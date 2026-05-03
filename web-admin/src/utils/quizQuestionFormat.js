/**
 * Editor ↔ API question shape (shared by Quiz Bank page and preview grader).
 */

/**
 * Decode `quiz_questions_v2.explanation`: JSON `{ feedback }`, legacy `{ note, slots[] }`, or plain string.
 */
export function parseStoredFeedback(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  try {
    const o = JSON.parse(s);
    if (o && typeof o === 'object') {
      if ('feedback' in o) return String(o.feedback ?? '').trim();
      if (Array.isArray(o.slots)) {
        const note = String(o.note ?? '').trim();
        if (note) return note;
        return o.slots.map((x) => (x == null ? '' : String(x).trim())).filter(Boolean).join('\n');
      }
    }
  } catch (_) {
    /* legacy plain string */
  }
  return s;
}

/** Persist a single optional “incorrect / partial” message for learners. */
export function serializeFeedbackForApi(q) {
  const feedback = String(q.incorrectFeedback || '').trim();
  if (!feedback) return null;
  return JSON.stringify({ feedback });
}

/** @deprecated use parseStoredFeedback */
export function parseStoredExplanation(raw) {
  const fb = parseStoredFeedback(raw);
  return { note: fb, slots: [] };
}

/** @deprecated use serializeFeedbackForApi */
export function serializeExplanationForApi(q) {
  return serializeFeedbackForApi(q);
}

export function emptyQuestion() {
  return {
    type: 'mcq_single',
    prompt1: '',
    prompt2: '',
    points: 1,
    incorrectFeedback: '',
    fillCaseSensitive: false,
    mcqOptions: [
      { text: 'Option A', correct: true },
      { text: 'Option B', correct: false },
    ],
    matchPairs: [
      { left: '', right: '' },
      { left: '', right: '' },
    ],
    fillBlanks: [{ key: '', answer: '' }],
  };
}

/** When the user changes question type, replace type-specific fields with sensible defaults. */
export function editorDefaultsForType(type) {
  if (type === 'mcq_single') {
    return {
      mcqOptions: [
        { text: 'Option A', correct: true },
        { text: 'Option B', correct: false },
      ],
    };
  }
  if (type === 'mcq_multi') {
    return {
      mcqOptions: [
        { text: 'Option A', correct: true },
        { text: 'Option B', correct: false },
        { text: 'Option C', correct: false },
      ],
    };
  }
  if (type === 'matching') {
    return {
      matchPairs: [
        { left: '', right: '' },
        { left: '', right: '' },
      ],
    };
  }
  return {
    fillBlanks: [{ key: '', answer: '' }],
    fillCaseSensitive: false,
  };
}

export function optionsTextToMcqOptions(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return [
      { text: 'Option A', correct: true },
      { text: 'Option B', correct: false },
    ];
  }
  return lines.map((line) => ({
    text: line.replace(/^\*/, '').trim() || 'Option',
    correct: line.startsWith('*'),
  }));
}

export function pairsTextToMatchPairs(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = lines.map((line) => {
    const [left, right] = line.split('=>').map((x) => (x || '').trim());
    return { left: left || '', right: right || '' };
  });
  return out.length >= 2 ? out : [
    { left: '', right: '' },
    { left: '', right: '' },
  ];
}

export function blanksTextToFillBlanks(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = lines.map((line) => {
    const [key, answer] = line.split('=>').map((x) => (x || '').trim());
    return { key: key || '', answer: answer || '' };
  });
  return out.length >= 1 ? out : [{ key: '', answer: '' }];
}

/** Merge CSV / legacy text fields into structured editor arrays. Prefer explicit pasted text over defaults. */
export function normalizeEditorQuestion(q) {
  const t = q.type;
  const next = { ...q };
  if (t === 'mcq_single' || t === 'mcq_multi') {
    if (String(next.optionsText || '').trim()) {
      next.mcqOptions = optionsTextToMcqOptions(next.optionsText);
    } else if (!Array.isArray(next.mcqOptions) || next.mcqOptions.length < 2) {
      next.mcqOptions = optionsTextToMcqOptions('');
    }
    delete next.optionsText;
    return next;
  }
  if (t === 'matching') {
    if (String(next.pairsText || '').trim()) {
      next.matchPairs = pairsTextToMatchPairs(next.pairsText);
    } else if (!Array.isArray(next.matchPairs) || next.matchPairs.length < 2) {
      next.matchPairs = pairsTextToMatchPairs('');
    }
    delete next.pairsText;
    return next;
  }
  if (t === 'fill_blank') {
    if (String(next.blanksText || '').trim()) {
      next.fillBlanks = blanksTextToFillBlanks(next.blanksText);
    } else if (!Array.isArray(next.fillBlanks) || next.fillBlanks.length < 1) {
      next.fillBlanks = blanksTextToFillBlanks('');
    }
    delete next.blanksText;
    return next;
  }
  return next;
}

