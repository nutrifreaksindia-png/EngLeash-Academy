import React, { useEffect, useState } from 'react';
import Modal from './Modal';

function pct(rate) {
  if (rate == null || Number.isNaN(Number(rate))) return '—';
  return `${Math.round(Number(rate) * 100)}%`;
}

export default function StudentProgressPanel({
  open,
  onClose,
  batchId,
  studentId,
  loadProgress,
  addNote,
  deleteNote,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busyNote, setBusyNote] = useState(false);

  async function refresh() {
    if (!batchId || !studentId || !loadProgress) return;
    setLoading(true);
    setError('');
    try {
      const row = await loadProgress(batchId, studentId);
      setData(row);
    } catch (e) {
      setError(e?.message || 'Could not load progress');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return undefined;
    void refresh();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, batchId, studentId]);

  async function submitNote(e) {
    e.preventDefault();
    if (!note.trim() || !addNote) return;
    setBusyNote(true);
    try {
      await addNote(batchId, studentId, note.trim());
      setNote('');
      await refresh();
    } catch (err) {
      setError(err?.message || 'Could not save note');
    } finally {
      setBusyNote(false);
    }
  }

  const student = data?.student;
  const title = student ? `Progress — ${student.name || student.email}` : 'Student progress';

  return (
    <Modal open={open} title={title} onClose={onClose} variant="drawer">
      {loading ? <p className="muted">Loading…</p> : null}
      {error ? <p className="muted">{error}</p> : null}
      {data ? (
        <div className="stack">
          <div className="statsGrid">
            <div className="statTile">
              <div className="statLabel">Attendance</div>
              <div className="statValue">{pct(data.attendanceRate)}</div>
            </div>
            <div className="statTile">
              <div className="statLabel">Present / late</div>
              <div className="statValue">
                {data.presentOrLate ?? 0}/{data.sessionsCounted ?? 0}
              </div>
            </div>
          </div>

          <h4 className="batchModalSubhead">Attendance history</h4>
          <div className="tableWrap">
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Date</th>
                  <th>Lesson</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {(data.attendanceHistory || []).map((row) => (
                  <tr key={row.sessionId}>
                    <td>{row.sessionDay}</td>
                    <td>{row.sessionDate || '—'}</td>
                    <td>{row.lessonTitle || '—'}</td>
                    <td>{row.status || '—'}</td>
                  </tr>
                ))}
                {!(data.attendanceHistory || []).length ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No sessions yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <h4 className="batchModalSubhead">Assignments</h4>
          <div className="tableWrap">
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Due</th>
                  <th>Score</th>
                  <th>Feedback</th>
                </tr>
              </thead>
              <tbody>
                {(data.assignments || []).map((a) => (
                  <tr key={a.id}>
                    <td>{a.title}</td>
                    <td>{a.due_date || '—'}</td>
                    <td>
                      {a.review_status === 'reviewed' && a.score != null
                        ? `${a.score}/${a.max_score ?? 10}`
                        : a.submission_id
                          ? 'Pending'
                          : 'Not submitted'}
                    </td>
                    <td>{a.feedback || '—'}</td>
                  </tr>
                ))}
                {!(data.assignments || []).length ? (
                  <tr>
                    <td colSpan={4} className="muted">
                      No assignments.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <h4 className="batchModalSubhead">Quiz attempts</h4>
          <div className="tableWrap">
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Quiz</th>
                  <th>Score</th>
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {(data.quizAttempts || []).map((q) => (
                  <tr key={q.id}>
                    <td>{q.quiz_title}</td>
                    <td>
                      {q.score != null ? `${q.score}/${q.max_score ?? 0}` : '—'}
                    </td>
                    <td>{q.submitted_at ? new Date(q.submitted_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
                {!(data.quizAttempts || []).length ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No quiz attempts in this batch’s courses.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <h4 className="batchModalSubhead">Private trainer notes</h4>
          <p className="muted">Visible to this batch’s trainers and admins, never to the student.</p>
          {addNote ? (
            <form className="stack" onSubmit={submitNote}>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Note" />
              <button type="submit" disabled={busyNote || !note.trim()}>
                Add note
              </button>
            </form>
          ) : null}
          <ul className="trainerNotesList">
            {(data.notes || []).map((n) => (
              <li key={n.id}>
                <div>
                  <strong>{n.author_name || 'Staff'}</strong>
                  <span className="muted"> · {n.created_at ? new Date(n.created_at).toLocaleString() : ''}</span>
                  <p>{n.note}</p>
                </div>
                {deleteNote ? (
                  <button
                    type="button"
                    className="dangerBtn"
                    onClick={async () => {
                      await deleteNote(batchId, n.id);
                      await refresh();
                    }}
                  >
                    Delete
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Modal>
  );
}
