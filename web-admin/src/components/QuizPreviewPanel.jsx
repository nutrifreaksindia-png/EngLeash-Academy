import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  gradeAllQuestions,
  normalizeTextInsensitive,
  parseQuestionInput,
} from '../utils/quizQuestionFormat';

const MATCH_DRAG_MIME = 'application/x-engleash-match';

/** Fisher–Yates using Math.random(); new order on every render (matching bank only). */
function shuffleIndicesRandom(n) {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx;
}

function dropPairOnLeftSlot(prev, leftKey, pairIdx) {
  const next = { ...prev };
  for (const k of Object.keys(next)) {
    if (next[k] === pairIdx) delete next[k];
  }
  next[leftKey] = pairIdx;
  return next;
}

function unassignPairEverywhere(prev, pairIdx) {
  const next = { ...prev };
  for (const k of Object.keys(next)) {
    if (next[k] === pairIdx) delete next[k];
  }
  return next;
}

function MatchingQuestionDnd({ pairs, byLeftPairIdx, onChange, submitted }) {
  const [dragOverSlot, setDragOverSlot] = useState(null);
  const [dragOverBank, setDragOverBank] = useState(false);

  const clearDragUi = useCallback(() => {
    setDragOverSlot(null);
    setDragOverBank(false);
  }, []);

  const bankOrder = shuffleIndicesRandom((pairs || []).length);

  const used = useMemo(() => new Set(Object.values(byLeftPairIdx || {})), [byLeftPairIdx]);
  const bankPairIndices = useMemo(
    () => bankOrder.filter((pi) => !used.has(pi)),
    [bankOrder, used],
  );

  function parseDragData(e) {
    const parsePairIdx = (raw) => {
      if (raw == null || raw === '') return null;
      try {
        const o = JSON.parse(raw);
        if (o != null && typeof o === 'object' && 'pairIdx' in o) {
          const n = Number(o.pairIdx);
          return Number.isFinite(n) ? n : null;
        }
        const num = Number(o);
        return Number.isFinite(num) ? num : null;
      } catch {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
      }
    };
    let idx = parsePairIdx(e.dataTransfer.getData(MATCH_DRAG_MIME));
    if (idx != null) return idx;
    idx = parsePairIdx(e.dataTransfer.getData('text/plain'));
    return idx;
  }

  function onDragStartChip(e, pairIdx) {
    e.dataTransfer.setData(MATCH_DRAG_MIME, JSON.stringify({ pairIdx }));
    e.dataTransfer.effectAllowed = 'move';
    try {
      e.dataTransfer.setData('text/plain', String(pairIdx));
    } catch {
      /* ignore */
    }
  }

  function preventDragNoise(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  if (!pairs?.length) return null;

  return (
    <div className="quizPreviewMatchDnd">
      <p className="quizPreviewMatchHelp">Drag each answer into the box next to its prompt.</p>
      <div className="quizPreviewMatchRows">
        {(pairs || []).map((p, pi) => {
          const leftKey = normalizeTextInsensitive(p.left_text);
          const assignedPi = byLeftPairIdx[leftKey];
          const isOver = dragOverSlot === leftKey;
          return (
            <div key={pi} className="quizPreviewMatchRow quizPreviewMatchRow--dnd">
              <span className="quizPreviewMatchLeft">{p.left_text}</span>
              <div
                className={`quizPreviewMatchDrop ${isOver ? 'isDragOver' : ''} ${assignedPi != null ? 'hasChip' : ''}`}
                onDragEnter={() => setDragOverSlot(leftKey)}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) setDragOverSlot(null);
                }}
                onDragOver={submitted ? undefined : preventDragNoise}
                onDrop={
                  submitted
                    ? undefined
                    : (e) => {
                        e.preventDefault();
                        clearDragUi();
                        const pairIdx = parseDragData(e);
                        if (pairIdx == null) return;
                        onChange(dropPairOnLeftSlot(byLeftPairIdx, leftKey, pairIdx));
                      }
                }
              >
                {assignedPi != null && pairs[assignedPi] ? (
                  <span
                    role="button"
                    tabIndex={submitted ? -1 : 0}
                    className="quizPreviewMatchChip"
                    draggable={!submitted}
                    onDragStart={(e) => onDragStartChip(e, assignedPi)}
                    onDragEnd={clearDragUi}
                    onKeyDown={
                      submitted
                        ? undefined
                        : (ev) => {
                            if (ev.key === 'Enter' || ev.key === ' ') {
                              ev.preventDefault();
                              onChange(unassignPairEverywhere(byLeftPairIdx, assignedPi));
                            }
                          }
                    }
                  >
                    {pairs[assignedPi].right_text}
                  </span>
                ) : (
                  <span className="quizPreviewMatchPlaceholder">Drop answer here</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="quizPreviewMatchBankLabel">Answer bank</div>
      <div
        className={`quizPreviewMatchBank ${dragOverBank ? 'isDragOver' : ''}`}
        onDragEnter={() => setDragOverBank(true)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setDragOverBank(false);
        }}
        onDragOver={submitted ? undefined : preventDragNoise}
        onDrop={
          submitted
            ? undefined
            : (e) => {
                e.preventDefault();
                clearDragUi();
                const pairIdx = parseDragData(e);
                if (pairIdx == null) return;
                onChange(unassignPairEverywhere(byLeftPairIdx, pairIdx));
              }
        }
      >
        {bankPairIndices.length === 0 ? (
          <span className="quizPreviewMuted">All answers placed.</span>
        ) : (
          bankPairIndices.map((pairIdx) => (
            <span
              key={pairIdx}
              className="quizPreviewMatchChip quizPreviewMatchChip--bank"
              draggable={!submitted}
              onDragStart={(e) => onDragStartChip(e, pairIdx)}
              onDragEnd={clearDragUi}
            >
              {pairs[pairIdx]?.right_text ?? ''}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function initialPreviewState(q) {
  if (q.type === 'mcq_single') return { kind: 'mcq_single', selectedIndex: undefined };
  if (q.type === 'mcq_multi') return { kind: 'mcq_multi', selectedIndices: [] };
  if (q.type === 'matching') return { kind: 'matching', byLeftPairIdx: {} };
  return { kind: 'fill_blank', blankAnswers: {} };
}

function slotLooksFull(br) {
  return br.max <= 0 || Math.abs(br.earned - br.max) < 0.001;
}

/** Border highlight after submit: supports partial for multi-select / matching. */
function questionOutcomeClass(q, row) {
  if (!row) return '';
  const t = q.type;
  if (t === 'mcq_single' || t === 'fill_blank') {
    return row.isFullyCorrect ? 'isCorrect' : 'isWrong';
  }
  if (row.isFullyCorrect) return 'isCorrect';
  const earned = Number(row.earned) || 0;
  if (earned < 0.001) return 'isWrong';
  return 'isPartial';
}

/** Summary line: single-choice & fill-blank are binary; others allow partially correct. */
function questionEvalSummary(q, row) {
  if (!row) return { label: '', evalClass: 'neutral' };
  const t = q.type;
  if (t === 'mcq_single' || t === 'fill_blank') {
    return row.isFullyCorrect
      ? { label: 'Correct', evalClass: 'ok' }
      : { label: 'Incorrect', evalClass: 'bad' };
  }
  if (row.isFullyCorrect) return { label: 'Correct', evalClass: 'ok' };
  const earned = Number(row.earned) || 0;
  if (earned < 0.001) return { label: 'Incorrect', evalClass: 'bad' };
  return { label: 'Partially Correct', evalClass: 'partial' };
}

function QuizPreviewBody({
  variant,
  quizTitle,
  questions,
  previewStates,
  setPreviewStateAt,
  submitted,
  results,
  passingPct,
  onSubmitMock,
  onResetMock,
  parseInner,
}) {
  const shellClass = `studyPreviewShell studyPreviewShell--${variant}`;

  const fullyCorrectCount = results ? results.perQuestion.filter((r) => r.isFullyCorrect).length : 0;
  const notFullyCorrectCount = results ? results.perQuestion.length - fullyCorrectCount : 0;

  if (questions.length === 0) {
    return (
      <div className={shellClass}>
        <p className="quizPreviewEmpty">Add questions in the editor to see the learner preview here.</p>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className="quizPreviewQuizHead">
        <strong className="quizPreviewQuizTitle">{quizTitle || 'Preview'}</strong>
        <span className="quizPreviewQuizMeta">{questions.length} question(s)</span>
      </div>

      {questions.map((q, idx) => {
        const pq = parseInner(q);
        const st = previewStates[idx] || initialPreviewState(q);
        const row = submitted && results ? results.perQuestion[idx] : null;
        const p1 = String(q.prompt1 || '').trim() || '(No prompt)';
        const p2 = String(q.prompt2 || '').trim();
        const ev = questionEvalSummary(q, row);

        return (
          <div key={idx} className={`quizPreviewQ ${row ? questionOutcomeClass(q, row) : ''}`}>
            <div className="quizPreviewQHead">
              <span className="quizPreviewQNo">{idx + 1}</span>
              <span className="quizPreviewQPts">{Number(q.points || 1)} pt</span>
            </div>
            <div className="quizPreviewPrompt">
              <span className="quizPreviewPromptPrimary">{p1}</span>
              {p2 ? <em className="quizPreviewPromptSecondary">{p2}</em> : null}
            </div>

            {(q.type === 'mcq_single' || q.type === 'mcq_multi') && (
              <div className="quizPreviewMcq">
                {(pq.options || []).length === 0 ? (
                  <p className="quizPreviewMuted">Add options in the editor (one per line, * for correct).</p>
                ) : null}
                {(pq.options || []).map((opt) => {
                  const ord = Number(opt.sort_order);
                  if (q.type === 'mcq_single') {
                    const checked = st.selectedIndex != null && st.selectedIndex === ord;
                    return (
                      <label key={ord} className="quizPreviewOpt">
                        <input
                          type="radio"
                          name={`qp-mcq-${variant}-${idx}`}
                          checked={checked}
                          disabled={submitted}
                          onChange={() => setPreviewStateAt(idx, { ...st, selectedIndex: ord })}
                        />
                        <span>{opt.option_text}</span>
                      </label>
                    );
                  }
                  const set = new Set(st.selectedIndices || []);
                  const checked = set.has(ord);
                  return (
                    <label key={ord} className="quizPreviewOpt">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={submitted}
                        onChange={() => {
                          const next = new Set(st.selectedIndices || []);
                          if (next.has(ord)) next.delete(ord);
                          else next.add(ord);
                          setPreviewStateAt(idx, {
                            ...st,
                            selectedIndices: Array.from(next).sort((a, b) => a - b),
                          });
                        }}
                      />
                      <span>{opt.option_text}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {q.type === 'matching' && (
              <div className="quizPreviewMatch">
                {(pq.pairs || []).length === 0 ? (
                  <p className="quizPreviewMuted">Add pairs in the editor (left =&gt; right).</p>
                ) : (
                  <MatchingQuestionDnd
                    pairs={pq.pairs}
                    byLeftPairIdx={st.byLeftPairIdx || {}}
                    onChange={(next) => setPreviewStateAt(idx, { ...st, byLeftPairIdx: next })}
                    submitted={submitted}
                  />
                )}
              </div>
            )}

            {q.type === 'fill_blank' && (
              <div className="quizPreviewBlanks">
                {(pq.solutions || []).length === 0 ? (
                  <p className="quizPreviewMuted">Add blank_key =&gt; answer lines in the editor.</p>
                ) : (
                  (pq.solutions || []).map((s, si) => (
                    <label key={si} className="quizPreviewBlankRow">
                      <span className="quizPreviewBlankKey">{s.blank_key}</span>
                      <input
                        type="text"
                        value={st.blankAnswers?.[s.blank_key] ?? ''}
                        disabled={submitted}
                        onChange={(e) =>
                          setPreviewStateAt(idx, {
                            ...st,
                            blankAnswers: {
                              ...st.blankAnswers,
                              [s.blank_key]: e.target.value,
                            },
                          })
                        }
                      />
                    </label>
                  ))
                )}
              </div>
            )}

            {row ? (
              <div className="quizPreviewEvalBlock">
                <div className={`quizPreviewEvalSummary ${ev.evalClass}`}>
                  <span>{ev.label}</span>
                  <span className="quizPreviewEvalPts">
                    {row.earned}/{row.maxPoints} pts
                  </span>
                </div>
                {!row.isFullyCorrect && row.incorrectFeedback ? (
                  <div className="quizPreviewQuestionNote">{row.incorrectFeedback}</div>
                ) : null}
                <ul className="quizPreviewBreakdown">
                  {(row.breakdownRows || []).map((br) => (
                    <li
                      key={br.id}
                      className={`quizPreviewBreakdownItem ${slotLooksFull(br) ? 'slotOk' : 'slotBad'}`}
                    >
                      <div className="quizPreviewBreakdownTop">
                        <span className="quizPreviewBreakdownLabel">{br.label}</span>
                        <span className="quizPreviewBreakdownPts">
                          {br.earned}/{br.max} pts
                        </span>
                      </div>
                      {br.subtitle ? (
                        <div className="quizPreviewBreakdownSub">{br.subtitle}</div>
                      ) : null}
                      <p className="quizPreviewBreakdownExpl">{br.explanation}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        );
      })}

      <div className="quizPreviewActions">
        <button type="button" className="secondaryBtn" onClick={onResetMock}>
          Reset answers
        </button>
        <button type="button" onClick={onSubmitMock} disabled={submitted || questions.length === 0}>
          Submit
        </button>
      </div>

      {submitted && results ? (
        <div className="quizPreviewSummary">
          <div className="quizPreviewSummaryGrid">
            <div>
              <div className="quizPreviewSumLabel">Questions</div>
              <div className="quizPreviewSumVal">{results.perQuestion.length}</div>
            </div>
            <div>
              <div className="quizPreviewSumLabel">Fully correct</div>
              <div className="quizPreviewSumVal ok">{fullyCorrectCount}</div>
            </div>
            <div>
              <div className="quizPreviewSumLabel">Not fully correct</div>
              <div className="quizPreviewSumVal bad">{notFullyCorrectCount}</div>
            </div>
            <div>
              <div className="quizPreviewSumLabel">Score</div>
              <div className="quizPreviewSumVal">{results.pct}%</div>
            </div>
            <div>
              <div className="quizPreviewSumLabel">Points</div>
              <div className="quizPreviewSumVal">
                {results.earned} / {results.max}
              </div>
            </div>
            <div>
              <div className="quizPreviewSumLabel">Passing</div>
              <div className="quizPreviewSumVal">
                {passingPct}% —{' '}
                {results.pct >= passingPct ? (
                  <span className="ok">Pass</span>
                ) : (
                  <span className="bad">Below pass</span>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Interactive learner preview with mock submit / grading.
 * @param {boolean} [showViewportSwitcher=true] — When false, only the mobile layout is shown (e.g. quiz bank modal).
 */
export function QuizInteractivePreview({ quizTitle, questions, passingPct, showViewportSwitcher = true }) {
  const [previewPopup, setPreviewPopup] = useState(null);
  const [previewStates, setPreviewStates] = useState(() =>
    (questions || []).map((q) => initialPreviewState(q)),
  );
  const [submitted, setSubmitted] = useState(false);
  const [results, setResults] = useState(null);

  const fingerprint = useMemo(() => JSON.stringify(questions), [questions]);

  useEffect(() => {
    setPreviewStates((questions || []).map((q) => initialPreviewState(q)));
    setSubmitted(false);
    setResults(null);
  }, [fingerprint]);

  const parseInner = useCallback((q) => parseQuestionInput(q), []);

  const setPreviewStateAt = useCallback((idx, next) => {
    setPreviewStates((prev) => {
      const copy = [...prev];
      copy[idx] = next;
      return copy;
    });
  }, []);

  const onSubmitMock = useCallback(() => {
    const parsed = questions.map(parseQuestionInput);
    const graded = gradeAllQuestions(parsed, previewStates);
    setResults(graded);
    setSubmitted(true);
  }, [questions, previewStates]);

  const onResetMock = useCallback(() => {
    setPreviewStates((questions || []).map((q) => initialPreviewState(q)));
    setSubmitted(false);
    setResults(null);
  }, [questions]);

  const passNum = Number(passingPct) || 0;

  const mobileBody = (
    <QuizPreviewBody
      variant="mobile"
      quizTitle={quizTitle}
      questions={questions}
      previewStates={previewStates}
      setPreviewStateAt={setPreviewStateAt}
      submitted={submitted}
      results={results}
      passingPct={passNum}
      onSubmitMock={onSubmitMock}
      onResetMock={onResetMock}
      parseInner={parseInner}
    />
  );

  if (!showViewportSwitcher) {
    return (
      <div className="quizPreviewStandalone">
        <div className="studyPreviewSidebarScroll quizPreviewStandaloneScroll">{mobileBody}</div>
      </div>
    );
  }

  return (
    <div className="studyFullscreenPreview quizPreviewPane">
      <div className="studyPreviewSidebarHead row">
        <div>
          <div className="fieldLabel" style={{ marginBottom: 4 }}>
            Preview
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
      <div className="studyPreviewSidebarScroll">{mobileBody}</div>

      {previewPopup ? (
        <div
          className="studyPreviewPopupOverlay"
          role="presentation"
          onClick={() => setPreviewPopup(null)}
        >
          <div
            className={`studyPreviewPopupModal ${previewPopup === 'tablet' ? 'isTablet' : 'isDesktop'}`}
            role="dialog"
            aria-labelledby="quiz-preview-popup-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="studyPreviewPopupHead">
              <div className="studyPreviewPopupTitleBlock">
                <strong id="quiz-preview-popup-title">
                  {previewPopup === 'tablet' ? 'Tablet preview' : 'Desktop preview'}
                </strong>
                <span className="studyPreviewPopupHint">
                  {previewPopup === 'tablet'
                    ? 'Approx. 834px content width'
                    : 'Approx. 1200px content width'}
                </span>
              </div>
              <button type="button" className="secondaryBtn" onClick={() => setPreviewPopup(null)}>
                Close
              </button>
            </div>
            <div className="studyPreviewPopupBody">
              <QuizPreviewBody
                variant={previewPopup}
                quizTitle={quizTitle}
                questions={questions}
                previewStates={previewStates}
                setPreviewStateAt={setPreviewStateAt}
                submitted={submitted}
                results={results}
                passingPct={passNum}
                onSubmitMock={onSubmitMock}
                onResetMock={onResetMock}
                parseInner={parseInner}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function QuizPreviewPanel(props) {
  return <QuizInteractivePreview {...props} />;
}
