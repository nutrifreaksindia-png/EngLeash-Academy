import React from 'react';
import SectionCard from '../components/SectionCard';

function fmtLocal(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function durationCell(row) {
  if (row.isLifetime) return 'Lifetime / full access';
  const u = String(row.durationUnit || '').toLowerCase();
  const c = Number(row.durationCount);
  const part =
    !Number.isFinite(c) || c < 1
      ? '—'
      : u === 'day'
        ? `${c} day(s)`
        : u === 'year'
          ? `${c} yr`
          : `${c} mo`;
  return `${part}${row.packageKind ? ` (${row.packageKind})` : ''}`;
}

export default function SubscriptionsPage({ loadSubscriptions, onDeleteGrant }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [deletingId, setDeletingId] = React.useState(null);

  async function refreshRows() {
    try {
      const data = typeof loadSubscriptions === 'function' ? await loadSubscriptions() : [];
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    }
  }

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = typeof loadSubscriptions === 'function' ? await loadSubscriptions() : [];
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete(row) {
    if (!onDeleteGrant) return;
    const id = row?.id;
    if (id == null) return;
    const who = row.userName || row.userEmail || 'this learner';
    const course = row.courseName || `course #${row.courseId}`;
    if (
      !window.confirm(
        `Remove this access window for ${who} on ${course}?\n\nThis revokes the entitlement row; the user may lose course access if they had no other grant.`,
      )
    ) {
      return;
    }
    setDeletingId(id);
    try {
      await onDeleteGrant(id);
      await refreshRows();
    } catch {
      /* toast in App */
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <h1 style={{ margin: '0 0 20px', fontWeight: '800', color: 'var(--ink, #0f172a)' }}>Subscriptions &amp; access</h1>
      <SectionCard title="Granted access windows (students &amp; paid plans)">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Course</th>
                  <th>Source</th>
                  <th>Package</th>
                  <th>Batch</th>
                  <th>Starts</th>
                  <th>Ends</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div>{r.userName || '—'}</div>
                      <div className="muted" style={{ fontSize: '0.85rem' }}>
                        {r.userEmail || '—'}
                      </div>
                    </td>
                    <td>{r.courseName || r.courseId}</td>
                    <td>{r.sourceLabel || r.source}</td>
                    <td>{durationCell(r)}</td>
                    <td>
                      {r.batchTitle
                        ? `${r.batchTitle}${r.batchNumber != null ? ` (#${r.batchNumber})` : ''}`
                        : '—'}
                    </td>
                    <td>{fmtLocal(r.startsAtIso)}</td>
                    <td>{r.isLifetime ? '∞' : fmtLocal(r.endsAtIso)}</td>
                    <td>
                      {onDeleteGrant ? (
                        <button
                          type="button"
                          className="dangerBtn"
                          disabled={deletingId === r.id}
                          onClick={() => handleDelete(r)}
                        >
                          {deletingId === r.id ? 'Removing…' : 'Delete'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted">
                      No subscription records yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
