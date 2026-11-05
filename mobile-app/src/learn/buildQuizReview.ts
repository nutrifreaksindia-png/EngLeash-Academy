/** Build review rows when the API returns responses but omits `review`. */

function optionLabel(options: any[] | undefined, selected: unknown): string | null {
  const list = Array.isArray(options) ? options : [];
  const n = Number(selected);
  if (!Number.isFinite(n) || n < 0) return null;
  const byOrder = list.find((o) => Number(o?.sort_order) === n);
  if (byOrder) return String(byOrder.option_text || '').trim() || null;
  if (n < list.length) {
    const o = list[n];
    return String(typeof o === 'string' ? o : o?.option_text || '').trim() || null;
  }
  return null;
}

function formatYourAnswer(question: any, response: any): string {
  if (!response) return 'No answer';
  const type = question?.type || 'mcq_single';
  if (type === 'mcq_single' || !question?.type) {
    if (typeof response === 'number') return optionLabel(question.options, response) || 'No answer';
    return optionLabel(question.options, response.selectedIndex) || 'No answer';
  }
  if (type === 'mcq_multi') {
    const selected = Array.isArray(response.selectedIndices) ? response.selectedIndices : [];
    const labels = selected.map((i: number) => optionLabel(question.options, i)).filter(Boolean);
    return labels.length ? labels.join(', ') : 'No answer';
  }
  if (type === 'matching') {
    const matches = response.matches && typeof response.matches === 'object' ? response.matches : {};
    const lines = Object.entries(matches).map(([left, right]) => `${left} → ${right}`);
    return lines.length ? lines.join('\n') : 'No answer';
  }
  const blanks = Array.isArray(response.blanks) ? response.blanks : [];
  const lines = blanks
    .map((b: any) => `${String(b.blank_key || '').trim()}: ${String(b.answer_text || '').trim()}`)
    .filter((s: string) => s !== ':');
  return lines.length ? lines.join('\n') : 'No answer';
}

function formatCorrectAnswer(question: any): string {
  const type = question?.type || 'mcq_single';
  if (type === 'mcq_single' || type === 'mcq_multi') {
    const opts = question.options || [];
    const labels = opts
      .filter((o: any) => (typeof o === 'object' ? Number(o.is_correct) === 1 : false))
      .map((o: any) => String(o.option_text || '').trim())
      .filter(Boolean);
    if (labels.length) return labels.join(', ');
    if (question.correct_index != null) {
      return optionLabel(opts, question.correct_index) || '—';
    }
    return '—';
  }
  if (type === 'matching') {
    return (
      (question.pairs || []).map((p: any) => `${p.left_text} → ${p.right_text}`).join('\n') || '—'
    );
  }
  return (
    (question.solutions || [])
      .map((s: any) => `${s.blank_key}: ${s.answer_text}`)
      .join('\n') || '—'
  );
}

export function buildQuizReviewFromResponses(
  questions: any[] | undefined,
  responses: any[] | undefined,
): {
  questionId?: number | string;
  index?: number;
  prompt: string;
  type?: string;
  isCorrect: boolean;
  yourAnswer: string;
  correctAnswer: string;
  explanation?: string | null;
}[] {
  if (!questions?.length) return [];
  return questions.map((q, idx) => {
    const g =
      (responses || []).find((row) => Number(row.questionId ?? row.question_id) === Number(q.id)) ||
      {};
    const response = g.response ?? g.response_json ?? null;
    return {
      questionId: q.id,
      index: idx,
      prompt: String(q.prompt || q.question_text || `Question ${idx + 1}`),
      type: q.type || 'mcq_single',
      isCorrect: Boolean(g.isCorrect ?? g.is_correct),
      yourAnswer: formatYourAnswer(q, response),
      correctAnswer: formatCorrectAnswer(q),
      explanation: typeof q.explanation === 'string' ? q.explanation : null,
    };
  });
}

/** Prefer API review; otherwise rebuild from responses + local question bank. */
export function resolveQuizReview(
  apiReview: unknown,
  questions: any[] | undefined,
  responses: any[] | undefined,
) {
  if (Array.isArray(apiReview) && apiReview.length) return apiReview;
  return buildQuizReviewFromResponses(questions, responses);
}
