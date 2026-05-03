import React, { useEffect, useMemo, useRef, useState } from 'react';
import SectionCard from '../components/SectionCard';
import QuizPreviewPanel, { QuizInteractivePreview } from '../components/QuizPreviewPanel';
import {
  apiQuestionsToEditorQuestions,
  editorDefaultsForType,
  emptyQuestion,
  normalizeEditorQuestion,
  parseQuestionInput,
} from '../utils/quizQuestionFormat';
import { parseQuizPaste, QUIZ_PASTE_HEADER } from '../utils/parseQuizPaste';

const QUESTION_TYPES = [
  { value: 'mcq_single', label: 'Multiple choice (single)' },
  { value: 'mcq_multi', label: 'Multiple choice (multi)' },
  { value: 'matching', label: 'Matching' },
  { value: 'fill_blank', label: 'Fill in the blank' },
];

/** @returns {string | null} Error message or null if OK */
function validateQuestionsForPublish(questions) {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const num = i + 1;
    if (!String(q.prompt1 || '').trim()) {
      return `Question ${num}: add question text.`;
    }

    if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
      const opts = Array.isArray(q.mcqOptions) ? q.mcqOptions : [];
      for (let j = 0; j < opts.length; j++) {
        if (!String(opts[j]?.text ?? '').trim()) {
          return `Question ${num}: fill in every option or remove empty rows.`;
        }
      }
      const withText = opts.filter((o) => String(o?.text ?? '').trim());
      if (withText.length < 2) {
        return `Question ${num}: add at least two answer options with text.`;
      }
      const correctCount = withText.filter((o) => o.correct).length;
      if (q.type === 'mcq_single') {
        if (correctCount !== 1) {
          return `Question ${num}: select exactly one correct answer.`;
        }
      } else if (correctCount < 1) {
        return `Question ${num}: mark at least one option as correct.`;
      }
    }

    if (q.type === 'matching') {
      const pairs = Array.isArray(q.matchPairs) ? q.matchPairs : [];
      let complete = 0;
      for (let j = 0; j < pairs.length; j++) {
        const L = String(pairs[j]?.left ?? '').trim();
        const R = String(pairs[j]?.right ?? '').trim();
        if (L && !R) {
          return `Question ${num}: pair ${j + 1} needs text on the right.`;
        }
        if (!L && R) {
          return `Question ${num}: pair ${j + 1} needs text on the left.`;
        }
        if (L && R) complete += 1;
      }
      if (complete < 2) {
        return `Question ${num}: add at least two pairs with both left and right filled in.`;
      }
    }

    if (q.type === 'fill_blank') {
      const blanks = Array.isArray(q.fillBlanks) ? q.fillBlanks : [];
      let okBlanks = 0;
      for (let j = 0; j < blanks.length; j++) {
        const k = String(blanks[j]?.key ?? '').trim();
        const a = String(blanks[j]?.answer ?? '').trim();
        if (k && !a) {
          return `Question ${num}: blank ${j + 1} needs an expected answer.`;
        }
        if (!k && a) {
          return `Question ${num}: blank ${j + 1} needs a blank key.`;
        }
        if (k && a) okBlanks += 1;
      }
      if (okBlanks < 1) {
        return `Question ${num}: add at least one blank with a key and answer.`;
      }
    }
  }
  return null;
}

