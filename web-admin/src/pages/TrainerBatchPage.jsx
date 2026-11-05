import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SectionCard from '../components/SectionCard';
import StudentProgressPanel from '../components/StudentProgressPanel';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'roster', label: 'Roster' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'recordings', label: 'Recordings' },
];

function statusLabel(b) {
  const s = b?.batch_status || 'draft';
  if (s === 'completed') return 'Completed';
  if (s === 'started') return 'Started';
  return 'Draft';
}

function hasRun(b) {
  const s = b?.batch_status || 'draft';
  return s === 'started' || s === 'completed';
}

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatTime(value) {
  if (!value) return '—';
  const s = String(value).trim();
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return s;
}

export default function TrainerBatchPage({
  batches = [],
  selectedBatchId,
  setSelectedBatchId,
  onLoadSessions,
  onCancelSession,
  cancelAuditRows = [],
  batchMembers = [],
  batchTrainers = [],
  batchSessions = [],
  fetchBatchAssignments,
  createBatchAssignment,
  fetchAssignmentSubmissions,
  fetchBatchAttendance,
  fetchBatchLiveRecordings,
  saveSessionAttendance,
  loadStudentProgress,
  addStudentNote,
  deleteStudentNote,
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [assignments, setAssignments] = useState([]);
  const [assignTitle, setAssignTitle] = useState('');
  const [assignDue, setAssignDue] = useState('');
  const [assignMax, setAssignMax] = useState('10');
  const [subs, setSubs] = useState({});
  const [attendance, setAttendance] = useState(null);
  const [recordings, setRecordings] = useState([]);
  const [progressStudentId, setProgressStudentId] = useState(null);
  const [cancelId, setCancelId] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

  const batch = useMemo(
    () => (batches || []).find((b) => String(b.id) === String(selectedBatchId)) || (batches || [])[0] || null,
    [batches, selectedBatchId],
  );

  useEffect(() => {
    if (batch && String(selectedBatchId) !== String(batch.id) && setSelectedBatchId) {
      setSelectedBatchId(String(batch.id));
    }
  }, [batch, selectedBatchId, setSelectedBatchId]);

  useEffect(() => {
    if (!batch?.id || !onLoadSessions) return;
    void onLoadSessions(batch.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batch?.id]);

  useEffect(() => {
    if (!batch?.id || tab !== 'assignments' || !fetchBatchAssignments) return undefined;
    let cancelled = false;
    fetchBatchAssignments(batch.id)
      .then((rows) => {
        if (!cancelled) setAssignments(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setAssignments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [batch?.id, tab, fetchBatchAssignments]);

  useEffect(() => {
    if (!batch?.id || tab !== 'attendance' || !fetchBatchAttendance) return undefined;
    let cancelled = false;
    fetchBatchAttendance(batch.id)
      .then((data) => {
        if (!cancelled) setAttendance(data && Array.isArray(data.members) ? data : { members: [], sessions: [], marks: [] });
      })
      .catch(() => {
        if (!cancelled) setAttendance({ members: [], sessions: [], marks: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [batch?.id, tab, fetchBatchAttendance]);

  useEffect(() => {
    if (!batch?.id || tab !== 'recordings' || !fetchBatchLiveRecordings) return undefined;
    let cancelled = false;
    fetchBatchLiveRecordings(batch.id)
      .then((data) => {
        if (!cancelled) setRecordings(Array.isArray(data?.recordings) ? data.recordings : []);
      })
      .catch(() => {
        if (!cancelled) setRecordings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [batch?.id, tab, fetchBatchLiveRecordings]);

  const markMap = useMemo(() => {
    const map = new Map();
    (attendance?.marks || []).forEach((m) => {
      map.set(`${m.batch_session_id}:${m.student_id}`, m.status || '');
    });
    return map;
  }, [attendance]);

  if (!batch) {
    return (
      <SectionCard title="My batches" subtitle="Batches you teach">
        <p className="muted">You are not assigned to any batches yet.</p>
      </SectionCard>
    );
  }

  async function handleCreateAssignment(e) {
    e.preventDefault();
    await createBatchAssignment(batch.id, {
      title: assignTitle,
      dueDate: assignDue || null,
      maxScore: Number(assignMax || 10),
    });
    setAssignTitle('');
    setAssignDue('');
    setAssignMax('10');
    const rows = await fetchBatchAssignments(batch.id);
    setAssignments(Array.isArray(rows) ? rows : []);
  }

  return (
    <div className="stack">
      <SectionCard title="My batches" subtitle="Select a batch, then use the tabs to teach it.">
        <div className="row">
          <select
            value={String(batch.id)}
            onChange={(e) => {
              setSelectedBatchId(e.target.value);
              setTab('overview');
            }}
          >
            {(batches || []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.title || b.name} ({statusLabel(b)})
              </option>
            ))}
          </select>
          <span className={`badge ${hasRun(batch) ? 'active' : 'inactive'}`}>{statusLabel(batch)}</span>
        </div>
        <div className="trainerTabBar">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`secondaryBtn ${tab === t.id ? 'toggleBtnOn' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </SectionCard>

      {tab === 'overview' ? (
        <SectionCard title={batch.title || batch.name} subtitle={batch.course_name || 'No course linked'}>
          <p>Planned start: {formatDate(batch.planned_start_date)}</p>
          <p>Notes: {batch.notes || '—'}</p>
          <p className="muted">Admins create, start, and complete batches. You teach, mark attendance, and grade work.</p>
        </SectionCard>
      ) : null}

      {tab === 'roster' ? (
        <SectionCard title="Roster" subtitle="Students in this batch">
          <div className="tableWrap">
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(batchMembers || []).map((m) => (
                  <tr key={m.user_id}>
                    <td>{m.name}</td>
                    <td>{m.email}</td>
                    <td>
                      <button type="button" className="secondaryBtn" onClick={() => setProgressStudentId(m.user_id)}>
                        Progress
                      </button>
                    </td>
                  </tr>
                ))}
                {!(batchMembers || []).length ? (
                  <tr>
                    <td colSpan={3} className="muted">
                      No students yet. Admins manage the roster.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <h4 className="batchModalSubhead">Trainers</h4>
          <ul>
            {(batchTrainers || []).map((t) => (
              <li key={t.user_id}>
                {t.name} ({t.email})
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      {tab === 'schedule' ? (
        <SectionCard title="Schedule">
          <div className="tableWrap">
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Date</th>
                  <th>Lesson</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(batchSessions || []).map((s) => (
                  <tr key={s.id}>
                    <td>{s.session_day}</td>
                    <td>{formatDate(s.session_date)}</td>
                    <td>{s.lesson_title || '—'}</td>
                    <td>
                      {formatTime(s.starts_at)}–{formatTime(s.ends_at)}
                    </td>
                    <td>{s.status}</td>
                    <td>
                      {s.live_session_id && s.status !== 'cancelled' && s.live_status !== 'ended' ? (
                        <button type="button" className="secondaryBtn" onClick={() => navigate(`/live/${s.live_session_id}`)}>
                          Class
                        </button>
                      ) : null}
                      {s.status === 'scheduled' ? (
                        <button
                          type="button"
                          className="dangerBtn"
                          onClick={() => {
                            setCancelId(s.id);
                            setCancelReason('');
                          }}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {cancelId ? (
            <div className="stack" style={{ marginTop: 12 }}>
              <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason" rows={2} />
              <div className="row">
                <button
                  type="button"
                  className="dangerBtn"
                  disabled={!cancelReason.trim()}
                  onClick={async () => {
                    await onCancelSession(cancelId, cancelReason.trim(), batch.id);
                    setCancelId(null);
                    setCancelReason('');
                  }}
                >
                  Confirm cancel
                </button>
                <button type="button" className="secondaryBtn" onClick={() => setCancelId(null)}>
                  Close
                </button>
              </div>
            </div>
          ) : null}
          {(cancelAuditRows || []).length ? (
            <p className="muted">{cancelAuditRows.length} cancellation(s) logged.</p>
          ) : null}
        </SectionCard>
      ) : null}

      {tab === 'attendance' ? (
        <SectionCard title="Attendance">
          {!hasRun(batch) ? (
            <p className="muted">This batch has not started yet.</p>
          ) : !(attendance?.sessions || []).length ? (
            <p className="muted">No sessions yet.</p>
          ) : (
            <div className="tableWrap batchListWrap">
              <table className="dataTable batchAttendanceTable">
                <thead>
                  <tr>
                    <th>Student</th>
                    {(attendance.sessions || []).map((s) => (
                      <th key={s.id}>
                        Day {s.session_day}
                        <div className="muted">{formatDate(s.session_date)}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(attendance.members || []).map((m) => (
                    <tr key={m.user_id}>
                      <td>
                        <button type="button" className="secondaryBtn" onClick={() => setProgressStudentId(m.user_id)}>
                          {m.name}
                        </button>
                      </td>
                      {(attendance.sessions || []).map((s) => {
                        const v = markMap.get(`${s.id}:${m.user_id}`) || '';
                        return (
                          <td key={`${m.user_id}-${s.id}`}>
                            <select
                              className="batchAttendanceSelect"
                              value={v}
                              onChange={async (e) => {
                                const status = e.target.value || null;
                                await saveSessionAttendance(batch.id, s.id, [{ studentId: m.user_id, status }]);
                                setAttendance((prev) => {
                                  if (!prev) return prev;
                                  const marks = (prev.marks || []).filter(
                                    (x) => !(x.batch_session_id === s.id && x.student_id === m.user_id),
                                  );
                                  if (status) marks.push({ batch_session_id: s.id, student_id: m.user_id, status });
                                  return { ...prev, marks };
                                });
                              }}
                            >
                              <option value="">—</option>
                              <option value="present">Present</option>
                              <option value="absent">Absent</option>
                              <option value="late">Late</option>
                              <option value="excused">Excused</option>
                            </select>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : null}

      {tab === 'assignments' ? (
        <SectionCard title="Assignments">
          <form className="row" onSubmit={handleCreateAssignment}>
            <input value={assignTitle} onChange={(e) => setAssignTitle(e.target.value)} placeholder="Title" required />
            <input type="date" value={assignDue} onChange={(e) => setAssignDue(e.target.value)} />
            <input
              type="number"
              min={1}
              step="0.5"
              value={assignMax}
              onChange={(e) => setAssignMax(e.target.value)}
              title="Max score"
              style={{ width: 80 }}
            />
            <button type="submit">Add</button>
          </form>
          <div className="tableWrap">
            <table className="dataTable">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Due</th>
                  <th>Max</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {assignments.map((a) => (
                  <React.Fragment key={a.id}>
                    <tr>
                      <td>{a.title}</td>
                      <td>{a.due_date || '—'}</td>
                      <td>{a.max_score ?? 10}</td>
                      <td>
                        <button
                          type="button"
                          className="secondaryBtn"
                          onClick={async () => {
                            const rows = await fetchAssignmentSubmissions(batch.id, a.id);
                            setSubs((prev) => ({ ...prev, [a.id]: Array.isArray(rows) ? rows : [] }));
                          }}
                        >
                          Submissions
                        </button>
                      </td>
                    </tr>
                    {subs[a.id] ? (
                      <tr>
                        <td colSpan={4}>
                          <ul className="batchSubmissionList">
                            {subs[a.id].map((s) => (
                              <li key={s.id}>
                                <a href={s.file_url} target="_blank" rel="noreferrer">
                                  {s.student_name}
                                </a>
                                <span className="muted">
                                  {' '}
                                  · {s.review_status === 'reviewed' ? `${s.score}/${s.max_score ?? 10}` : 'pending'}
                                </span>
                                <button
                                  type="button"
                                  className="secondaryBtn"
                                  onClick={() => setProgressStudentId(s.student_id)}
                                >
                                  Student
                                </button>
                              </li>
                            ))}
                            {subs[a.id].length === 0 ? <li className="muted">No submissions.</li> : null}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      ) : null}

      {tab === 'recordings' ? (
        <SectionCard title="Recordings">
          {recordings.length === 0 ? (
            <p className="muted">No completed recordings for this batch yet.</p>
          ) : (
            <div className="tableWrap">
              <table className="dataTable">
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Stopped</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {recordings.map((r) => {
                    const urls = Array.isArray(r.cdnUrls) ? r.cdnUrls.filter(Boolean) : [];
                    const playUrl = urls.find((u) => /\.mp4(\?|$)/i.test(String(u))) || urls[0];
                    return (
                      <tr key={r.id}>
                        <td>{r.liveTitle || `Session ${r.liveSessionId}`}</td>
                        <td>{r.stoppedAt ? new Date(r.stoppedAt).toLocaleString() : '—'}</td>
                        <td>
                          {playUrl ? (
                            <a href={playUrl} target="_blank" rel="noreferrer">
                              Play
                            </a>
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      ) : null}

      <StudentProgressPanel
        open={!!progressStudentId}
        onClose={() => setProgressStudentId(null)}
        batchId={batch.id}
        studentId={progressStudentId}
        loadProgress={loadStudentProgress}
        addNote={addStudentNote}
        deleteNote={deleteStudentNote}
      />
    </div>
  );
}
