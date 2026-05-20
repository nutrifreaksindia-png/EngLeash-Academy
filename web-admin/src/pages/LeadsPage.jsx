import React from 'react';
import SectionCard from '../components/SectionCard';

const SLOT_LABELS = {
  '10-11': '10:00 a.m. – 11:00 a.m.',
  '11-12': '11:00 a.m. – 12:00 p.m.',
  '12-13': '12:00 p.m. – 1:00 p.m.',
  '15-16': '3:00 p.m. – 4:00 p.m.',
  '16-17': '4:00 p.m. – 5:00 p.m.',
  '17-18': '5:00 p.m. – 6:00 p.m.',
  '18-19': '6:00 p.m. – 7:00 p.m.',
};

function slotLabel(id) {
  return SLOT_LABELS[id] || id || '—';
}

function batchLabel(row) {
  if (row.batch_id == null) return '— (no batch yet)';
  const num = row.batch_number != null ? `#${row.batch_number}` : '';
  const title = row.batch_title || row.batch_name || '';
  return [num, title].filter(Boolean).join(' ') || `Batch ${row.batch_id}`;
}

export default function LeadsPage({ leads = [], onUpdateStatus, onDeleteLead }) {
  const [busyId, setBusyId] = React.useState(null);

  async function setStatus(id, status) {
    setBusyId(id);
    try {
      await onUpdateStatus(id, status);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteLead(row) {
    const name = row.display_name || row.user_account_name || row.user_email || `Lead #${row.id}`;
    const course = row.course_name || 'this course';
    if (
      !window.confirm(
        `Delete callback request from ${name} for ${course}?\n\nThis removes the lead and callback details only. The student account and billing are not affected.`,
      )
    ) {
      return;
    }
    setBusyId(row.id);
    try {
      await onDeleteLead(row.id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SectionCard title="Leads" subtitle="Callback requests from apply-course enquiries (mobile & web learners)">
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Course</th>
              <th>Batch</th>
              <th>Account</th>
              <th>Callback name</th>
              <th>Phone</th>
              <th>Preferred date</th>
              <th>Slot</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan="10" className="muted">No enquiries yet.</td>
              </tr>
            ) : (
              leads.map((row) => (
                <tr key={row.id}>
                  <td>{row.created_at || '—'}</td>
                  <td>{row.course_name || '—'}</td>
                  <td>{batchLabel(row)}</td>
                  <td>
                    <div>{row.user_account_name || '—'}</div>
                    <div className="muted" style={{ fontSize: '0.82rem' }}>{row.user_email || ''}</div>
                  </td>
                  <td>{row.display_name || '—'}</td>
                  <td>
                    {row.phone_country_code || ''} {row.phone_local || ''}
                  </td>
                  <td>{row.callback_date || '—'}</td>
                  <td>{slotLabel(row.callback_slot)}</td>
                  <td>{row.status || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {row.status !== 'contacted' ? (
                        <button
                          type="button"
                          className="secondaryBtn"
                          disabled={busyId === row.id}
                          onClick={() => void setStatus(row.id, 'contacted')}
                        >
                          Mark contacted
                        </button>
                      ) : null}
                      {row.status !== 'closed' ? (
                        <button
                          type="button"
                          className="secondaryBtn"
                          disabled={busyId === row.id}
                          onClick={() => void setStatus(row.id, 'closed')}
                        >
                          Close
                        </button>
                      ) : null}
                      {row.status !== 'open' ? (
                        <button
                          type="button"
                          className="secondaryBtn"
                          disabled={busyId === row.id}
                          onClick={() => void setStatus(row.id, 'open')}
                        >
                          Reopen
                        </button>
                      ) : null}
                      {onDeleteLead ? (
                        <button
                          type="button"
                          className="dangerBtn"
                          disabled={busyId === row.id}
                          onClick={() => void deleteLead(row)}
                        >
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
