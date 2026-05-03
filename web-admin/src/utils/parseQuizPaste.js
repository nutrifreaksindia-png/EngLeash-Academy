/**
 * Parse pasted CSV (RFC-style quoted fields, multiline cells) into quiz editor state.
 * Expected header:
 * quiz_title,...,prompt1,prompt2,...,feedback,fill_case_sensitive
 */

import { emptyQuestion, normalizeEditorQuestion } from './quizQuestionFormat.js';

export const QUIZ_PASTE_HEADER =
  'quiz_title,quiz_description,version_title,passing_pct,time_limit_sec,question_index,type,prompt1,prompt2,points,mcq_options,matching_pairs,fill_blanks,feedback,fill_case_sensitive';

const TYPE_ALIASES = {
  mcq_single: 'mcq_single',
  single: 'mcq_single',
  objective_single: 'mcq_single',
  mcq_multi: 'mcq_multi',
  multi: 'mcq_multi',
  objective_multi: 'mcq_multi',
  matching: 'matching',
  match: 'matching',
  fill_blank: 'fill_blank',
  completion: 'fill_blank',
  fill: 'fill_blank',
};

/** Split CSV into rows of string fields (supports "quoted" fields with newlines). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const s = String(text || '').replace(/^\uFEFF/, '');

  while (i < s.length) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (c === '\r' && s[i + 1] === '\n') {
      row.push(field);
      field = '';
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
      i += 2;
      continue;
    }
    if (c === '\n') {
      row.push(field);
      field = '';
      if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);
      row = [];
      i += 1;
      continue;
    }
    field += c;
    i += 1;
  }
  row.push(field);
  if (row.some((cell) => String(cell).trim() !== '')) rows.push(row);

  return rows;
}

function normalizeHeader(h) {
  return String(h || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function normalizeType(raw) {
  const k = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  return TYPE_ALIASES[k] || null;
}

function parseBoolCell(raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on'].includes(s);
}

/**
 * @returns {{ ok: true, meta: object, questions: object[] } | { ok: false, error: string }}
 */
