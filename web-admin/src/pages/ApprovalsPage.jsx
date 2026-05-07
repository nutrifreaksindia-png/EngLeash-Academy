import React from 'react';
import SectionCard from '../components/SectionCard';

export default function ApprovalsPage({
  pendingApplications = [],
  fetchOpenBatchesForCourse,
  onApproveApplication,
  onDisapproveApplication,
}) {
  const [batchOptionsByCourse, setBatchOptionsByCourse] = React.useState({});
  const [pickByApplication, setPickByApplication] = React.useState({});

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      const ids = [...new Set((pendingApplications || []).map((x) => x.course_id).filter(Boolean))];
      const next = {};
      for (const cid of ids) {
        try {
          const rows = await fetchOpenBatchesForCourse(cid);
          next[cid] = Array.isArray(rows) ? rows : [];
        } catch {
          next[cid] = [];
        }
      }
      if (!cancelled) setBatchOptionsByCourse(next);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [pendingApplications, fetchOpenBatchesForCourse]);

  async function approve(app) {
    const picked = pickByApplication[app.id];
    await onApproveApplication(app.id, picked || app.batch_id || null);
  }

  return (
    <SectionCard title="Pending Applications" subtitle="Approve/disapprove student applications and place students into a batch">
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Student</th><th>Course</th><th>Requested batch</th><th>Requested at</th><th>Change batch</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pendingApplications.length === 0 ? (
              <tr><td colSpan="6" className="muted">No pending applications</td></tr>
            ) : pendingApplications.map((app) => (
              <tr key={app.id}>
                <td>{app.user_name || app.user_email}</td>
                <td>{app.course_name}</td>
                <td>{app.requested_batch_number ? `Batch ${app.requested_batch_number}` : (app.requested_batch_title || '—')}</td>
                <td>{app.requested_at || '—'}</td>
                <td>
                  <select
                    value={pickByApplication[app.id] || app.batch_id || ''}
                    onChange={(e) => setPickByApplication((prev) => ({ ...prev, [app.id]: e.target.value ? Number(e.target.value) : null }))}
                  >
                    <option value="">Select batch</option>
                    {(batchOptionsByCourse[app.course_id] || []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {`#${b.batch_number || b.id} ${b.title || b.name} (${b.session_type === 'one_to_one' ? '1:1' : 'Group'})`}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className="row">
                    <button onClick={() => void approve(app)}>Approve</button>
                    <button className="dangerBtn" onClick={() => void onDisapproveApplication(app.id)}>Disapprove</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
