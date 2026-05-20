import React, { useMemo } from 'react';
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { HtmlContent } from '../HtmlContent';

const BRAND_BLUE = '#1a237e';

const BODY_FONT = 17;
const BODY_LINE = 26;
const H1_FONT = 28;
const H2_FONT = 24;
const H3_FONT = 21;

type Block = {
  id: string;
  type: string;
  [key: string]: any;
};

type InlineSpan = {
  text?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  href?: string;
};

export function parseContentBlocks(contentJson: string): Block[] {
  try {
    const parsed = JSON.parse(contentJson || '{}');
    if (!Array.isArray(parsed.blocks)) return [];
    return parsed.blocks;
  } catch {
    return [];
  }
}

export function splitBlocksByDivider(blocks: Block[]): Block[][] {
  const chunks: Block[][] = [];
  let cur: Block[] = [];
  for (const b of blocks) {
    if (b.type === 'divider') {
      if (cur.length) chunks.push(cur);
      cur = [];
    } else {
      cur.push(b);
    }
  }
  if (cur.length) chunks.push(cur);
  if (!chunks.length) return [blocks];
  return chunks.every((c) => c.length === 0) ? [blocks.filter((x) => x.type !== 'divider')] : chunks;
}

function splitRows(raw: any): string[][] {
  if (Array.isArray(raw)) return raw.map((r) => (Array.isArray(r) ? r.map((c) => String(c || '')) : []));
  return [];
}

function stripHtml(html: string) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function paragraphHasRenderableHtml(block: any): boolean {
  if (!block?.html || typeof block.html !== 'string') return false;
  return stripHtml(block.html).length > 0;
}

function applyCasing(text: string, mode?: string) {
  const t = String(text || '');
  if (mode === 'allCaps') return t.toUpperCase();
  if (mode === 'smallCaps') return t.toLowerCase();
  if (mode === 'titleCase') return t.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  if (mode === 'sentenceCase') {
    const s = t.toLowerCase().trim();
    if (!s) return '';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  return t;
}

/** Admin .studyPreviewList--leveled: row margin-left = depth * 18px */
const LIST_LEVEL_INDENT = 18;

const BULLET_ONLY_RE = /^\s*[\u2022\u2023\u25AA\u25E6\u25CF\u25CB\u25C6\u25C7◦▪•\-–—*\uf0b7\uF0B7]+\s*$/i;
const LEADING_MARKER_RE = /^[\s\u00A0]*(?:[\u2022\u2023\u25AA\u25E6\u25CF\u25CB\u25C6\u25C7◦▪•\-–—*\uf0b7]|\d+[.)])\s*/i;

/** Remove stray list markers pasted into heading or list item text. */
function stripLeadingListMarker(text: string) {
  let t = String(text || '');
  while (LEADING_MARKER_RE.test(t)) {
    t = t.replace(LEADING_MARKER_RE, '');
  }
  return t;
}

function isBulletOnlySpan(text: string) {
  return BULLET_ONLY_RE.test(String(text || ''));
}

