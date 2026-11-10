import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';
import AudioPlayerWithDuration from '../components/AudioPlayerWithDuration';
import MediaPreview from '../components/MediaPreview';
import SearchMultiSelect from '../components/SearchMultiSelect';
import SearchSelect from '../components/SearchSelect';
import VoiceRecorder from '../components/VoiceRecorder';
import AssignmentsPage from './AssignmentsPage';
import {
  formatAssignmentDue,
  responseTypeLabel,
  reviewStatusLabel,
} from '../utils/assignmentLabels';

const WEEKDAYS = [
  { id: 0, label: 'Sun' },
  { id: 1, label: 'Mon' },
  { id: 2, label: 'Tue' },
  { id: 3, label: 'Wed' },
  { id: 4, label: 'Thu' },
  { id: 5, label: 'Fri' },
  { id: 6, label: 'Sat' },
];

function displayName(row) {
  return (
    row?.displayLabel ||
    row?.library?.displayLabel ||
    row?.library?.label ||
    row?.library?.title ||
    `Assignment #${row?.library_id || row?.id || ''}`
  );
}

function batchLabel(b) {
  const title = b?.title || b?.name || `Batch #${b?.id}`;
  const num = b?.batch_number != null ? ` · #${b.batch_number}` : '';
  return `${title}${num}`;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

/** Local datetime string YYYY-MM-DDTHH:mm:ss for due defaults / API. */
function localDateTimePlusHours(hours) {
  const d = new Date(Date.now() + hours * 60 * 60 * 1000);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Value for <input type="datetime-local"> */
function toDatetimeLocalValue(isoOrLocal) {
  const raw = String(isoOrLocal || '').trim();
  if (!raw) return '';
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function fromDatetimeLocalValue(local) {
  const raw = String(local || '').trim();
  if (!raw) return localDateTimePlusHours(24);
  // Keep seconds for API consistency
  return raw.length === 16 ? `${raw}:00` : raw;
}

function occurrenceBatchLabel(o, batches = []) {
  if (o?.batchName && String(o.batchName).includes('#')) return o.batchName;
  const batchId = o?.batch_id ?? o?.occ_batch_id;
  const b = (batches || []).find((x) => Number(x.id) === Number(batchId));
  if (b) return batchLabel(b);
  if (o?.batchName && o?.batch_number != null) return `${o.batchName} · #${o.batch_number}`;
  return o?.batchName || '—';
}

export default function TrainerAssignmentsPage({
  batches = [],
  assignmentsLibrary = [],
  loadTrainerOccurrences,
  loadTrainerResponses,
  setAssignment,
  reviewSubmission,
  loadBatchMembers,
  loadBatchSessions,
  cancelOccurrence,
  loadAssignment,
  // library tab props
  showCreatedBy = false,
  libraryCanMutate = () => true,
  libraryCanSharePublic = () => false,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  uploadAssignmentAsset,
  deleteAssignmentAsset,
  staffUsers = [],
  onTransferOwner,
  showLibraryTab = true,
}) {
  const [tab, setTab] = useState('responses');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);

  // Responses
  const [batchFilter, setBatchFilter] = useState('');
  const [responseFilter, setResponseFilter] = useState('pending');
  const [studentFilterId, setStudentFilterId] = useState('');
  const [responses, setResponses] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reviewVoiceBlob, setReviewVoiceBlob] = useState(null);
  const [clearExistingVoice, setClearExistingVoice] = useState(false);
  const [reviewSaving, setReviewSaving] = useState(false);

  // Set
  const [selectedLibs, setSelectedLibs] = useState([]);
  const [selectedBatches, setSelectedBatches] = useState([]);
  const [sessionDay, setSessionDay] = useState('');
  const [sessionDayOptions, setSessionDayOptions] = useState([]);
  const [dueLocal, setDueLocal] = useState(() => toDatetimeLocalValue(localDateTimePlusHours(24)));
  const [notes, setNotes] = useState('');
  const [allStudents, setAllStudents] = useState(true);
  const [studentIds, setStudentIds] = useState([]);
  const [memberOptions, setMemberOptions] = useState([]);
  const [setting, setSetting] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [recurrenceDays, setRecurrenceDays] = useState([1, 2, 3, 4, 5]);
  const [recurrenceCount, setRecurrenceCount] = useState(4);

  // Set list (occurrences)
  const [occurrences, setOccurrences] = useState([]);
  const [listBatchFilter, setListBatchFilter] = useState('');
  const [listKindFilter, setListKindFilter] = useState('all'); // all | one_time | recurring
  const [listSourceFilter, setListSourceFilter] = useState('all');
  const [listWhenFilter, setListWhenFilter] = useState('upcoming'); // upcoming | past | all

  const refreshResponses = useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      const q = batchFilter ? { batchId: Number(batchFilter) } : {};
      const rows = await loadTrainerResponses(q);
      setResponses(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setNotice(e.message || 'Failed to load responses');
    } finally {
      setLoading(false);
    }
  }, [batchFilter, loadTrainerResponses]);

  const refreshOccurrences = useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      const q = listBatchFilter ? { batchId: Number(listBatchFilter) } : {};
      const rows = await loadTrainerOccurrences(q);
      setOccurrences(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setNotice(e.message || 'Failed to load assignments');
    } finally {
      setLoading(false);
    }
  }, [listBatchFilter, loadTrainerOccurrences]);

  useEffect(() => {
    if (tab === 'responses') void refreshResponses();
    if (tab === 'set') void refreshOccurrences();
  }, [tab, refreshResponses, refreshOccurrences]);

  useEffect(() => {
    if (allStudents || !selectedBatches.length || !loadBatchMembers) {
      setMemberOptions([]);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const all = [];
      for (const bid of selectedBatches) {
        try {
          const rows = await loadBatchMembers(bid);
          for (const r of rows || []) {
            all.push({
              id: r.user_id || r.id,
              name: r.name || r.user_name || `#${r.user_id || r.id}`,
              batchId: bid,
            });
          }
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setMemberOptions(all);
    })();
    return () => {
      cancelled = true;
    };
  }, [allStudents, selectedBatches, loadBatchMembers]);

  useEffect(() => {
    if (!selectedBatches.length || !loadBatchSessions) {
      setSessionDayOptions([]);
      setSessionDay('');
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const byDay = new Map();
      let firstBatch = true;
      let intersection = null;
      for (const bid of selectedBatches) {
        try {
          const rows = await loadBatchSessions(bid);
          const days = [];
          let display = 0;
          for (const s of rows || []) {
            if (String(s.status || '') === 'cancelled') continue;
            display += 1;
            const label = s.lesson_title || s.lessonTitle || `Day ${display}`;
            days.push(display);
            const prev = byDay.get(display) || { day: display, labels: [] };
            prev.labels.push(label);
            byDay.set(display, prev);
          }
          if (firstBatch) {
            intersection = new Set(days);
            firstBatch = false;
          } else {
            intersection = new Set(days.filter((d) => intersection.has(d)));
          }
        } catch {
          /* ignore */
        }
      }
      if (cancelled) return;
      const options = [...(intersection || [])]
        .sort((a, b) => a - b)
        .map((d) => {
          const meta = byDay.get(d);
          const title = meta?.labels?.[0] || `Day ${d}`;
          return { day: d, label: `Day ${String(d).padStart(2, '0')} — ${title}` };
        });
      setSessionDayOptions(options);
      setSessionDay((prev) => {
        const n = Number(prev);
        if (options.some((o) => o.day === n)) return String(n);
        return options[0] ? String(options[0].day) : '';
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedBatches, loadBatchSessions]);

  const publishedLibs = useMemo(
    () => (assignmentsLibrary || []).filter((a) => Number(a.is_draft) !== 1),
    [assignmentsLibrary],
  );

  const libOptions = useMemo(
    () =>
      publishedLibs.map((a) => ({
        id: a.id,
        label: displayName(a),
        subLabel: [
          responseTypeLabel(a.response_type),
          Number(a.is_public) === 1 ? 'Public' : null,
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    [publishedLibs],
  );

  const batchOptions = useMemo(
    () =>
      (batches || []).map((b) => ({
        id: b.id,
        label: batchLabel(b),
        subLabel: b.session_type || '',
      })),
    [batches],
  );

  const studentOptions = useMemo(() => {
    const map = new Map();
    for (const r of responses) {
      const id = Number(r.student_id);
      if (!id || map.has(id)) continue;
      map.set(id, { id, label: r.student_name || `Student #${id}` });
    }
    return [...map.values()].sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }, [responses]);

  const filteredResponses = useMemo(() => {
    let rows = responses;
    if (responseFilter === 'reviewed') {
      rows = rows.filter((r) => String(r.review_status || '').toLowerCase() === 'reviewed');
    } else if (responseFilter === 'pending') {
      rows = rows.filter((r) => String(r.review_status || 'pending').toLowerCase() !== 'reviewed');
    }
    if (studentFilterId) {
      rows = rows.filter((r) => Number(r.student_id) === Number(studentFilterId));
    }
    return rows;
  }, [responses, responseFilter, studentFilterId]);

  const todayYmd = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }, [tab, occurrences]);

  const filteredOccurrences = useMemo(() => {
    const rows = (occurrences || []).filter((o) => {
      if (listKindFilter === 'one_time' && o.recurrence_json) return false;
      if (listKindFilter === 'recurring' && !o.recurrence_json) return false;
      if (listSourceFilter !== 'all' && String(o.source || '') !== listSourceFilter) return false;
      const dueKey = String(o.due_at || o.schedule_date || '');
      const dueDay = dueKey.slice(0, 10);
      if (listWhenFilter === 'upcoming' && dueDay && dueDay < todayYmd) return false;
      if (listWhenFilter === 'past' && dueDay && dueDay >= todayYmd) return false;
      return true;
    });
    const rank = (o) => {
      const t = Date.parse(o.due_at || o.schedule_date || '') || 0;
      return t;
    };
    return rows.sort((a, b) => {
      if (listWhenFilter === 'upcoming') return rank(a) - rank(b);
      if (listWhenFilter === 'past') return rank(b) - rank(a);
      return rank(b) - rank(a);
    });
  }, [occurrences, listKindFilter, listSourceFilter, listWhenFilter, todayYmd]);

  function openExpand(row) {
    const id = row.id;
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    setReviewFeedback(row.feedback || '');
    setReviewVoiceBlob(null);
    setClearExistingVoice(false);
  }

  async function saveReview(row, e) {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    if (!row) return;
    if (!String(reviewFeedback || '').trim() && !reviewVoiceBlob && !(row.feedback_audio_url && !clearExistingVoice)) {
      window.alert('Add written feedback and/or a voice note.');
      return;
    }
    setReviewSaving(true);
    try {
      await reviewSubmission(row.occurrence_id, row.id, {
        feedback: reviewFeedback,
        voiceBlob: reviewVoiceBlob,
        clearFeedbackAudio: clearExistingVoice && !reviewVoiceBlob,
      });
      setExpandedId(null);
      setReviewVoiceBlob(null);
      setClearExistingVoice(false);
      setReviewFeedback('');
      setNotice('Feedback saved.');
      await refreshResponses();
    } catch (err) {
      window.alert(err.message || 'Review failed');
    } finally {
      setReviewSaving(false);
    }
  }

  function toggleWeekday(day) {
    setRecurrenceDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b),
    );
  }

  async function submitSet(e) {
    e.preventDefault();
    if (!selectedLibs.length || !selectedBatches.length) {
      window.alert('Select at least one assignment and one batch.');
      return;
    }
    if (!sessionDay) {
      window.alert('Select a lesson schedule day.');
      return;
    }
    if (!allStudents && !studentIds.length) {
      window.alert('Select at least one student, or choose All students.');
      return;
    }
    if (recurring && !recurrenceDays.length) {
      window.alert('Select at least one weekday for recurring assignments.');
      return;
    }
    setSetting(true);
    try {
      const dueAt = fromDatetimeLocalValue(dueLocal);
      const recurrence = recurring
        ? {
            frequency: 'weekly',
            interval: 1,
            count: Number(recurrenceCount) || 1,
            byWeekday: recurrenceDays,
          }
        : null;
      await setAssignment({
        libraryIds: selectedLibs,
        batchIds: selectedBatches,
        sessionDay: Number(sessionDay),
        dueAt,
        notes: notes || undefined,
        studentIds: allStudents ? [] : studentIds,
        recurrence,
      });
      setNotice('Assignment set.');
      setSelectedLibs([]);
      setNotes('');
      setRecurring(false);
      setStudentIds([]);
      setAllStudents(true);
      setDueLocal(toDatetimeLocalValue(localDateTimePlusHours(24)));
      void refreshOccurrences();
    } catch (err) {
      window.alert(err.message || 'Failed to set');
    } finally {
      setSetting(false);
    }
  }

  async function onCancelOcc(occ) {
    if (!cancelOccurrence) return;
    if (!window.confirm(`Cancel “${displayName(occ)}” for this batch day?`)) return;
    try {
      await cancelOccurrence(occ.id);
      void refreshOccurrences();
    } catch (e) {
      window.alert(e.message || 'Could not cancel');
    }
  }

  const tabs = [
    { id: 'responses', label: 'Responses' },
    { id: 'set', label: 'Set an Assignment' },
    ...(showLibraryTab ? [{ id: 'library', label: 'Assignment Library' }] : []),
  ];

  const expandedRow = filteredResponses.find((r) => r.id === expandedId) || null;

  return (
    <div className="stack assignWorkspace">
      <SectionCard title="Assignments" subtitle="Review student work, schedule assignments, and manage the library">
        <div className="assignTabs" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`assignTab ${tab === t.id ? 'assignTabOn' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {notice ? <p className="assignNotice">{notice}</p> : null}

        {tab === 'responses' ? (
          <div className="assignPane">
            <div className="assignFilters">
              <label className="assignFilter">
                <span>Batch</span>
                <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
                  <option value="">All batches</option>
                  {(batches || []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {batchLabel(b)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="assignFilter">
                <span>Status</span>
                <select value={responseFilter} onChange={(e) => setResponseFilter(e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="reviewed">Reviewed</option>
                  <option value="all">All</option>
                </select>
              </label>
              <div className="assignFilter assignFilterStudent">
                <SearchSelect
                  label="Student"
                  options={studentOptions}
                  value={studentFilterId}
                  onChange={(id) => setStudentFilterId(id === '' || id == null ? '' : String(id))}
                  placeholder="Search students…"
                  allLabel="All students"
                  compact
                />
              </div>
              <button type="button" className="assignGhostBtn" onClick={() => void refreshResponses()}>
                Refresh
              </button>
            </div>

            {loading ? <p className="muted">Loading…</p> : null}
            {!loading && !filteredResponses.length ? (
              <p className="muted assignEmpty">No responses match these filters.</p>
            ) : null}

            <div className="assignTableWrap">
              <table className="dataTable assignTable">
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Assignment</th>
                    <th>Batch</th>
                    <th>Type</th>
                    <th>Submitted</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResponses.map((r) => {
                    const open = expandedId === r.id;
                    return (
                      <React.Fragment key={r.id}>
                        <tr
                          className={`assignRow ${open ? 'assignRowOpen' : ''}`}
                          onClick={() => openExpand(r)}
                          style={{ cursor: 'pointer' }}
                        >
                          <td>{r.student_name || '—'}</td>
                          <td>{displayName(r)}</td>
                          <td>{occurrenceBatchLabel(r, batches)}</td>
                          <td>{responseTypeLabel(r.response_type)}</td>
                          <td>
                            {r.submitted_at
                              ? new Date(r.submitted_at).toLocaleString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: 'numeric',
                                  minute: '2-digit',
                                })
                              : '—'}
                          </td>
                          <td>
                            <span
                              className={`assignStatusPill assignStatus-${String(r.review_status || 'pending')}`}
                            >
                              {reviewStatusLabel(r.review_status)}
                            </span>
                          </td>
                        </tr>
                        {open ? (
                          <tr className="assignExpandRow" onClick={(e) => e.stopPropagation()}>
                            <td colSpan={6}>
                              <div
                                className="assignExpand"
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                              >
                                <div className="assignExpandMedia">
                                  {r.text_body ? (
                                    <p className="assignTextBody">{r.text_body}</p>
                                  ) : null}
                                  {(Array.isArray(r.files) && r.files.length
                                    ? r.files
                                    : r.file_url
                                      ? [{ url: r.file_url, mime_type: r.mime_type, kind: r.response_type }]
                                      : []
                                  ).map((f, idx) => (
                                    <MediaPreview
                                      key={f.id || `${r.id}-${idx}`}
                                      url={f.url}
                                      typeHint={f.kind || r.response_type}
                                      mimeType={f.mime_type}
                                      title={f.file_name || `Submission ${idx + 1}`}
                                      maxHeight={280}
                                    />
                                  ))}
                                  {!r.text_body &&
                                  !(Array.isArray(r.files) && r.files.length) &&
                                  !r.file_url ? (
                                    <p className="muted">Check-in / no media attached.</p>
                                  ) : null}
                                </div>

                                <div className="assignReviewBox">
                                  <label className="assignFieldLabel">Feedback</label>
                                  <textarea
                                    className="assignTextarea"
                                    rows={3}
                                    value={reviewFeedback}
                                    onChange={(e) => setReviewFeedback(e.target.value)}
                                    placeholder="Write feedback for the student…"
                                  />
                                  <label className="assignFieldLabel" style={{ marginTop: 10 }}>
                                    Voice feedback
                                  </label>
                                  {r.feedback_audio_url && !clearExistingVoice && !reviewVoiceBlob ? (
                                    <div className="voiceRecDone" style={{ marginBottom: 8 }}>
                                      <AudioPlayerWithDuration src={r.feedback_audio_url} />
                                      <button
                                        type="button"
                                        className="secondaryBtn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setClearExistingVoice(true);
                                        }}
                                      >
                                        Remove existing voice
                                      </button>
                                    </div>
                                  ) : null}
                                  <VoiceRecorder
                                    valueBlob={reviewVoiceBlob}
                                    onChange={setReviewVoiceBlob}
                                    disabled={reviewSaving}
                                  />
                                  <div className="assignExpandActions">
                                    <button
                                      type="button"
                                      className="assignPrimaryBtn"
                                      disabled={reviewSaving}
                                      onClick={(e) => void saveReview(r, e)}
                                    >
                                      {reviewSaving ? 'Saving…' : 'Save feedback'}
                                    </button>
                                    <button
                                      type="button"
                                      className="assignGhostBtn"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setExpandedId(null);
                                      }}
                                    >
                                      Collapse
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === 'set' ? (
          <div className="assignPane">
            <form className="assignSetForm" onSubmit={submitSet}>
              <div className="assignSetGrid4">
                <SearchMultiSelect
                  label="Assignments"
                  options={libOptions}
                  value={selectedLibs}
                  onChange={setSelectedLibs}
                  placeholder="Search assignments…"
                  compact
                />
                <SearchMultiSelect
                  label="Batches"
                  options={batchOptions}
                  value={selectedBatches}
                  onChange={setSelectedBatches}
                  placeholder="Search batches…"
                  compact
                />
                <label className="assignFilter">
                  <span>Lesson day</span>
                  <select
                    value={sessionDay}
                    onChange={(e) => setSessionDay(e.target.value)}
                    disabled={!sessionDayOptions.length}
                  >
                    {!sessionDayOptions.length ? <option value="">Select batches first</option> : null}
                    {sessionDayOptions.map((o) => (
                      <option key={o.day} value={o.day}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="assignFilter" title="Defaults to 24 hours from now — edit if needed">
                  <span>Due</span>
                  <input
                    type="datetime-local"
                    value={dueLocal}
                    onChange={(e) => setDueLocal(e.target.value)}
                  />
                </label>
              </div>

              <div className="assignSetGrid3">
                <div className="assignFilter assignStudentsCell">
                  <span>Students</span>
                  <div className="assignStudentsCompact">
                    <label className="assignCheck assignCheckCompact">
                      <input
                        type="checkbox"
                        checked={allStudents}
                        onChange={(e) => {
                          setAllStudents(e.target.checked);
                          if (e.target.checked) setStudentIds([]);
                        }}
                      />
                      All in batches
                    </label>
                    {!allStudents ? (
                      <SearchMultiSelect
                        options={memberOptions.map((m) => ({ id: m.id, label: m.name }))}
                        value={studentIds}
                        onChange={setStudentIds}
                        placeholder="Search students…"
                        compact
                      />
                    ) : null}
                  </div>
                </div>

                <div className="assignFilter assignRecurringCell">
                  <span>Recurring</span>
                  <div className="assignRecurringCompact">
                    <label className="assignCheck assignCheckCompact">
                      <input
                        type="checkbox"
                        checked={recurring}
                        onChange={(e) => setRecurring(e.target.checked)}
                      />
                      On
                    </label>
                    {recurring ? (
                      <>
                        <div className="assignWeekdays assignWeekdaysCompact">
                          {WEEKDAYS.map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              className={`assignDayChip ${recurrenceDays.includes(d.id) ? 'on' : ''}`}
                              onClick={() => toggleWeekday(d.id)}
                            >
                              {d.label}
                            </button>
                          ))}
                        </div>
                        <input
                          className="assignWeeksInput"
                          type="number"
                          min={1}
                          max={52}
                          value={recurrenceCount}
                          onChange={(e) => setRecurrenceCount(e.target.value)}
                          title="Weeks"
                          aria-label="Weeks"
                        />
                      </>
                    ) : null}
                  </div>
                </div>

                <label className="assignFilter">
                  <span>Notes</span>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Visible to students"
                  />
                </label>
              </div>

              <div className="assignSetActions">
                <button type="submit" className="assignPrimaryBtn" disabled={setting}>
                  {setting ? 'Setting…' : 'Set assignment'}
                </button>
              </div>
            </form>

            <div className="assignSetListHead">
              <h3 className="assignSubhead">Set assignments</h3>
              <div className="assignFilters">
                <label className="assignFilter">
                  <span>Batch</span>
                  <select value={listBatchFilter} onChange={(e) => setListBatchFilter(e.target.value)}>
                    <option value="">All batches</option>
                    {(batches || []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {batchLabel(b)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="assignFilter">
                  <span>Kind</span>
                  <select value={listKindFilter} onChange={(e) => setListKindFilter(e.target.value)}>
                    <option value="all">All</option>
                    <option value="one_time">One-time</option>
                    <option value="recurring">Recurring</option>
                  </select>
                </label>
                <label className="assignFilter">
                  <span>Source</span>
                  <select value={listSourceFilter} onChange={(e) => setListSourceFilter(e.target.value)}>
                    <option value="all">All</option>
                    <option value="trainer_set">Trainer set</option>
                    <option value="lesson">Lesson</option>
                    <option value="migrated">Migrated</option>
                  </select>
                </label>
                <label className="assignFilter">
                  <span>When</span>
                  <select value={listWhenFilter} onChange={(e) => setListWhenFilter(e.target.value)}>
                    <option value="upcoming">Upcoming</option>
                    <option value="past">Past</option>
                    <option value="all">All</option>
                  </select>
                </label>
                <button type="button" className="assignGhostBtn" onClick={() => void refreshOccurrences()}>
                  Refresh
                </button>
              </div>
            </div>

            {loading ? <p className="muted">Loading…</p> : null}
            <div className="assignTableWrap">
              <table className="dataTable assignTable">
                <thead>
                  <tr>
                    <th>Assignment</th>
                    <th>Batch</th>
                    <th>Day</th>
                    <th>Due</th>
                    <th>Source</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredOccurrences.map((o) => (
                    <tr key={o.id}>
                      <td>{displayName(o)}</td>
                      <td>{occurrenceBatchLabel(o, batches)}</td>
                      <td>{o.schedule_date || '—'}</td>
                      <td>
                        {formatAssignmentDue({
                          dueAt: o.due_at,
                          scheduleDate: o.schedule_date,
                        })}
                      </td>
                      <td>{o.source || '—'}</td>
                      <td>
                        <button type="button" className="assignGhostBtn" onClick={() => void onCancelOcc(o)}>
                          Cancel
                        </button>
                      </td>
                    </tr>
                  ))}
                  {!loading && !filteredOccurrences.length ? (
                    <tr>
                      <td colSpan={6} className="muted">
                        No set assignments match these filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {tab === 'library' && showLibraryTab ? (
          <div className="assignPane assignLibraryPane">
            <AssignmentsPage
              assignments={assignmentsLibrary}
              showCreatedBy={showCreatedBy}
              libraryCanMutate={libraryCanMutate}
              libraryCanSharePublic={libraryCanSharePublic}
              loadAssignment={loadAssignment}
              createAssignment={createAssignment}
              updateAssignment={updateAssignment}
              deleteAssignment={deleteAssignment}
              uploadAssignmentAsset={uploadAssignmentAsset}
              deleteAssignmentAsset={deleteAssignmentAsset}
              staffUsers={staffUsers}
              onTransferOwner={onTransferOwner}
              embedded
            />
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
