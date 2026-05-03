import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SectionCard from '../components/SectionCard';
import RichTextField from '../components/RichTextField';
import Cropper from 'react-easy-crop';
import 'react-easy-crop/react-easy-crop.css';

const emptyDoc = { schema_version: 1, blocks: [] };

const AUTOSAVE_DEBOUNCE_MS = 1600;

/** Stable snapshot for deduping autosave (draft title normalizes to Untitled draft when empty). */
function normalizedEditorSnapshot(title, description, doc, isDraft) {
  const t = String(title || '').trim() || (isDraft ? 'Untitled draft' : '');
  return JSON.stringify({
    t,
    d: String(description || '').trim(),
    c: doc,
  });
}
const STANDARD_COLORS = ['#111827', '#334155', '#1e3a8a', '#0f766e', '#166534', '#b45309', '#b91c1c', '#7c3aed'];
const HEADING_COLOR = '#1e3a8a';
const SUBHEADING_ONE_COLOR = '#0f766e';
const SUBHEADING_TWO_COLOR = '#7c3aed';
const PARAGRAPH_COLOR = '#334155';
const RATIO_MAP = {
  '1:1': 1,
  '4:3': 4 / 3,
  '16:9': 16 / 9,
};

function defaultHeadingAlign(level) {
  return level === 1 ? 'center' : 'left';
}

function defaultHeadingColor(level) {
  if (level === 1) return HEADING_COLOR;
  if (level === 2) return SUBHEADING_ONE_COLOR;
  return SUBHEADING_TWO_COLOR;
}

