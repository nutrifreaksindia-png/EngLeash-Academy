import React from 'react';
import { useNavigate } from 'react-router-dom';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';

function batchTypeLabel(t) {
  if (t === 'one_to_one') return 'One-on-one';
  return 'Group';
}

const WEEKDAY_KEYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function parseTrainingSchedule(jsonStr) {
  if (!jsonStr) {
    return { daysOfWeek: [], startTime: '', endTime: '' };
  }
  try {
    const o = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
    const d = o.daysOfWeek;
    return {
      daysOfWeek: Array.isArray(d) ? d : [],
      startTime: o.startTime || '',
      endTime: o.endTime || '',
    };
  } catch {
    return { daysOfWeek: [], startTime: '', endTime: '' };
  }
}

function isBatchStarted(b) {
  return (b?.batch_status || 'draft') === 'started';
}

function isBatchOpenForApply(b) {
  return (b?.enrollment_open_status || 'closed') === 'open';
}

/** Batch session row includes live_session_id / live_status when backend joins live_sessions. */
function canJoinLiveSession(s) {
  if (!s?.live_session_id) return false;
  if (s.status === 'cancelled') return false;
  const ls = s.live_status;
  if (ls === 'ended' || ls === 'cancelled') return false;
  if (ls !== 'scheduled' && ls !== 'live') return false;
  const startsAt = s.live_starts_at || s.starts_at;
  const endsAt = s.live_ends_at || s.ends_at;
  const startMs = new Date(startsAt).getTime();
  const endMs = new Date(endsAt).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
  const nowMs = Date.now();
  const earlyMs = 5 * 60 * 1000;
  return nowMs >= startMs - earlyMs && nowMs <= endMs;
}