/** Primary + optional second line, stored in API as one `prompt` with a Prompt2: marker. */
export function buildPromptFromParts(prompt1, prompt2) {
  const a = String(prompt1 || '').trim();
  const b = String(prompt2 || '').trim();
  if (!b) return a;
  return `${a}\nPrompt2: ${b}`;
}

/** Map hydrated API questions (from GET /quizzes/v2/:id) to editor row shape. */
export function apiQuestionToEditor(q) {
  const parts = splitPromptParts(q.prompt || '');
  const primary =
    parts.primary === '(No prompt)' ? '' : parts.primary;
  const base = {
    type: q.type,
    prompt1: primary,
    prompt2: parts.secondary || '',
    points: q.points || 1,
    incorrectFeedback: parseStoredFeedback(q.explanation),
    fillCaseSensitive: false,
    mcqOptions: [],
    matchPairs: [],
    fillBlanks: [],
  };
  if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
    const opts = [...(q.options || [])].sort(
      (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
    );
    base.mcqOptions = opts.map((o) => ({
      text: String(o.option_text || '').trim(),
      correct: Number(o.is_correct) === 1,
    }));
  } else if (q.type === 'matching') {
    const pairs = [...(q.pairs || [])].sort(
      (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
    );
    base.matchPairs = pairs.map((p) => ({
      left: String(p.left_text || '').trim(),
      right: String(p.right_text || '').trim(),
    }));
  } else if (q.type === 'fill_blank') {
    const sols = q.solutions || [];
    base.fillBlanks = sols.map((s) => ({
      key: String(s.blank_key || '').trim(),
      answer: String(s.answer_text || '').trim(),
    }));
    base.fillCaseSensitive = sols.some((s) => Number(s.is_case_sensitive) === 1);
  }
  return base;
}

export function apiQuestionsToEditorQuestions(apiQuestions) {
  const sorted = [...(apiQuestions || [])].sort(
    (a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0),
  );
  return sorted.length ? sorted.map(apiQuestionToEditor) : [emptyQuestion()];
}

export function parseQuestionInput(q) {
  const base = {
    type: q.type,
    prompt: buildPromptFromParts(q.prompt1, q.prompt2),
    points: Number(q.points || 1),
    explanation: serializeFeedbackForApi(q),
  };
  if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
    let opts = Array.isArray(q.mcqOptions)
      ? q.mcqOptions.filter((o) => String(o?.text ?? '').trim() !== '')
      : [];
    if (opts.length < 2) opts = optionsTextToMcqOptions(q.optionsText);
    if (q.type === 'mcq_single') {
      const firstCorrect = opts.findIndex((o) => o.correct);
      opts = opts.map((o, i) => ({ ...o, correct: firstCorrect === -1 ? i === 0 : i === firstCorrect }));
    }
    return {
      ...base,
      options: opts.map((o, idx) => ({
        option_text: String(o.text || '').trim(),
        is_correct: !!o.correct,
        sort_order: idx,
      })),
    };
  }
  if (q.type === 'matching') {
    let pairs = Array.isArray(q.matchPairs)
      ? q.matchPairs.filter((p) => String(p?.left ?? '').trim() && String(p?.right ?? '').trim())
      : [];
    if (pairs.length < 2) {
      pairs = pairsTextToMatchPairs(q.pairsText).filter(
        (p) => String(p.left || '').trim() && String(p.right || '').trim(),
      );
    }
    return {
      ...base,
      pairs: pairs.map((p, idx) => ({
        left_text: String(p.left || '').trim(),
        right_text: String(p.right || '').trim(),
        sort_order: idx,
      })),
    };
  }
  const caseSens = q.type === 'fill_blank' && !!q.fillCaseSensitive;
  let blanks = Array.isArray(q.fillBlanks)
    ? q.fillBlanks.filter((b) => String(b?.key ?? '').trim() !== '')
    : [];
  if (blanks.length < 1) {
    blanks = blanksTextToFillBlanks(q.blanksText).filter((b) => String(b.key || '').trim());
  }
  const solutions = blanks.map((b) => ({
    blank_key: String(b.key || '').trim(),
    answer_text: String(b.answer || '').trim(),
    is_case_sensitive: caseSens,
  }));
  return { ...base, solutions };
}