function applyCasing(text, mode) {
  const t = String(text || '');
  if (mode === 'allCaps') return t.toUpperCase();
  if (mode === 'smallCaps') return t.toLowerCase();
  if (mode === 'titleCase') {
    return t.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  }
  if (mode === 'sentenceCase') {
    const s = t.toLowerCase().trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return t;
}

function mediaAlignStyle(align) {
  const a = align || 'center';
  if (a === 'left') return { marginLeft: 0, marginRight: 'auto' };
  if (a === 'right') return { marginLeft: 'auto', marginRight: 0 };
  return { marginLeft: 'auto', marginRight: 'auto' };
}

function safeParse(input) {
  try {
    if (!input) return emptyDoc;
    const parsed = typeof input === 'string' ? JSON.parse(input) : input;
    if (!parsed || !Array.isArray(parsed.blocks)) return emptyDoc;
    return { schema_version: Number(parsed.schema_version || 1), blocks: parsed.blocks };
  } catch {
    return emptyDoc;
  }
}

function sanitizePastedHtmlString(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');
}

function escapeHtmlText(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Plain clipboard → minimal HTML paragraphs (when text/html is missing). */
function plainTextToPseudoHtml(plain) {
  const t = String(plain || '').replace(/\u00a0/g, ' ');
  if (!t.trim()) return '';
  const paras = t.split(/\r?\n\r?\n/).map((p) => p.trim()).filter(Boolean);
  if (paras.length === 0) return `<p>${escapeHtmlText(t.trim())}</p>`;
  return paras.map((p) => `<p>${escapeHtmlText(p)}</p>`).join('');
}

function parseColorFromElement(el) {
  const style = el.getAttribute('style') || '';
  const m =
    style.match(/color:\s*([^;]+)/i) ||
    style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
  if (!m) return '';
  let c = m[1].trim();
  if (c.startsWith('rgb')) return c;
  if (c.startsWith('#')) return c.length >= 4 ? c : '';
  return c;
}

const DEFAULT_SPAN = () => ({
  text: '',
  bold: false,
  italic: false,
  underline: false,
  color: PARAGRAPH_COLOR,
  href: '',
});

function mergeAdjacentSpans(spans) {
  const out = [];
  spans.forEach((s) => {
    const t = String(s.text ?? '');
    if (!t) return;
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.bold === s.bold &&
      prev.italic === s.italic &&
      prev.underline === s.underline &&
      (prev.color || PARAGRAPH_COLOR) === (s.color || PARAGRAPH_COLOR) &&
      (prev.href || '') === (s.href || '')
    ) {
      prev.text += t;
    } else {
      out.push({ ...s, text: t });
    }
  });
  return out.length ? out : [{ ...DEFAULT_SPAN(), text: '' }];
}

function extractSpansFromRichElement(root, base = {}) {
  const baseStyle = {
    bold: !!base.bold,
    italic: !!base.italic,
    underline: !!base.underline,
    color: base.color || PARAGRAPH_COLOR,
    href: base.href || '',
  };
  const raw = [];
  function walk(node, st) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = String(node.textContent ?? '').replace(/\u00a0/g, ' ');
      if (text) raw.push({ ...st, text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = String(node.tagName || '').toLowerCase();
    let next = { ...st };
    if (tag === 'b' || tag === 'strong') next.bold = true;
    if (tag === 'i' || tag === 'em') next.italic = true;
    if (tag === 'u') next.underline = true;
    if (tag === 'a') next.href = node.getAttribute('href') || '';
    if (tag === 'span' || tag === 'font') {
      const col = parseColorFromElement(node);
      if (col) next.color = col;
    }
    Array.from(node.childNodes).forEach((ch) => walk(ch, next));
  }
  walk(root, baseStyle);
  return mergeAdjacentSpans(raw.map((r) => ({ ...DEFAULT_SPAN(), ...r })));
}

function parseFontSizePxFromStyle(styleStr) {
  if (!styleStr) return 0;
  const m = String(styleStr).match(/font-size:\s*([0-9.]+)\s*(pt|px|em)/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = m[2].toLowerCase();
  if (u === 'pt') return n * (96 / 72);
  if (u === 'px') return n;
  if (u === 'em') return n * 16;
  return 0;
}

function maxFontSizePx(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return 0;
  let max = parseFontSizePxFromStyle(el.getAttribute('style') || '');
  const nested = el.querySelectorAll('span[style*="font-size"], font[style*="font-size"]');
  nested.forEach((n) => {
    const fs = parseFontSizePxFromStyle(n.getAttribute('style') || '');
    if (fs > max) max = fs;
  });
  return max;
}

function classifyParagraphAsHeadingLevel(el) {
  const tag = String(el.tagName || '').toLowerCase();
  if (tag !== 'p') return null;
  const cls = (el.getAttribute('class') || '').toLowerCase();
  if (/msotitle|^title$|paragraph-title/.test(cls) && !/subtitle/.test(cls)) return 1;
  if (/msoheading1|heading1|msographicheading1/.test(cls)) return 1;
  if (/msoheading2|heading2/.test(cls)) return 2;
  if (/msoheading3|heading3/.test(cls)) return 3;
  if (/msoheading4|msoheading5|msoheading6|heading4|heading5|heading6/.test(cls)) return 3;

  const role = el.getAttribute('role');
  const aria = el.getAttribute('aria-level');
  if (role === 'heading' && aria) {
    const n = parseInt(aria, 10);
    if (n >= 1 && n <= 3) return n;
    if (n > 3) return 3;
  }

  const fs = maxFontSizePx(el);
  if (fs >= 22) return 1;
  if (fs >= 17.5) return 2;
  if (fs >= 15) return 3;

  const style = (el.getAttribute('style') || '').toLowerCase();
  if (/font-weight:\s*(700|bold)/.test(style) && fs >= 14) {
    if (fs >= 18) return 2;
    return 3;
  }

  return null;
}

function isProbablyOrderedListParagraph(el) {
  const t = String(el.textContent || '').trim();
  return /^\s*\d{1,3}[.)]\s/.test(t) || /^\s*[a-z][.)]\s/i.test(t);
}

function isProbablyWordListParagraph(el) {
  const cls = (el.getAttribute('class') || '').toLowerCase();
  const style = (el.getAttribute('style') || '').toLowerCase();
  if (/msolistparagraph|list-paragraph|bulleted|numbered/.test(cls)) return true;
  if (/mso-list/.test(style)) return true;
  const t = String(el.textContent || '').trim();
  if (/^[•▪▸◦○●■\-–—\u2022\u2023\u25E6\u2043]\s*/.test(t)) return true;
  if (isProbablyOrderedListParagraph(el)) return true;
  return false;
}

function parseTextAlignFromElement(el) {
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
  const a = String(el.getAttribute('align') || '').toLowerCase();
  if (['left', 'right', 'center', 'justify'].includes(a)) return a;
  const style = el.getAttribute('style') || '';
  const m = style.match(/text-align:\s*([^;]+)/i);
  if (!m) return '';
  const v = m[1].trim().toLowerCase();
  if (v === 'start') return 'left';
  if (v === 'end') return 'right';
  if (['left', 'right', 'center', 'justify'].includes(v)) return v;
  return '';
}

/** Word and some editors use a styled paragraph instead of a blockquote element. */
function isProbablyQuotedParagraph(el) {
  const tag = String(el.tagName || '').toLowerCase();
  if (tag !== 'p') return false;
  if (isProbablyWordListParagraph(el)) return false;
  const cls = (el.getAttribute('class') || '').toLowerCase();
  if (/\b(quote|pullquote|block-quote|block_quote|msoquote|blockquotetext)\b/.test(cls)) return true;
  const style = (el.getAttribute('style') || '').toLowerCase();
  if (/mso-style-name:\s*['"]?quote/.test(style)) return true;
  if (/border-left:\s*[^;]{3,}/.test(style) && /padding-left:\s*\d/.test(style)) return true;
  return false;
}

function headingLevelFromTag(tagName) {
  const m = String(tagName || '').match(/^h([1-6])$/i);
  if (!m) return 1;
  const n = parseInt(m[1], 10);
  return Math.min(Math.max(n, 1), 3);
}

function newId() {
  return `${Date.now()}-${Math.random()}`;
}

/** Document-order segments (tables / lists not descended into twice). */
function extractPasteSegments(body) {
  const segments = [];
  function walk(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = String(node.textContent ?? '').replace(/\u00a0/g, ' ');
      if (t.trim()) segments.push({ kind: 'text', text: t });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = String(node.tagName || '').toLowerCase();

    if (tag === 'table') {
      segments.push({ kind: 'table', el: node });
      return;
    }
    if (tag === 'img') {
      segments.push({ kind: 'image', el: node });
      return;
    }
    if (tag === 'ul') {
      segments.push({ kind: 'bulletList', el: node, native: true });
      return;
    }
    if (tag === 'ol') {
      segments.push({ kind: 'numberedList', el: node, native: true });
      return;
    }
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tag)) {
      segments.push({ kind: 'heading', el: node, level: headingLevelFromTag(tag) });
      return;
    }
    if (tag === 'hr') {
      segments.push({ kind: 'divider' });
      return;
    }
    if (tag === 'blockquote') {
      segments.push({ kind: 'highlightedQuote', el: node });
      return;
    }
    if (tag === 'p') {
      const textOnly = String(node.textContent || '').replace(/\u00a0/g, ' ').trim();
      const imgs = node.querySelectorAll('img');
      if (imgs.length === 1 && !textOnly) {
        segments.push({ kind: 'image', el: imgs[0] });
        return;
      }
      const hl = classifyParagraphAsHeadingLevel(node);
      if (hl) {
        segments.push({ kind: 'heading', el: node, level: hl });
        return;
      }
      if (isProbablyQuotedParagraph(node)) {
        segments.push({ kind: 'highlightedQuote', el: node });
        return;
      }
      if (isProbablyWordListParagraph(node)) {
        const ordered = isProbablyOrderedListParagraph(node);
        segments.push({ kind: 'listParagraph', el: node, ordered });
        return;
      }
      segments.push({ kind: 'paragraph', el: node });
      return;
    }
    if (tag === 'li') {
      segments.push({ kind: 'paragraph', el: node });
      return;
    }
    if (['div', 'section', 'article', 'main', 'center', 'header', 'footer', 'aside', 'figure', 'figcaption'].includes(tag)) {
      Array.from(node.childNodes).forEach(walk);
      return;
    }
    if (tag === 'br') {
      segments.push({ kind: 'break' });
      return;
    }
    if (tag === 'script' || tag === 'style' || tag === 'meta' || tag === 'link' || tag === 'noscript') return;
    Array.from(node.childNodes).forEach(walk);
  }
  Array.from(body.childNodes).forEach(walk);
  return segments;
}

function collapseTextAndBreakSegments(segments) {
  const out = [];
  let buf = [];
  function flush() {
    if (!buf.length) return;
    const merged = buf
      .map((x) => (x.kind === 'break' ? '\n' : x.text))
      .join('')
      .replace(/\u00a0/g, ' ');
    if (merged.trim()) {
      out.push({ kind: 'paragraph', synthetic: true, text: merged.trim() });
    }
    buf = [];
  }
  segments.forEach((s) => {
    if (s.kind === 'text' || s.kind === 'break') {
      buf.push(s);
      return;
    }
    flush();
    out.push(s);
  });
  flush();
  return out;
}

function collapseListParagraphRuns(segments) {
  const out = [];
  let i = 0;
  while (i < segments.length) {
    const s = segments[i];
    if (s.kind === 'listParagraph') {
      const ordered = !!s.ordered;
      const els = [s.el];
      let j = i + 1;
      while (
        j < segments.length &&
        segments[j].kind === 'listParagraph' &&
        !!segments[j].ordered === ordered
      ) {
        els.push(segments[j].el);
        j += 1;
      }
      out.push({
        kind: ordered ? 'numberedList' : 'bulletList',
        native: false,
        elements: els,
      });
      i = j;
      continue;
    }
    out.push(s);
    i += 1;
  }
  return out;
}

function tableRowsFromEl(tableEl) {
  return Array.from(tableEl.querySelectorAll('tr')).map((r) =>
    Array.from(r.querySelectorAll('th,td')).map((c) => String(c.textContent || '').trim())
  );
}

const MAX_LIST_LEVEL = 8;

/** Recursive native ul/ol → flat items with spans + nesting level (paste). */
function flattenNativeListToItems(listEl) {
  const items = [];
  function walk(ulOrOl, level) {
    const lis = Array.from(ulOrOl.children).filter((n) => String(n.tagName).toLowerCase() === 'li');
    for (const li of lis) {
      const nestedLists = [];
      const wrapper = document.createElement('div');
      Array.from(li.childNodes).forEach((ch) => {
        if (ch.nodeType === 1) {
          const t = String(ch.tagName).toLowerCase();
          if (t === 'ul' || t === 'ol') {
            nestedLists.push(ch);
            return;
          }
        }
        wrapper.appendChild(ch.cloneNode(true));
      });
      const spans = extractSpansFromRichElement(wrapper, {});
      const plain = String(wrapper.textContent || '').replace(/\u00a0/g, ' ').trim();
      const hasSpanText = spans.some((s) => String(s.text || '').trim());
      if (hasSpanText || plain) {
        items.push({
          spans: hasSpanText ? spans : mergeAdjacentSpans([{ ...DEFAULT_SPAN(), text: plain }]),
          level: Math.min(Math.max(level, 0), MAX_LIST_LEVEL),
        });
      }
      nestedLists.forEach((nl) => walk(nl, level + 1));
    }
  }
  walk(listEl, 0);
  return items;
}

/** Word “list paragraph” indent → approximate level. */
function inferListParagraphLevel(el) {
  const st = (el.getAttribute('style') || '').toLowerCase();
  const m = st.match(/margin-left:\s*([0-9.]+)\s*(pt|px|em|rem)?/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const u = (m[2] || 'px').toLowerCase();
  const px = u === 'pt' ? n * (96 / 72) : u === 'em' || u === 'rem' ? n * 16 : n;
  const steps = Math.round(px / 36);
  return Math.min(MAX_LIST_LEVEL, Math.max(0, steps));
}

function bulletGlyphForLevel(level) {
  const L = Math.min(Math.max(Number(level) || 0, 0), MAX_LIST_LEVEL);
  if (L <= 0) return '•';
  if (L === 1) return '◦';
  return '▪';
}

/** Hierarchical outline labels for flat numbered list rows with levels. */
function computeOrderedListLabels(items) {
  const path = [];
  return (items || []).map((it) => {
    const L = Math.min(Math.max(Number(it.level) || 0, 0), MAX_LIST_LEVEL);
    while (path.length > L + 1) path.pop();
    path.length = L + 1;
    path[L] = (path[L] || 0) + 1;
    return path.join('.');
  });
}

function normalizeListItem(it) {
  if (!it || typeof it !== 'object') return { spans: [{ ...DEFAULT_SPAN(), text: '' }], level: 0 };
  const level = Math.min(MAX_LIST_LEVEL, Math.max(0, Number(it.level) || 0));
  const spans = Array.isArray(it.spans) && it.spans.length ? it.spans : [{ ...DEFAULT_SPAN(), text: String(it.text || '') }];
  return { spans, level };
}

function segmentToBlock(seg) {
  const id = newId();
  if (seg.kind === 'divider') {
    return [{ id, type: 'divider' }];
  }
  if (seg.kind === 'heading') {
    const level = seg.level || 1;
    const spans = extractSpansFromRichElement(seg.el, {
      bold: true,
      color: defaultHeadingColor(level),
    });
    const fixed = spans.map((s) => ({
      ...s,
      color: s.color && s.color !== PARAGRAPH_COLOR ? s.color : defaultHeadingColor(level),
      bold: true,
    }));
    return [
      {
        id,
        type: 'heading',
        level,
        align: defaultHeadingAlign(level),
        casing: level === 1 ? 'allCaps' : 'titleCase',
        color: defaultHeadingColor(level),
        spans: fixed.length
          ? fixed
          : [{ ...DEFAULT_SPAN(), text: String(seg.el.textContent || '').trim(), bold: true, color: defaultHeadingColor(level) }],
      },
    ];
  }
  if (seg.kind === 'paragraph' && seg.synthetic) {
    return [
      {
        id,
        type: 'paragraph',
        spans: mergeAdjacentSpans([{ ...DEFAULT_SPAN(), text: seg.text }]),
      },
    ];
  }
  if (seg.kind === 'paragraph') {
    const spans = extractSpansFromRichElement(seg.el, {});
    const text = String(seg.el.textContent || '').trim();
    if (!text && !seg.el.querySelector('img')) return [];
    return [
      {
        id,
        type: 'paragraph',
        spans: spans.length && spans.some((s) => s.text) ? spans : mergeAdjacentSpans([{ ...DEFAULT_SPAN(), text }]),
      },
    ];
  }
  if (seg.kind === 'image') {
    const src = seg.el.getAttribute('src');
    if (!src) return [];
    return [{ id, type: 'image', url: src, caption: '' }];
  }
  if (seg.kind === 'table') {
    const rows = tableRowsFromEl(seg.el);
    if (!rows.length) return [];
    return [{ id, type: 'table', rows }];
  }
  if (seg.kind === 'bulletList' || seg.kind === 'numberedList') {
    let items = [];
    if (seg.native) {
      items = flattenNativeListToItems(seg.el).map(normalizeListItem);
    } else {
      items = (seg.elements || []).map((el) =>
        normalizeListItem({
          spans: extractSpansFromRichElement(el, {}),
          level: inferListParagraphLevel(el),
        }),
      );
    }
    if (!items.length) return [];
    const type = seg.kind === 'numberedList' ? 'numberedList' : 'bulletList';
    return [{ id, type, items }];
  }
  if (seg.kind === 'highlightedQuote') {
    const el = seg.el;
    const text = String(el.textContent || '').trim();
    if (!text && !el.querySelector('img')) return [];
    const align = parseTextAlignFromElement(el) || 'left';
    let html = String(el.innerHTML || '').trim();
    if (!html) return [];
    if (!/<[a-z]/i.test(html)) {
      html = `<p style="color:${HEADING_COLOR};text-align:${align}">${escapeHtmlText(html)}</p>`;
    }
    return [{ id, type: 'highlightedQuote', align, html }];
  }
  return [];
}

function normalizePastedHtmlToBlocks(htmlText) {
  if (!htmlText || !String(htmlText).trim()) return [];
  const clean = sanitizePastedHtmlString(htmlText);
  const parser = new DOMParser();
  const doc = parser.parseFromString(clean, 'text/html');
  const body = doc.body;

  let segments = extractPasteSegments(body);
  segments = collapseTextAndBreakSegments(segments);
  segments = collapseListParagraphRuns(segments);

  if (!segments.length) {
    const plain = String(body.textContent || '').replace(/\u00a0/g, ' ').trim();
    if (!plain) return [];
    return [
      {
        id: newId(),
        type: 'paragraph',
        spans: mergeAdjacentSpans([{ ...DEFAULT_SPAN(), text: plain }]),
      },
    ];
  }

  const blocks = [];
  segments.forEach((seg) => {
    segmentToBlock(seg).forEach((b) => blocks.push(b));
  });
  return blocks;
}

function inlineSpans(block) {
  if (Array.isArray(block.spans) && block.spans.length) return block.spans;
  const text = String(block.text || '');
  return [{ text, bold: !!block.bold, italic: !!block.italic, underline: !!block.underline, color: block.color || '#334155', href: '' }];
}

function escapeHtmlAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function htmlToPlainWithBreaks(html) {
  if (!html) return '';
  if (typeof document === 'undefined') {
    return String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' ');
  }
  const d = document.createElement('div');
  d.innerHTML = html;
  return String(d.innerText || d.textContent || '').replace(/\u00a0/g, ' ');
}

function paragraphHtmlHasContent(html) {
  return htmlToPlainWithBreaks(html || '').trim().length > 0;
}

function spansToParagraphHtml(spans) {
  const list = Array.isArray(spans) && spans.length ? spans : [{ ...DEFAULT_SPAN(), text: '' }];
  const parts = list.map((s) => {
    const color = s.color || PARAGRAPH_COLOR;
    const st = [
      s.bold ? 'font-weight:700' : 'font-weight:400',
      s.italic ? 'font-style:italic' : '',
      s.underline ? 'text-decoration:underline' : '',
      `color:${color}`,
    ]
      .filter(Boolean)
      .join(';');
    const inner = escapeHtmlText(String(s.text ?? '')).replace(/\r\n|\r|\n/g, '<br />');
    if (s.href) {
      return `<a href="${escapeHtmlAttr(s.href)}" style="${escapeHtmlAttr(st)}" target="_blank" rel="noreferrer">${inner}</a>`;
    }
    return `<span style="${escapeHtmlAttr(st)}">${inner}</span>`;
  });
  return `<p style="color:${PARAGRAPH_COLOR};text-align:left">${parts.join('')}</p>`;
}

/** Rich text editor value: HTML when author typed HTML; otherwise synthesize from spans (paste pipeline). */
function paragraphRichEditorValue(block) {
  if (block.type !== 'paragraph') return '';
  if (paragraphHtmlHasContent(block.html)) return block.html;
  return spansToParagraphHtml(inlineSpans(block));
}

function paragraphSpansForMerge(block) {
  if (block.type !== 'paragraph') return inlineSpans(block);
  if (Array.isArray(block.spans) && block.spans.some((s) => String(s.text || '').length)) return inlineSpans(block);
  if (paragraphHtmlHasContent(block.html)) {
    return [{ ...DEFAULT_SPAN(), text: htmlToPlainWithBreaks(block.html) }];
  }
  return [{ ...DEFAULT_SPAN(), text: '' }];
}

function blockPlainTextMergeable(block) {
  if (block.type === 'paragraph') {
    if (paragraphHtmlHasContent(block.html)) return htmlToPlainWithBreaks(block.html);
    return inlineSpans(block)
      .map((s) => s.text || '')
      .join('');
  }
  if (block.type === 'heading') return inlineSpans(block).map((s) => s.text || '').join('');
  if (block.type === 'highlightedQuote') return htmlToPlainWithBreaks(block.html || '');
  if (block.type === 'bulletList' || block.type === 'numberedList') {
    return (block.items || []).map((it) => (it.spans || []).map((s) => s.text || '').join('')).join('\n');
  }
  if (block.type === 'table') return (block.rows || []).map((r) => r.join('\t')).join('\n');
  if (block.type === 'divider') return '';
  return null;
}

function canMergeStudyBlocks(a, b) {
  const assetLike = ['image', 'image_v2', 'gif', 'imageCarousel', 'pdfAttachment', 'audioAttachment'];
  if (assetLike.includes(a.type) || assetLike.includes(b.type)) return false;
  if (a.type === 'paragraph' && b.type === 'paragraph') return true;
  if (a.type === 'heading' && b.type === 'heading') return true;
  if ((a.type === 'paragraph' && b.type === 'heading') || (a.type === 'heading' && b.type === 'paragraph')) return true;
  if (a.type === 'bulletList' && b.type === 'bulletList') return true;
  if (a.type === 'numberedList' && b.type === 'numberedList') return true;
  if (a.type === 'table' && b.type === 'table') return true;
  if (a.type === 'highlightedQuote' && b.type === 'highlightedQuote') return true;
  if (a.type === 'divider' && b.type === 'paragraph') return true;
  if (a.type === 'paragraph' && b.type === 'divider') return true;
  const ta = blockPlainTextMergeable(a);
  const tb = blockPlainTextMergeable(b);
  return ta !== null && tb !== null;
}

function mergeTwoStudyBlocks(a, b) {
  const id = a.id;
  const joinNL = { ...DEFAULT_SPAN(), text: '\n' };
  if (a.type === 'paragraph' && b.type === 'paragraph') {
    return {
      id,
      type: 'paragraph',
      spans: mergeAdjacentSpans([...paragraphSpansForMerge(a), joinNL, ...paragraphSpansForMerge(b)]),
      html: undefined,
    };
  }
  if (a.type === 'heading' && b.type === 'heading') {
    return {
      id,
      type: 'paragraph',
      spans: mergeAdjacentSpans([...inlineSpans(a), joinNL, ...inlineSpans(b)]),
      html: undefined,
    };
  }
  if ((a.type === 'paragraph' && b.type === 'heading') || (a.type === 'heading' && b.type === 'paragraph')) {
    const pa = a.type === 'paragraph' ? a : b;
    const ha = a.type === 'heading' ? a : b;
    return {
      id,
      type: 'paragraph',
      spans: mergeAdjacentSpans([...paragraphSpansForMerge(pa), joinNL, ...inlineSpans(ha)]),
      html: undefined,
    };
  }
  if (a.type === 'bulletList' && b.type === 'bulletList') {
    return { id, type: 'bulletList', items: [...(a.items || []), ...(b.items || [])] };
  }
  if (a.type === 'numberedList' && b.type === 'numberedList') {
    return { id, type: 'numberedList', items: [...(a.items || []), ...(b.items || [])] };
  }
  if (a.type === 'table' && b.type === 'table') {
    return { id, type: 'table', rows: [...(a.rows || []), ...(b.rows || [])] };
  }
  if (a.type === 'highlightedQuote' && b.type === 'highlightedQuote') {
    const ha = `<div>${a.html || ''}</div><div>${b.html || ''}</div>`;
    return { id, type: 'highlightedQuote', html: ha, align: a.align || 'left' };
  }
  if (a.type === 'divider' && b.type === 'paragraph') return { ...b, id };
  if (a.type === 'paragraph' && b.type === 'divider') return { ...a, id };
  const ta = blockPlainTextMergeable(a);
  const tb = blockPlainTextMergeable(b);
  if (ta !== null && tb !== null) {
    return {
      id,
      type: 'paragraph',
      spans: [{ ...DEFAULT_SPAN(), text: `${ta}\n${tb}`.trim() }],
      html: undefined,
    };
  }
  return null;
}

/** Allowed "Convert to" targets per block type (no nonsense e.g. divider → table). */
const STUDY_BLOCK_CONVERT_TARGETS = {
  heading: ['paragraph', 'highlightedQuote', 'bulletList', 'numberedList'],
  paragraph: ['heading', 'highlightedQuote', 'bulletList', 'numberedList', 'divider'],
  highlightedQuote: ['paragraph', 'heading', 'bulletList', 'numberedList'],
  bulletList: ['paragraph', 'numberedList', 'heading'],
  numberedList: ['paragraph', 'bulletList', 'heading'],
  table: ['paragraph', 'bulletList'],
  divider: ['paragraph'],
};

function convertStudyBlock(block, targetType) {
  const id = block.id;
  if (block.type === targetType) return null;

  if (targetType === 'paragraph') {
    if (block.type === 'heading') {
      return {
        id,
        type: 'paragraph',
        html: spansToParagraphHtml(inlineSpans(block)),
        spans: [],
      };
    }
    if (block.type === 'highlightedQuote') {
      return {
        id,
        type: 'paragraph',
        html: block.html || `<p style="color:${PARAGRAPH_COLOR}"></p>`,
        spans: [],
      };
    }
    if (block.type === 'bulletList' || block.type === 'numberedList') {
      const lines = (block.items || []).map((it) => (it.spans || []).map((s) => s.text || '').join('')).filter(Boolean);
      const text = lines.join('\n');
      return {
        id,
        type: 'paragraph',
        spans: [{ ...DEFAULT_SPAN(), text }],
        html: undefined,
      };
    }
    if (block.type === 'table') {
      const text = (block.rows || []).map((r) => r.join('\t')).join('\n');
      return { id, type: 'paragraph', spans: [{ ...DEFAULT_SPAN(), text }], html: undefined };
    }
    if (block.type === 'divider') {
      return { id, type: 'paragraph', html: `<p style="color:${PARAGRAPH_COLOR}"><br /></p>`, spans: [] };
    }
  }

  if (targetType === 'heading') {
    const mkHeading = (spans, level = 2) => ({
      id,
      type: 'heading',
      level,
      align: defaultHeadingAlign(level),
      casing: level === 1 ? 'allCaps' : 'titleCase',
      color: defaultHeadingColor(level),
      spans: spans.map((s) => ({
        ...s,
        bold: true,
        color: s.color && s.color !== PARAGRAPH_COLOR ? s.color : defaultHeadingColor(level),
      })),
    });
    if (block.type === 'paragraph') {
      const spans = paragraphSpansForMerge(block).map((s) => ({
        ...s,
        bold: true,
        color: s.color && s.color !== PARAGRAPH_COLOR ? s.color : SUBHEADING_ONE_COLOR,
      }));
      return mkHeading(spans.length ? spans : [{ ...DEFAULT_SPAN(), text: '', bold: true, color: HEADING_COLOR }], 2);
    }
    if (block.type === 'highlightedQuote') {
      const t = htmlToPlainWithBreaks(block.html || '').trim() || 'Heading';
      return mkHeading([{ ...DEFAULT_SPAN(), text: t, bold: true, color: HEADING_COLOR }], 2);
    }
    if (block.type === 'bulletList' || block.type === 'numberedList') {
      const t = (block.items || []).map((it) => (it.spans || []).map((s) => s.text || '').join(' ')).join(' ') || 'Heading';
      return mkHeading([{ ...DEFAULT_SPAN(), text: t, bold: true, color: HEADING_COLOR }], 2);
    }
    if (block.type === 'table') {
      const t = (block.rows || []).map((r) => r.join(' ')).join(' ') || 'Heading';
      return mkHeading([{ ...DEFAULT_SPAN(), text: t, bold: true, color: HEADING_COLOR }], 2);
    }
  }

  if (targetType === 'highlightedQuote') {
    const htmlFromPara = () => {
      if (paragraphHtmlHasContent(block.html)) return block.html;
      return spansToParagraphHtml(inlineSpans(block));
    };
    if (block.type === 'paragraph') {
      return { id, type: 'highlightedQuote', align: 'left', html: htmlFromPara() };
    }
    if (block.type === 'heading') {
      return {
        id,
        type: 'highlightedQuote',
        align: 'left',
        html: `<p style="color:${HEADING_COLOR}">${inlineSpans(block).map((s) => `<strong>${escapeHtmlText(s.text || '')}</strong>`).join(' ')}</p>`,
      };
    }
    if (block.type === 'bulletList' || block.type === 'numberedList') {
      const inner = (block.items || [])
        .map((it) => `<p>${escapeHtmlText((it.spans || []).map((s) => s.text || '').join(''))}</p>`)
        .join('');
      return {
        id,
        type: 'highlightedQuote',
        align: 'left',
        html: inner || `<p style="color:${HEADING_COLOR}">Highlighted quote</p>`,
      };
    }
  }

  if (targetType === 'bulletList') {
    const linesFromParagraph = () => {
      const t = paragraphHtmlHasContent(block.html)
        ? htmlToPlainWithBreaks(block.html)
        : inlineSpans(block)
          .map((s) => s.text || '')
          .join('');
      return t.split(/\n/).map((x) => x.trim()).filter(Boolean);
    };
    if (block.type === 'paragraph') {
      const lines = linesFromParagraph();
      return {
        id,
        type: 'bulletList',
        items: lines.length
          ? lines.map((line) => ({ spans: [{ ...DEFAULT_SPAN(), text: line }], level: 0 }))
          : [{ spans: [{ ...DEFAULT_SPAN(), text: '' }], level: 0 }],
      };
    }
    if (block.type === 'numberedList') {
      return { id, type: 'bulletList', items: [...(block.items || []).map(normalizeListItem)] };
    }
    if (block.type === 'heading') {
      const t = inlineSpans(block).map((s) => s.text || '').join(' ') || 'Item';
      return { id, type: 'bulletList', items: [{ spans: [{ ...DEFAULT_SPAN(), text: t }], level: 0 }] };
    }
    if (block.type === 'table') {
      const items = (block.rows || []).map((row) => ({
        spans: [{ ...DEFAULT_SPAN(), text: row.join(' — ') }],
        level: 0,
      }));
      return {
        id,
        type: 'bulletList',
        items: items.length ? items : [{ spans: [{ ...DEFAULT_SPAN(), text: '' }], level: 0 }],
      };
    }
    if (block.type === 'highlightedQuote') {
      const lines = htmlToPlainWithBreaks(block.html || '')
        .split(/\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      return {
        id,
        type: 'bulletList',
        items: lines.length
          ? lines.map((line) => ({ spans: [{ ...DEFAULT_SPAN(), text: line }], level: 0 }))
          : [{ spans: [{ ...DEFAULT_SPAN(), text: '' }], level: 0 }],
      };
    }
  }

  if (targetType === 'numberedList') {
    if (block.type === 'bulletList') {
      return { id, type: 'numberedList', items: [...(block.items || []).map(normalizeListItem)] };
    }
    const linesFromParagraph = () => {
      const t = paragraphHtmlHasContent(block.html)
        ? htmlToPlainWithBreaks(block.html)
        : inlineSpans(block)
          .map((s) => s.text || '')
          .join('');
      return t.split(/\n/).map((x) => x.trim()).filter(Boolean);
    };
    if (block.type === 'paragraph') {
      const lines = linesFromParagraph();
      return {
        id,
        type: 'numberedList',
        items: lines.length
          ? lines.map((line) => ({ spans: [{ ...DEFAULT_SPAN(), text: line }], level: 0 }))
          : [{ spans: [{ ...DEFAULT_SPAN(), text: '' }], level: 0 }],
      };
    }
    if (block.type === 'heading') {
      const t = inlineSpans(block).map((s) => s.text || '').join(' ') || 'Item';
      return { id, type: 'numberedList', items: [{ spans: [{ ...DEFAULT_SPAN(), text: t }], level: 0 }] };
    }
    if (block.type === 'table') {
      const items = (block.rows || []).map((row) => ({
        spans: [{ ...DEFAULT_SPAN(), text: row.join(' — ') }],
        level: 0,
      }));
      return {
        id,
        type: 'numberedList',
        items: items.length ? items : [{ spans: [{ ...DEFAULT_SPAN(), text: '' }], level: 0 }],
      };
    }
    if (block.type === 'highlightedQuote') {
      const lines = htmlToPlainWithBreaks(block.html || '')
        .split(/\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      return {
        id,
        type: 'numberedList',
        items: lines.length
          ? lines.map((line) => ({ spans: [{ ...DEFAULT_SPAN(), text: line }], level: 0 }))
          : [{ spans: [{ ...DEFAULT_SPAN(), text: '' }], level: 0 }],
      };
    }
  }

  if (targetType === 'divider' && block.type === 'paragraph') {
    return { id, type: 'divider' };
  }

  return null;
}

function renderInlineSpans(spans, fallback, casing) {
  const normalized = Array.isArray(spans) && spans.length ? spans : [{ text: fallback || '' }];
  return normalized.map((s, i) => {
    const style = {
      color: s.color || '#334155',
      fontWeight: s.bold ? 700 : 400,
      fontStyle: s.italic ? 'italic' : 'normal',
      textDecoration: s.underline ? 'underline' : 'none',
    };
    const txt = applyCasing(s.text || '', casing);
    if (s.href) {
      return <a key={`${i}-${txt}`} href={s.href} target="_blank" rel="noreferrer" style={style}>{txt}</a>;
    }
    return <span key={`${i}-${txt}`} style={style}>{txt}</span>;
  });
}

async function optimizeImageAtRatio(file, ratio) {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = srcUrl;
    });
    const srcW = img.width;
    const srcH = img.height;
    let cropW = srcW;
    let cropH = srcH;
    if (ratio && ratio !== 'free') {
      const [rw, rh] = ratio.split(':').map(Number);
      const targetRatio = rw / rh;
      const srcRatio = srcW / srcH;
      if (srcRatio > targetRatio) cropW = Math.round(srcH * targetRatio);
      else cropH = Math.round(srcW / targetRatio);
    }
    const sx = Math.max(0, Math.floor((srcW - cropW) / 2));
    const sy = Math.max(0, Math.floor((srcH - cropH) / 2));
    const outW = Math.min(1600, cropW);
    const outH = Math.min(1600, cropH);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process image');
    ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, outW, outH);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', 0.86);
    });
    return new File([blob], `${Date.now()}-optimized.jpg`, { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

async function buildCroppedFileFromDraft(draft) {
  const srcUrl = draft.url || URL.createObjectURL(draft.file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = srcUrl;
    });
    const [rw, rh] = draft.ratio && draft.ratio !== 'free'
      ? draft.ratio.split(':').map(Number)
      : [img.width, img.height];
    const ratio = rw / rh;
    const outW = 1400;
    const outH = Math.round(outW / ratio);
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create canvas');

    const zoom = Math.max(1, Number(draft.zoom || 1));
    const sxRange = Math.max(0, img.width - img.width / zoom);
    const syRange = Math.max(0, img.height - img.height / zoom);
    const panX = Number(draft.panX || 0); // -1..1
    const panY = Number(draft.panY || 0); // -1..1
    const sx = Math.max(0, Math.min(sxRange, ((panX + 1) / 2) * sxRange));
    const sy = Math.max(0, Math.min(syRange, ((panY + 1) / 2) * syRange));
    const sw = img.width / zoom;
    const sh = img.height / zoom;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), 'image/jpeg', 0.86);
    });
    return new File([blob], `${Date.now()}-cropped.jpg`, { type: 'image/jpeg' });
  } finally {
    if (!draft.url) URL.revokeObjectURL(srcUrl);
  }
}

