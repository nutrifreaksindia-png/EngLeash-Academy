/**
 * Parse pasted CSV (RFC-style quoted fields, multiline cells) into quiz editor state.
 * Expected header:
 * quiz_title,quiz_description,version_title,passing_pct,time_limit_sec,question_index,type,prompt,points,mcq_options,matching_pairs,fill_blanks
 */

export const QUIZ_PASTE_HEADER =
  'quiz_title,quiz_description,version_title,passing_pct,time_limit_sec,question_index,type,prompt,points,mcq_options,matching_pairs,fill_blanks';

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

function emptyEditorQuestion() {
  return {
    type: 'mcq_single',
    prompt: '',
    points: 1,
    optionsText: '',
    pairsText: '',
    blanksText: '',
  };
}

/**
 * @returns {{ ok: true, meta: object, questions: object[] } | { ok: false, error: string }}
 */
export function parseQuizPaste(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { ok: false, error: 'Paste needs a header row and at least one question row.' };
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
  const idxPrompt = col('prompt');
  const idxPoints = col('points');
  const idxMcq = col('mcq_options');
  const idxPairs = col('matching_pairs');
  const idxBlanks = col('fill_blanks');

  if ([idxType, idxPrompt].some((x) => x < 0)) {
    return {
      ok: false,
      error:
        'Missing required columns. First row must include at least: type, prompt (and usually quiz_title, question_index). See placeholder in the paste box.',
    };
  }

  const dataRows = rows.slice(1).filter((r) => r.some((c) => String(c || '').trim() !== ''));

  if (dataRows.length === 0) {
    return { ok: false, error: 'No data rows after the header.' };
  }

  const first = dataRows[0];
  const quizTitle =
    idxTitle >= 0 ? String(first[idxTitle] || '').trim() : '';
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
        error: `Multiple quiz_title values found ("${quizTitle}" vs "${rowQuizTitle}"). Use one quiz per paste.`,
      };
    }

    const type = normalizeType(idxType >= 0 ? r[idxType] : '');
    if (!type) {
      return { ok: false, error: `Row ${i + 2}: unknown or missing type.` };
    }

    const prompt = idxPrompt >= 0 ? String(r[idxPrompt] || '').trim() : '';
    if (!prompt) {
      return { ok: false, error: `Row ${i + 2}: prompt is required.` };
    }

    const points = idxPoints >= 0 && String(r[idxPoints] || '').trim() !== '' ? Number(r[idxPoints]) : 1;
    const q = { ...emptyEditorQuestion(), type, prompt, points: Number.isFinite(points) && points > 0 ? points : 1 };

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
      const raw = idxPairs >= 0 ? String(r[idxPairs] || '').trim() : '';
      if (!raw) {
        return { ok: false, error: `Row ${i + 2}: matching_pairs required.` };
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
      const raw = idxBlanks >= 0 ? String(r[idxBlanks] || '').trim() : '';
      if (!raw) {
        return { ok: false, error: `Row ${i + 2}: fill_blanks required.` };
      }
      const blankLines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (blankLines.length < 1) {
        return { ok: false, error: `Row ${i + 2}: fill_blank needs at least one blank_key => answer line.` };
      }
      q.blanksText = raw;
    }

    questions.push(q);
  }

  return { ok: true, meta, questions };
}