export function normalizeText(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

export function normalizeTextInsensitive(s) {
  return normalizeText(s).toLowerCase();
}

/** Split editor prompt into primary text + optional italic secondary (fill-in stems). */
export function splitPromptParts(prompt) {
  const s = String(prompt ?? '');
  const re = /\bPrompt2:\s*/i;
  const idx = s.search(re);
  if (idx === -1) {
    const t = s.trim();
    return { primary: t || '(No prompt)', secondary: null };
  }
  let primary = s.slice(0, idx).trim().replace(/^\s*Prompt1:\s*/i, '').replace(/,\s*$/, '').trim();
  const secondary = s.slice(idx).replace(re, '').trim();
  return {
    primary: primary || '(No prompt)',
    secondary: secondary || null,
  };
}

function roundPoints(x) {
  return Math.round(Number(x) * 100) / 100;
}

const MCQ_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Shown after submit when the learner is not fully correct; from `explanation` JSON. */
function incorrectFeedbackFromParsedQuestion(question) {
  return parseStoredFeedback(question?.explanation);
}

/**
 * Preview-only grading: partial credit per option (MCQ multi) and per pair (matching).
 * Single-choice and fill-in split points evenly across choices/blanks.
 */
export function gradeQuestionPreviewDetailed(question, response) {
  const maxPoints = Number(question.points || 1);
  const incorrectFeedback = incorrectFeedbackFromParsedQuestion(question);

  if (question.type === 'mcq_single') {
    const options = question.options || [];
    const correct = options.find((o) => Number(o.is_correct) === 1);
    const selectedIdx = response?.selectedIndex;
    if (!correct) {
      return {
        earned: 0,
        maxPoints,
        isFullyCorrect: false,
        incorrectFeedback,
        rows: [
          {
            id: 'mcq',
            label: 'Answer',
            subtitle: '',
            earned: 0,
            max: maxPoints,
            explanation: 'No correct option is marked in the quiz definition.',
          },
        ],
      };
    }
    const ordCorrect = Number(correct.sort_order);
    const ordSelected = selectedIdx == null ? NaN : Number(selectedIdx);
    const ok = Number.isFinite(ordSelected) && ordSelected === ordCorrect;
    const earned = ok ? maxPoints : 0;
    const selOpt = options.find((o) => Number(o.sort_order) === ordSelected);
    const autoExpl = ok
      ? `Correct — you selected the right answer (“${correct.option_text}”).`
      : selOpt
        ? `Incorrect — you chose “${selOpt.option_text}”; the correct answer is “${correct.option_text}”.`
        : `Incorrect — no answer selected; the correct answer is “${correct.option_text}”.`;
    return {
      earned: roundPoints(earned),
      maxPoints,
      isFullyCorrect: ok,
      incorrectFeedback,
      rows: [
        {
          id: 'mcq',
          label: 'Answer',
          subtitle: selOpt?.option_text || '—',
          earned: roundPoints(earned),
          max: maxPoints,
          explanation: autoExpl,
        },
      ],
    };
  }

  if (question.type === 'mcq_multi') {
    const options = question.options || [];
    const n = options.length;
    if (n === 0) {
      return {
        earned: 0,
        maxPoints,
        isFullyCorrect: false,
        incorrectFeedback,
        rows: [
          {
            id: 'mcq-multi-empty',
            label: '—',
            subtitle: '',
            earned: 0,
            max: maxPoints,
            explanation: 'No options are defined in the quiz.',
          },
        ],
      };
    }
    const perSlot = maxPoints / n;
    const selected = new Set((response?.selectedIndices || []).map(Number));
    let earned = 0;
    const rows = options.map((opt, i) => {
      const ord = Number(opt.sort_order);
      const keyCorrect = Number(opt.is_correct) === 1;
      const sel = selected.has(ord);
      const slotOk = (keyCorrect && sel) || (!keyCorrect && !sel);
      const slotEarned = slotOk ? perSlot : 0;
      earned += slotEarned;
      const autoExpl = keyCorrect && sel
        ? 'Correct — this option is part of the answer key and you selected it.'
        : keyCorrect && !sel
          ? 'Incorrect — this correct option was not selected.'
          : !keyCorrect && sel
            ? 'Incorrect — this distractor should not be selected.'
            : 'Correct — you correctly left this distractor unselected.';
      return {
        id: `opt-${ord}`,
        label: MCQ_LETTERS[i] ?? String(i + 1),
        subtitle: opt.option_text,
        earned: roundPoints(slotEarned),
        max: roundPoints(perSlot),
        explanation: autoExpl,
      };
    });
    const er = roundPoints(earned);
    return {
      earned: er,
      maxPoints,
      isFullyCorrect: n > 0 && Math.abs(er - maxPoints) < 0.001,
      incorrectFeedback,
      rows,
    };
  }

  if (question.type === 'matching') {
    const pairs = question.pairs || [];
    if (pairs.length === 0) {
      return {
        earned: 0,
        maxPoints,
        isFullyCorrect: false,
        incorrectFeedback,
        rows: [
          {
            id: 'match-empty',
            label: '—',
            subtitle: '',
            earned: 0,
            max: maxPoints,
            explanation: 'No matching pairs are defined in the quiz.',
          },
        ],
      };
    }
    const map = response?.matches && typeof response.matches === 'object' ? response.matches : {};
    const m = pairs.length;
    const perSlot = m > 0 ? maxPoints / m : 0;
    let earned = 0;
    const rows = pairs.map((p, i) => {
      const lk = normalizeTextInsensitive(p.left_text);
      const expected = normalizeTextInsensitive(p.right_text);
      const actualRaw = map[lk];
      const actualNorm = normalizeTextInsensitive(actualRaw ?? '');
      const slotOk = m > 0 && actualNorm === expected;
      const slotEarned = slotOk ? perSlot : 0;
      earned += slotEarned;
      const displayActual =
        actualRaw != null && String(actualRaw).trim() !== '' ? String(actualRaw).trim() : '(no answer)';
      const autoExpl = slotOk
        ? `Correct — “${p.left_text}” is matched to “${p.right_text}”.`
        : `Incorrect — for “${p.left_text}” the expected match is “${p.right_text}”; you had “${displayActual}”.`;
      return {
        id: `pair-${i}`,
        label: String(i + 1),
        subtitle: p.left_text,
        earned: roundPoints(slotEarned),
        max: roundPoints(perSlot),
        explanation: autoExpl,
      };
    });
    const er = roundPoints(earned);
    return {
      earned: er,
      maxPoints,
      isFullyCorrect: m > 0 && Math.abs(er - maxPoints) < 0.001,
      incorrectFeedback,
      rows,
    };
  }

  if (question.type === 'fill_blank') {
    const answers = Array.isArray(response?.blanks) ? response.blanks : [];
    const blankMap = answers.reduce((acc, b) => {
      acc[String(b.blank_key || '').trim()] = String(b.answer_text || '');
      return acc;
    }, {});
    const solutions = Array.isArray(question.solutions) ? question.solutions : [];
    const sn = solutions.length;
    const perSlot = sn > 0 ? maxPoints / sn : 0;
    let earned = 0;
    if (sn === 0) {
      return {
        earned: 0,
        maxPoints,
        isFullyCorrect: false,
        incorrectFeedback,
        rows: [
          {
            id: 'blank-none',
            label: '—',
            subtitle: '',
            earned: 0,
            max: maxPoints,
            explanation: 'No blanks are defined in the quiz definition.',
          },
        ],
      };
    }
    const rows = solutions.map((s, i) => {
      const actual = blankMap[s.blank_key] ?? '';
      let ok;
      if (Number(s.is_case_sensitive) === 1) {
        ok = normalizeText(actual) === normalizeText(s.answer_text);
      } else {
        ok = normalizeTextInsensitive(actual) === normalizeTextInsensitive(s.answer_text);
      }
      const slotEarned = ok ? perSlot : 0;
      earned += slotEarned;
      const autoExpl = ok
        ? `Correct — “${s.blank_key}” matches the expected answer.`
        : `Incorrect — for “${s.blank_key}” the expected answer is “${s.answer_text}”; you entered “${actual.trim() || '(empty)'}”.`;
      return {
        id: `blank-${s.blank_key}-${i}`,
        label: s.blank_key,
        subtitle: '',
        earned: roundPoints(slotEarned),
        max: roundPoints(perSlot),
        explanation: autoExpl,
      };
    });
    const er = roundPoints(earned);
    return {
      earned: er,
      maxPoints,
      isFullyCorrect: Math.abs(er - maxPoints) < 0.001,
      incorrectFeedback,
      rows,
    };
  }

  return {
    earned: 0,
    maxPoints,
    isFullyCorrect: false,
    incorrectFeedback,
    rows: [],
  };
}

/** Build learner-style response object from preview UI state (aligned with API grading). */
export function buildResponseForGrading(qParsed, previewState) {
  if (!previewState) return null;
  if (qParsed.type === 'mcq_single') {
    return { selectedIndex: previewState.selectedIndex };
  }
  if (qParsed.type === 'mcq_multi') {
    return { selectedIndices: previewState.selectedIndices || [] };
  }
  if (qParsed.type === 'matching') {
    const pairs = qParsed.pairs || [];
    const byLeft = previewState.byLeftPairIdx;
    if (byLeft && typeof byLeft === 'object') {
      const matches = {};
      for (const [lk, pi] of Object.entries(byLeft)) {
        const row = pairs[Number(pi)];
        if (row) matches[lk] = row.right_text;
      }
      return { matches };
    }
    return { matches: previewState.matches || {} };
  }
  return {
    blanks: Object.entries(previewState.blankAnswers || {}).map(([blank_key, answer_text]) => ({
      blank_key,
      answer_text,
    })),
  };
}

/** Mirrors backend `gradeQuestion` (routes/quizzes.js). */
export function gradeQuestion(question, response) {
  const maxPoints = Number(question.points || 1);
  if (question.type === 'mcq_single') {
    if (response?.selectedIndex == null) return { isCorrect: false, earned: 0 };
    const selected = Number(response.selectedIndex);
    const correct = (question.options || []).find((o) => Number(o.is_correct) === 1);
    const ok = correct && selected === Number(correct.sort_order);
    return { isCorrect: !!ok, earned: ok ? maxPoints : 0 };
  }
  if (question.type === 'mcq_multi') {
    const selected = Array.isArray(response?.selectedIndices)
      ? response.selectedIndices.map(Number).sort((a, b) => a - b)
      : [];
    const expected = (question.options || [])
      .filter((o) => Number(o.is_correct) === 1)
      .map((o) => Number(o.sort_order))
      .sort((a, b) => a - b);
    const ok = selected.length === expected.length && selected.every((v, i) => v === expected[i]);
    return { isCorrect: ok, earned: ok ? maxPoints : 0 };
  }
  if (question.type === 'matching') {
    const map = response?.matches && typeof response.matches === 'object' ? response.matches : {};
    const expected = (question.pairs || []).reduce((acc, p) => {
      acc[normalizeTextInsensitive(p.left_text)] = normalizeTextInsensitive(p.right_text);
      return acc;
    }, {});
    const leftKeys = Object.keys(expected);
    const ok =
      leftKeys.length > 0 && leftKeys.every((left) => normalizeTextInsensitive(map[left]) === expected[left]);
    return { isCorrect: ok, earned: ok ? maxPoints : 0 };
  }
  const answers = Array.isArray(response?.blanks) ? response.blanks : [];
  const map = answers.reduce((acc, b) => {
    acc[String(b.blank_key || '').trim()] = String(b.answer_text || '');
    return acc;
  }, {});
  const solutions = Array.isArray(question.solutions) ? question.solutions : [];
  if (solutions.length === 0) return { isCorrect: false, earned: 0 };
  const ok = solutions.every((s) => {
    const actual = map[s.blank_key] ?? '';
    if (Number(s.is_case_sensitive) === 1) return normalizeText(actual) === normalizeText(s.answer_text);
    return normalizeTextInsensitive(actual) === normalizeTextInsensitive(s.answer_text);
  });
  return { isCorrect: ok, earned: ok ? maxPoints : 0 };
}

export function gradeAllQuestions(parsedQuestions, previewStates) {
  let earned = 0;
  let max = 0;
  const perQuestion = parsedQuestions.map((pq, idx) => {
    const pts = Number(pq.points || 1);
    max += pts;
    const resp = buildResponseForGrading(pq, previewStates[idx]);
    const detail = gradeQuestionPreviewDetailed(pq, resp);
    earned += detail.earned;
    return {
      index: idx,
      type: pq.type,
      prompt: pq.prompt,
      isFullyCorrect: detail.isFullyCorrect,
      earned: detail.earned,
      maxPoints: pts,
      breakdownRows: detail.rows,
      incorrectFeedback: detail.incorrectFeedback || '',
    };
  });
  const pct = max > 0 ? Math.round((earned / max) * 1000) / 10 : 0;
  return { earned: roundPoints(earned), max, pct, perQuestion };
}