function truncateBlockLabel(text, max = 52) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}…`;
}

function filenameFromAssetUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const base = url.split('?')[0];
    const seg = base.split('/').pop() || '';
    return decodeURIComponent(seg) || seg;
  } catch {
    return url.slice(-48);
  }
}

/** Short label for block list rows (editor sidebar). */
function blockSummaryLabel(block, cropDrafts = {}) {
  const b = block;
  if (!b?.type) return '';
  if (b.type === 'heading') {
    return truncateBlockLabel(inlineSpans(b).map((s) => s.text).join(''));
  }
  if (b.type === 'paragraph') {
    if (paragraphHtmlHasContent(b.html)) return truncateBlockLabel(htmlToPlainWithBreaks(b.html));
    return truncateBlockLabel(inlineSpans(b).map((s) => s.text).join(''));
  }
  if (b.type === 'highlightedQuote') {
    return truncateBlockLabel(htmlToPlainWithBreaks(b.html || ''));
  }
  if (b.type === 'bulletList' || b.type === 'numberedList') {
    const items = b.items || [];
    const first = items[0];
    const t = first ? (first.spans || []).map((s) => s.text || '').join('').trim() : '';
    if (items.length <= 1) return truncateBlockLabel(t || 'Empty list');
    return truncateBlockLabel(t ? `${t} (+${items.length - 1} more)` : `${items.length} items`);
  }
  if (b.type === 'image_v2' || b.type === 'image' || b.type === 'gif') {
    const url = b.renderCache?.derivedUrl || b.asset?.originalUrl || b.url || cropDrafts?.[`${b.id}`]?.url;
    const name = filenameFromAssetUrl(url);
    if (name) return truncateBlockLabel(name, 44);
    return b.type === 'gif' ? 'GIF' : 'Image';
  }
  if (b.type === 'imageCarousel') {
    const n = (b.items || []).length;
    return n ? `${n} slide${n === 1 ? '' : 's'}` : 'Carousel';
  }
  if (b.type === 'table') {
    const rows = b.rows || [];
    const r0 = rows[0];
    const sample = r0 ? r0.filter(Boolean).join(' · ') : '';
    return truncateBlockLabel(sample || `Table (${rows.length} row${rows.length === 1 ? '' : 's'})`);
  }
  if (b.type === 'pdfAttachment') {
    const label = b.label || filenameFromAssetUrl(b.url) || '';
    return truncateBlockLabel(label || 'PDF');
  }
  if (b.type === 'audioAttachment') {
    return truncateBlockLabel(b.title || filenameFromAssetUrl(b.url) || 'Audio');
  }
  if (b.type === 'divider') {
    return '—';
  }
  return '';
}

function Preview({ blocks, cropDrafts, variant = 'mobile', onBlockClick, selectedBlockId }) {
  const shellClass =
    variant === 'tablet'
      ? 'studyPreviewShell studyPreviewShell--tablet'
      : variant === 'desktop'
        ? 'studyPreviewShell studyPreviewShell--desktop'
        : 'studyPreviewShell studyPreviewShell--mobile';

  const interactive = typeof onBlockClick === 'function';

  function wrapBlock(b, inner) {
    const active = selectedBlockId && selectedBlockId === b.id;
    return (
      <div
        key={b.id}
        data-study-preview-block={b.id}
        className={[
          'studyPreviewBlock',
          interactive && 'studyPreviewBlock--selectable',
          active && 'studyPreviewBlock--active',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={
          interactive
            ? (e) => {
                const el = e.target;
                if (typeof el.closest === 'function') {
                  if (
                    el.closest('a[href]')
                    || el.closest('button')
                    || el.closest('audio')
                    || el.closest('input')
                    || el.closest('textarea')
                    || el.closest('select')
                  ) {
                    return;
                  }
                }
                onBlockClick(b.id);
              }
            : undefined
        }
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onBlockClick(b.id);
                }
              }
            : undefined
        }
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
      >
        {inner}
      </div>
    );
  }

  return (
    <div className={shellClass}>
      {blocks.map((b) => {
        if (b.type === 'heading') {
          const size = b.level === 1 ? 24 : b.level === 2 ? 20 : 18;
          return wrapBlock(
            b,
            <div
              style={{
                fontSize: size,
                fontWeight: b.bold ? 700 : 600,
                color: b.color || defaultHeadingColor(b.level || 2),
                marginBottom: 8,
                textAlign: b.align || defaultHeadingAlign(b.level || 2),
              }}
            >
              {renderInlineSpans(inlineSpans(b), 'Heading', b.casing || (b.level === 1 ? 'allCaps' : 'titleCase'))}
            </div>,
          );
        }
        if (b.type === 'paragraph') {
          if (paragraphHtmlHasContent(b.html)) {
            return wrapBlock(
              b,
              <div className="studyPreviewRichText" dangerouslySetInnerHTML={{ __html: b.html }} />,
            );
          }
          return wrapBlock(
            b,
            <div
              style={{
                fontSize: 15,
                color: b.color || '#334155',
                fontWeight: b.bold ? 700 : 400,
                fontStyle: b.italic ? 'italic' : 'normal',
                textDecorationLine: b.underline ? 'underline' : 'none',
                marginBottom: 10,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
              }}
            >
              {renderInlineSpans(inlineSpans(b), 'Paragraph text')}
            </div>,
          );
        }
        if (b.type === 'bulletList' || b.type === 'numberedList') {
          const listItems = b.items || [];
          const orderedLabels = b.type === 'numberedList' ? computeOrderedListLabels(listItems) : [];
          const ListEl = b.type === 'numberedList' ? 'ol' : 'ul';
          return wrapBlock(
            b,
            <ListEl className={`studyPreviewList studyPreviewList--leveled ${b.type === 'numberedList' ? 'isOrdered' : ''}`}>
              {listItems.map((item, i) => {
                const depth = Math.min(Math.max(Number(item.level) || 0, 0), MAX_LIST_LEVEL);
                const marker =
                  b.type === 'numberedList' ? `${orderedLabels[i]}.` : `${bulletGlyphForLevel(depth)}`;
                return (
                  <li
                    key={`${b.id}-li-${i}`}
                    className="studyPreviewListRow"
                    style={{ marginLeft: `${depth * 18}px` }}
                  >
                    <span className="studyPreviewListGlyph" aria-hidden>
                      {marker}
                    </span>
                    <span className="studyPreviewListBody">{renderInlineSpans(item?.spans || [], '')}</span>
                  </li>
                );
              })}
            </ListEl>,
          );
        }
        if (b.type === 'highlightedQuote') {
          return wrapBlock(
            b,
            <blockquote className="studyQuotePreview" style={{ textAlign: b.align || 'left' }}>
              <div dangerouslySetInnerHTML={{ __html: b.html || '<p>Highlighted quote</p>' }} />
            </blockquote>,
          );
        }
        if (b.type === 'image_v2' || b.type === 'image' || b.type === 'gif') {
          const draft = cropDrafts?.[`${b.id}`];
          const previewUrl = b.renderCache?.derivedUrl || b.asset?.originalUrl || b.url || draft?.url || '';
          const captionHtml = typeof b.caption === 'object' ? (b.caption?.html || '') : '';
          const captionText = typeof b.caption === 'string' ? b.caption : '';
          return wrapBlock(
            b,
            <div className="studyPreviewImageWrap" style={{ textAlign: b.layout?.align || b.align || 'center' }}>
              {previewUrl ? (
                <img src={previewUrl} alt={b.alt || 'Study'} className="studyPreviewImage" style={mediaAlignStyle(b.layout?.align || b.align)} />
              ) : (
                <div className="studyPreviewImagePlaceholder">Choose image file</div>
              )}
              {captionHtml ? (
                <div className="muted" dangerouslySetInnerHTML={{ __html: captionHtml }} />
              ) : captionText ? (
                <div className="muted">{captionText}</div>
              ) : null}
            </div>,
          );
        }
        if (b.type === 'imageCarousel') {
          return wrapBlock(
            b,
            <div className="studyPreviewCarousel">
              {(b.items || []).map((item, idx) => {
                const draft = cropDrafts?.[`${b.id}:${idx}`];
                const previewUrl = item.url || draft?.url || '';
                return (
                  <div key={`${b.id}-c-${idx}`} className="studyPreviewCarouselItem">
                    {previewUrl ? (
                      <img src={previewUrl} alt={item.caption || `slide-${idx + 1}`} className="studyPreviewImage" />
                    ) : (
                      <div className="studyPreviewImagePlaceholder">Choose slide image</div>
                    )}
                  </div>
                );
              })}
            </div>,
          );
        }
        if (b.type === 'table') {
          const rows = b.rows || [];
          const headerRow = rows[0];
          const bodyRows = rows.slice(1);
          return wrapBlock(
            b,
            <div className="tableWrap studyPreviewTableWrap">
              <table className="studyPreviewTable">
                {headerRow ? (
                  <thead>
                    <tr>
                      {headerRow.map((cell, cIdx) => (
                        <th key={`${b.id}-h-${cIdx}`} scope="col">
                          {cell}
                        </th>
                      ))}
                    </tr>
                  </thead>
                ) : null}
                {bodyRows.length ? (
                  <tbody>
                    {bodyRows.map((row, rIdx) => (
                      <tr key={`${b.id}-r-${rIdx}`}>
                        {row.map((cell, cIdx) => (
                          <td key={`${b.id}-${rIdx}-${cIdx}`}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                ) : null}
              </table>
            </div>,
          );
        }
        if (b.type === 'pdfAttachment') {
          return wrapBlock(
            b,
            <div style={{ textAlign: b.align || 'right' }}>
              <a href={b.url || '#'} target="_blank" rel="noreferrer" className="studyPreviewLink">
                {b.label || 'Download PDF'}
              </a>
            </div>,
          );
        }
        if (b.type === 'audioAttachment') {
          return wrapBlock(
            b,
            <div className="studyPreviewAudio">
              <div>{b.title || 'Audio'}</div>
              <audio controls src={b.url || ''} />
            </div>,
          );
        }
        if (b.type === 'divider') {
          return wrapBlock(b, <div className="studyPreviewDivider" role="separator" aria-hidden="true" />);
        }
        return wrapBlock(b, <div className="studyPreviewDivider studyPreviewDividerFallback" role="separator" aria-hidden="true" />);
      })}
    </div>
  );
}

function newBlock(type) {
  const id = `${Date.now()}-${Math.random()}`;
  if (type === 'heading') return { id, type, level: 1, align: 'center', casing: 'allCaps', color: HEADING_COLOR, spans: [{ text: '', bold: true, italic: false, underline: false, color: HEADING_COLOR, href: '' }] };
  if (type === 'paragraph') return { id, type, html: `<p style="color:${PARAGRAPH_COLOR};text-align:left"></p>`, spans: [{ text: '', bold: false, italic: false, underline: false, color: PARAGRAPH_COLOR, href: '' }] };
  if (type === 'highlightedQuote') return { id, type, align: 'left', html: `<p style="color:${HEADING_COLOR};text-align:left"><strong>Highlighted quote</strong></p>` };
  if (type === 'image') return {
    id,
    type: 'image_v2',
    asset: { assetId: null, originalUrl: '', mimeType: '', width: 0, height: 0 },
    layout: { containerRatio: '16:9', fitMode: 'cover', zoom: 1, panX: 0, panY: 0, align: 'center', rotation: 0 },
    caption: { html: '', align: 'center' },
    renderCache: { derivedUrl: '', cacheKey: '' },
  };
  if (type === 'gif') return { id, type, url: '', caption: '', cropRatio: 'free', align: 'center' };
  if (type === 'imageCarousel') return { id, type, items: [{ url: '', caption: '' }], cropRatio: '16:9' };
  if (type === 'table') return { id, type, rows: [['Header 1', 'Header 2'], ['Value 1', 'Value 2']] };
  if (type === 'bulletList') {
    return {
      id,
      type: 'bulletList',
      items: [{ spans: [{ text: '', bold: false, italic: false, underline: false, color: PARAGRAPH_COLOR, href: '' }], level: 0 }],
    };
  }
  if (type === 'numberedList') {
    return {
      id,
      type: 'numberedList',
      items: [{ spans: [{ text: '', bold: false, italic: false, underline: false, color: PARAGRAPH_COLOR, href: '' }], level: 0 }],
    };
  }
  if (type === 'pdfAttachment') return { id, type, label: 'Download PDF', url: '', align: 'right' };
  if (type === 'audioAttachment') return { id, type, title: 'Audio', url: '' };
  return { id, type: 'divider' };
}

function duplicateStudyBlock(block) {
  const next = JSON.parse(JSON.stringify(block));
  next.id = `${Date.now()}-${Math.random()}`;
  return next;
}

export default function WorksheetsPage({
  worksheets,
  showCreatedBy = false,
  libraryCanMutate = () => true,
  onCreate,
  onUpdate,
  onDelete,
  onUploadAsset,
}) {
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [doc, setDoc] = useState(emptyDoc);
  const [editingId, setEditingId] = useState(null);
  const [pasteInput, setPasteInput] = useState('');
  const [pasteNotice, setPasteNotice] = useState('');
  const [dragBlockId, setDragBlockId] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [previewPopup, setPreviewPopup] = useState(null); // null | 'tablet' | 'desktop'

  const MAX_DOC_UNDO = 100;
  const undoStackRef = useRef([]);
  function cloneDoc(d) {
    return JSON.parse(JSON.stringify(d));
  }
  function commitDoc(updater) {
    setDoc((prev) => {
      undoStackRef.current.push(cloneDoc(prev));
      if (undoStackRef.current.length > MAX_DOC_UNDO) undoStackRef.current.shift();
      return typeof updater === 'function' ? updater(prev) : updater;
    });
  }
  const undoDocEdit = useCallback(() => {
    const snap = undoStackRef.current.pop();
    if (!snap) return;
    setDoc(snap);
    setOpenBlockId((prev) => (prev && snap.blocks.some((b) => b.id === prev) ? prev : ''));
  }, []);

  useEffect(() => {
    if (!previewPopup) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setPreviewPopup(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewPopup]);

  useEffect(() => {
    if (!editorOpen) return undefined;
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta || e.key.toLowerCase() !== 'z' || e.shiftKey) return;
      const t = e.target;
      if (t && (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement)) {
        return;
      }
      if (t && t.isContentEditable) return;
      e.preventDefault();
      undoDocEdit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorOpen, undoDocEdit]);
  const [uploadingBlockId, setUploadingBlockId] = useState('');
  const [openBlockId, setOpenBlockId] = useState('');
  const skipScrollPreviewFromPreviewRef = useRef(false);
  const [cropDrafts, setCropDrafts] = useState({});
  const [activeCropKey, setActiveCropKey] = useState('');
  const [cropPosition, setCropPosition] = useState({ x: 0, y: 0 });
  const pasteAreaRef = useRef(null);
  const [viewingWorksheet, setViewingWorksheet] = useState(null);
  const [draftNotice, setDraftNotice] = useState('');
  const [editorIsDraft, setEditorIsDraft] = useState(false);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const [autosaveStatus, setAutosaveStatus] = useState('idle'); // idle | saving | saved | error

  const lastPersistedSnapshotRef = useRef('');
  const newWorksheetSessionRef = useRef(0);
  const autosaveClearSavedTimerRef = useRef(null);
  const onUpdateRef = useRef(onUpdate);
  const onCreateRef = useRef(onCreate);
  onUpdateRef.current = onUpdate;
  onCreateRef.current = onCreate;

  const autosaveFieldsRef = useRef({
    title: '',
    description: '',
    doc: emptyDoc,
    editorIsDraft: false,
    editingId: null,
  });
  autosaveFieldsRef.current = { title, description, doc, editorIsDraft, editingId };

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return worksheets || [];
    return (worksheets || []).filter((m) =>
      String(m.title || '').toLowerCase().includes(needle) || String(m.description || '').toLowerCase().includes(needle)
    );
  }, [worksheets, q]);

  const editingLibraryRow = useMemo(
    () => (worksheets || []).find((w) => w.id === editingId) ?? null,
    [worksheets, editingId],
  );
  const canDeleteFromEditor =
    Boolean(editingId) &&
    !creatingDraft &&
    (editingLibraryRow == null || libraryCanMutate(editingLibraryRow));

  function patchBlock(id, patch) {
    setDoc((prev) => ({ ...prev, blocks: prev.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
  }

  function replaceBlock(id, nextBlock) {
    commitDoc((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === id ? nextBlock : b)),
    }));
  }

  function mergeBlockWithNext(index) {
    commitDoc((prev) => {
      const { blocks } = prev;
      if (index < 0 || index >= blocks.length - 1) return prev;
      const a = blocks[index];
      const c = blocks[index + 1];
      if (!canMergeStudyBlocks(a, c)) return prev;
      const merged = mergeTwoStudyBlocks(a, c);
      if (!merged) return prev;
      return {
        ...prev,
        blocks: [...blocks.slice(0, index), merged, ...blocks.slice(index + 2)],
      };
    });
  }

  function duplicateBlockAtIndex(idx) {
    const b = doc.blocks[idx];
    if (!b) return;
    const dup = duplicateStudyBlock(b);
    commitDoc((prev) => {
      const blocks = [...prev.blocks];
      blocks.splice(idx + 1, 0, dup);
      return { ...prev, blocks };
    });
    setOpenBlockId(dup.id);
  }

  function focusBlockFromPreview(blockId) {
    skipScrollPreviewFromPreviewRef.current = true;
    setOpenBlockId(blockId);
    requestAnimationFrame(() => {
      document.getElementById(`study-block-${blockId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }

  useEffect(() => {
    if (!editorOpen || !openBlockId) return undefined;
    if (skipScrollPreviewFromPreviewRef.current) {
      skipScrollPreviewFromPreviewRef.current = false;
      return undefined;
    }
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(openBlockId) : openBlockId;
    const sel = `[data-study-preview-block="${escaped}"]`;
    const rafId = requestAnimationFrame(() => {
      document.querySelectorAll(sel).forEach((el) => {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      const inPopup = previewPopup && document.querySelector(`.studyPreviewPopupModal ${sel}[tabindex="0"]`);
      const focusEl = inPopup || document.querySelector(`${sel}[tabindex="0"]`);
      focusEl?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(rafId);
  }, [editorOpen, openBlockId, previewPopup]);

  function draftKey(blockId, carouselIndex) {
    return carouselIndex == null ? `${blockId}` : `${blockId}:${carouselIndex}`;
  }

  function setDraft(blockId, file, opts = {}) {
    const key = draftKey(blockId, opts.carouselIndex);
    const url = URL.createObjectURL(file);
    setCropDrafts((prev) => ({
      ...prev,
      [key]: {
        file,
        url,
        zoom: 1,
        panX: 0,
        panY: 0,
        cropX: 0,
        cropY: 0,
        ratio: opts.cropRatio || '16:9',
        assetType: opts.assetType || 'image',
        carouselIndex: opts.carouselIndex,
      },
    }));
  }

  function clearDraft(blockId, carouselIndex) {
    const key = draftKey(blockId, carouselIndex);
    setCropDrafts((prev) => {
      const next = { ...prev };
      if (next[key]?.url) URL.revokeObjectURL(next[key].url);
      delete next[key];
      return next;
    });
  }

  function openCropPopup(blockId, carouselIndex) {
    const key = draftKey(blockId, carouselIndex);
    if (cropDrafts[key]) {
      setActiveCropKey(key);
      setCropPosition({ x: cropDrafts[key].cropX || 0, y: cropDrafts[key].cropY || 0 });
    }
  }

  function closeCropPopup() {
    setActiveCropKey('');
  }

  async function uploadAssetForBlock(blockId, assetTypeValue, fileOrDraft, opts = {}) {
    if (!fileOrDraft) return;
    let worksheetId = editingId;
    if (!worksheetId) {
      const created = await onCreate({
        title: title?.trim() || 'Untitled draft',
        description,
        contentJson: doc,
        isDraft: true,
      });
      worksheetId = created?.id;
      if (!worksheetId) return;
      setEditingId(worksheetId);
    }
    try {
      setUploadingBlockId(blockId);
      let uploadFile = fileOrDraft;
      if (assetTypeValue === 'image' || assetTypeValue === 'carousel' || assetTypeValue === 'gif') {
        if (fileOrDraft?.file && fileOrDraft?.zoom != null) {
          uploadFile = await buildCroppedFileFromDraft(fileOrDraft);
        } else if (fileOrDraft instanceof File && (assetTypeValue === 'image' || assetTypeValue === 'carousel')) {
          uploadFile = await optimizeImageAtRatio(fileOrDraft, opts.cropRatio || '16:9');
        }
      }
      const row = await onUploadAsset(Number(worksheetId), {
        assetType: assetTypeValue === 'carousel' ? 'image' : assetTypeValue,
        file: uploadFile,
      });
      if (!row?.url) return;
      if (assetTypeValue === 'image' || assetTypeValue === 'gif' || assetTypeValue === 'pdf') {
        if (assetTypeValue === 'image') {
          const cacheKey = [
            `asset:${row.id || 'x'}`,
            `ratio:${opts.cropRatio || '16:9'}`,
            `zoom:${Number(fileOrDraft?.zoom || 1).toFixed(2)}`,
            `panX:${Number(fileOrDraft?.panX || 0).toFixed(3)}`,
            `panY:${Number(fileOrDraft?.panY || 0).toFixed(3)}`,
            `align:${String(opts.align || 'center')}`,
          ].join('|');
          patchBlock(blockId, {
            asset: {
              assetId: row.id || null,
              originalUrl: row.url,
              mimeType: row.mime_type || uploadFile.type || 'image/jpeg',
              width: row.width || 0,
              height: row.height || 0,
            },
            renderCache: {
              derivedUrl: row.url,
              cacheKey,
            },
          });
        } else {
          patchBlock(blockId, { url: row.url });
        }
        clearDraft(blockId, opts.carouselIndex);
        return;
      }
      if (assetTypeValue === 'carousel') {
        const index = Number(opts.carouselIndex);
        commitDoc((prev) => ({
          ...prev,
          blocks: prev.blocks.map((b) => {
            if (b.id !== blockId) return b;
            const items = [...(b.items || [])];
            items[index] = { ...(items[index] || {}), url: row.url };
            return { ...b, items };
          }),
        }));
        clearDraft(blockId, index);
      }
    } finally {
      setUploadingBlockId('');
    }
  }

  function moveBlock(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    commitDoc((prev) => {
      const next = [...prev.blocks];
      const fromIndex = next.findIndex((b) => b.id === fromId);
      const toIndex = next.findIndex((b) => b.id === toId);
      if (fromIndex < 0 || toIndex < 0) return prev;
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return { ...prev, blocks: next };
    });
  }

  function updateSpan(blockId, spanIndex, patch) {
    setDoc((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => {
        if (b.id !== blockId) return b;
        const spans = inlineSpans(b);
        spans[spanIndex] = { ...spans[spanIndex], ...patch };
        return { ...b, spans };
      }),
    }));
  }

  function addSpan(blockId) {
    setDoc((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => (b.id === blockId
        ? { ...b, spans: [...inlineSpans(b), { text: '', bold: false, italic: false, underline: false, color: '#334155', href: '' }] }
        : b)),
    }));
  }

  function removeSpan(blockId, spanIndex) {
    setDoc((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => {
        if (b.id !== blockId) return b;
        const spans = inlineSpans(b).filter((_, i) => i !== spanIndex);
        return { ...b, spans: spans.length ? spans : [{ text: '', bold: false, italic: false, underline: false, color: '#334155', href: '' }] };
      }),
    }));
  }

  function patchTableCell(blockId, rowIndex, colIndex, value) {
    setDoc((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => {
        if (b.id !== blockId) return b;
        const rows = Array.isArray(b.rows) ? b.rows.map((r) => [...r]) : [['']];
        rows[rowIndex][colIndex] = value;
        return { ...b, rows };
      }),
    }));
  }

  function addTableRow(blockId) {
    setDoc((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => {
        if (b.id !== blockId) return b;
        const rows = Array.isArray(b.rows) && b.rows.length ? b.rows.map((r) => [...r]) : [['']];
        rows.push(new Array(rows[0].length).fill(''));
        return { ...b, rows };
      }),
    }));
  }

  function addTableColumn(blockId) {
    setDoc((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b) => {
        if (b.id !== blockId) return b;
        const rows = Array.isArray(b.rows) && b.rows.length ? b.rows.map((r) => [...r]) : [['']];
        const nextRows = rows.map((r) => [...r, '']);
        return { ...b, rows: nextRows };
      }),
    }));
  }

  function startEdit(item) {
    const parsed = safeParse(item.content_json);
    undoStackRef.current = [];
    setEditingId(item.id);
    setTitle(item.title || '');
    setDescription(item.description || '');
    setDoc(parsed);
    setPasteInput('');
    setPasteNotice('');
    setEditorIsDraft(Number(item.is_draft) === 1);
    setDraftNotice('');
    setPreviewPopup(null);
    setEditorOpen(true);
    setOpenBlockId('');
    setAutosaveStatus('idle');
    setCreatingDraft(false);
    lastPersistedSnapshotRef.current = normalizedEditorSnapshot(
      item.title || '',
      item.description || '',
      parsed,
      Number(item.is_draft) === 1,
    );
    requestAnimationFrame(() => {
      if (pasteAreaRef.current) pasteAreaRef.current.innerHTML = '';
    });
  }

  function resetEditor() {
    newWorksheetSessionRef.current += 1;
    lastPersistedSnapshotRef.current = '';
    undoStackRef.current = [];
    setAutosaveStatus('idle');
    setCreatingDraft(false);
    if (autosaveClearSavedTimerRef.current) {
      window.clearTimeout(autosaveClearSavedTimerRef.current);
      autosaveClearSavedTimerRef.current = null;
    }
    setEditingId(null);
    setTitle('');
    setDescription('');
    setDoc(emptyDoc);
    setPasteInput('');
    setPasteNotice('');
    if (pasteAreaRef.current) pasteAreaRef.current.innerHTML = '';
    setEditorOpen(false);
    setOpenBlockId('');
    setEditorIsDraft(false);
    setDraftNotice('');
    setPreviewPopup(null);
  }

  async function openNewWorksheetCreator() {
    newWorksheetSessionRef.current += 1;
    const session = newWorksheetSessionRef.current;
    undoStackRef.current = [];
    setEditingId(null);
    setTitle('');
    setDescription('');
    setDoc(emptyDoc);
    setPasteInput('');
    setPasteNotice('');
    setEditorIsDraft(false);
    setDraftNotice('');
    setPreviewPopup(null);
    setOpenBlockId('');
    setAutosaveStatus('idle');
    lastPersistedSnapshotRef.current = '';
    setEditorOpen(true);
    requestAnimationFrame(() => {
      if (pasteAreaRef.current) pasteAreaRef.current.innerHTML = '';
    });
    setCreatingDraft(true);
    try {
      const created = await onCreateRef.current({
        title: '',
        description: '',
        contentJson: emptyDoc,
        isDraft: true,
        is_draft: true,
      });
      if (newWorksheetSessionRef.current !== session) return;
      if (!created?.id) throw new Error('Could not create draft');
      setEditingId(created.id);
      setEditorIsDraft(true);
      lastPersistedSnapshotRef.current = normalizedEditorSnapshot('', '', emptyDoc, true);
    } catch (err) {
      if (newWorksheetSessionRef.current === session) {
        window.alert(err?.message || 'Could not create draft. Try again.');
        resetEditor();
      }
    } finally {
      setCreatingDraft(false);
    }
  }

  useEffect(() => {
    if (!editorOpen || !editingId || creatingDraft) return undefined;
    const cur = autosaveFieldsRef.current;
    const snap = normalizedEditorSnapshot(cur.title, cur.description, cur.doc, cur.editorIsDraft);
    if (snap === lastPersistedSnapshotRef.current) return undefined;

    const tid = window.setTimeout(async () => {
      const latest = autosaveFieldsRef.current;
      const snapNow = normalizedEditorSnapshot(latest.title, latest.description, latest.doc, latest.editorIsDraft);
      if (snapNow === lastPersistedSnapshotRef.current) return;
      setAutosaveStatus('saving');
      try {
        await onUpdateRef.current(latest.editingId, {
          title: String(latest.title || '').trim() || (latest.editorIsDraft ? 'Untitled draft' : ''),
          description: latest.description,
          contentJson: latest.doc,
          isDraft: latest.editorIsDraft,
        });
        lastPersistedSnapshotRef.current = snapNow;
        setAutosaveStatus('saved');
        if (autosaveClearSavedTimerRef.current) window.clearTimeout(autosaveClearSavedTimerRef.current);
        autosaveClearSavedTimerRef.current = window.setTimeout(() => {
          setAutosaveStatus((s) => (s === 'saved' ? 'idle' : s));
          autosaveClearSavedTimerRef.current = null;
        }, 2500);
      } catch {
        setAutosaveStatus('error');
      }
    }, AUTOSAVE_DEBOUNCE_MS);

    return () => window.clearTimeout(tid);
  }, [editorOpen, editingId, creatingDraft, title, description, doc, editorIsDraft]);

  useEffect(
    () => () => {
      if (autosaveClearSavedTimerRef.current) window.clearTimeout(autosaveClearSavedTimerRef.current);
    },
    [],
  );

  function handlePasteAreaPaste(e) {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain') || '';
    const fragment =
      html && html.trim() ? sanitizePastedHtmlString(html) : plainTextToPseudoHtml(plain);
    if (!fragment.trim()) return;
    const el = pasteAreaRef.current;
    if (!el) return;
    const cur = el.innerHTML.replace(/^\s*<br\s*\/?>\s*$/i, '').trim();
    el.innerHTML = cur ? `${cur}<p></p>${fragment}` : fragment;
    setPasteInput(el.innerHTML);
    setPasteNotice('Clipboard captured (including formatting). Click Standardize to convert into blocks.');
  }

  function handlePasteAreaInput() {
    if (pasteAreaRef.current) setPasteInput(pasteAreaRef.current.innerHTML);
  }

  function clearPasteArea() {
    setPasteInput('');
    setPasteNotice('');
    if (pasteAreaRef.current) pasteAreaRef.current.innerHTML = '';
  }

  async function submit(e) {
    e.preventDefault();
    const t = String(title || '').trim();
    if (!t) {
      window.alert('Enter a title before publishing.');
      return;
    }
    const payload = { title: t, description, contentJson: doc, isDraft: false };
    if (editingId) await onUpdate(editingId, payload);
    else await onCreate(payload);
    resetEditor();
  }

  async function saveDraft() {
    setDraftNotice('');
    if (creatingDraft || !editingId) {
      setDraftNotice(creatingDraft ? 'Draft is still initializing…' : 'Nothing to save.');
      window.setTimeout(() => setDraftNotice(''), 4000);
      return;
    }
    setAutosaveStatus('saving');
    try {
      const latest = autosaveFieldsRef.current;
      await onUpdateRef.current(latest.editingId, {
        title: String(latest.title || '').trim() || 'Untitled draft',
        description: latest.description,
        contentJson: latest.doc,
        isDraft: true,
      });
      setAutosaveStatus('idle');
      if (autosaveClearSavedTimerRef.current) {
        window.clearTimeout(autosaveClearSavedTimerRef.current);
        autosaveClearSavedTimerRef.current = null;
      }
      resetEditor();
    } catch (err) {
      setDraftNotice(err?.message || 'Could not save draft.');
      setAutosaveStatus('error');
      window.setTimeout(() => setDraftNotice(''), 6000);
    }
  }

  async function deleteCurrentFromEditor() {
    if (!editingId || creatingDraft) return;
    if (editingLibraryRow && !libraryCanMutate(editingLibraryRow)) {
      window.alert('You can only delete worksheets you created (or as staff).');
      return;
    }
    if (!window.confirm('Delete this worksheet from the library? This cannot be undone.')) return;
    setDraftNotice('');
    try {
      await onDelete(editingId);
      resetEditor();
    } catch (err) {
      setDraftNotice(err?.message || 'Could not delete.');
      window.setTimeout(() => setDraftNotice(''), 6000);
    }
  }

  function applyPasteNormalization() {
    const raw = (pasteAreaRef.current && pasteAreaRef.current.innerHTML) || pasteInput;
    const nextBlocks = normalizePastedHtmlToBlocks(raw);
    commitDoc((prev) => {
      if (nextBlocks.length === 0) return prev;
      const blocks = [...prev.blocks];
      const focusIdx = openBlockId ? blocks.findIndex((x) => x.id === openBlockId) : -1;
      const insertAt = focusIdx >= 0 ? focusIdx + 1 : blocks.length;
      blocks.splice(insertAt, 0, ...nextBlocks);
      return { ...prev, blocks };
    });
    setPasteNotice(nextBlocks.length ? `Content standardized: ${nextBlocks.length} block(s) added.` : 'No usable content found in pasted input.');
  }

  return (
    <div className="stack">
      <SectionCard title="Worksheet Library" subtitle="Reusable rich learning content with mobile preview parity">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search worksheets" />
        <div className="row">
          <button type="button" className="uploadPrimaryBtn" onClick={() => openNewWorksheetCreator()}>
            + Open Full Screen Creator
          </button>
        </div>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Description</th>
                {showCreatedBy ? <th>Created by</th> : null}
                <th>Blocks</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const blocks = safeParse(m.content_json).blocks || [];
                const isDraft = Number(m.is_draft) === 1;
                return (
                  <tr key={m.id}>
                    <td>{m.title}</td>
                    <td>{m.description || '-'}</td>
                    {showCreatedBy ? <td>{m.creator_name || `#${m.created_by}` || '—'}</td> : null}
                    <td>{blocks.length}</td>
                    <td>{isDraft ? <span className="studyDraftBadge">Draft</span> : <span className="muted">Published</span>}</td>
                    <td>
                      <div className="row studyMaterialRowActions">
                        <button type="button" className="secondaryBtn" onClick={() => setViewingWorksheet(m)}>
                          View
                        </button>
                        {libraryCanMutate(m) ? (
                          <>
                            <button type="button" className="secondaryBtn" onClick={() => startEdit(m)}>
                              Edit
                            </button>
                            <button
                              type="button"
                              className="dangerBtn"
                              onClick={async () => {
                                if (!window.confirm('Delete this worksheet from the library? This cannot be undone.')) return;
                                await onDelete(m.id);
                              }}
                            >
                              Delete
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {viewingWorksheet ? (
        <div
          className="studyViewOverlay"
          role="presentation"
          onClick={() => setViewingWorksheet(null)}
        >
          <div className="studyViewModal" role="dialog" aria-labelledby="worksheet-view-title" onClick={(e) => e.stopPropagation()}>
            <div className="modalHead">
              <h3 id="worksheet-view-title">{viewingWorksheet.title || 'Worksheet'}</h3>
              <button type="button" className="secondaryBtn" onClick={() => setViewingWorksheet(null)}>
                Close
              </button>
            </div>
            {viewingWorksheet.description ? (
              <p className="fieldHint" style={{ marginTop: 0 }}>{viewingWorksheet.description}</p>
            ) : null}
            {Number(viewingWorksheet.is_draft) === 1 ? (
              <p className="studyDraftBanner">This worksheet is a draft and is hidden from learners until published.</p>
            ) : null}
            <div className="studyViewPreviewWrap">
              <Preview blocks={safeParse(viewingWorksheet.content_json).blocks} cropDrafts={{}} />
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              {libraryCanMutate(viewingWorksheet) ? (
                <>
                  <button
                    type="button"
                    className="secondaryBtn"
                    onClick={() => {
                      startEdit(viewingWorksheet);
                      setViewingWorksheet(null);
                    }}
                  >
                    Edit in creator
                  </button>
                  <button
                    type="button"
                    className="dangerBtn"
                    onClick={async () => {
                      if (!window.confirm('Delete this worksheet from the library? This cannot be undone.')) return;
                      await onDelete(viewingWorksheet.id);
                      setViewingWorksheet(null);
                    }}
                  >
                    Delete
                  </button>
                </>
              ) : (
                <p className="muted" style={{ margin: 0 }}>You can view this worksheet; only the author or staff can edit or delete it.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {editorOpen ? (
        <div className="studyFullscreenOverlay">
          <form className="studyFullscreenShell" onSubmit={submit}>
            <div className="studyFullscreenTopbar studyFullscreenTopbar--editorTools">
              <div className="studyTopInputs">
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Worksheet title (required to publish)" />
                <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" />
                {editorIsDraft ? <span className="studyDraftBadge studyDraftBadgeLarge">Draft</span> : null}
                {creatingDraft ? (
                  <span className="studyAutosaveHint studyAutosaveHintBusy">Creating draft…</span>
                ) : null}
                {!creatingDraft && autosaveStatus === 'saving' ? (
                  <span className="studyAutosaveHint studyAutosaveHintSaving">Saving…</span>
                ) : null}
                {!creatingDraft && autosaveStatus === 'saved' ? (
                  <span className="studyAutosaveHint studyAutosaveHintSaved">Saved</span>
                ) : null}
                {!creatingDraft && autosaveStatus === 'error' ? (
                  <span className="studyAutosaveHint studyAutosaveHintError">Could not autosave</span>
                ) : null}
              </div>
              <div className="studyTopToolbarRow">
                <button
                  type="button"
                  className="secondaryBtn"
                  disabled={creatingDraft || !editingId}
                  title="Undo last block change (⌘/Ctrl+Z when not typing in a field)"
                  onClick={() => undoDocEdit()}
                >
                  Undo
                </button>
                {['heading', 'paragraph', 'highlightedQuote', 'bulletList', 'numberedList', 'image', 'imageCarousel', 'gif', 'table', 'pdfAttachment', 'audioAttachment', 'divider'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className="secondaryBtn"
                    disabled={creatingDraft || !editingId}
                    onClick={() => {
                      const created = newBlock(t);
                      commitDoc((prev) => {
                        const blocks = [...prev.blocks];
                        const focusIdx = openBlockId ? blocks.findIndex((x) => x.id === openBlockId) : -1;
                        const insertAt = focusIdx >= 0 ? focusIdx + 1 : blocks.length;
                        blocks.splice(insertAt, 0, created);
                        return { ...prev, blocks };
                      });
                      setOpenBlockId(created.id);
                    }}
                  >
                    + {t}
                  </button>
                ))}
              </div>
              <div className="studyTopPublishRow">
                <button
                  type="button"
                  className="studySaveDraftCloseBtn"
                  disabled={creatingDraft || !editingId}
                  onClick={() => saveDraft()}
                >
                  Save draft &amp; close
                </button>
                <button type="submit" className="uploadPrimaryBtn" disabled={creatingDraft || !editingId}>
                  Publish
                </button>
                <button
                  type="button"
                  className="dangerBtn"
                  disabled={!canDeleteFromEditor}
                  onClick={() => deleteCurrentFromEditor()}
                >
                  Delete
                </button>
              </div>
              {draftNotice ? <div className="studyDraftNotice">{draftNotice}</div> : null}
            </div>

            <div className="studyFullscreenBody">
              <div className="studyFullscreenEditor">
                <div className="videoUploaderField">
                  <label className="fieldLabel">Paste from Docs / Word / Web</label>
                  <p className="fieldHint" style={{ marginTop: 0 }}>
                    Use the area below (not a plain text box). Your browser provides rich HTML on paste; content appears formatted here, then click Standardize to add blocks.
                  </p>
                  <div
                    ref={pasteAreaRef}
                    className="studyPasteArea"
                    contentEditable
                    suppressContentEditableWarning
                    data-placeholder="Paste here — bold, colors, and headings are preserved from Docs and Word…"
                    onPaste={handlePasteAreaPaste}
                    onInput={handlePasteAreaInput}
                  />
                  <div className="row" style={{ marginTop: 8 }}>
                    <button type="button" className="secondaryBtn" onClick={applyPasteNormalization}>
                      Standardize Pasted Content
                    </button>
                    <button type="button" className="secondaryBtn" onClick={clearPasteArea}>
                      Clear paste area
                    </button>
                  </div>
                  {pasteNotice ? <div className="fieldHint">{pasteNotice}</div> : null}
                </div>
                <div className="studyBlocks">
                  {doc.blocks.map((b, idx) => {
                    const summary = blockSummaryLabel(b, cropDrafts);
                    return (
                    <div
                      key={b.id}
                      id={`study-block-${b.id}`}
                      className={['studyBlockCard', openBlockId === b.id && 'studyBlockCard--active'].filter(Boolean).join(' ')}
                      draggable
                      onDragStart={() => setDragBlockId(b.id)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        moveBlock(dragBlockId, b.id);
                        setDragBlockId(null);
                      }}
                    >
                      <div className="studyBlockHead">
                        <button
                          type="button"
                          className="studyBlockTitleBtn"
                          onClick={() => setOpenBlockId((prev) => (prev === b.id ? '' : b.id))}
                        >
                          <span className="studyBlockTitleMain">{idx + 1}. {b.type}</span>
                          {summary ? <span className="studyBlockSummary"> — {summary}</span> : null}
                        </button>
                        <div className="row">
                          <button type="button" className="secondaryBtn" onClick={() => idx > 0 && moveBlock(b.id, doc.blocks[idx - 1].id)}>Up</button>
                          <button type="button" className="secondaryBtn" onClick={() => idx < doc.blocks.length - 1 && moveBlock(b.id, doc.blocks[idx + 1].id)}>Down</button>
                          <button
                            type="button"
                            className="dangerBtn"
                            onClick={() =>
                              commitDoc((prev) => ({ ...prev, blocks: prev.blocks.filter((x) => x.id !== b.id) }))
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="studyBlockMeta row">
                        <select
                          className="studyConvertSelect"
                          aria-label="Convert block type"
                          value=""
                          onChange={(e) => {
                            const v = e.target.value;
                            if (!v) return;
                            const next = convertStudyBlock(b, v);
                            if (next) replaceBlock(b.id, next);
                            e.target.value = '';
                          }}
                        >
                          <option value="">Convert to…</option>
                          {(STUDY_BLOCK_CONVERT_TARGETS[b.type] || []).map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="secondaryBtn"
                          onClick={() => duplicateBlockAtIndex(idx)}
                          title="Duplicate this block below"
                        >
                          Duplicate
                        </button>
                        {idx < doc.blocks.length - 1 ? (
                          <button
                            type="button"
                            className="secondaryBtn"
                            disabled={!canMergeStudyBlocks(b, doc.blocks[idx + 1])}
                            title={!canMergeStudyBlocks(b, doc.blocks[idx + 1]) ? 'These blocks cannot be merged (e.g. media attachments).' : 'Combine this block with the one below'}
                            onClick={() => mergeBlockWithNext(idx)}
                          >
                            Merge with next
                          </button>
                        ) : null}
                      </div>
                      {openBlockId === b.id && b.type === 'heading' ? (
                        <>
                          <select
                            value={b.level || 2}
                            onChange={(e) => {
                              const nextLevel = Number(e.target.value);
                              patchBlock(b.id, {
                                level: nextLevel,
                                align: defaultHeadingAlign(nextLevel),
                                casing: nextLevel === 1 ? 'allCaps' : 'titleCase',
                                color: defaultHeadingColor(nextLevel),
                                spans: (inlineSpans(b) || []).map((sp) => ({ ...sp, color: defaultHeadingColor(nextLevel) })),
                              });
                            }}
                          >
                            <option value={1}>Heading</option>
                            <option value={2}>Subheading 1</option>
                            <option value={3}>Subheading 2</option>
                          </select>
                          <select
                            value={b.casing || (b.level === 1 ? 'allCaps' : 'titleCase')}
                            onChange={(e) => patchBlock(b.id, { casing: e.target.value })}
                          >
                            <option value="allCaps">All Caps</option>
                            <option value="smallCaps">Small Caps</option>
                            <option value="titleCase">Title Case</option>
                            <option value="sentenceCase">Sentence Case</option>
                          </select>
                          <select
                            value={b.align || defaultHeadingAlign(b.level || 2)}
                            onChange={(e) => patchBlock(b.id, { align: e.target.value })}
                          >
                            <option value="left">Left</option>
                            <option value="center">Centered</option>
                            <option value="right">Right</option>
                            <option value="justify">Justified</option>
                          </select>
                          {(inlineSpans(b)).map((s, sIdx) => (
                            <div key={`${b.id}-sp-${sIdx}`} className="studyInlineSpanCard">
                              <input value={s.text || ''} onChange={(e) => updateSpan(b.id, sIdx, { text: e.target.value })} placeholder="Text span" />
                              <input value={s.href || ''} onChange={(e) => updateSpan(b.id, sIdx, { href: e.target.value })} placeholder="Optional link URL" />
                              <div className="row">
                                <label><input type="checkbox" checked={!!s.bold} onChange={(e) => updateSpan(b.id, sIdx, { bold: e.target.checked })} /> Bold</label>
                                <label><input type="checkbox" checked={!!s.italic} onChange={(e) => updateSpan(b.id, sIdx, { italic: e.target.checked })} /> Italic</label>
                                <label><input type="checkbox" checked={!!s.underline} onChange={(e) => updateSpan(b.id, sIdx, { underline: e.target.checked })} /> Underline</label>
                                <div className="colorSwatchRow">
                                  {STANDARD_COLORS.map((c) => (
                                    <button
                                      key={c}
                                      type="button"
                                      className={`colorSwatchBtn ${String(s.color || defaultHeadingColor(b.level || 2)).toLowerCase() === c.toLowerCase() ? 'active' : ''}`}
                                      style={{ backgroundColor: c }}
                                      onClick={() => updateSpan(b.id, sIdx, { color: c })}
                                      title={c}
                                    />
                                  ))}
                                </div>
                                <button type="button" className="secondaryBtn" onClick={() => removeSpan(b.id, sIdx)}>Remove Span</button>
                              </div>
                            </div>
                          ))}
                          <button type="button" className="secondaryBtn" onClick={() => addSpan(b.id)}>+ Add Span</button>
                        </>
                      ) : null}
                      {openBlockId === b.id && b.type === 'paragraph' ? (
                        <div className="studyParagraphRichWrap">
                          <label className="fieldLabel">Paragraph rich-text editor</label>
                          <RichTextField
                            value={paragraphRichEditorValue(b)}
                            onChange={(v) => patchBlock(b.id, { html: v, spans: [] })}
                          />
                          <div className="fieldHint">Supports bold, italic, underline, color and links. Pasted blocks keep spans until you edit here; then HTML becomes the source.</div>
                        </div>
                      ) : null}
                      {openBlockId === b.id && (b.type === 'bulletList' || b.type === 'numberedList') ? (
                        <div className="studyListEditor">
                          <label className="fieldLabel">{b.type === 'bulletList' ? 'Bullet list' : 'Numbered list'} items</label>
                          <p className="fieldHint" style={{ marginTop: 0 }}>
                            Use Indent / Outdent for nested rows (levels). Pasted nested lists keep levels from Word/Docs.
                          </p>
                          {(() => {
                            const listItems = b.items || [];
                            const ordLabs = b.type === 'numberedList' ? computeOrderedListLabels(listItems.map(normalizeListItem)) : [];
                            return listItems.map((rawItem, ii) => {
                              const item = normalizeListItem(rawItem);
                              const depth = item.level ?? 0;
                              const marker =
                                b.type === 'numberedList'
                                  ? `${ordLabs[ii]}.`
                                  : bulletGlyphForLevel(depth);
                              return (
                                <div
                                  key={`${b.id}-lit-${ii}`}
                                  className="studyListItemEdit"
                                  style={{ paddingLeft: `${Math.min(depth, MAX_LIST_LEVEL) * 12}px` }}
                                >
                                  <span className="muted studyListMarker" title={`Level ${depth + 1}`}>
                                    {marker}
                                  </span>
                                  <div className="studyListItemMain">
                                    <textarea
                                      rows={2}
                                      value={(item.spans || []).map((s) => s.text || '').join('')}
                                      onChange={(e) => {
                                        const items = [...(b.items || [])];
                                        const cur = normalizeListItem(items[ii]);
                                        items[ii] = {
                                          ...cur,
                                          spans: [{ ...DEFAULT_SPAN(), text: e.target.value }],
                                        };
                                        patchBlock(b.id, { items });
                                      }}
                                    />
                                    <div className="studyListLevelActions row">
                                      <button
                                        type="button"
                                        className="secondaryBtn"
                                        disabled={depth <= 0}
                                        onClick={() => {
                                          const items = [...(b.items || [])];
                                          const cur = normalizeListItem(items[ii]);
                                          items[ii] = { ...cur, level: Math.max(0, (cur.level ?? 0) - 1) };
                                          patchBlock(b.id, { items });
                                        }}
                                      >
                                        Outdent
                                      </button>
                                      <button
                                        type="button"
                                        className="secondaryBtn"
                                        disabled={depth >= MAX_LIST_LEVEL}
                                        onClick={() => {
                                          const items = [...(b.items || [])];
                                          const cur = normalizeListItem(items[ii]);
                                          items[ii] = {
                                            ...cur,
                                            level: Math.min(MAX_LIST_LEVEL, (cur.level ?? 0) + 1),
                                          };
                                          patchBlock(b.id, { items });
                                        }}
                                      >
                                        Indent
                                      </button>
                                      <label className="studyListLevelLabel">
                                        Level{' '}
                                        <select
                                          value={depth}
                                          onChange={(e) => {
                                            const nv = Math.min(MAX_LIST_LEVEL, Math.max(0, Number(e.target.value) || 0));
                                            const items = [...(b.items || [])];
                                            const cur = normalizeListItem(items[ii]);
                                            items[ii] = { ...cur, level: nv };
                                            patchBlock(b.id, { items });
                                          }}
                                        >
                                          {Array.from({ length: MAX_LIST_LEVEL + 1 }, (_, i) => (
                                            <option key={i} value={i}>
                                              {i + 1}
                                            </option>
                                          ))}
                                        </select>
                                      </label>
                                    </div>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                          <div className="row">
                            <button
                              type="button"
                              className="secondaryBtn"
                              onClick={() => {
                                const prev = (b.items || []).length
                                  ? normalizeListItem(b.items[b.items.length - 1])
                                  : { level: 0 };
                                patchBlock(b.id, {
                                  items: [
                                    ...(b.items || []),
                                    { spans: [{ ...DEFAULT_SPAN(), text: '' }], level: prev.level ?? 0 },
                                  ],
                                });
                              }}
                            >
                              + Add item
                            </button>
                            <button
                              type="button"
                              className="secondaryBtn"
                              onClick={() => {
                                const items = [...(b.items || [])];
                                if (items.length > 1) items.pop();
                                patchBlock(b.id, { items });
                              }}
                            >
                              Remove last item
                            </button>
                          </div>
                        </div>
                      ) : null}
                      {openBlockId === b.id && (b.type === 'image_v2' || b.type === 'image' || b.type === 'gif') ? (
                        <>
                          <div className="row">
                            <select
                              value={b.type === 'image_v2' ? (b.layout?.align || 'center') : (b.align || 'center')}
                              onChange={(e) => (b.type === 'image_v2'
                                ? patchBlock(b.id, { layout: { ...(b.layout || {}), align: e.target.value } })
                                : patchBlock(b.id, { align: e.target.value }))}
                            >
                              <option value="left">Left</option>
                              <option value="center">Centered</option>
                              <option value="right">Right</option>
                              <option value="justify">Justified</option>
                            </select>
                            <select
                              value={b.type === 'image_v2' ? (b.layout?.containerRatio || '16:9') : (b.cropRatio || 'free')}
                              onChange={(e) => (b.type === 'image_v2'
                                ? patchBlock(b.id, { layout: { ...(b.layout || {}), containerRatio: e.target.value } })
                                : patchBlock(b.id, { cropRatio: e.target.value }))}
                            >
                              <option value="free">Freehand (original)</option>
                              <option value="1:1">1:1</option>
                              <option value="4:3">4:3</option>
                              <option value="16:9">16:9</option>
                            </select>
                            <input
                              type="file"
                              accept={b.type === 'gif' ? 'image/gif' : 'image/*'}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) {
                                  setDraft(b.id, f, {
                                    cropRatio: b.type === 'image_v2' ? (b.layout?.containerRatio || '16:9') : (b.cropRatio || '16:9'),
                                    assetType: b.type === 'gif' ? 'gif' : 'image',
                                  });
                                  setTimeout(() => openCropPopup(b.id), 0);
                                }
                              }}
                            />
                            <button type="button" className="secondaryBtn" onClick={() => openCropPopup(b.id)}>Open Cropper</button>
                            <span className="muted">{uploadingBlockId === b.id ? 'Uploading...' : 'Choose file, then crop in popup'}</span>
                          </div>
                          <input
                            value={b.type === 'image_v2' ? (b.caption?.html || '') : (b.caption || '')}
                            onChange={(e) => (b.type === 'image_v2'
                              ? patchBlock(b.id, { caption: { ...(b.caption || {}), html: e.target.value } })
                              : patchBlock(b.id, { caption: e.target.value }))}
                            placeholder="Caption"
                          />
                        </>
                      ) : null}
                      {openBlockId === b.id && b.type === 'imageCarousel' ? (
                        <>
                          <div className="row">
                            <select value={b.cropRatio || '16:9'} onChange={(e) => patchBlock(b.id, { cropRatio: e.target.value })}>
                              <option value="free">Freehand (original)</option>
                              <option value="1:1">1:1</option>
                              <option value="4:3">4:3</option>
                              <option value="16:9">16:9</option>
                            </select>
                            <span className="muted">Upload each slide with selected ratio</span>
                          </div>
                          {(b.items || []).map((item, i) => (
                            <div className="row" key={`${b.id}-item-${i}`}>
                              <div className="studyCarouselThumb">
                                {item.url ? <img src={item.url} alt={`slide-${i + 1}`} className="studyCarouselThumbImg" /> : <span className="muted">No image</span>}
                              </div>
                              <input
                                value={item.caption || ''}
                                onChange={(e) => {
                                  const items = [...(b.items || [])];
                                  items[i] = { ...items[i], caption: e.target.value };
                                  patchBlock(b.id, { items });
                                }}
                                placeholder="Caption"
                              />
                              <input
                                type="file"
                                accept="image/*"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) setDraft(b.id, f, { cropRatio: b.cropRatio, assetType: 'carousel', carouselIndex: i });
                                }}
                              />
                              <button
                                type="button"
                                className="secondaryBtn"
                                onClick={() => {
                                  const d = cropDrafts[draftKey(b.id, i)];
                                  if (d) uploadAssetForBlock(b.id, 'carousel', d, { cropRatio: b.cropRatio, carouselIndex: i });
                                }}
                              >
                                Crop & Upload
                              </button>
                            </div>
                          ))}
                          <button type="button" className="secondaryBtn" onClick={() => patchBlock(b.id, { items: [...(b.items || []), { url: '', caption: '' }] })}>+ Slide</button>
                        </>
                      ) : null}
                      {openBlockId === b.id && b.type === 'table' ? (
                        <div className="studyTableEditor">
                          {(b.rows || []).map((row, rIdx) => (
                            <div className="studyTableEditorRow" key={`${b.id}-r-${rIdx}`}>
                              {(row || []).map((cell, cIdx) => (
                                <input
                                  key={`${b.id}-${rIdx}-${cIdx}`}
                                  value={cell || ''}
                                  onChange={(e) => patchTableCell(b.id, rIdx, cIdx, e.target.value)}
                                  placeholder={rIdx === 0 ? 'Header' : 'Cell'}
                                />
                              ))}
                            </div>
                          ))}
                          <div className="row">
                            <button type="button" className="secondaryBtn" onClick={() => addTableRow(b.id)}>+ Row</button>
                            <button type="button" className="secondaryBtn" onClick={() => addTableColumn(b.id)}>+ Column</button>
                          </div>
                        </div>
                      ) : null}
                      {openBlockId === b.id && b.type === 'pdfAttachment' ? (
                        <>
                          <select value={b.align || 'right'} onChange={(e) => patchBlock(b.id, { align: e.target.value })}>
                            <option value="left">Left</option>
                            <option value="center">Centered</option>
                            <option value="right">Right</option>
                            <option value="justify">Justified</option>
                          </select>
                          <input value={b.label || ''} onChange={(e) => patchBlock(b.id, { label: e.target.value })} placeholder="Button label" />
                          <div className="row">
                            <input type="file" accept="application/pdf" onChange={(e) => uploadAssetForBlock(b.id, 'pdf', e.target.files?.[0])} />
                            <span className="muted">{uploadingBlockId === b.id ? 'Uploading...' : 'Upload PDF'}</span>
                          </div>
                          <input value={b.url || ''} onChange={(e) => patchBlock(b.id, { url: e.target.value })} placeholder="PDF URL" />
                        </>
                      ) : null}
                      {openBlockId === b.id && b.type === 'audioAttachment' ? (
                        <>
                          <input value={b.title || ''} onChange={(e) => patchBlock(b.id, { title: e.target.value })} placeholder="Audio title" />
                          <input value={b.url || ''} onChange={(e) => patchBlock(b.id, { url: e.target.value })} placeholder="Audio URL" />
                        </>
                      ) : null}
                      {openBlockId === b.id && b.type === 'highlightedQuote' ? (
                        <div className="studyParagraphRichWrap">
                          <label className="fieldLabel">Highlighted quote rich-text editor</label>
                          <RichTextField value={b.html || ''} onChange={(v) => patchBlock(b.id, { html: v })} />
                        </div>
                      ) : null}
                    </div>
                    );
                  })}
                </div>
              </div>

              <div className="studyFullscreenPreview">
                <div className="studyPreviewSidebarHead row">
                  <div>
                    <div className="fieldLabel" style={{ marginBottom: 4 }}>Mobile preview</div>
                    <div className="fieldHint" style={{ margin: 0 }}>
                      Approx. phone width. Tablet and desktop open in a larger popup.
                    </div>
                  </div>
                  <div className="studyPreviewOpenPopups row">
                    <button type="button" className="secondaryBtn" onClick={() => setPreviewPopup('tablet')}>
                      Tablet preview
                    </button>
                    <button type="button" className="secondaryBtn" onClick={() => setPreviewPopup('desktop')}>
                      Desktop preview
                    </button>
                  </div>
                </div>
                <div className="studyPreviewSidebarScroll">
                  <Preview
                    blocks={doc.blocks}
                    cropDrafts={cropDrafts}
                    variant="mobile"
                    onBlockClick={focusBlockFromPreview}
                    selectedBlockId={openBlockId}
                  />
                </div>
              </div>
            </div>
          </form>
        </div>
      ) : null}

      {editorOpen && previewPopup ? (
        <div
          className="studyPreviewPopupOverlay"
          role="presentation"
          onClick={() => setPreviewPopup(null)}
        >
          <div
            className={`studyPreviewPopupModal ${previewPopup === 'tablet' ? 'isTablet' : 'isDesktop'}`}
            role="dialog"
            aria-labelledby="study-preview-popup-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="studyPreviewPopupHead">
              <div className="studyPreviewPopupTitleBlock">
                <strong id="study-preview-popup-title">
                  {previewPopup === 'tablet' ? 'Tablet preview' : 'Desktop preview'}
                </strong>
                <span className="studyPreviewPopupHint">
                  {previewPopup === 'tablet' ? 'Approx. 834px content width' : 'Approx. 1200px content width'}
                </span>
              </div>
              <button type="button" className="secondaryBtn" onClick={() => setPreviewPopup(null)}>
                Close
              </button>
            </div>
            <div className="studyPreviewPopupBody">
              <Preview
                blocks={doc.blocks}
                cropDrafts={cropDrafts}
                variant={previewPopup}
                onBlockClick={focusBlockFromPreview}
                selectedBlockId={openBlockId}
              />
            </div>
          </div>
        </div>
      ) : null}

      {activeCropKey && cropDrafts[activeCropKey] ? (
        <div className="studyCropModalOverlay">
          <div className="studyCropModalCard">
            <div className="studyCropModalHead">
              <strong>Crop Image</strong>
              <button type="button" className="dangerBtn" onClick={closeCropPopup}>Close</button>
            </div>
            <div className="studyCropPreviewFrame large">
              <Cropper
                image={cropDrafts[activeCropKey].url}
                crop={cropPosition}
                zoom={cropDrafts[activeCropKey].zoom}
                aspect={RATIO_MAP[cropDrafts[activeCropKey].ratio] || (16 / 9)}
                cropShape="rect"
                showGrid
                onCropChange={(nextCrop) => setCropPosition(nextCrop)}
                onZoomChange={(nextZoom) => setCropDrafts((prev) => ({ ...prev, [activeCropKey]: { ...prev[activeCropKey], zoom: nextZoom } }))}
                onCropComplete={(_, croppedAreaPixels) => {
                  const d = cropDrafts[activeCropKey];
                  if (!d) return;
                  const panX = ((cropPosition.x || 0) / 120);
                  const panY = ((cropPosition.y || 0) / 120);
                  setCropDrafts((prev) => ({
                    ...prev,
                    [activeCropKey]: { ...prev[activeCropKey], panX: Math.max(-1, Math.min(1, panX)), panY: Math.max(-1, Math.min(1, panY)), cropPixels: croppedAreaPixels, cropX: cropPosition.x || 0, cropY: cropPosition.y || 0 },
                  }));
                }}
              />
            </div>
            <div className="studyCropControls">
              <label>Zoom<input type="range" min="1" max="3" step="0.05" value={cropDrafts[activeCropKey].zoom} onChange={(e) => setCropDrafts((prev) => ({ ...prev, [activeCropKey]: { ...prev[activeCropKey], zoom: Number(e.target.value) } }))} /></label>
            </div>
            <div className="row">
              <button
                type="button"
                className="secondaryBtn"
                onClick={async () => {
                  const d = cropDrafts[activeCropKey];
                  if (!d) return;
                  const blockId = String(activeCropKey).split(':')[0];
                  const idxPart = String(activeCropKey).split(':')[1];
                  const carouselIndex = idxPart != null ? Number(idxPart) : undefined;
                  const blk = (doc.blocks || []).find((x) => x.id === blockId);
                  await uploadAssetForBlock(blockId, d.assetType || 'image', d, {
                    cropRatio: d.ratio,
                    carouselIndex,
                    align: blk?.layout?.align || blk?.align || 'center',
                  });
                  closeCropPopup();
                }}
              >
                Apply Crop & Upload
              </button>
              <button
                type="button"
                className="dangerBtn"
                onClick={() => {
                  const blockId = String(activeCropKey).split(':')[0];
                  const idxPart = String(activeCropKey).split(':')[1];
                  clearDraft(blockId, idxPart != null ? Number(idxPart) : undefined);
                  closeCropPopup();
                }}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
