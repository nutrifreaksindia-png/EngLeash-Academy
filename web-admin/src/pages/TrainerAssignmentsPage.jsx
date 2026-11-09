import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';

function displayName(row) {
  return (
    row?.displayLabel ||
    row?.library?.displayLabel ||
    row?.library?.label ||
    row?.library?.title ||
    `Assignment #${row?.library_id || row?.id || ''}`
  );
}

export default function TrainerAssignmentsPage({
  batches = [],
  assignmentsLibrary = [],
  loadTrainerOccurrences,
  loadTrainerResponses,
  setAssignment,
  reviewSubmission,
  loadBatchMembers,
}) {
  const [tab, setTab] = useState('assignments');
  const [batchFilter, setBatchFilter] = useState('');
  const [occurrences, setOccurrences] = useState([]);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');

  // Set form
  const [libSearch, setLibSearch] = useState('');
  const [batchSearch, setBatchSearch] = useState('');
  const [selectedLibs, setSelectedLibs] = useState([]);
  const [selectedBatches, setSelectedBatches] = useState([]);
  const [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueAt, setDueAt] = useState('');
  const [notes, setNotes] = useState('');
  const [allStudents, setAllStudents] = useState(true);
  const [studentIds, setStudentIds] = useState([]);
  const [memberOptions, setMemberOptions] = useState([]);
  const [setting, setSetting] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState('weekly');
  const [recurrenceCount, setRecurrenceCount] = useState(4);

  const refreshList = useCallback(async () => {
    setLoading(true);
    setNotice('');
    try {
      const q = batchFilter ? { batchId: Number(batchFilter) } : {};
      if (tab === 'responses') {
        const rows = await loadTrainerResponses(q);
        setResponses(Array.isArray(rows) ? rows : []);
      } else {
        const rows = await loadTrainerOccurrences(q);
        setOccurrences(Array.isArray(rows) ? rows : []);
      }
    } catch (e) {
      setNotice(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [batchFilter, loadTrainerOccurrences, loadTrainerResponses, tab]);

  useEffect(() => {
    if (tab === 'set') return;
    void refreshList();
  }, [tab, refreshList]);

  useEffect(() => {
    if (allStudents || !selectedBatches.length || !loadBatchMembers) {
      setMemberOptions([]);
      return;
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

  const publishedLibs = useMemo(
    () => (assignmentsLibrary || []).filter((a) => Number(a.is_draft) !== 1),
    [assignmentsLibrary],
  );

  const filteredLibs = useMemo(() => {
    const n = libSearch.toLowerCase().trim();
    if (!n) return publishedLibs;
    return publishedLibs.filter((a) =>
      String(a.displayLabel || a.label || a.title || '')
        .toLowerCase()
        .includes(n),
    );
  }, [publishedLibs, libSearch]);

  const filteredBatches = useMemo(() => {
    const n = batchSearch.toLowerCase().trim();
    if (!n) return batches;
    return (batches || []).filter((b) =>
      String(b.title || b.name || '')
        .toLowerCase()
        .includes(n),
    );
  }, [batches, batchSearch]);

  function toggleId(list, id, setter) {
    const n = Number(id);
    setter(list.includes(n) ? list.filter((x) => x !== n) : [...list, n]);
  }

  async function submitSet(e) {
    e.preventDefault();
    if (!selectedLibs.length || !selectedBatches.length || !day) {
      window.alert('Select at least one assignment, one batch, and a day.');
      return;
    }
    setSetting(true);
    try {
      const recurrence = recurring
        ? {
            frequency: recurrenceFrequency,
            interval: 1,
            count: Number(recurrenceCount) || 1,
            byWeekday: recurrenceFrequency === 'weekly' ? [1, 2, 3, 4, 5] : undefined,
          }
        : null;
      await setAssignment({
        libraryIds: selectedLibs,
        batchIds: selectedBatches,
        day,
        dueAt: dueAt || undefined,
        notes: notes || undefined,
        studentIds: allStudents ? [] : studentIds,
        recurrence,
      });
      window.alert('Assignment set.');
      setSelectedLibs([]);
      setNotes('');
      setRecurring(false);
      setTab('assignments');
    } catch (err) {
      window.alert(err.message || 'Failed to set');
    } finally {
      setSetting(false);
    }
  }

  async function onReview(row) {
    const scoreRaw = window.prompt('Score (number)', row.score != null ? String(row.score) : '');
    if (scoreRaw == null) return;
    const feedback = window.prompt('Feedback', row.feedback || '') ?? '';
    try {
      await reviewSubmission(row.occurrence_id, row.id, {
        score: scoreRaw === '' ? null : Number(scoreRaw),
        feedback,
      });
      void refreshList();
    } catch (e) {
      window.alert(e.message || 'Review failed');
    }
  }

  return (
    <div className="stack">
      <SectionCard title="Assignments" subtitle="Batch homework scheduled from the library">
        <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          {[
            { id: 'assignments', label: 'Assignments' },
            { id: 'responses', label: 'Responses' },
            { id: 'set', label: 'Set an Assignment' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? 'uploadPrimaryBtn' : 'secondaryBtn'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab !== 'set' ? (
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <label>
              Filter by batch{' '}
              <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)}>
                <option value="">All batches</option>
                {(batches || []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title || b.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="secondaryBtn" onClick={() => void refreshList()}>
              Refresh
            </button>
          </div>
        ) : null}

        {notice ? <p className="muted">{notice}</p> : null}
        {loading ? <p className="muted">Loading…</p> : null}

        {tab === 'assignments' && !loading ? (
          <div className="tableWrap">
            <table className="assignmentLibraryTable">
              <thead>
                <tr>
                  <th>Assignment</th>
                  <th>Batch</th>
                  <th>Day</th>
                  <th>Due</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {occurrences.map((o) => (
                  <tr key={o.id}>
                    <td>{displayName(o)}</td>
                    <td>{o.batchName || o.batch_id}</td>
                    <td>{o.schedule_date}</td>
                    <td>{o.due_at || '—'}</td>
                    <td className="muted">{o.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!occurrences.length ? <p className="muted">No scheduled assignments yet.</p> : null}
          </div>
        ) : null}

        {tab === 'responses' && !loading ? (
          <div className="tableWrap">
            <table className="assignmentLibraryTable">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Assignment</th>
                  <th>Batch</th>
                  <th>Status</th>
                  <th>Score</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {responses.map((r) => (
                  <tr key={r.id}>
                    <td>{r.student_name}</td>
                    <td>{r.displayLabel}</td>
                    <td>{r.batchName}</td>
                    <td>{r.review_status || r.status}</td>
                    <td>{r.score != null ? r.score : '—'}</td>
                    <td>
                      <button type="button" className="secondaryBtn" onClick={() => onReview(r)}>
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!responses.length ? <p className="muted">No responses yet.</p> : null}
          </div>
        ) : null}

        {tab === 'set' ? (
          <form className="assignmentEditorForm" onSubmit={submitSet}>
            <div className="courseFormField">
              <label className="fieldLabel">Assignments (search + multiselect)</label>
              <input
                value={libSearch}
                onChange={(e) => setLibSearch(e.target.value)}
                placeholder="Search library"
              />
              <div className="tableWrap" style={{ maxHeight: 200, overflow: 'auto' }}>
                {filteredLibs.map((a) => (
                  <label key={a.id} style={{ display: 'block', padding: '4px 0' }}>
                    <input
                      type="checkbox"
                      checked={selectedLibs.includes(a.id)}
                      onChange={() => toggleId(selectedLibs, a.id, setSelectedLibs)}
                    />{' '}
                    {a.displayLabel || a.label || a.title}{' '}
                    <span className="muted">({a.response_type || 'file'})</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="courseFormField">
              <label className="fieldLabel">Batches</label>
              <input
                value={batchSearch}
                onChange={(e) => setBatchSearch(e.target.value)}
                placeholder="Search batches"
              />
              <div className="tableWrap" style={{ maxHeight: 160, overflow: 'auto' }}>
                {filteredBatches.map((b) => (
                  <label key={b.id} style={{ display: 'block', padding: '4px 0' }}>
                    <input
                      type="checkbox"
                      checked={selectedBatches.includes(b.id)}
                      onChange={() => toggleId(selectedBatches, b.id, setSelectedBatches)}
                    />{' '}
                    {b.title || b.name}
                  </label>
                ))}
              </div>
            </div>

            <div className="row" style={{ gap: 16 }}>
              <div className="courseFormField">
                <label className="fieldLabel">Day</label>
                <input type="date" value={day} onChange={(e) => setDay(e.target.value)} required />
              </div>
              <div className="courseFormField">
                <label className="fieldLabel">Due (optional datetime-local)</label>
                <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </div>
            </div>

            <div className="courseFormField">
              <label className="fieldLabel">
                <input
                  type="checkbox"
                  checked={allStudents}
                  onChange={(e) => setAllStudents(e.target.checked)}
                />{' '}
                All students (default)
              </label>
              {!allStudents ? (
                <div className="tableWrap" style={{ maxHeight: 160, overflow: 'auto' }}>
                  {memberOptions.map((m) => (
                    <label key={`${m.batchId}-${m.id}`} style={{ display: 'block' }}>
                      <input
                        type="checkbox"
                        checked={studentIds.includes(Number(m.id))}
                        onChange={() => toggleId(studentIds, m.id, setStudentIds)}
                      />{' '}
                      {m.name}
                    </label>
                  ))}
                  {!memberOptions.length ? <p className="muted">Select batches to load students.</p> : null}
                </div>
              ) : null}
            </div>

            <div className="courseFormField">
              <label className="fieldLabel">Notes</label>
              <textarea
                className="courseTextarea"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            <div className="courseFormField">
              <label className="fieldLabel">
                <input
                  type="checkbox"
                  checked={recurring}
                  onChange={(e) => setRecurring(e.target.checked)}
                />{' '}
                Recurring (overrides library template when checked)
              </label>
              {recurring ? (
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <select
                    value={recurrenceFrequency}
                    onChange={(e) => setRecurrenceFrequency(e.target.value)}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly (weekdays)</option>
                  </select>
                  <label>
                    Occurrences{' '}
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={recurrenceCount}
                      onChange={(e) => setRecurrenceCount(e.target.value)}
                      style={{ width: 64 }}
                    />
                  </label>
                </div>
              ) : null}
              <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                If unchecked, each library item’s recurrence template (if any) still applies.
              </p>
            </div>

            <button type="submit" className="uploadPrimaryBtn" disabled={setting}>
              {setting ? 'Setting…' : 'Set assignment'}
            </button>
          </form>
        ) : null}
      </SectionCard>
    </div>
  );
}
