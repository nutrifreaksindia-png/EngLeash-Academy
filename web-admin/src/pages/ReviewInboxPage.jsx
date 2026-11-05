import React, { useEffect, useState } from 'react';
import SectionCard from '../components/SectionCard';
import StudentProgressPanel from '../components/StudentProgressPanel';

export default function ReviewInboxPage({
  loadReviewQueue,
  submitReview,
  loadStudentProgress,
  addStudentNote,
  deleteStudentNote,
}) {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(null);
  const [score, setScore] = useState('');
  const [feedback, setFeedback] = useState('');
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(null);

  async function refresh(nextStatus = status) {
    setLoading(true);
    setError('');
    try {
      const data = await loadReviewQueue(nextStatus);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      setError(e?.message || 'Could not load review queue');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh(status);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  function openRow(row) {
    setActive(row);
    setScore(row.score != null ? String(row.score) : '');
    setFeedback(row.feedback || '');
  }

  async function saveReview(e) {
    e.preventDefault();
    if (!active) return;
    setSaving(true);
    try {
      await submitReview(active.batch_id, active.assignment_id, active.id, {
        score: Number(score),
        feedback,
      });
      setActive(null);
      await refresh();
    } catch (err) {
      setError(err?.message || 'Could not save review');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <SectionCard
        title="Review inbox"
        subtitle="Assignment submissions from your active batches."
        actions={
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="all">All</option>
          </select>
        }
      >
        {loading ? <p className="muted">Loading…</p> : null}
        {error ? <p className="muted">{error}</p> : null}
        <div className="tableWrap">
          <table className="dataTable">
            <thead>
              <tr>
                <th>Student</th>
                <th>Assignment</th>
                <th>Batch</th>
                <th>Submitted</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.student_name}</td>
                  <td>{r.assignment_title}</td>
                  <td>{r.batch_title || r.batch_name}</td>
                  <td>{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : '—'}</td>
                  <td>{r.review_status === 'reviewed' ? `${r.score}/${r.max_score ?? 10}` : 'Pending'}</td>
                  <td>
                    <button type="button" className="secondaryBtn" onClick={() => openRow(r)}>
                      Review
                    </button>
                    <button
                      type="button"
                      className="secondaryBtn"
                      onClick={() => setProgress({ batchId: r.batch_id, studentId: r.student_id })}
                    >
                      Student
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Nothing in this queue.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {active ? (
        <SectionCard
          title={`Review — ${active.student_name}`}
          subtitle={`${active.assignment_title} · max ${active.max_score ?? 10}`}
          actions={
            <button type="button" className="secondaryBtn" onClick={() => setActive(null)}>
              Close
            </button>
          }
        >
          <p>
            <a href={active.file_url} target="_blank" rel="noreferrer">
              Open PDF
            </a>
          </p>
          <iframe className="reviewPdfFrame" title="Assignment PDF" src={active.file_url} />
          <form className="stack" onSubmit={saveReview}>
            <label className="batchCreateLabel">
              Score
              <input
                type="number"
                min={0}
                max={Number(active.max_score ?? 10)}
                step="0.5"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                required
              />
            </label>
            <label className="batchCreateLabel">
              Feedback
              <textarea rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
            </label>
            <button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save review'}
            </button>
          </form>
        </SectionCard>
      ) : null}

      <StudentProgressPanel
        open={!!progress}
        onClose={() => setProgress(null)}
        batchId={progress?.batchId}
        studentId={progress?.studentId}
        loadProgress={loadStudentProgress}
        addNote={addStudentNote}
        deleteNote={deleteStudentNote}
      />
    </div>
  );
}