function collapseInlineWhitespace(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

/** Headings in admin use spans only — no list markers. */
function normalizeHeadingSpans(block: any): InlineSpan[] {
  const raw = normalizeSpans(block, false).filter((s) => !isBulletOnlySpan(s.text || ''));
  if (!raw.length) return [{ text: '', bold: true, color: '#0f172a' }];
  const style = raw.find((s) => String(s.text || '').trim()) || raw[0];
  const joined = collapseInlineWhitespace(
    raw.map((s) => stripLeadingListMarker(s.text || '')).join(''),
  );
  return [{
    ...style,
    text: applyCasing(joined, block?.casing),
    bold: true,
  }];
}

function normalizeListItemSpans(item: any): InlineSpan[] {
  const raw = normalizeSpans(item, false).filter((s) => !isBulletOnlySpan(s.text || ''));
  if (!raw.length) return [{ text: '', color: '#334155' }];
  const style = raw[0];
  const joined = collapseInlineWhitespace(
    raw.map((s) => stripLeadingListMarker(s.text || '')).join(''),
  );
  return [{ ...style, text: joined }];
}

/** Prefer structured spans when they match HTML plain text (avoids RenderHTML list quirks). */
function paragraphShouldUseHtml(block: any): boolean {
  if (!paragraphHasRenderableHtml(block)) return false;
  const spanText = collapseInlineWhitespace(
    normalizeSpans(block, false).map((s) => s.text || '').join(''),
  );
  if (!spanText) return true;
  const htmlText = collapseInlineWhitespace(stripHtml(block.html));
  return htmlText.length > 0 && htmlText !== spanText;
}

function normalizeSpans(block: any, stripMarkers = false): InlineSpan[] {
  let spans: InlineSpan[];
  if (Array.isArray(block?.spans) && block.spans.length) {
    spans = block.spans;
  } else {
    spans = [{
      text: String(block?.text || ''),
      bold: !!block?.bold,
      italic: !!block?.italic,
      underline: !!block?.underline,
      color: block?.color || '#334155',
      href: '',
    }];
  }
  if (!stripMarkers) return spans;
  const out = [...spans];
  if (out[0]?.text) {
    out[0] = { ...out[0], text: stripLeadingListMarker(out[0].text || '') };
  }
  return out;
}

function InlineText({ spans, baseStyle }: { spans: InlineSpan[]; baseStyle: any }) {
  return (
    <Text style={baseStyle}>
      {spans.map((s, i) => (
        <Text
          key={`${i}-${s.text || ''}`}
          style={{
            color: s.color || '#334155',
            fontWeight: s.bold ? '700' : '400',
            fontStyle: s.italic ? 'italic' : 'normal',
            textDecorationLine: s.underline ? 'underline' : 'none',
          }}
          onPress={() => {
            if (s.href) void Linking.openURL(s.href);
          }}
        >
          {s.text || ''}
        </Text>
      ))}
    </Text>
  );
}

const MAX_LIST_LEVEL = 8;

function clampListLevel(n: number) {
  return Math.min(MAX_LIST_LEVEL, Math.max(0, n));
}

/** Match admin preview: one bullet glyph, nesting shown by indent only. */
function bulletGlyphForLevel(_level: number) {
  return '\u2022';
}

function computeOrderedListLabels(items: any[]): string[] {
  const path: number[] = [];
  return (items || []).map((it) => {
    const L = clampListLevel(Number(it?.level) || 0);
    while (path.length > L + 1) path.pop();
    path.length = L + 1;
    path[L] = (path[L] || 0) + 1;
    return path.join('.');
  });
}

function parseContainerRatio(ratio?: string): number {
  if (!ratio || typeof ratio !== 'string') return 16 / 9;
  const parts = ratio.split(':').map((x) => parseFloat(x.trim()));
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) return parts[0] / parts[1];
  return 16 / 9;
}

function ListItemRow({
  marker,
  spans,
  depth,
  ordered,
}: {
  marker: string;
  spans: InlineSpan[];
  depth: number;
  ordered?: boolean;
}) {
  const indent = depth * LIST_LEVEL_INDENT;
  const markerText = ordered ? `${marker} ` : `${marker} `;
  return (
    <Text style={[styles.listRow, { paddingLeft: indent }]}>
      <Text style={styles.listGlyphInline}>{markerText}</Text>
      {spans.map((s, i) => (
        <Text
          key={`${i}-${s.text || ''}`}
          style={{
            color: s.color || '#334155',
            fontWeight: s.bold ? '700' : '400',
            fontStyle: s.italic ? 'italic' : 'normal',
            textDecorationLine: s.underline ? 'underline' : 'none',
          }}
          onPress={() => {
            if (s.href) void Linking.openURL(s.href);
          }}
        >
          {s.text || ''}
        </Text>
      ))}
    </Text>
  );
}

type Props = {
  blocks: Block[];
  description?: string | null;
  /** When false, render a View (for screens that already use ScrollView). Default true. */
  scrollable?: boolean;
  horizontalInset?: number;
};

