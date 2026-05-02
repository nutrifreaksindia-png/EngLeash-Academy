import React, { useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';

const QUESTION_TYPES = [
  { value: 'mcq_single', label: 'Multiple Choice (single)' },
  { value: 'mcq_multi', label: 'Multiple Choice (multi)' },
  { value: 'matching', label: 'Matching' },
  { value: 'fill_blank', label: 'Completion (fill blank)' },
];

function emptyQuestion() {
  return {
    type: 'mcq_single',
    prompt: '',
    points: 1,
    optionsText: '*Option A\nOption B',
    pairsText: 'Word => Meaning',
    blanksText: 'blank1 => answer',
  };
}

function parseQuestionInput(q) {
  const base = {
    type: q.type,
    prompt: q.prompt,
    points: Number(q.points || 1),
  };
  if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
    const lines = String(q.optionsText || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      ...base,
      options: lines.map((line, idx) => ({
        option_text: line.replace(/^\*/, '').trim(),
        is_correct: line.startsWith('*'),
        sort_order: idx,
      })),
    };
  }
  if (q.type === 'matching') {
    const pairs = String(q.pairsText || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line, idx) => {
        const [left, right] = line.split('=>').map((x) => (x || '').trim());
        return { left_text: left, right_text: right, sort_order: idx };
      });
    return { ...base, pairs };
  }
  const solutions = String(q.blanksText || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, answer] = line.split('=>').map((x) => (x || '').trim());
      return { blank_key: key, answer_text: answer, is_case_sensitive: false };
    });
  return { ...base, solutions };
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
}) {
  const [selectedQuizId, setSelectedQuizId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [createTitle, setCreateTitle] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [questions, setQuestions] = useState([emptyQuestion()]);
  const [versionTitle, setVersionTitle] = useState('');
  const [passingPct, setPassingPct] = useState(60);
  const [timeLimitSec, setTimeLimitSec] = useState('');
  const [assignScopeType, setAssignScopeType] = useState('course');
  const [assignScopeId, setAssignScopeId] = useState('');
  const [assignVersionId, setAssignVersionId] = useState('');
  const [assignRequired, setAssignRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectedVersions = detail?.versions || [];
  const selectedAssignments = detail?.assignments || [];
  const canMutateDetail = Boolean(detail && libraryCanMutate(detail));

  const scopeOptions = useMemo(() => {
    if (assignScopeType === 'course') {
      return (courses || []).map((c) => ({ id: c.id, label: c.name }));
    }
    return (lessons || [])
      .filter((l) => Number.isFinite(Number(l.id)))
      .map((l) => ({ id: l.id, label: l.title }));
  }, [assignScopeType, courses, lessons]);

  async function refreshDetails(id) {
    if (!id) return;
    const d = await onGetQuiz(id);
    setDetail(d);
  }

  async function pickQuiz(id) {
    setSelectedQuizId(id);
    setError('');
    try {
      await refreshDetails(id);
    } catch (e) {
      setError(e.message);
    }
  }

  async function createQuiz(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onCreateQuiz({ title: createTitle, description: createDescription, status: 'draft' });
      setCreateTitle('');
      setCreateDescription('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function publishVersion(e) {
    e.preventDefault();
    if (!selectedQuizId || !canMutateDetail) return;
    setBusy(true);
    setError('');
    try {
      await onPublishVersion(selectedQuizId, {
        title: versionTitle || null,
        timeLimitSec: timeLimitSec ? Number(timeLimitSec) : null,
        shuffleQuestions: false,
        passingPct: Number(passingPct || 0),
        questions: questions.map(parseQuestionInput),
      });
      setQuestions([emptyQuestion()]);
      setVersionTitle('');
      setTimeLimitSec('');
      await refreshDetails(selectedQuizId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(status) {
    if (!selectedQuizId || !canMutateDetail) return;
    setBusy(true);
    setError('');
    try {
      await onUpdateQuiz(selectedQuizId, { status });
      await refreshDetails(selectedQuizId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function assign(e) {
    e.preventDefault();
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
      await refreshDetails(selectedQuizId);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {error ? <div className="partialErrorBox">{error}</div> : null}
      <SectionCard title="Quiz Bank" subtitle="Reusable quizzes assignable to multiple courses and lessons">
        <form className="formGrid" onSubmit={createQuiz}>
          <input placeholder="Quiz title" value={createTitle} onChange={(e) => setCreateTitle(e.target.value)} required />
          <input placeholder="Description" value={createDescription} onChange={(e) => setCreateDescription(e.target.value)} />
          <button type="submit" disabled={busy}>Create Quiz</button>
        </form>
      </SectionCard>

      <SectionCard title="Quizzes" subtitle="Select a quiz to edit, publish versions and assign">
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                {showCreatedBy ? <th>Created by</th> : null}
                <th>Latest Version</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {(quizzes || []).map((q) => (
                <tr key={q.id}>
                  <td>{q.title}</td>
                  <td>{q.status}</td>
                  {showCreatedBy ? <td>{q.creator_name || `#${q.created_by}` || '—'}</td> : null}
                  <td>{q.latest_version || '-'}</td>
                  <td><button type="button" className="secondaryBtn" onClick={() => pickQuiz(q.id)}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {selectedQuizId ? (
        <>
          <SectionCard
            title={`Quiz #${selectedQuizId}`}
            subtitle={canMutateDetail ? 'Manage status and publish versions' : 'View quiz versions (read-only — not your quiz)'}
            actions={
              canMutateDetail ? (
                <div className="row">
                  <button type="button" className="secondaryBtn" onClick={() => updateStatus('draft')}>Set Draft</button>
                  <button type="button" className="secondaryBtn" onClick={() => updateStatus('published')}>Set Published</button>
                  <button type="button" className="secondaryBtn" onClick={() => updateStatus('archived')}>Set Archived</button>
                </div>
              ) : (
                <span className="muted">View only</span>
              )
            }
          >
            <form className="stack" onSubmit={publishVersion}>
              <fieldset disabled={!canMutateDetail} style={{ border: 'none', margin: 0, padding: 0 }}>
              <input placeholder="Version title (optional)" value={versionTitle} onChange={(e) => setVersionTitle(e.target.value)} />
              <div className="row">
                <input type="number" min="0" placeholder="Time limit sec (optional)" value={timeLimitSec} onChange={(e) => setTimeLimitSec(e.target.value)} />
                <input type="number" min="0" max="100" placeholder="Passing %" value={passingPct} onChange={(e) => setPassingPct(e.target.value)} />
              </div>

              {questions.map((q, idx) => (
                <div key={idx} className="sectionCard" style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10 }}>
                  <div className="row">
                    <strong>Question {idx + 1}</strong>
                    <button
                      type="button"
                      className="dangerBtn"
                      onClick={() => setQuestions((prev) => prev.filter((_, i) => i !== idx))}
                      disabled={questions.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                  <select value={q.type} onChange={(e) => setQuestions((prev) => prev.map((x, i) => (i === idx ? { ...x, type: e.target.value } : x)))}>
                    {QUESTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <textarea placeholder="Prompt" value={q.prompt} onChange={(e) => setQuestions((prev) => prev.map((x, i) => (i === idx ? { ...x, prompt: e.target.value } : x)))} />
                  <input type="number" min="1" placeholder="Points" value={q.points} onChange={(e) => setQuestions((prev) => prev.map((x, i) => (i === idx ? { ...x, points: e.target.value } : x)))} />

                  {(q.type === 'mcq_single' || q.type === 'mcq_multi') ? (
                    <textarea
                      placeholder="Options (one per line, prefix correct option with *)"
                      value={q.optionsText}
                      onChange={(e) => setQuestions((prev) => prev.map((x, i) => (i === idx ? { ...x, optionsText: e.target.value } : x)))}
                    />
                  ) : null}
                  {q.type === 'matching' ? (
                    <textarea
                      placeholder="Pairs one per line: left => right"
                      value={q.pairsText}
                      onChange={(e) => setQuestions((prev) => prev.map((x, i) => (i === idx ? { ...x, pairsText: e.target.value } : x)))}
                    />
                  ) : null}
                  {q.type === 'fill_blank' ? (
                    <textarea
                      placeholder="Solutions one per line: blank_key => answer"
                      value={q.blanksText}
                      onChange={(e) => setQuestions((prev) => prev.map((x, i) => (i === idx ? { ...x, blanksText: e.target.value } : x)))}
                    />
                  ) : null}
                </div>
              ))}
              <button type="button" className="secondaryBtn" onClick={() => setQuestions((prev) => [...prev, emptyQuestion()])}>+ Add Question</button>
              <button type="submit" disabled={busy}>Publish New Version</button>
              </fieldset>
            </form>
          </SectionCard>

          <SectionCard title="Assignments" subtitle="Attach selected version to course or lesson">
            <form className="formGrid" onSubmit={assign}>
              <fieldset disabled={!canMutateDetail} style={{ border: 'none', margin: 0, padding: 0 }} className="formGrid">
              <select value={assignVersionId} onChange={(e) => setAssignVersionId(e.target.value)} required>
                <option value="">Select version</option>
                {selectedVersions.map((v) => <option key={v.id} value={v.id}>v{v.version_no} - {v.title || 'Untitled'}</option>)}
              </select>
              <select value={assignScopeType} onChange={(e) => { setAssignScopeType(e.target.value); setAssignScopeId(''); }}>
                <option value="course">Course</option>
                <option value="lesson">Lesson</option>
              </select>
              <select value={assignScopeId} onChange={(e) => setAssignScopeId(e.target.value)} required>
                <option value="">Select {assignScopeType}</option>
                {scopeOptions.map((o) => <option key={`${assignScopeType}-${o.id}`} value={o.id}>{o.label}</option>)}
              </select>
              <label className="checkboxRow">
                <input type="checkbox" checked={assignRequired} onChange={(e) => setAssignRequired(e.target.checked)} />
                <span>Required</span>
              </label>
              <button type="submit" disabled={busy}>Assign</button>
              </fieldset>
            </form>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Scope</th><th>Scope ID</th><th>Version ID</th><th>Required</th></tr></thead>
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
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