function formatDateFriendly(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTimeFriendly(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatTimeValue(value) {
  if (!value) return '—';
  const s = String(value).trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return s;
}

function getSessionDisplayStatus(s) {
  if (s?.status === 'cancelled') return 'Cancelled';
  if (s?.live_status === 'live') return 'Live';
  if (s?.live_status === 'ended' || s?.status === 'completed') return 'Ended';
  return 'Scheduled';
}

function canCancelScheduledSession(s) {
  return s?.status === 'scheduled' && getSessionDisplayStatus(s) !== 'Ended';
}

function packageOptionLabel(p) {
  const u = String(p.duration_unit || '').toLowerCase();
  const c = Number(p.duration_count) || 1;
  const dur = u === 'day' ? `${c}d` : u === 'year' ? `${c}y` : `${c} mo`;
  const fee = Number(p.fee_inr || 0);
  const disc = Number(p.discount_inr || 0);
  const pay = Math.max(0, fee - disc);
  return `#${p.id} · ${dur} · ₹${Math.round(pay).toLocaleString('en-IN')}`;
}

export default function BatchesPage({
  onCreateBatch,
  onUpdateBatch,
  courses = [],
  batches,
  fetchSubscribePackagesForCourse,
  onStartBatch,
  onLoadSessions,
  onCancelSession,
  cancelAuditRows,
  users,
  batchMembers,
  batchTrainers,
  onAddBatchMember,
  onRemoveBatchMember,
  onAddBatchTrainer,
  onRemoveBatchTrainer,
  batchSessions,
  fetchBatchAssignments,
  createBatchAssignment,
  fetchAssignmentSubmissions,
  fetchBatchAttendance,
  fetchBatchLiveRecordings,
  saveSessionAttendance,
  onRefreshUsers,
  onDeleteBatch,
}) {
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = React.useState(null);
  const [modal, setModal] = React.useState(null);
  const [modalBatch, setModalBatch] = React.useState(null);
  const [createModalOpen, setCreateModalOpen] = React.useState(false);

  const [schedDays, setSchedDays] = React.useState([]);
  const [schedStart, setSchedStart] = React.useState('');
  const [schedEnd, setSchedEnd] = React.useState('');

  const [editTitle, setEditTitle] = React.useState('');
  const [editNotes, setEditNotes] = React.useState('');
  const [editPlanned, setEditPlanned] = React.useState('');
  const [editBatchNumber, setEditBatchNumber] = React.useState('');

  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelSessionId, setCancelSessionId] = React.useState(null);
  const [cancelReason, setCancelReason] = React.useState('');

  const [startModalOpen, setStartModalOpen] = React.useState(false);
  const [startModalBatch, setStartModalBatch] = React.useState(null);
  const [startDateValue, setStartDateValue] = React.useState(() => new Date().toISOString().slice(0, 10));

  const [newStudentId, setNewStudentId] = React.useState('');
  const [newTrainerId, setNewTrainerId] = React.useState('');
  const [coursePickId, setCoursePickId] = React.useState('');
  const [durationOverride, setDurationOverride] = React.useState('');
  const [subPkgOptions, setSubPkgOptions] = React.useState([]);
  const [subPkgLoading, setSubPkgLoading] = React.useState(false);
  const [editSubPackageId, setEditSubPackageId] = React.useState('');

  const [assignments, setAssignments] = React.useState([]);
  const [assignLoading, setAssignLoading] = React.useState(false);
  const [newAssignTitle, setNewAssignTitle] = React.useState('');
  const [newAssignDue, setNewAssignDue] = React.useState('');
  const [submissionCache, setSubmissionCache] = React.useState({});
  const [attendanceData, setAttendanceData] = React.useState(null);
  const [attendanceLoading, setAttendanceLoading] = React.useState(false);
  const [batchRecordings, setBatchRecordings] = React.useState([]);
  const [batchRecordingsLoading, setBatchRecordingsLoading] = React.useState(false);
  const [recordingPreview, setRecordingPreview] = React.useState(null);
  const [recordingPreviewError, setRecordingPreviewError] = React.useState('');
  const recordingVideoRef = React.useRef(null);
  React.useEffect(() => {
    if (onRefreshUsers) onRefreshUsers();
    // Intentionally once per visit to Batches; directory must stay in sync with Students/Trainers pages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const studentUsers = React.useMemo(() => {
    return (users || [])
      .filter((u) => u.role === 'Student' || u.role === 'Lab')
      .slice()
      .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '', undefined, { sensitivity: 'base' }));
  }, [users]);

  const trainerUsers = React.useMemo(() => {
    return (users || [])
      .filter((u) => u.role === 'Trainer')
      .slice()
      .sort((a, b) => (a.name || a.email || '').localeCompare(b.name || b.email || '', undefined, { sensitivity: 'base' }));
  }, [users]);

  React.useEffect(() => {
    if (modal !== 'sessions' || !modalBatch) return;
    const p = parseTrainingSchedule(modalBatch.training_schedule_json);
    setSchedDays(p.daysOfWeek);
    setSchedStart(p.startTime);
    setSchedEnd(p.endTime);
  }, [modal, modalBatch?.id, modalBatch?.training_schedule_json]);

  React.useEffect(() => {
    if (modal !== 'batchEdit' || !modalBatch) return;
    setEditTitle(modalBatch.title || '');
    setEditNotes(modalBatch.notes || '');
    setEditPlanned(modalBatch.planned_start_date || '');
    setEditBatchNumber(modalBatch.batch_number != null ? String(modalBatch.batch_number) : '');
  }, [modal, modalBatch]);

  React.useEffect(() => {
    if (modal !== 'course' || !coursePickId || !fetchSubscribePackagesForCourse) {
      setSubPkgOptions([]);
      setSubPkgLoading(false);
      return undefined;
    }
    const meta = (courses || []).find((c) => String(c.id) === String(coursePickId));
    if (!meta || String(meta.enrollment_type || '').toLowerCase() !== 'subscribe') {
      setSubPkgOptions([]);
      setSubPkgLoading(false);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      setSubPkgLoading(true);
      try {
        const data = await fetchSubscribePackagesForCourse(Number(coursePickId));
        if (cancelled) return;
        const opts = (data?.packages || []).filter((p) => p.is_active);
        setSubPkgOptions(opts);
      } catch {
        if (!cancelled) setSubPkgOptions([]);
      } finally {
        if (!cancelled) setSubPkgLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modal, coursePickId, courses, fetchSubscribePackagesForCourse]);

  function toggleSchedDay(day) {
    setSchedDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }

  async function openModal(kind, batch) {
    setModal(kind);
    setModalBatch(batch);
    if (kind === 'students' && onRefreshUsers) {
      try {
        await onRefreshUsers();
      } catch {
        /* loadAll surfaces errors in App */
      }
    }
    if (kind !== 'batchView' && kind !== 'batchEdit') {
      await onLoadSessions(batch.id);
    }
    if (kind === 'course') {
      setCoursePickId(batch.course_id ? String(batch.course_id) : '');
      setDurationOverride(batch.duration_days ? String(batch.duration_days) : '');
      setEditSubPackageId(batch.subscription_package_id != null ? String(batch.subscription_package_id) : '');
    }
    if (kind === 'assignments') {
      setAssignLoading(true);
      try {
        const rows = await fetchBatchAssignments(batch.id);
        setAssignments(Array.isArray(rows) ? rows : []);
      } catch {
        setAssignments([]);
      } finally {
        setAssignLoading(false);
      }
    }
    if (kind === 'attendance') {
      setAttendanceLoading(true);
      setAttendanceData(null);
      try {
        const data = await fetchBatchAttendance(batch.id);
        setAttendanceData(
          data && Array.isArray(data.members)
            ? data
            : { members: [], sessions: [], marks: [] }
        );
      } catch {
        setAttendanceData({ members: [], sessions: [], marks: [] });
      } finally {
        setAttendanceLoading(false);
      }
    }
    if (kind === 'recordings' && fetchBatchLiveRecordings) {
      setBatchRecordingsLoading(true);
      try {
        const data = await fetchBatchLiveRecordings(batch.id);
        setBatchRecordings(Array.isArray(data?.recordings) ? data.recordings : []);
      } catch {
        setBatchRecordings([]);
      } finally {
        setBatchRecordingsLoading(false);
      }
    }
  }

  function closeModal() {
    setModal(null);
    setModalBatch(null);
    setAssignments([]);
    setSubmissionCache({});
    setAttendanceData(null);
    setBatchRecordings([]);
    setBatchRecordingsLoading(false);
    setRecordingPreview(null);
    setRecordingPreviewError('');
  }

  React.useEffect(() => {
    const video = recordingVideoRef.current;
    if (!video || !recordingPreview?.url) return undefined;

    let hls = null;
    let cancelled = false;
    setRecordingPreviewError('');

    const url = String(recordingPreview.url);
    const isHls = /\.m3u8(\?|$)/i.test(url);

    if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
      void import('hls.js')
        .then(({ default: Hls }) => {
          if (cancelled) return;
          if (!Hls.isSupported()) {
            setRecordingPreviewError('This browser cannot play HLS stream directly.');
            return;
          }
          hls = new Hls();
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_evt, data) => {
            if (data?.fatal) {
              setRecordingPreviewError('Could not load this recording stream.');
            }
          });
        })
        .catch(() => {
          if (!cancelled) setRecordingPreviewError('Could not initialize stream player.');
        });
    } else {
      video.src = url;
    }

    return () => {
      cancelled = true;
      if (hls) {
        try {
          hls.destroy();
        } catch {
          /* ignore */
        }
      }
      if (video) {
        video.removeAttribute('src');
        try {
          video.load();
        } catch {
          /* ignore */
        }
      }
    };
  }, [recordingPreview?.url]);

  async function handleCreateSubmit(e) {
    const ok = await onCreateBatch(e);
    if (ok) setCreateModalOpen(false);
  }

  async function handleSaveSchedule() {
    if (!modalBatch || isBatchStarted(modalBatch)) return;
    if (schedDays.length === 0) {
      window.alert('Select at least one weekday.');
      return;
    }
    const updated = await onUpdateBatch(modalBatch.id, {
      trainingSchedule: {
        daysOfWeek: schedDays,
        startTime: schedStart.trim(),
        endTime: schedEnd.trim(),
      },
    });
    if (updated) setModalBatch(updated);
  }

  async function handleSaveBatchEdit(e) {
    e.preventDefault();
    if (!modalBatch) return;
    const updated = await onUpdateBatch(modalBatch.id, {
      title: editTitle.trim() || undefined,
      notes: editNotes.trim() || undefined,
      plannedStartDate: editPlanned || null,
      batchNumber: editBatchNumber === '' ? undefined : Number(editBatchNumber),
    });
    if (updated) {
      setModalBatch(updated);
      closeModal();
    }
  }

  async function handleDeleteBatchFromRow(b, evt) {
    evt.stopPropagation();
    if (!onDeleteBatch) return;
    if (
      !window.confirm(
        `Delete batch "${b.title || b.name}"? This cannot be undone. Started batches cannot be deleted.`
      )
    ) {
      return;
    }
    const ok = await onDeleteBatch(b.id);
    if (ok) {
      if (expandedId === b.id) setExpandedId(null);
      if (modalBatch?.id === b.id) closeModal();
    }
  }

  const attendanceMarkMap = React.useMemo(() => {
    const m = new Map();
    (attendanceData?.marks || []).forEach((r) => {
      m.set(`${r.batch_session_id}:${r.student_id}`, r.status);
    });
    return m;
  }, [attendanceData]);

  async function handleAttendanceChange(sessionId, studentId, raw) {
    if (!modalBatch || !saveSessionAttendance) return;
    const status = raw === '' ? null : raw;
    try {
      await saveSessionAttendance(modalBatch.id, sessionId, [{ studentId, status }]);
      setAttendanceData((prev) => {
        if (!prev) return prev;
        const marks = (prev.marks || []).filter(
          (x) => !(x.batch_session_id === sessionId && x.student_id === studentId)
        );
        if (status) {
          marks.push({
            batch_session_id: sessionId,
            student_id: studentId,
            status,
            marked_by: null,
            updated_at: new Date().toISOString(),
          });
        }
        return { ...prev, marks };
      });
    } catch (err) {
      window.alert(err?.message || 'Could not save attendance');
    }
  }

  async function handleSaveCourse() {
    if (!modalBatch) return;
    const cid = coursePickId === '' ? null : Number(coursePickId);
    const cmeta = cid != null ? (courses || []).find((x) => Number(x.id) === cid) : null;
    const isSubscribe =
      cmeta && String(cmeta.enrollment_type || '').toLowerCase() === 'subscribe';
    if (isSubscribe) {
      const pid = Number(editSubPackageId);
      if (!Number.isFinite(pid)) {
        window.alert('Choose a subscription package for this Subscribe course, or use Billing & combos to create one.');
        return;
      }
    }
    await onUpdateBatch(modalBatch.id, {
      courseId: cid,
      durationDays: durationOverride === '' ? null : Number(durationOverride),
      subscriptionPackageId: isSubscribe ? Number(editSubPackageId) : null,
    });
    closeModal();
  }

  function openStartModal(batch, evt) {
    evt.stopPropagation();
    if (!batch.course_id) {
      const d = Number(batch.duration_days);
      if (!Number.isFinite(d) || d < 1) {
        window.alert(
          'Without a linked course, open Course & duration and set Session count (number of sessions) before starting.'
        );
        return;
      }
    }
    const p = parseTrainingSchedule(batch.training_schedule_json);
    if (!p.daysOfWeek || p.daysOfWeek.length === 0) {
      window.alert('Open Sessions and save a class schedule (weekdays and session times) before starting.');
      return;
    }
    if (!String(p.startTime || '').trim() || !String(p.endTime || '').trim()) {
      window.alert('Set session start and end time in the Sessions dialog, then save the schedule, before starting.');
      return;
    }
    const defaultDate = new Date().toISOString().slice(0, 10);
    setStartDateValue(defaultDate);
    setStartModalBatch(batch);
    setStartModalOpen(true);
  }

  function closeStartModal() {
    setStartModalOpen(false);
    setStartModalBatch(null);
  }

  async function confirmStartBatch() {
    if (!startModalBatch) return;
    const batch = startModalBatch;
    const d = String(startDateValue || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      window.alert('Choose a valid start date.');
      return;
    }
    try {
      await onStartBatch(batch.id, d);
      await onLoadSessions(batch.id);
      setExpandedId(batch.id);
      closeStartModal();
    } catch {
      /* App.jsx surfaces toast */
    }
  }

  async function handleCreateAssignment(e) {
    e.preventDefault();
    if (!modalBatch || !newAssignTitle.trim()) return;
    await createBatchAssignment(modalBatch.id, {
      title: newAssignTitle.trim(),
      dueDate: newAssignDue || null,
    });
    const rows = await fetchBatchAssignments(modalBatch.id);
    setAssignments(Array.isArray(rows) ? rows : []);
    setNewAssignTitle('');
    setNewAssignDue('');
  }

  async function loadSubs(aid) {
    if (!modalBatch || submissionCache[aid]) return;
    const subs = await fetchAssignmentSubmissions(modalBatch.id, aid);
    setSubmissionCache((prev) => ({ ...prev, [aid]: Array.isArray(subs) ? subs : [] }));
  }

  function openCancelDialog(sessionId) {
    setCancelSessionId(sessionId);
    setCancelReason('');
    setCancelOpen(true);
  }

  async function confirmCancel() {
    if (!cancelSessionId || !modalBatch || !cancelReason.trim()) return;
    await onCancelSession(cancelSessionId, cancelReason.trim(), modalBatch.id);
    setCancelOpen(false);
    setCancelSessionId(null);
    setCancelReason('');
    await onLoadSessions(modalBatch.id);
  }

  const modalTitle =
    modal && modalBatch
      ? {
          students: `Students — ${modalBatch.title || modalBatch.name}`,
          sessions: `Sessions — ${modalBatch.title || modalBatch.name}`,
          course: `Course & duration — ${modalBatch.title || modalBatch.name}`,
          cancellation: `Cancellation log — ${modalBatch.title || modalBatch.name}`,
          assignments: `Assignments — ${modalBatch.title || modalBatch.name}`,
          attendance: `Attendance — ${modalBatch.title || modalBatch.name}`,
          recordings: `Recordings & reports — ${modalBatch.title || modalBatch.name}`,
          progress: `Progress report — ${modalBatch.title || modalBatch.name}`,
          batchView: `View batch — ${modalBatch.title || modalBatch.name}`,
          batchEdit: `Edit batch — ${modalBatch.title || modalBatch.name}`,
        }[modal]
      : '';

  return (
    <div className="stack">
      <SectionCard
        title="Batches"
        subtitle="Batch numbers must be unique per type. Set Sessions (weekdays + times). Optionally link a course — if not, set session count in Course & duration before starting."
        actions={
          <button type="button" onClick={() => setCreateModalOpen(true)}>
            Create batch
          </button>
        }
      >
        <div className="tableWrap batchListWrap">
          <table className="batchListTable">
            <thead>
              <tr>
                <th className="batchColExpand" aria-hidden />
                <th>No.</th>
                <th>Type</th>
                <th>Title</th>
                <th>Status</th>
                <th>Course</th>
                <th>Start (planned)</th>
                <th className="batchColActions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(batches || []).map((b) => (
                <React.Fragment key={b.id}>
                  <tr
                    className={`batchListRow ${expandedId === b.id ? 'batchListRowOpen' : ''}`}
                    onClick={() => setExpandedId((cur) => (cur === b.id ? null : b.id))}
                  >
                    <td className="batchColExpand">{expandedId === b.id ? '▼' : '▶'}</td>
                    <td>{b.batch_number ?? '—'}</td>
                    <td>{batchTypeLabel(b.session_type)}</td>
                    <td>{b.title || b.name}</td>
                    <td>
                      <span className={`badge ${isBatchStarted(b) ? 'active' : 'inactive'}`}>
                        {isBatchStarted(b) ? 'Started' : 'Draft'}
                      </span>
                    </td>
                    <td>{b.course_name || <span className="muted">None</span>}</td>
                    <td>{formatDateFriendly(b.planned_start_date)}</td>
                    <td className="batchColActions" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="secondaryBtn batchRowActionBtn" onClick={() => openModal('batchView', b)}>
                        View
                      </button>
                      <button type="button" className="secondaryBtn batchRowActionBtn" onClick={() => openModal('batchEdit', b)}>
                        Edit
                      </button>
                      <button
                        type="button"
                        className="dangerBtn batchRowActionBtn"
                        disabled={isBatchStarted(b)}
                        title={isBatchStarted(b) ? 'Cannot delete a started batch' : 'Delete batch'}
                        onClick={(e) => handleDeleteBatchFromRow(b, e)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                  {expandedId === b.id ? (
                    <tr className="batchExpandRow">
                      <td colSpan={8}>
                        <div className="batchExpandBar">
                          <button type="button" className="secondaryBtn" onClick={() => openModal('students', b)}>
                            Students
                          </button>
                          <button type="button" className="secondaryBtn" onClick={() => openModal('sessions', b)}>
                            Sessions
                          </button>
                          <button type="button" className="secondaryBtn" onClick={() => openModal('course', b)}>
                            Course
                          </button>
                          {!isBatchStarted(b) ? (
                            <button type="button" onClick={(e) => openStartModal(b, e)}>
                              Start batch
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={`secondaryBtn ${isBatchOpenForApply(b) ? 'toggleBtnOn' : ''}`}
                            title="Allow students to apply for this batch from mobile app"
                            onClick={async () => {
                              await onUpdateBatch(b.id, {
                                enrollmentOpenStatus: isBatchOpenForApply(b) ? 'closed' : 'open',
                              });
                            }}
                          >
                            {isBatchOpenForApply(b) ? 'Applications: Open' : 'Applications: Closed'}
                          </button>
                          {isBatchStarted(b) ? (
                            <>
                              <button type="button" className="secondaryBtn" onClick={() => openModal('attendance', b)}>
                                Attendance
                              </button>
                              <button type="button" className="secondaryBtn" onClick={() => openModal('cancellation', b)}>
                                Cancellations
                              </button>
                              <button type="button" className="secondaryBtn" onClick={() => openModal('recordings', b)}>
                                Recordings
                              </button>
                              <button type="button" className="secondaryBtn" onClick={() => openModal('assignments', b)}>
                                Assignments
                              </button>
                              <button type="button" className="secondaryBtn" onClick={() => openModal('progress', b)}>
                                Progress
                              </button>
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              ))}
              {(!batches || batches.length === 0) && (
                <tr>
                  <td colSpan={8} className="muted">
                    No batches yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <Modal open={!!modal && modal === 'students'} title={modalTitle} onClose={closeModal} variant="modal">
        {modalBatch ? (
          <div className="stack batchModalBody">
            <div className="row">
              <select value={newStudentId} onChange={(e) => setNewStudentId(e.target.value)}>
                <option value="">Select student / lab</option>
                {studentUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  onAddBatchMember(newStudentId, modalBatch.id);
                  setNewStudentId('');
                }}
                disabled={!newStudentId}
              >
                Add
              </button>
            </div>
            {studentUsers.length === 0 ? (
              <p className="muted">
                No Student/Lab accounts in the directory. Add them under <strong>Students</strong> in the sidebar, then use{' '}
                <strong>Refresh</strong> or reopen this dialog.
              </p>
            ) : null}
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Role</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(batchMembers || []).map((m) => (
                    <tr key={m.user_id}>
                      <td>{m.name}</td>
                      <td>{m.email}</td>
                      <td>{m.role}</td>
                      <td>
                        <button type="button" className="dangerBtn" onClick={() => onRemoveBatchMember(m.user_id, modalBatch.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!batchMembers || batchMembers.length === 0) && (
                    <tr>
                      <td colSpan={4} className="muted">
                        No students yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <h4 className="batchModalSubhead">Trainers</h4>
            <div className="row">
              <select value={newTrainerId} onChange={(e) => setNewTrainerId(e.target.value)}>
                <option value="">Select trainer</option>
                {trainerUsers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => {
                  onAddBatchTrainer(newTrainerId, modalBatch.id);
                  setNewTrainerId('');
                }}
                disabled={!newTrainerId}
              >
                Add trainer
              </button>
            </div>
            {trainerUsers.length === 0 ? (
              <p className="muted">
                No Trainer accounts in the directory. Add them under <strong>Trainers</strong>, then use <strong>Refresh</strong> or reopen this dialog.
              </p>
            ) : null}
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(batchTrainers || []).map((t) => (
                    <tr key={t.user_id}>
                      <td>{t.name}</td>
                      <td>{t.email}</td>
                      <td>
                        <button type="button" className="dangerBtn" onClick={() => onRemoveBatchTrainer(t.user_id, modalBatch.id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!batchTrainers || batchTrainers.length === 0) && (
                    <tr>
                      <td colSpan={3} className="muted">
                        No trainers yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={!!modal && modal === 'sessions'} title={modalTitle} onClose={closeModal} variant="modal">
        {modalBatch ? (
          <div className="stack batchModalBody">
            {!isBatchStarted(modalBatch) ? (
              <>
                <p className="muted">
                  The batch hasn&apos;t yet been started and there are no scheduled sessions.
                </p>
                <div className="batchScheduleEditor">
                  <p className="batchModalSubhead">Class schedule (saved when you click Save — sessions are created when you start the batch)</p>
                  <div className="batchWeekdayRow" role="group" aria-label="Class days">
                    {WEEKDAY_KEYS.map((day) => (
                      <button
                        type="button"
                        key={day}
                        className={
                          schedDays.includes(day) ? 'batchWeekdayPill batchWeekdayPillOn' : 'batchWeekdayPill'
                        }
                        onClick={() => toggleSchedDay(day)}
                      >
                        {day}
                      </button>
                    ))}
                  </div>
                  <label className="batchCreateLabel">
                    Session start
                    <input type="time" value={schedStart} onChange={(e) => setSchedStart(e.target.value)} />
                  </label>
                  <label className="batchCreateLabel">
                    Session end
                    <input type="time" value={schedEnd} onChange={(e) => setSchedEnd(e.target.value)} />
                  </label>
                  <div className="row">
                    <button type="button" onClick={handleSaveSchedule}>
                      Save schedule
                    </button>
                  </div>
                </div>
              </>
            ) : null}
            {isBatchStarted(modalBatch) ? (
              <div className="tableWrap">
                <table>
                  <thead>
                    <tr>
                      <th>Day</th>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Lesson</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(batchSessions || []).map((s) => (
                      <tr key={s.id}>
                        <td>{s.display_day != null ? s.display_day : '—'}</td>
                        <td>{formatDateFriendly(s.session_date)}</td>
                        <td>{`${formatTimeValue(s.starts_at)} - ${formatTimeValue(s.ends_at)}`}</td>
                        <td>{s.lesson_title || '—'}</td>
                        <td>
                          <span className={`badge ${String(getSessionDisplayStatus(s)).toLowerCase()}`}>
                            {getSessionDisplayStatus(s)}
                          </span>
                        </td>
                        <td>
                          <div className="row">
                            {s.live_session_id ? (
                              <button
                                type="button"
                                className="secondaryBtn"
                                disabled={!canJoinLiveSession(s)}
                                onClick={() => navigate(`/live/${s.live_session_id}`)}
                                title={canJoinLiveSession(s) ? 'Join now' : 'Join window is not open yet'}
                                style={!canJoinLiveSession(s) ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}
                              >
                                Join live
                              </button>
                            ) : null}
                            {canCancelScheduledSession(s) ? (
                              <button type="button" className="dangerBtn" onClick={() => openCancelDialog(s.id)}>
                                Cancel
                              </button>
                            ) : null}
                            {!s.live_session_id && s.status !== 'scheduled' ? <span className="muted">—</span> : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                    {(!batchSessions || batchSessions.length === 0) && (
                      <tr>
                        <td colSpan={6} className="muted">
                          No sessions in the list.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={!!modal && modal === 'batchView'} title={modalTitle} onClose={closeModal} variant="modal">
        {modalBatch ? (
          <div className="stack batchModalBody batchViewPanel">
            <p>
              <strong>Batch number</strong> {modalBatch.batch_number ?? '—'}
            </p>
            <p>
              <strong>Type</strong> {batchTypeLabel(modalBatch.session_type)}
            </p>
            <p>
              <strong>Title</strong> {modalBatch.title || modalBatch.name || '—'}
            </p>
            <p>
              <strong>Status</strong> {isBatchStarted(modalBatch) ? 'Started' : 'Draft'}
            </p>
            <p>
              <strong>Course</strong> {modalBatch.course_name || <span className="muted">None</span>}
            </p>
            <p>
              <strong>Batch subscription package</strong>{' '}
              {modalBatch.subscription_package_id != null ? (
                <>#{modalBatch.subscription_package_id}</>
              ) : (
                <span className="muted">—</span>
              )}
            </p>
            <p>
              <strong>Planned start</strong> {formatDateFriendly(modalBatch.planned_start_date)}
            </p>
            <p>
              <strong>Duration override (days)</strong> {modalBatch.duration_days ?? '—'}
            </p>
            <p>
              <strong>Notes</strong>
            </p>
            <p className="batchViewNotes">{modalBatch.notes ? modalBatch.notes : <span className="muted">—</span>}</p>
            <div className="row">
              <button type="button" className="secondaryBtn" onClick={closeModal}>
                Close
              </button>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={!!modal && modal === 'batchEdit'} title={modalTitle} onClose={closeModal} variant="modal">
        {modalBatch ? (
          <form onSubmit={handleSaveBatchEdit} className="stack batchModalBody formGrid batchCreateForm">
            <label className="batchCreateLabel">
              Batch number *
              <input
                type="number"
                min={1}
                required
                value={editBatchNumber}
                onChange={(e) => setEditBatchNumber(e.target.value)}
              />
            </label>
            <label className="batchCreateLabel batchCreateSpan2">
              Title *
              <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} required />
            </label>
            <label className="batchCreateLabel batchCreateSpan2">
              Expected start (optional)
              <input type="date" value={editPlanned} onChange={(e) => setEditPlanned(e.target.value)} />
            </label>
            <label className="batchCreateLabel batchCreateSpan2">
              Notes (optional)
              <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={3} />
            </label>
            <div className="row batchCreateSpan2">
              <button type="submit">Save</button>
              <button type="button" className="secondaryBtn" onClick={closeModal}>
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </Modal>

      <Modal open={createModalOpen} title="Create batch" onClose={() => setCreateModalOpen(false)} variant="modal">
        <form onSubmit={handleCreateSubmit} className="formGrid batchCreateForm batchModalBody">
          <label className="batchCreateLabel">
            Batch number *
            <input name="batchNumber" type="number" min={1} required placeholder="e.g. 101" />
          </label>
          <label className="batchCreateLabel">
            Type *
            <select name="batchType" defaultValue="group">
              <option value="group">Group</option>
              <option value="one_to_one">One-on-one</option>
            </select>
          </label>
          <label className="batchCreateLabel">
            Title *
            <input name="title" placeholder="Display title" required />
          </label>
          <label className="batchCreateLabel">
            Expected start (optional)
            <input name="plannedStartDate" type="date" />
          </label>
          <label className="batchCreateLabel">
            Number of sessions (optional — required if no course linked)
            <input
              name="durationDays"
              type="number"
              min={1}
              placeholder="How many sessions when starting without a course"
            />
          </label>
          <label className="batchCreateLabel">
            Trainer (optional)
            <select name="trainerId" defaultValue="">
              <option value="">— Later —</option>
              {trainerUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.email})
                </option>
              ))}
            </select>
          </label>
          <label className="batchCreateLabel batchCreateSpan2">
            Notes (optional)
            <textarea name="notes" placeholder="Internal notes" rows={2} />
          </label>
          <div className="batchCreateActions batchCreateSpan2">
            <button type="submit">Create batch</button>
            <button type="button" className="secondaryBtn" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!modal && modal === 'course'} title={modalTitle} onClose={closeModal} variant="modal">
        <div className="stack batchModalBody">
          <label className="batchCreateLabel">
            Course
            <select
              value={coursePickId}
              onChange={(e) => {
                setCoursePickId(e.target.value);
                setEditSubPackageId('');
              }}
            >
              <option value="">— None —</option>
              {(courses || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {String(c.enrollment_type || '').toLowerCase() === 'subscribe' ? ' (Subscribe)' : ''}
                </option>
              ))}
            </select>
          </label>
          {(() => {
            const meta = (courses || []).find((c) => String(c.id) === String(coursePickId));
            const isSub = meta && String(meta.enrollment_type || '').toLowerCase() === 'subscribe';
            if (!isSub) return null;
            return (
              <label className="batchCreateLabel">
                Subscription package (required for Subscribe courses)
                <select
                  value={editSubPackageId}
                  onChange={(e) => setEditSubPackageId(e.target.value)}
                  disabled={subPkgLoading}
                >
                  <option value="">— Select package —</option>
                  {subPkgOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {packageOptionLabel(p)}
                    </option>
                  ))}
                </select>
                {subPkgLoading ? (
                  <span className="muted fieldHint">Loading packages…</span>
                ) : subPkgOptions.length === 0 ? (
                  <span className="muted fieldHint">
                    No active subscription packages for this course. An admin can add them under Billing &amp; combos →
                    Course packages.
                  </span>
                ) : null}
              </label>
            );
          })()}
          <label className="batchCreateLabel">
            Session count override (optional)
            <input
              type="number"
              min={1}
              placeholder="With a course: overrides its length. Without a course: required to start."
              value={durationOverride}
              onChange={(e) => setDurationOverride(e.target.value)}
            />
          </label>
          <p className="muted fieldHint">
            With a linked course, leave empty to use the course length. With no course, set a positive number here before
            starting the batch.
          </p>
          <div className="row">
            <button type="button" onClick={handleSaveCourse}>
              Save
            </button>
            <button type="button" className="secondaryBtn" onClick={closeModal}>
              Close
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!modal && modal === 'cancellation'} title={modalTitle} onClose={closeModal} variant="modal">
        <div className="tableWrap batchModalBody">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Date</th>
                <th>Lesson</th>
                <th>Reason</th>
                <th>Cancelled by</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {(cancelAuditRows || []).map((r) => (
                <tr key={r.id}>
                  <td>{r.session_day}</td>
                  <td>{formatDateFriendly(r.session_date)}</td>
                  <td>{r.lesson_title}</td>
                  <td>{r.cancellation_reason || '—'}</td>
                  <td>{r.cancelled_by_name || r.cancelled_by_email || '—'}</td>
                  <td>{formatDateTimeFriendly(r.updated_at)}</td>
                </tr>
              ))}
              {(!cancelAuditRows || cancelAuditRows.length === 0) && (
                <tr>
                  <td colSpan={6} className="muted">
                    No cancellations logged.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Modal>

      <Modal open={!!modal && modal === 'assignments'} title={modalTitle} onClose={closeModal} variant="modal">
        {assignLoading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="stack batchModalBody">
            <form onSubmit={handleCreateAssignment} className="row">
              <input
                placeholder="Assignment title"
                value={newAssignTitle}
                onChange={(e) => setNewAssignTitle(e.target.value)}
                required
              />
              <input type="date" value={newAssignDue} onChange={(e) => setNewAssignDue(e.target.value)} />
              <button type="submit">Add assignment</button>
            </form>
            <div className="tableWrap">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Due</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {assignments.map((a) => (
                    <React.Fragment key={a.id}>
                      <tr>
                        <td>{a.title}</td>
                        <td>{a.due_date || '—'}</td>
                        <td>
                          <button type="button" className="secondaryBtn" onClick={() => loadSubs(a.id)}>
                            Submissions
                          </button>
                        </td>
                      </tr>
                      {submissionCache[a.id] ? (
                        <tr className="batchAssignSubRow">
                          <td colSpan={3}>
                            <ul className="batchSubmissionList">
                              {submissionCache[a.id].map((s) => (
                                <li key={s.id}>
                                  <a href={s.file_url} target="_blank" rel="noreferrer">
                                    {s.student_name}
                                  </a>
                                  <span className="muted"> · {s.submitted_at || ''}</span>
                                </li>
                              ))}
                              {submissionCache[a.id].length === 0 && <li className="muted">No submissions.</li>}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  ))}
                  {assignments.length === 0 && (
                    <tr>
                      <td colSpan={3} className="muted">
                        No assignments yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!modal && modal === 'attendance'} title={modalTitle} onClose={closeModal} variant="modal">
        <div className="batchModalBody">
          {attendanceLoading ? (
            <p className="muted">Loading attendance…</p>
          ) : !modalBatch || !isBatchStarted(modalBatch) ? (
            <p className="muted">Start the batch first to generate sessions, then mark attendance per day.</p>
          ) : !(attendanceData?.sessions || []).length ? (
            <p className="muted">No sessions yet. Start the batch from the list if you have not.</p>
          ) : !(attendanceData?.members || []).length ? (
            <p className="muted">Add students to this batch to record attendance.</p>
          ) : (
            <div className="batchAttendanceWrap">
              <p className="muted batchAttendanceHint">
                One status per student per session. Clear sets the cell to unmarked.
              </p>
              <div className="batchListWrap">
                <table className="dataTable batchAttendanceTable">
                  <thead>
                    <tr>
                      <th className="batchAttendanceSticky">Student</th>
                      {(attendanceData.sessions || []).map((s) => (
                        <th key={s.id} className="batchAttendanceSessionHead" title={s.lesson_title || ''}>
                          <span className="batchAttendanceDay">Day {s.session_day}</span>
                          <span className="batchAttendanceDate">{formatDateFriendly(s.session_date)}</span>
                          {s.status === 'cancelled' ? (
                            <span className="badge cancelled batchAttendanceMiniBadge">
                              Off
                            </span>
                          ) : null}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(attendanceData.members || []).map((m) => (
                      <tr key={m.user_id}>
                        <td className="batchAttendanceSticky">
                          <strong>{m.name}</strong>
                          <span className="muted batchAttendanceEmail">{m.email}</span>
                        </td>
                        {(attendanceData.sessions || []).map((s) => {
                          const v = attendanceMarkMap.get(`${s.id}:${m.user_id}`) || '';
                          return (
                            <td key={`${m.user_id}-${s.id}`}>
                              <select
                                className="batchAttendanceSelect"
                                aria-label={`Attendance ${m.name} day ${s.session_day}`}
                                value={v}
                                onChange={(e) => handleAttendanceChange(s.id, m.user_id, e.target.value)}
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
            </div>
          )}
        </div>
      </Modal>

      <Modal open={!!modal && modal === 'recordings'} title={modalTitle} onClose={closeModal} variant="modal">
        <div className="batchModalBody">
          {recordingPreview?.url ? (
            <div className="batchRecordingPreviewCard">
              <div className="row">
                <strong>{recordingPreview.title || 'Session recording'}</strong>
                <button type="button" className="secondaryBtn" onClick={() => setRecordingPreview(null)}>
                  Close player
                </button>
              </div>
              {recordingPreviewError ? <p className="muted">{recordingPreviewError}</p> : null}
              <video
                ref={recordingVideoRef}
                className="batchRecordingPlayer"
                controls
                preload="metadata"
                playsInline
              />
              <div className="row">
                <a href={recordingPreview.url} target="_blank" rel="noopener noreferrer">
                  Open source URL
                </a>
              </div>
            </div>
          ) : null}
          {batchRecordingsLoading ? (
            <p className="muted">Loading recordings…</p>
          ) : batchRecordings.length === 0 ? (
            <p className="muted">No completed recordings for this batch yet.</p>
          ) : (
            <div className="batchRecordingsScroll">
              <table className="dataTable">
                <thead>
                  <tr>
                    <th>Live session</th>
                    <th>Scheduled</th>
                    <th>Stopped</th>
                    <th>Expires</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {batchRecordings.map((r) => {
                    const urls = Array.isArray(r.cdnUrls) ? r.cdnUrls.filter(Boolean) : [];
                    const mp4 = urls.find((u) => /\.mp4(\?|$)/i.test(String(u)));
                    const hls = urls.find((u) => /\.m3u8(\?|$)/i.test(String(u)));
                    const playUrl = mp4 || hls || urls[0] || null;
                    return (
                      <tr key={r.id}>
                        <td>{r.liveTitle || `Session ${r.liveSessionId}`}</td>
                        <td>{r.startsAt ? new Date(r.startsAt).toLocaleString() : '—'}</td>
                        <td>{r.stoppedAt ? new Date(r.stoppedAt).toLocaleString() : '—'}</td>
                        <td>{r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : '—'}</td>
                        <td>
                          {playUrl ? (
                            <button
                              type="button"
                              className="secondaryBtn"
                              onClick={() =>
                                setRecordingPreview({
                                  title: r.liveTitle || `Session ${r.liveSessionId}`,
                                  url: playUrl,
                                })
                              }
                            >
                              Play
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <Modal open={!!modal && modal === 'progress'} title={modalTitle} onClose={closeModal} variant="modal">
        <p className="muted batchModalBody">Automatic and manual progress reports per student — coming later.</p>
      </Modal>

      <Modal open={cancelOpen} title="Cancel scheduled session" onClose={() => setCancelOpen(false)}>
        <div className="stack">
          <p className="muted">Provide a reason. Remaining scheduled sessions may be renumbered.</p>
          <textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="Reason" rows={3} />
          <div className="row">
            <button type="button" className="dangerBtn" onClick={confirmCancel} disabled={!cancelReason.trim()}>
              Confirm cancel
            </button>
            <button type="button" className="secondaryBtn" onClick={() => setCancelOpen(false)}>
              Close
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={startModalOpen}
        title={startModalBatch ? `Start batch — ${startModalBatch.title || startModalBatch.name}` : 'Start batch'}
        onClose={closeStartModal}
      >
        <div className="stack">
          <p className="muted batchModalBody">
            Choose the real first class day. Class sessions are generated from this date on your saved weekdays, skipping
            holidays from settings.
          </p>
          <label className="stack">
            <span className="batchModalSubhead">Real start date</span>
            <input
              type="date"
              value={startDateValue}
              onChange={(e) => setStartDateValue(e.target.value)}
            />
          </label>
          <div className="row">
            <button type="button" onClick={confirmStartBatch}>
              Start batch
            </button>
            <button type="button" className="secondaryBtn" onClick={closeStartModal}>
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