function QuizQuestionCard({
  index,
  q,
  canMutate,
  questionTypes,
  onPatch,
  onRemove,
  canRemove,
}) {
  const opts = Array.isArray(q.mcqOptions) ? q.mcqOptions : [];
  const pairs = Array.isArray(q.matchPairs) ? q.matchPairs : [];
  const blanks = Array.isArray(q.fillBlanks) ? q.fillBlanks : [];

  const [secondLineOpen, setSecondLineOpen] = useState(() => String(q.prompt2 || '').trim() !== '');

  useEffect(() => {
    if (String(q.prompt2 || '').trim()) setSecondLineOpen(true);
  }, [q.prompt2]);

  function patchMcq(nextOpts) {
    onPatch({ mcqOptions: nextOpts });
  }

  function setMcqOptionText(i, text) {
    patchMcq(opts.map((o, j) => (j === i ? { ...o, text } : o)));
  }

  function setMcqCorrectSingle(i) {
    patchMcq(opts.map((o, j) => ({ ...o, correct: j === i })));
  }

  function toggleMcqCorrectMulti(i) {
    patchMcq(opts.map((o, j) => (j === i ? { ...o, correct: !o.correct } : o)));
  }

  function addMcqOption() {
    patchMcq([...opts, { text: `Option ${opts.length + 1}`, correct: false }]);
  }

  function removeMcqOption(i) {
    if (opts.length <= 2) return;
    const next = opts.filter((_, j) => j !== i);
    if (q.type === 'mcq_single' && !next.some((o) => o.correct)) next[0] = { ...next[0], correct: true };
    patchMcq(next);
  }

  function patchPairs(nextPairs) {
    onPatch({ matchPairs: nextPairs });
  }

  function setPair(i, field, value) {
    patchPairs(pairs.map((p, j) => (j === i ? { ...p, [field]: value } : p)));
  }

  function addPair() {
    patchPairs([...pairs, { left: '', right: '' }]);
  }

  function removePair(i) {
    if (pairs.length <= 2) return;
    patchPairs(pairs.filter((_, j) => j !== i));
  }

  function patchBlanks(nextBlanks) {
    onPatch({ fillBlanks: nextBlanks });
  }

  function setBlank(i, field, value) {
    patchBlanks(blanks.map((b, j) => (j === i ? { ...b, [field]: value } : b)));
  }

  function addBlank() {
    patchBlanks([...blanks, { key: '', answer: '' }]);
  }

  function removeBlank(i) {
    if (blanks.length <= 1) return;
    patchBlanks(blanks.filter((_, j) => j !== i));
  }

  return (
    <div className="quizQuestionCard">
      <div className="quizQuestionCard__toolbar">
        <span className="quizQuestionCard__index">{index + 1}</span>
        <select
          className="quizQuestionCard__type"
          value={q.type}
          disabled={!canMutate}
          onChange={(e) => {
            const type = e.target.value;
            onPatch({ type, ...editorDefaultsForType(type) });
          }}
        >
          {questionTypes.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <label className="quizQuestionCard__points">
          <span className="quizQuestionCard__pointsLabel">Pts</span>
          <input
            type="number"
            min={1}
            className="quizQuestionCard__pointsInput"
            value={q.points}
            disabled={!canMutate}
            onChange={(e) => onPatch({ points: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="dangerBtn quizQuestionCard__remove"
          disabled={!canMutate || !canRemove}
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
      <div className="quizQuestionCard__body">
        <label className="fieldLabel quizFieldLabelCompact">Question</label>
        <textarea
          className="quizQuestionCard__textarea quizQuestionCard__textarea--sm"
          placeholder="Question text"
          value={q.prompt1}
          disabled={!canMutate}
          onChange={(e) => onPatch({ prompt1: e.target.value })}
        />
        {secondLineOpen ? (
          <>
            <label className="fieldLabel quizFieldLabelCompact" htmlFor={`quiz-prompt2-${index}`}>
              Second line
            </label>
            <textarea
              id={`quiz-prompt2-${index}`}
              className="quizQuestionCard__textarea quizQuestionCard__textarea--sm"
              placeholder="Optional second line (italics in preview)"
              value={q.prompt2}
              disabled={!canMutate}
              onChange={(e) => onPatch({ prompt2: e.target.value })}
            />
          </>
        ) : (
          <button
            type="button"
            className="quizEditorAddSecondLine"
            disabled={!canMutate}
            onClick={() => setSecondLineOpen(true)}
          >
            Add optional second line
          </button>
        )}
        <label className="fieldLabel quizFieldLabelCompact">Feedback</label>
        <textarea
          className="quizQuestionCard__textarea quizQuestionCard__textarea--xs"
          placeholder="Optional — shown when the answer is not fully correct"
          value={q.incorrectFeedback || ''}
          disabled={!canMutate}
          onChange={(e) => onPatch({ incorrectFeedback: e.target.value })}
        />

        {(q.type === 'mcq_single' || q.type === 'mcq_multi') && (
          <div className="quizStructuredBlock">
            <span className="fieldLabel quizFieldLabelCompact" style={{ margin: 0 }}>
              Answer choices
            </span>
            <div className="quizMcqTable">
              <div className="quizMcqHeader">
                <span className="quizMcqColCorrect">{q.type === 'mcq_single' ? 'Correct' : '✓'}</span>
                <span className="quizMcqColText">Option text</span>
                <span className="quizMcqColAct" />
              </div>
              {opts.map((o, i) => (
                <div key={i} className="quizMcqRow">
                  <div className="quizMcqColCorrect">
                    {q.type === 'mcq_single' ? (
                      <input
                        type="radio"
                        name={`mcq-single-${index}`}
                        checked={!!o.correct}
                        disabled={!canMutate}
                        onChange={() => setMcqCorrectSingle(i)}
                        title="Correct answer"
                      />
                    ) : (
                      <input
                        type="checkbox"
                        checked={!!o.correct}
                        disabled={!canMutate}
                        onChange={() => toggleMcqCorrectMulti(i)}
                        title="Correct answer"
                      />
                    )}
                  </div>
                  <input
                    type="text"
                    className="quizInlineInput"
                    value={o.text}
                    disabled={!canMutate}
                    onChange={(e) => setMcqOptionText(i, e.target.value)}
                    placeholder={`Option ${i + 1}`}
                  />
                  <div className="quizMcqColAct">
                    <button
                      type="button"
                      className="quizMiniBtn quizMiniBtn--danger"
                      disabled={!canMutate || opts.length <= 2}
                      onClick={() => removeMcqOption(i)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button type="button" className="quizMiniBtn quizMcqAddBelow" disabled={!canMutate} onClick={addMcqOption}>
              + Add option
            </button>
          </div>
        )}

        {q.type === 'matching' && (
          <div className="quizStructuredBlock">
            <div className="quizStructuredHead">
              <span className="fieldLabel quizFieldLabelCompact" style={{ margin: 0 }}>
                Pairs
              </span>
              <button type="button" className="quizMiniBtn" disabled={!canMutate} onClick={addPair}>
                + Add pair
              </button>
            </div>
            <div className="quizPairTable">
              <div className="quizPairHeader">
                <span>Left</span>
                <span>Right</span>
                <span className="quizMcqColAct" />
              </div>
              {pairs.map((p, i) => (
                <div key={i} className="quizPairRow">
                  <input
                    type="text"
                    className="quizInlineInput"
                    value={p.left}
                    disabled={!canMutate}
                    onChange={(e) => setPair(i, 'left', e.target.value)}
                    placeholder="Prompt"
                  />
                  <input
                    type="text"
                    className="quizInlineInput"
                    value={p.right}
                    disabled={!canMutate}
                    onChange={(e) => setPair(i, 'right', e.target.value)}
                    placeholder="Match"
                  />
                  <div className="quizMcqColAct">
                    <button
                      type="button"
                      className="quizMiniBtn quizMiniBtn--danger"
                      disabled={!canMutate || pairs.length <= 2}
                      onClick={() => removePair(i)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {q.type === 'fill_blank' && (
          <div className="quizStructuredBlock">
            <label className="quizCaseSensitive quizCaseSensitive--compact">
              <input
                type="checkbox"
                checked={!!q.fillCaseSensitive}
                disabled={!canMutate}
                onChange={(e) => onPatch({ fillCaseSensitive: e.target.checked })}
              />
              <span>Case-sensitive</span>
            </label>
            <div className="quizStructuredHead">
              <span className="fieldLabel quizFieldLabelCompact" style={{ margin: 0 }}>
                Blanks
              </span>
              <button type="button" className="quizMiniBtn" disabled={!canMutate} onClick={addBlank}>
                + Add blank
              </button>
            </div>
            <div className="quizPairTable">
              <div className="quizPairHeader">
                <span>Blank key</span>
                <span>Expected answer</span>
                <span className="quizMcqColAct" />
              </div>
              {blanks.map((b, i) => (
                <div key={i} className="quizPairRow">
                  <input
                    type="text"
                    className="quizInlineInput"
                    value={b.key}
                    disabled={!canMutate}
                    onChange={(e) => setBlank(i, 'key', e.target.value)}
                    placeholder="e.g. verb"
                  />
                  <input
                    type="text"
                    className="quizInlineInput"
                    value={b.answer}
                    disabled={!canMutate}
                    onChange={(e) => setBlank(i, 'answer', e.target.value)}
                    placeholder="Answer"
                  />
                  <div className="quizMcqColAct">
                    <button
                      type="button"
                      className="quizMiniBtn quizMiniBtn--danger"
                      disabled={!canMutate || blanks.length <= 1}
                      onClick={() => removeBlank(i)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function QuizBankPage({
  quizzes,
  courses,
  lessons,
  showCreatedBy = false,
  libraryCanMutate = () => true,
  onCreateQuiz,
  onGetQuiz,
  onUpdateQuiz,
  onPublishVersion,
  onAssignQuiz,
  onDeleteQuiz = null,
}) {
  const [librarySearch, setLibrarySearch] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorTitle, setEditorTitle] = useState('');
  const [editorDescription, setEditorDescription] = useState('');
  const [selectedQuizId, setSelectedQuizId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [questions, setQuestions] = useState([emptyQuestion()]);
  const [versionTitle, setVersionTitle] = useState('');
  const [passingPct, setPassingPct] = useState(60);
  const [timeLimitSec, setTimeLimitSec] = useState('');
  const [assignScopeType, setAssignScopeType] = useState('course');
  const [assignScopeId, setAssignScopeId] = useState('');
  const [assignVersionId, setAssignVersionId] = useState('');
  const [assignRequired, setAssignRequired] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteHint, setPasteHint] = useState('');
  const [previewSession, setPreviewSession] = useState(null);
  const [previewLoadingId, setPreviewLoadingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const createDraftInFlightRef = useRef(false);

  function preventFormSubmitOnEnter(e) {
    if (e.key === 'Enter') e.preventDefault();
  }

  const selectedVersions = detail?.versions || [];
  const selectedAssignments = detail?.assignments || [];
  const canMutateDetail = Boolean(detail && libraryCanMutate(detail));

  const filteredQuizzes = useMemo(() => {
    const q = librarySearch.trim().toLowerCase();
    const list = quizzes || [];
    if (!q) return list;
    return list.filter((z) => String(z.title || '').toLowerCase().includes(q));
  }, [quizzes, librarySearch]);

  const scopeOptions = useMemo(() => {
    if (assignScopeType === 'course') {
      return (courses || []).map((c) => ({ id: c.id, label: c.name }));
    }
    return (lessons || [])
      .filter((l) => Number.isFinite(Number(l.id)))
      .map((l) => ({ id: l.id, label: l.title }));
  }, [assignScopeType, courses, lessons]);

  function applyPasteToEditor(parsed) {
    setQuestions(
      (parsed.questions.length ? parsed.questions : [emptyQuestion()]).map(normalizeEditorQuestion),
    );
    setVersionTitle(parsed.meta.versionTitle || '');
    setPassingPct(Number.isFinite(Number(parsed.meta.passingPct)) ? Number(parsed.meta.passingPct) : 60);
    setTimeLimitSec(
      parsed.meta.timeLimitSec === '' || parsed.meta.timeLimitSec == null
        ? ''
        : String(parsed.meta.timeLimitSec),
    );
    if (parsed.meta.title && canMutateDetail) {
      setEditorTitle(parsed.meta.title);
    }
    if (parsed.meta.description != null && canMutateDetail) {
      setEditorDescription(parsed.meta.description);
    }
  }

  async function openEditor(quizId) {
    setError('');
    setPasteHint('');
    setBusy(true);
    try {
      const d = await onGetQuiz(quizId);
      setDetail(d);
      setSelectedQuizId(quizId);
      setEditorTitle(d.title || '');
      setEditorDescription(d.description || '');
      const v = (d.versions || [])[0];
      if (v && Array.isArray(v.questions) && v.questions.length > 0) {
        setQuestions(apiQuestionsToEditorQuestions(v.questions).map(normalizeEditorQuestion));
        setVersionTitle(v.title || '');
        setTimeLimitSec(
          v.time_limit_sec != null && v.time_limit_sec !== '' ? String(v.time_limit_sec) : '',
        );
        setPassingPct(Number.isFinite(Number(v.passing_pct)) ? Number(v.passing_pct) : 60);
      } else {
        setQuestions([emptyQuestion()]);
        setVersionTitle('');
        setTimeLimitSec('');
        setPassingPct(60);
      }
      setEditorOpen(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function resetEditorAndClose() {
    setEditorOpen(false);
    setPasteHint('');
    setSelectedQuizId(null);
    setDetail(null);
    setQuestions([emptyQuestion()]);
    setEditorTitle('');
    setEditorDescription('');
    setVersionTitle('');
    setTimeLimitSec('');
    setPassingPct(60);
    setPasteText('');
    setAssignVersionId('');
    setAssignScopeId('');
  }

  async function createDraftAndOpen() {
    if (createDraftInFlightRef.current) return;
    createDraftInFlightRef.current = true;
    setBusy(true);
    setError('');
    try {
      const created = await onCreateQuiz({
        title: 'Untitled quiz',
        description: '',
        status: 'draft',
      });
      if (!created?.id) throw new Error('Create quiz did not return an id.');
      await openEditor(created.id);
    } catch (e) {
      setError(e.message);
    } finally {
      createDraftInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function saveDraftAndClose() {
    if (!selectedQuizId || !canMutateDetail) return;
    setBusy(true);
    setError('');
    try {
      await onUpdateQuiz(selectedQuizId, {
        title: editorTitle.trim() || 'Untitled quiz',
        description: editorDescription,
        status: 'draft',
      });
      resetEditorAndClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function publishVersion(e) {
    e.preventDefault();
    if (!selectedQuizId || !canMutateDetail) return;
    const validationError = validateQuestionsForPublish(questions);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onUpdateQuiz(selectedQuizId, {
        title: editorTitle.trim() || 'Untitled quiz',
        description: editorDescription,
      });
      await onPublishVersion(selectedQuizId, {
        title: versionTitle || null,
        timeLimitSec: timeLimitSec ? Number(timeLimitSec) : null,
        shuffleQuestions: false,
        passingPct: Number(passingPct || 0),
        questions: questions.map(parseQuestionInput),
      });
      resetEditorAndClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  /** Applies pasted text to the current quiz in the editor only — does not create a new quiz row. */
  function applyPasteImport() {
    setError('');
    setPasteHint('');
    if (!selectedQuizId || !editorOpen) {
      setError('Use “+ New quiz” or open an existing quiz, then apply import here.');
      return;
    }
    if (!canMutateDetail) {
      setError('You cannot edit this quiz.');
      return;
    }
    const result = parseQuizPaste(pasteText);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    applyPasteToEditor(result);
    setPasteHint(
      `Imported ${result.questions.length} question(s). Save draft or publish when ready.`,
    );
  }

  async function openPreviewQuiz(quizId) {
    setPreviewLoadingId(quizId);
    setError('');
    try {
      const d = await onGetQuiz(quizId);
      const v = (d.versions || [])[0];
      let previewQuestions = [];
      if (v && Array.isArray(v.questions) && v.questions.length > 0) {
        previewQuestions = apiQuestionsToEditorQuestions(v.questions).map(normalizeEditorQuestion);
      }
      const passingPct = v && Number.isFinite(Number(v.passing_pct)) ? Number(v.passing_pct) : 60;
      setPreviewSession({
        quizId,
        title: d.title || 'Quiz',
        questions: previewQuestions,
        passingPct,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setPreviewLoadingId(null);
    }
  }

  function closePreviewQuiz() {
    setPreviewSession(null);
  }

  async function deleteQuiz(id) {
    if (!onDeleteQuiz) return;
    if (!window.confirm('Delete this quiz and all its versions and assignments? This cannot be undone.')) {
      return;
    }
    setError('');
    try {
      await onDeleteQuiz(id);
      if (selectedQuizId === id) {
        resetEditorAndClose();
      }
      if (previewSession?.quizId === id) {
        setPreviewSession(null);
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function assign() {
    if (!selectedQuizId || !assignVersionId || !assignScopeId || !canMutateDetail) return;
    setBusy(true);
    setError('');
    try {
      await onAssignQuiz(selectedQuizId, {
        quizVersionId: Number(assignVersionId),
        scopeType: assignScopeType,
        scopeId: Number(assignScopeId),
        isRequired: assignRequired,
      });
      const fresh = await onGetQuiz(selectedQuizId);
      setDetail(fresh);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {error ? <div className="partialErrorBox">{error}</div> : null}
      {pasteHint && editorOpen ? <div className="banner success">{pasteHint}</div> : null}

      <SectionCard
        title="Quiz bank"
        subtitle="Reusable quizzes — full-screen editor, learner preview, and course or lesson assignment."
      >
        <input
          className="quizBankSearch"
          value={librarySearch}
          onChange={(e) => setLibrarySearch(e.target.value)}
          placeholder="Search quizzes"
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="uploadPrimaryBtn"
            onClick={createDraftAndOpen}
            disabled={busy}
          >
            + New quiz
          </button>
        </div>
        <div className="tableWrap quizBankTableWrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                {showCreatedBy ? <th>Created by</th> : null}
                <th>Latest version</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredQuizzes.map((q) => (
                <tr key={q.id}>
                  <td>{q.title}</td>
                  <td>
                    {q.status === 'draft' ? (
                      <span className="studyDraftBadge">Draft</span>
                    ) : q.status === 'published' ? (
                      <span className="muted">Published</span>
                    ) : (
                      <span className="muted">{q.status}</span>
                    )}
                  </td>
                  {showCreatedBy ? (
                    <td>{q.creator_name || `#${q.created_by}` || '—'}</td>
                  ) : null}
                  <td>{q.latest_version ?? '—'}</td>
                  <td>
                    <div className="row studyMaterialRowActions">
                      <button
                        type="button"
                        className="secondaryBtn"
                        onClick={() => openPreviewQuiz(q.id)}
                        disabled={previewLoadingId === q.id}
                      >
                        Preview
                      </button>
                      {libraryCanMutate(q) ? (
                        <>
                          <button
                            type="button"
                            className="secondaryBtn"
                            onClick={() => openEditor(q.id)}
                            disabled={busy}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="dangerBtn"
                            onClick={() => deleteQuiz(q.id)}
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {previewSession ? (
        <div
          className="studyViewOverlay"
          role="presentation"
          onClick={closePreviewQuiz}
        >
          <div
            className="studyViewModal quizBankPreviewModal"
            role="dialog"
            aria-labelledby="quiz-bank-preview-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modalHead">
              <h3 id="quiz-bank-preview-title">Preview: {previewSession.title}</h3>
              <button type="button" className="secondaryBtn" onClick={closePreviewQuiz}>
                Close
              </button>
            </div>
            <p className="quizBankPreviewHint">
              Mobile-sized learner view — answer questions and submit to see scoring (same logic as the app).
            </p>
            <div className="quizBankPreviewPhone">
              <div className="quizBankPreviewPhoneInner">
                <QuizInteractivePreview
                  quizTitle={previewSession.title}
                  questions={previewSession.questions}
                  passingPct={previewSession.passingPct}
                  showViewportSwitcher={false}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editorOpen ? (
        <div className="studyFullscreenOverlay">
          <form className="studyFullscreenShell" onSubmit={publishVersion}>
            <div className="studyFullscreenTopbar">
              <div className="studyTopInputsBlock">
                <div className="studyTopInputs">
                  <input
                    value={editorTitle}
                    onChange={(e) => setEditorTitle(e.target.value)}
                    onKeyDown={preventFormSubmitOnEnter}
                    placeholder="Quiz title"
                    disabled={!canMutateDetail}
                  />
                  <input
                    value={editorDescription}
                    onChange={(e) => setEditorDescription(e.target.value)}
                    onKeyDown={preventFormSubmitOnEnter}
                    placeholder="Description (optional)"
                    disabled={!canMutateDetail}
                  />
                  {detail?.status === 'draft' ? (
                    <span className="studyDraftBadge studyDraftBadgeLarge">Draft</span>
                  ) : null}
                </div>
                <div className="studyTopMetaRow">
                  <label className="studyTopMetaField">
                    <span className="fieldLabel">Version title (optional)</span>
                    <input
                      value={versionTitle}
                      onChange={(e) => setVersionTitle(e.target.value)}
                      onKeyDown={preventFormSubmitOnEnter}
                      disabled={!canMutateDetail}
                    />
                  </label>
                  <label className="studyTopMetaField">
                    <span className="fieldLabel">Time limit (sec)</span>
                    <input
                      type="number"
                      min={0}
                      value={timeLimitSec}
                      onChange={(e) => setTimeLimitSec(e.target.value)}
                      onKeyDown={preventFormSubmitOnEnter}
                      disabled={!canMutateDetail}
                    />
                  </label>
                  <label className="studyTopMetaField">
                    <span className="fieldLabel">Passing %</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={passingPct}
                      onChange={(e) => setPassingPct(e.target.value)}
                      onKeyDown={preventFormSubmitOnEnter}
                      disabled={!canMutateDetail}
                    />
                  </label>
                </div>
              </div>
              <div className="studyTopActions">
                {canMutateDetail ? (
                  <button type="button" className="secondaryBtn" disabled={busy} onClick={saveDraftAndClose}>
                    Save draft &amp; close
                  </button>
                ) : (
                  <button type="button" className="secondaryBtn" onClick={resetEditorAndClose}>
                    Exit
                  </button>
                )}
                <button
                  type="submit"
                  className="uploadPrimaryBtn"
                  formNoValidate
                  disabled={busy || !canMutateDetail}
                >
                  Publish
                </button>
                {onDeleteQuiz && canMutateDetail ? (
                  <button
                    type="button"
                    className="dangerBtn"
                    disabled={busy || !selectedQuizId}
                    onClick={() => deleteQuiz(selectedQuizId)}
                  >
                    Delete quiz
                  </button>
                ) : null}
              </div>
            </div>

            <div className="studyFullscreenBody">
              <div className="studyFullscreenEditor quizBankFullscreenEditor">
                <details className="quizBankDetails">
                  <summary>Import</summary>
                  <textarea
                    className="courseTextarea quizBankPasteArea"
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                    placeholder={`${QUIZ_PASTE_HEADER}\n...`}
                  />
                  <div className="row" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      className="secondaryBtn"
                      disabled={busy || !pasteText.trim() || !selectedQuizId || !canMutateDetail}
                      onClick={applyPasteImport}
                    >
                      Apply import to editor
                    </button>
                  </div>
                </details>

                <div className="quizBankSectionHead">
                  <h4 className="quizBankSectionTitle">Questions</h4>
                  <button
                    type="button"
                    className="secondaryBtn"
                    disabled={!canMutateDetail}
                    onClick={() => setQuestions((prev) => [...prev, emptyQuestion()])}
                  >
                    + Add question
                  </button>
                </div>

                <div className="quizBankQuestionList">
                  {questions.map((q, idx) => (
                    <QuizQuestionCard
                      key={idx}
                      index={idx}
                      q={q}
                      canMutate={canMutateDetail}
                      questionTypes={QUESTION_TYPES}
                      canRemove={questions.length > 1}
                      onPatch={(patch) =>
                        setQuestions((prev) => prev.map((x, i) => (i === idx ? { ...x, ...patch } : x)))
                      }
                      onRemove={() => setQuestions((prev) => prev.filter((_, i) => i !== idx))}
                    />
                  ))}
                </div>

                <details className="quizBankDetails quizBankDetailsAssignments">
                  <summary>Assignments</summary>
                  <div className="formGrid quizBankAssignForm">
                    <fieldset disabled={!canMutateDetail} style={{ border: 'none', margin: 0, padding: 0 }}>
                      <select
                        value={assignVersionId}
                        onChange={(e) => setAssignVersionId(e.target.value)}
                      >
                        <option value="">Version</option>
                        {selectedVersions.map((v) => (
                          <option key={v.id} value={v.id}>
                            v{v.version_no} — {v.title || 'Untitled'}
                          </option>
                        ))}
                      </select>
                      <select
                        value={assignScopeType}
                        onChange={(e) => {
                          setAssignScopeType(e.target.value);
                          setAssignScopeId('');
                        }}
                      >
                        <option value="course">Course</option>
                        <option value="lesson">Lesson</option>
                      </select>
                      <select
                        value={assignScopeId}
                        onChange={(e) => setAssignScopeId(e.target.value)}
                      >
                        <option value="">{assignScopeType === 'course' ? 'Course' : 'Lesson'}</option>
                        {scopeOptions.map((o) => (
                          <option key={`${assignScopeType}-${o.id}`} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <label className="checkboxRow">
                        <input
                          type="checkbox"
                          checked={assignRequired}
                          onChange={(e) => setAssignRequired(e.target.checked)}
                        />
                        <span>Required</span>
                      </label>
                      <button type="button" disabled={busy || !canMutateDetail} onClick={assign}>
                        Assign
                      </button>
                    </fieldset>
                  </div>
                  {selectedAssignments.length > 0 ? (
                    <div className="tableWrap" style={{ marginTop: 10 }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Scope</th>
                            <th>Scope ID</th>
                            <th>Version</th>
                            <th>Required</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedAssignments.map((a) => (
                            <tr key={a.id}>
                              <td>{a.scope_type}</td>
                              <td>{a.scope_id}</td>
                              <td>{a.quiz_version_id}</td>
                              <td>{a.is_required ? 'Yes' : 'No'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="muted" style={{ marginTop: 8 }}>
                      No assignments yet.
                    </p>
                  )}
                </details>
              </div>

              <QuizPreviewPanel quizTitle={editorTitle} questions={questions} passingPct={Number(passingPct) || 0} />
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