export function parseQuizPaste(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { ok: false, error: 'Paste needs a header row and at least one question row.' };
  }

  const headerLen = rows[0].length;
  for (const r of rows) {
    while (r.length < headerLen) r.push('');
  }

  const header = rows[0].map(normalizeHeader);
  const col = (name) => header.indexOf(name);

  const idxTitle = col('quiz_title');
  const idxDesc = col('quiz_description');
  const idxVerTitle = col('version_title');
  const idxPass = col('passing_pct');
  const idxTime = col('time_limit_sec');
  const idxQ = col('question_index');
  const idxType = col('type');
  const idxPrompt1 = col('prompt1');
  const idxPrompt2 = col('prompt2');
  const idxLegacyPrompt = col('prompt');
  const idxPoints = col('points');
  const idxMcq = col('mcq_options');
  const idxPairs = col('matching_pairs');
  const idxBlanks = col('fill_blanks');
  const idxFeedback = col('feedback');
  const idxLegacyExpl = col('explanation');
  const idxLegacySlot = col('slot_feedback');
  const idxFillCase = col('fill_case_sensitive');

  if (idxType < 0) {
    return {
      ok: false,
      error:
        'Missing required column: type. First row must match the header in the paste box (including prompt1, prompt2, feedback).',
    };
  }

  const hasPrompt1 = idxPrompt1 >= 0;
  const hasLegacy = idxLegacyPrompt >= 0;
  if (!hasPrompt1 && !hasLegacy) {
    return { ok: false, error: 'Header must include prompt1 (or legacy column prompt).' };
  }

  const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c || '').trim() !== ''));

  if (dataRows.length === 0) {
    return { ok: false, error: 'No data rows after the header.' };
  }

  const first = dataRows[0];
  const quizTitle = idxTitle >= 0 ? String(first[idxTitle] || '').trim() : '';
  if (!quizTitle) {
    return { ok: false, error: 'quiz_title is empty in the first data row.' };
  }

  const timeRaw = idxTime >= 0 ? String(first[idxTime] || '').trim() : '';
  const timeNum = timeRaw === '' ? NaN : Number(timeRaw);

  const meta = {
    title: quizTitle,
    description: idxDesc >= 0 ? String(first[idxDesc] || '').trim() : '',
    versionTitle: idxVerTitle >= 0 ? String(first[idxVerTitle] || '').trim() : '',
    passingPct: idxPass >= 0 ? Number(first[idxPass]) || 60 : 60,
    timeLimitSec: Number.isFinite(timeNum) ? timeNum : '',
  };

  const indexed = dataRows
    .map((r, i) => {
      const qIdx = idxQ >= 0 ? Number(r[idxQ]) : i + 1;
      return { row: r, order: Number.isFinite(qIdx) ? qIdx : i + 1 };
    })
    .sort((a, b) => a.order - b.order);

  const questions = [];
  for (let i = 0; i < indexed.length; i += 1) {
    const r = indexed[i].row;
    const rowQuizTitle = idxTitle >= 0 ? String(r[idxTitle] || '').trim() : quizTitle;
    if (rowQuizTitle && rowQuizTitle !== quizTitle) {
      return {
        ok: false,
        error: `Multiple quiz_title values found ("${quizTitle}" vs "${rowQuizTitle}"). Use one quiz per paste — or an unquoted newline inside a cell split the CSV into an extra row. Wrap multiline cells in double quotes.`,
      };
    }

    const type = normalizeType(idxType >= 0 ? r[idxType] : '');
    if (!type) {
      return { ok: false, error: `Row ${i + 2}: unknown or missing type.` };
    }

    let prompt1 = hasPrompt1 ? String(r[idxPrompt1] || '').trim() : '';
    let prompt2 = idxPrompt2 >= 0 ? String(r[idxPrompt2] || '').trim() : '';
    if (!prompt1 && hasLegacy) {
      const legacy = String(r[idxLegacyPrompt] || '').trim();
      const re = /\bPrompt2:\s*/i;
      const idx = legacy.search(re);
      if (idx === -1) {
        prompt1 = legacy;
      } else {
        prompt1 = legacy
          .slice(0, idx)
          .trim()
          .replace(/^\s*Prompt1:\s*/i, '')
          .replace(/,\s*$/, '')
          .trim();
        prompt2 = legacy.slice(idx).replace(re, '').trim();
      }
    }
    if (!prompt1 && !prompt2) {
      return { ok: false, error: `Row ${i + 2}: prompt1 (or prompt) is required.` };
    }

    const points = idxPoints >= 0 && String(r[idxPoints] || '').trim() !== '' ? Number(r[idxPoints]) : 1;
    const q = {
      ...emptyQuestion(),
      type,
      prompt1,
      prompt2,
      points: Number.isFinite(points) && points > 0 ? points : 1,
    };

    if (type === 'mcq_single' || type === 'mcq_multi') {
      const raw = idxMcq >= 0 ? String(r[idxMcq] || '').trim() : '';
      if (!raw) {
        return { ok: false, error: `Row ${i + 2}: mcq_options required for MCQ.` };
      }
      const lines = raw.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
      if (lines.length < 2) {
        return { ok: false, error: `Row ${i + 2}: need at least 2 option lines for MCQ.` };
      }
      const stars = lines.filter((l) => l.startsWith('*')).length;
      if (type === 'mcq_single' && stars !== 1) {
        return { ok: false, error: `Row ${i + 2}: mcq_single needs exactly one line starting with * (correct answer).` };
      }
      if (type === 'mcq_multi' && stars < 1) {
        return { ok: false, error: `Row ${i + 2}: mcq_multi needs at least one line starting with *.` };
      }
      q.optionsText = raw;
    } else if (type === 'matching') {
      let raw = idxPairs >= 0 ? String(r[idxPairs] || '').trim() : '';
      if (!raw && idxMcq >= 0) {
        raw = String(r[idxMcq] || '').trim();
      }
      if (!raw && idxBlanks >= 0) {
        const misplaced = String(r[idxBlanks] || '').trim();
        if (misplaced.includes('=>')) raw = misplaced;
      }
      if (!raw) {
        return {
          ok: false,
          error: `Row ${i + 2}: matching pairs missing. After points use two commas then quotes: ...2,,"Line1 => A\nLine2 => B" (one empty mcq column). If you used three commas before the quote, the text went into the wrong column — fix commas or upgrade the app.`,
        };
      }
      const pairLines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (pairLines.length < 2) {
        return { ok: false, error: `Row ${i + 2}: matching needs at least 2 pairs (lines left => right).` };
      }
      for (const line of pairLines) {
        if (!line.includes('=>')) {
          return { ok: false, error: `Row ${i + 2}: each matching line must contain =>` };
        }
      }
      q.pairsText = raw;
    } else if (type === 'fill_blank') {
      let raw = idxBlanks >= 0 ? String(r[idxBlanks] || '').trim() : '';
      if (!raw && idxMcq >= 0) raw = String(r[idxMcq] || '').trim();
      if (!raw && idxPairs >= 0) raw = String(r[idxPairs] || '').trim();
      if (!raw) {
        return { ok: false, error: `Row ${i + 2}: fill_blanks required (key => answer per line).` };
      }
      const blankLines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (blankLines.length < 1) {
        return { ok: false, error: `Row ${i + 2}: fill_blank needs at least one blank_key => answer line.` };
      }
      q.blanksText = raw;
      if (idxFillCase >= 0) {
        q.fillCaseSensitive = parseBoolCell(r[idxFillCase]);
      }
    }

    let fb = idxFeedback >= 0 ? String(r[idxFeedback] || '').trim() : '';
    if (!fb && idxLegacyExpl >= 0) fb = String(r[idxLegacyExpl] || '').trim();
    if (!fb && idxLegacySlot >= 0) fb = String(r[idxLegacySlot] || '').trim();
    if (fb) q.incorrectFeedback = fb;

    questions.push(normalizeEditorQuestion(q));
  }

  return { ok: true, meta, questions };
}