function ContentBlocksBody({
  blocks,
  description,
  horizontalInset = 32,
}: Omit<Props, 'scrollable'>) {
  const { width } = useWindowDimensions();
  const contentWidth = Math.max(200, width - horizontalInset);

  return (
    <>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {blocks.map((b, idx) => {
        if (b.type === 'heading') {
          const size = b.level === 1 ? H1_FONT : b.level === 2 ? H2_FONT : H3_FONT;
          return (
            <View key={b.id || `h-${idx}`} style={styles.blockWrap}>
              <InlineText
                spans={normalizeHeadingSpans(b)}
                baseStyle={[
                  styles.heading,
                  {
                    fontSize: size,
                    lineHeight: size + 6,
                    color: b.color || '#0f172a',
                    textAlign: b.align || (b.level === 1 ? 'center' : 'left'),
                  },
                ]}
              />
            </View>
          );
        }
        if (b.type === 'paragraph') {
          if (paragraphShouldUseHtml(b)) {
            return (
              <View key={b.id || `p-${idx}`} style={styles.blockWrap}>
                <HtmlContent
                  html={b.html}
                  horizontalInset={horizontalInset}
                  baseFontSize={BODY_FONT}
                  studyContent
                  style={styles.richHtmlWrap}
                />
              </View>
            );
          }
          return (
            <View key={b.id || `p-${idx}`} style={styles.blockWrap}>
              <InlineText
                spans={normalizeSpans(b)}
                baseStyle={[
                  styles.paragraph,
                  {
                    color: b.color || '#334155',
                    fontWeight: b.bold ? '700' : '400',
                    fontStyle: b.italic ? 'italic' : 'normal',
                    textDecorationLine: b.underline ? 'underline' : 'none',
                  },
                ]}
              />
            </View>
          );
        }
        if (b.type === 'bulletList' || b.type === 'numberedList') {
          const listItems = b.items || [];
          const isOrdered = b.type === 'numberedList';
          const ordLabs = isOrdered ? computeOrderedListLabels(listItems) : [];
          return (
            <View key={b.id || `list-${idx}`} style={styles.listBlock}>
              {listItems.map((item: any, li: number) => {
                const depth = clampListLevel(Number(item?.level) || 0);
                const marker = isOrdered
                  ? `${ordLabs[li] ?? String(li + 1)}.`
                  : bulletGlyphForLevel(depth);
                return (
                  <ListItemRow
                    key={`${b.id || idx}-${li}`}
                    marker={marker}
                    spans={normalizeListItemSpans(item)}
                    depth={depth}
                    ordered={isOrdered}
                  />
                );
              })}
            </View>
          );
        }
        if (b.type === 'highlightedQuote') {
          if (paragraphHasRenderableHtml(b)) {
            return (
              <View key={b.id || `q-${idx}`} style={[styles.quoteCard, { alignSelf: 'stretch' }]}>
                <HtmlContent html={b.html} horizontalInset={horizontalInset + 24} baseFontSize={BODY_FONT} studyContent />
              </View>
            );
          }
          return (
            <View key={b.id || `q-${idx}`} style={[styles.quoteCard, { alignSelf: 'stretch' }]}>
              <Text style={styles.quoteText}>{stripHtml(b.html || '')}</Text>
            </View>
          );
        }
        if (b.type === 'image_v2' || b.type === 'gif' || b.type === 'image') {
          const imageUrl = b.renderCache?.derivedUrl || b.asset?.originalUrl || b.url;
          const align = b.layout?.align || b.align || 'center';
          const aspectRatio = parseContainerRatio(b.layout?.containerRatio);
          const fitContain = b.layout?.fitMode !== 'cover';
          const imageWidth = contentWidth - 16;
          return (
            <View
              key={b.id || `img-${idx}`}
              style={[
                styles.mediaCard,
                { width: imageWidth },
                align === 'left' ? { alignSelf: 'flex-start' } :
                  align === 'right' ? { alignSelf: 'flex-end' } : { alignSelf: 'center' },
              ]}
            >
              {imageUrl ? (
                <Image
                  source={{ uri: imageUrl }}
                  style={[styles.image, { aspectRatio, maxHeight: 300 }]}
                  resizeMode={fitContain ? 'contain' : 'cover'}
                />
              ) : null}
              {b.caption?.html ? (
                <HtmlContent html={b.caption.html} horizontalInset={horizontalInset + 16} baseFontSize={14} style={styles.captionHtml} />
              ) : b.caption ? (
                <Text style={styles.caption}>{b.caption}</Text>
              ) : null}
            </View>
          );
        }
        if (b.type === 'imageCarousel') {
          const slideWidth = Math.min(300, contentWidth * 0.85);
          return (
            <ScrollView key={b.id || `car-${idx}`} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carouselRow}>
              {(b.items || []).map((item: any, i: number) => (
                <View key={`${b.id || idx}-${i}`} style={[styles.carouselCard, { width: slideWidth }]}>
                  {item.url ? (
                    <Image
                      source={{ uri: item.url }}
                      style={[styles.carouselImage, { aspectRatio: 4 / 3 }]}
                      resizeMode="contain"
                    />
                  ) : null}
                  {item.caption ? <Text style={styles.caption}>{item.caption}</Text> : null}
                </View>
              ))}
            </ScrollView>
          );
        }
        if (b.type === 'table') {
          const rows = splitRows(b.rows);
          return (
            <View key={b.id || `t-${idx}`} style={styles.tableWrap}>
              {rows.map((row, rIdx) => (
                <View key={`${idx}-r-${rIdx}`} style={styles.tableRow}>
                  {row.map((cell, cIdx) => (
                    <Text key={`${idx}-${rIdx}-${cIdx}`} style={[styles.tableCell, rIdx === 0 ? styles.tableHeader : null]}>
                      {cell}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          );
        }
        if (b.type === 'pdfAttachment') {
          return (
            <TouchableOpacity
              key={b.id || `pdf-${idx}`}
              style={[
                styles.linkCard,
                b.align === 'left' ? { alignSelf: 'flex-start' } :
                  b.align === 'center' ? { alignSelf: 'center' } : { alignSelf: 'flex-end' },
              ]}
              onPress={() => b.url && Linking.openURL(b.url)}
            >
              <Text style={styles.linkText}>{b.label || 'Download PDF'}</Text>
            </TouchableOpacity>
          );
        }
        if (b.type === 'audioAttachment') {
          return (
            <TouchableOpacity key={b.id || `aud-${idx}`} style={styles.linkCard} onPress={() => b.url && Linking.openURL(b.url)}>
              <Text style={styles.linkText}>{b.title || 'Open Audio File'}</Text>
            </TouchableOpacity>
          );
        }
        if (b.type === 'divider') {
          return <View key={b.id || `div-${idx}`} style={styles.divider} />;
        }
        return null;
      })}
    </>
  );
}

export function ContentBlocksView({
  blocks,
  description,
  scrollable = true,
  horizontalInset = 32,
}: Props) {
  const body = useMemo(
    () => (
      <ContentBlocksBody
        blocks={blocks}
        description={description}
        horizontalInset={horizontalInset}
      />
    ),
    [blocks, description, horizontalInset],
  );

  if (!scrollable) {
    return <View style={styles.content}>{body}</View>;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {body}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 16, paddingBottom: 36 },
  blockWrap: { marginBottom: 8 },
  description: { color: '#475569', fontSize: 16, lineHeight: 24, marginBottom: 8 },
  heading: { color: '#0f172a', fontWeight: '700', marginTop: 4, marginBottom: 2 },
  listBlock: {
    alignSelf: 'stretch',
    marginBottom: 12,
  },
  listRow: {
    fontSize: BODY_FONT,
    lineHeight: BODY_LINE,
    color: '#334155',
    marginBottom: 6,
  },
  listGlyphInline: {
    fontSize: BODY_FONT,
    lineHeight: BODY_LINE,
    color: '#475569',
    fontWeight: '600',
  },
  paragraph: { fontSize: BODY_FONT, lineHeight: BODY_LINE, marginTop: 0, marginBottom: 0 },
  richHtmlWrap: { marginTop: 0, marginBottom: 0 },
  mediaCard: { backgroundColor: '#fff', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  image: { width: '100%', borderRadius: 10, backgroundColor: '#e2e8f0' },
  caption: { marginTop: 6, fontSize: 14, lineHeight: 20, color: '#64748b' },
  captionHtml: { marginTop: 4 },
  carouselRow: { gap: 10, paddingVertical: 2 },
  carouselCard: { backgroundColor: '#fff', borderRadius: 12, padding: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  carouselImage: { width: '100%', borderRadius: 10, backgroundColor: '#e2e8f0' },
  tableWrap: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, overflow: 'hidden', backgroundColor: '#fff' },
  tableRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  tableCell: { flex: 1, padding: 10, color: '#334155', fontSize: 15, lineHeight: 22 },
  tableHeader: { fontWeight: '700', color: BRAND_BLUE, backgroundColor: '#eef2ff' },
  linkCard: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#dbe3f0', borderRadius: 10, padding: 12 },
  linkText: { color: BRAND_BLUE, fontWeight: '700', fontSize: 16 },
  divider: { height: 1, backgroundColor: '#e2e8f0', marginVertical: 8 },
  quoteCard: {
    backgroundColor: '#eff6ff',
    borderLeftWidth: 4,
    borderLeftColor: BRAND_BLUE,
    borderRadius: 10,
    padding: 12,
  },
  quoteText: { color: BRAND_BLUE, fontSize: BODY_FONT, lineHeight: BODY_LINE, fontStyle: 'italic', fontWeight: '600' },
});
