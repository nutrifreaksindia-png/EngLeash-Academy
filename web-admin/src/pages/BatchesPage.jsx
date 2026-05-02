import React from 'react';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';

export default function BatchesPage({
  onCreateBatch,
  batches,
  users,
  selectedBatchId,
  setSelectedBatchId,
  onStartBatch,
  onLoadSessions,
  onCancelSession,
  batchMembers,
  batchTrainers,
  onAddBatchMember,
  onRemoveBatchMember,
  onAddBatchTrainer,
  onRemoveBatchTrainer,
  cancelAuditRows,
  batchSessions,
}) {
  const [cancelOpen, setCancelOpen] = React.useState(false);
  const [cancelSessionId, setCancelSessionId] = React.useState(null);
  const [cancelReason, setCancelReason] = React.useState('');
  const [sessionPage, setSessionPage] = React.useState(1);
  const [auditPage, setAuditPage] = React.useState(1);
  const pageSize = 25;
  const sessionTotalPages = Math.max(1, Math.ceil((batchSessions || []).length / pageSize));
  const auditTotalPages = Math.max(1, Math.ceil((cancelAuditRows || []).length / pageSize));
  const visibleSessions = (batchSessions || []).slice((sessionPage - 1) * pageSize, sessionPage * pageSize);
  const visibleAudit = (cancelAuditRows || []).slice((auditPage - 1) * pageSize, auditPage * pageSize);
  const [newStudentId, setNewStudentId] = React.useState('');
  const [newTrainerId, setNewTrainerId] = React.useState('');
  const studentUsers = (users || []).filter((u) => u.role === 'Student' || u.role === 'Lab');
  const trainerUsers = (users || []).filter((u) => u.role === 'Trainer');
  React.useEffect(() => {
    if (sessionPage > sessionTotalPages) setSessionPage(sessionTotalPages);
  }, [sessionPage, sessionTotalPages]);
  React.useEffect(() => {
    if (auditPage > auditTotalPages) setAuditPage(auditTotalPages);
  }, [auditPage, auditTotalPages]);

  function openCancelDialog(sessionId) {
    setCancelSessionId(sessionId);
    setCancelReason('');
    setCancelOpen(true);
  }

  async function confirmCancel() {
    if (!cancelSessionId || !cancelReason.trim()) return;
    await onCancelSession(cancelSessionId, cancelReason.trim());
    setCancelOpen(false);
    setCancelSessionId(null);
    setCancelReason('');
  }

  return (
    <div className="stack">
      <SectionCard title="Create Batch" subtitle="Set schedule and connect to course">
        <form onSubmit={onCreateBatch} className="formGrid">
          <input name="title" placeholder="Batch title" required />
          <select name="batchType" defaultValue="group"><option value="group">group</option><option value="one_to_one">one_to_one</option></select>
          <input name="courseId" placeholder="Course ID" required />
          <input name="plannedStartDate" type="date" />
          <input name="startTime" placeholder="09:00" />
          <input name="endTime" placeholder="10:00" />
          <input name="daysOfWeek" placeholder="Mon,Tue,Wed,Thu,Fri" />
          <textarea name="notes" placeholder="Notes" />
          <button type="submit">Create Batch</button>
        </form>
      </SectionCard>

      <SectionCard title="Schedule Operations" subtitle="Generate and inspect sessions">
        <div className="row">
          <select value={selectedBatchId} onChange={(e) => setSelectedBatchId(e.target.value)}>
            <option value="">Select batch</option>
            {batches.map((b) => <option key={b.id} value={b.id}>{b.title || b.name}</option>)}
          </select>
          <button onClick={onStartBatch}>Start Batch</button>
          <button className="secondaryBtn" onClick={onLoadSessions}>Load Sessions</button>
        </div>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Day</th><th>Date</th><th>Lesson</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {visibleSessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.session_day}</td>
                  <td>{s.session_date}</td>
                  <td>{s.lesson_title}</td>
                  <td><span className={`badge ${s.status}`}>{s.status}</span></td>
                  <td>
                    {s.status === 'scheduled' ? (
                      <button className="dangerBtn" onClick={() => openCancelDialog(s.id)}>Cancel</button>
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button className="secondaryBtn" onClick={() => setSessionPage((p) => Math.max(1, p - 1))} disabled={sessionPage <= 1}>Prev</button>
          <span className="muted">Page {sessionPage} of {sessionTotalPages}</span>
          <button className="secondaryBtn" onClick={() => setSessionPage((p) => Math.min(sessionTotalPages, p + 1))} disabled={sessionPage >= sessionTotalPages}>Next</button>
        </div>
      </SectionCard>
      <SectionCard title="Batch Assignment" subtitle="Assign students and trainers to selected batch">
        {!selectedBatchId ? (
          <p className="muted">Select a batch first.</p>
        ) : (
          <div className="stack">
            <div className="row">
              <select value={newStudentId} onChange={(e) => setNewStudentId(e.target.value)}>
                <option value="">Select student/lab</option>
                {studentUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
              <button onClick={() => { onAddBatchMember(newStudentId); setNewStudentId(''); }} disabled={!newStudentId}>Add Student</button>
            </div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Action</th></tr></thead>
                <tbody>
                  {(batchMembers || []).map((m) => (
                    <tr key={m.user_id}>
                      <td>{m.name}</td>
                      <td>{m.email}</td>
                      <td>{m.role}</td>
                      <td><button className="dangerBtn" onClick={() => onRemoveBatchMember(m.user_id)}>Remove</button></td>
                    </tr>
                  ))}
                  {(!batchMembers || batchMembers.length === 0) ? <tr><td colSpan={4} className="muted">No students assigned.</td></tr> : null}
                </tbody>
              </table>
            </div>

            <div className="row">
              <select value={newTrainerId} onChange={(e) => setNewTrainerId(e.target.value)}>
                <option value="">Select trainer</option>
                {trainerUsers.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
              <button onClick={() => { onAddBatchTrainer(newTrainerId); setNewTrainerId(''); }} disabled={!newTrainerId}>Add Trainer</button>
            </div>
            <div className="tableWrap">
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Action</th></tr></thead>
                <tbody>
                  {(batchTrainers || []).map((t) => (
                    <tr key={t.user_id}>
                      <td>{t.name}</td>
                      <td>{t.email}</td>
                      <td><button className="dangerBtn" onClick={() => onRemoveBatchTrainer(t.user_id)}>Remove</button></td>
                    </tr>
                  ))}
                  {(!batchTrainers || batchTrainers.length === 0) ? <tr><td colSpan={3} className="muted">No trainers assigned.</td></tr> : null}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>
      <SectionCard title="Cancellation Audit" subtitle="Recent cancelled sessions with reason">
        {!selectedBatchId ? <p className="muted">Select a batch to view audit trail.</p> : null}
        <div className="tableWrap">
          <table>
            <thead><tr><th>Day</th><th>Date</th><th>Lesson</th><th>Reason</th><th>Cancelled By</th><th>Updated</th></tr></thead>
            <tbody>
              {visibleAudit.map((r) => (
                <tr key={r.id}>
                  <td>{r.session_day}</td>
                  <td>{r.session_date}</td>
                  <td>{r.lesson_title}</td>
                  <td>{r.cancellation_reason || '-'}</td>
                  <td>{r.cancelled_by_name || r.cancelled_by_email || '-'}</td>
                  <td>{r.updated_at || '-'}</td>
                </tr>
              ))}
              {selectedBatchId && (!cancelAuditRows || cancelAuditRows.length === 0) ? (
                <tr><td colSpan={6} className="muted">No cancellations found.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button className="secondaryBtn" onClick={() => setAuditPage((p) => Math.max(1, p - 1))} disabled={auditPage <= 1}>Prev</button>
          <span className="muted">Page {auditPage} of {auditTotalPages}</span>
          <button className="secondaryBtn" onClick={() => setAuditPage((p) => Math.min(auditTotalPages, p + 1))} disabled={auditPage >= auditTotalPages}>Next</button>
        </div>
      </SectionCard>
      <Modal open={cancelOpen} title="Cancel Scheduled Session" onClose={() => setCancelOpen(false)}>
        <div className="stack">
          <p className="muted">Provide a reason. This will carry forward remaining session order.</p>
          <textarea
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Reason for cancellation"
          />
          <div className="row">
            <button className="dangerBtn" onClick={confirmCancel} disabled={!cancelReason.trim()}>Confirm Cancel</button>
            <button className="secondaryBtn" onClick={() => setCancelOpen(false)}>Close</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
