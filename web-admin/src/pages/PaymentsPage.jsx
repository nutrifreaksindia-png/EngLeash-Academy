import React from 'react';
import SectionCard from '../components/SectionCard';

function fmtDate(iso) {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function fmtAmount(amountInr, currency = 'INR') {
  const value = Number(amountInr || 0);
  if (String(currency || '').toUpperCase() === 'INR') {
    return `Rs. ${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${String(currency || '').toUpperCase()} ${value.toFixed(2)}`;
}

export default function PaymentsPage({
  loadPayments,
  loadApplyBilling,
  openInvoice,
  recordManualApplyPayment,
  updateApplyPartSchedule,
  pushToast = () => {},
}) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [invoiceBusyId, setInvoiceBusyId] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [paymentKind, setPaymentKind] = React.useState('');
  const [applyRows, setApplyRows] = React.useState([]);
  const [applyLoading, setApplyLoading] = React.useState(true);
  const [applySearch, setApplySearch] = React.useState('');
  const [applyStatus, setApplyStatus] = React.useState('');
  const [manualBusyDueId, setManualBusyDueId] = React.useState(null);
  const [expandedProfileId, setExpandedProfileId] = React.useState(null);
  const [manualForm, setManualForm] = React.useState(null);
  const [scheduleForm, setScheduleForm] = React.useState(null);

  const refreshRows = React.useCallback(async () => {
    try {
      setLoading(true);
      const data = await loadPayments({ search, paymentKind });
      setRows(Array.isArray(data) ? data : []);
    } catch (error) {
      setRows([]);
      pushToast(error?.message || 'Could not load payments', 'error');
    } finally {
      setLoading(false);
    }
  }, [loadPayments, paymentKind, pushToast, search]);

  React.useEffect(() => {
    void refreshRows();
  }, [refreshRows]);

  const refreshApplyRows = React.useCallback(async () => {
    if (!loadApplyBilling) return;
    try {
      setApplyLoading(true);
      const data = await loadApplyBilling({ search: applySearch, status: applyStatus });
      setApplyRows(Array.isArray(data) ? data : []);
    } catch (error) {
      setApplyRows([]);
      pushToast(error?.message || 'Could not load apply billing', 'error');
    } finally {
      setApplyLoading(false);
    }
  }, [applySearch, applyStatus, loadApplyBilling, pushToast]);

  React.useEffect(() => {
    void refreshApplyRows();
  }, [refreshApplyRows]);

  async function handleOpenInvoice(row) {
    if (!row?.id) return;
    try {
      setInvoiceBusyId(row.id);
      await openInvoice(row.id);
    } catch (error) {
      pushToast(error?.message || 'Could not open invoice', 'error');
    } finally {
      setInvoiceBusyId(null);
    }
  }

  function openManualForm(profile, due) {
    if (!due?.id) return;
    setManualForm({
      profileId: profile.id,
      dueId: due.id,
      amountInr: Number(due.amountDueNowInr || 0).toFixed(2),
      paidAt: new Date().toISOString().slice(0, 10),
      referenceText: '',
      noteText: '',
    });
  }

  async function handleManualApplyPayment(event) {
    event.preventDefault();
    const due = manualForm;
    if (!due?.dueId || !recordManualApplyPayment) return;
    try {
      setManualBusyDueId(due.dueId);
      const payment = await recordManualApplyPayment(due.dueId, {
        amountInr: Number(due.amountInr || 0),
        paidAt: due.paidAt,
        referenceText: due.referenceText,
        noteText: due.noteText,
      });
      pushToast('Manual payment recorded', 'success');
      setManualForm(null);
      await Promise.all([refreshRows(), refreshApplyRows()]);
      if (payment?.id) {
        await openInvoice(payment.id);
      }
    } catch (error) {
      pushToast(error?.message || 'Could not record manual payment', 'error');
    } finally {
      setManualBusyDueId(null);
    }
  }

  function openScheduleForm(profile) {
    const unpaid = (profile.dueItems || []).filter((due) => due.dueStatus !== 'paid' && due.dueStatus !== 'cancelled');
    setScheduleForm({
      profileId: profile.id,
      parts: unpaid.length
        ? unpaid.map((due) => ({
            amountInr: Number(due.amountDueNowInr || due.amountInr || 0).toFixed(2),
            dueDate: String(due.dueDate || '').slice(0, 10),
          }))
        : [{ amountInr: Number(profile.remainingBalanceInr || 0).toFixed(2), dueDate: '' }],
    });
  }

  function updateSchedulePart(index, key, value) {
    setScheduleForm((current) => {
      if (!current) return current;
      return {
        ...current,
        parts: current.parts.map((part, i) => (i === index ? { ...part, [key]: value } : part)),
      };
    });
  }

  function setScheduleCount(count) {
    const nextCount = Math.max(1, Number(count || 1));
    setScheduleForm((current) => {
      if (!current) return current;
      const parts = [...current.parts];
      while (parts.length < nextCount) parts.push({ amountInr: '0.00', dueDate: '' });
      return { ...current, parts: parts.slice(0, nextCount) };
    });
  }

  async function submitScheduleForm(event) {
    event.preventDefault();
    if (!scheduleForm || !updateApplyPartSchedule) return;
    try {
      await updateApplyPartSchedule(scheduleForm.profileId, {
        parts: scheduleForm.parts.map((part) => ({
          amountInr: Number(part.amountInr || 0),
          dueDate: part.dueDate,
        })),
      });
      pushToast('Part schedule updated', 'success');
      setScheduleForm(null);
      await refreshApplyRows();
    } catch (error) {
      pushToast(error?.message || 'Could not update part schedule', 'error');
    }
  }

  return (
    <>
      <h1 style={{ margin: '0 0 20px', fontWeight: '800', color: 'var(--ink, #0f172a)' }}>Payments &amp; invoices</h1>
      <SectionCard
        title="Revenue ledger"
        subtitle="Successful purchase, subscription, and apply-course payments with invoice downloads."
        actions={(
          <>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search learner, course, invoice, order..."
              style={{ minWidth: 280 }}
            />
            <select value={paymentKind} onChange={(e) => setPaymentKind(e.target.value)}>
              <option value="">All kinds</option>
              <option value="purchase">Purchase</option>
              <option value="subscribe">Subscribe</option>
              <option value="renewal">Renewal</option>
              <option value="combo">Combo</option>
              <option value="apply_registration">Apply registration</option>
              <option value="apply_single_payment">Apply single payment</option>
              <option value="apply_installment">Apply part payment</option>
            </select>
            <button type="button" className="secondaryBtn" onClick={() => refreshRows()}>
              Refresh
            </button>
          </>
        )}
      >
        {loading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Learner</th>
                  <th>Course / Package</th>
                  <th>Kind</th>
                  <th>Amount</th>
                  <th>Paid on</th>
                  <th>Gateway refs</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div>{row.invoiceNumber || '—'}</div>
                      <div className="muted" style={{ fontSize: '0.82rem' }}>
                        {String(row.status || 'paid').toUpperCase()}
                      </div>
                    </td>
                    <td>
                      <div>{row.customerName || '—'}</div>
                      <div className="muted" style={{ fontSize: '0.82rem' }}>
                        {row.customerEmail || '—'}
                      </div>
                    </td>
                    <td>
                      <div>{row.title || '—'}</div>
                      <div className="muted" style={{ fontSize: '0.82rem' }}>
                        {row.packageLabel || '—'}
                      </div>
                    </td>
                    <td>{row.paymentKind || row.orderKind || '—'}</td>
                    <td>{fmtAmount(row.amountInr, row.currency)}</td>
                    <td>{fmtDate(row.paidAtIso)}</td>
                    <td>
                      <div style={{ maxWidth: 220, wordBreak: 'break-all' }}>{row.gatewayOrderId || '—'}</div>
                      <div className="muted" style={{ maxWidth: 220, wordBreak: 'break-all', fontSize: '0.82rem' }}>
                        {row.gatewayPaymentId || '—'}
                      </div>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="secondaryBtn"
                        disabled={!row.hasInvoice || invoiceBusyId === row.id}
                        onClick={() => handleOpenInvoice(row)}
                      >
                        {invoiceBusyId === row.id ? 'Opening…' : 'Invoice PDF'}
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted">
                      No payment records found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Apply course dues"
        subtitle="Review learner billing state, upcoming dues, and record cash payments against scheduled items."
        actions={(
          <>
            <input
              value={applySearch}
              onChange={(e) => setApplySearch(e.target.value)}
              placeholder="Search learner, course, batch..."
              style={{ minWidth: 260 }}
            />
            <select value={applyStatus} onChange={(e) => setApplyStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="awaiting_initial_payment">Awaiting initial payment</option>
              <option value="pending_approval">Pending approval</option>
              <option value="approved_pending_access">Approved, waiting for batch start</option>
              <option value="active">Active</option>
              <option value="removed_overdue">Removed overdue</option>
              <option value="rejected">Rejected</option>
            </select>
            <button type="button" className="secondaryBtn" onClick={() => refreshApplyRows()}>
              Refresh
            </button>
          </>
        )}
      >
        {applyLoading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Learner</th>
                  <th>Course / batch</th>
                  <th>Plan</th>
                  <th>Status</th>
                  <th>Remaining</th>
                  <th>Next due</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {applyRows.map((row) => {
                  const due = row.nextUnpaidDue;
                  const expanded = expandedProfileId === row.id;
                  return (
                    <React.Fragment key={row.id}>
                    <tr>
                      <td>
                        <div>{row.userName || '—'}</div>
                        <div className="muted" style={{ fontSize: '0.82rem' }}>
                          {row.userEmail || '—'}
                        </div>
                      </td>
                      <td>
                        <div>{row.courseName || '—'}</div>
                        <div className="muted" style={{ fontSize: '0.82rem' }}>
                          {row.batchTitle ? `${row.batchTitle}${row.batchNumber ? ` (#${row.batchNumber})` : ''}` : '—'}
                        </div>
                      </td>
                      <td>{row.selectedPlanLabel || row.selectedPlan || '—'}</td>
                      <td>{row.status || '—'}</td>
                      <td>{fmtAmount(row.remainingBalanceInr, 'INR')}</td>
                      <td>
                        {due ? (
                          <>
                            <div>{due.dueLabel}</div>
                            <div className="muted" style={{ fontSize: '0.82rem' }}>
                              {due.dueDate ? `${fmtDate(due.dueDate)} · ${fmtAmount(due.amountDueNowInr, 'INR')}` : fmtAmount(due.amountDueNowInr, 'INR')}
                            </div>
                            <div className="muted" style={{ fontSize: '0.82rem' }}>
                              {due.dueStatus}
                            </div>
                          </>
                        ) : (
                          'All dues settled'
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="secondaryBtn"
                          onClick={() => setExpandedProfileId(expanded ? null : row.id)}
                        >
                          {expanded ? 'Hide dues' : 'View dues'}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={7}>
                          <div className="stack" style={{ gap: 12 }}>
                            <div className="tableWrap">
                              <table>
                                <thead>
                                  <tr>
                                    <th>Due</th>
                                    <th>Amount</th>
                                    <th>Paid</th>
                                    <th>Due date</th>
                                    <th>Status</th>
                                    <th />
                                  </tr>
                                </thead>
                                <tbody>
                                  {(row.dueItems || []).map((item) => (
                                    <tr key={item.id}>
                                      <td>{item.dueLabel || item.dueKind || '—'}</td>
                                      <td>{fmtAmount(item.amountDueNowInr ?? item.amountInr, 'INR')}</td>
                                      <td>{fmtAmount(item.paidAmountInr, 'INR')}</td>
                                      <td>{item.dueDate || '—'}</td>
                                      <td>{item.dueStatus || 'scheduled'}</td>
                                      <td>
                                        <button
                                          type="button"
                                          className="secondaryBtn"
                                          disabled={item.dueStatus === 'paid' || item.dueStatus === 'cancelled'}
                                          onClick={() => openManualForm(row, item)}
                                        >
                                          Record partial
                                        </button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            <div>
                              <button
                                type="button"
                                className="secondaryBtn"
                                disabled={!updateApplyPartSchedule || row.status !== 'active'}
                                onClick={() => openScheduleForm(row)}
                              >
                                Edit parts
                              </button>
                              {row.status !== 'active' ? (
                                <span className="muted" style={{ marginLeft: 8 }}>
                                  Available after the batch has started.
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </React.Fragment>
                  );
                })}
                {applyRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      No apply-course billing records found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
      {manualForm ? (
        <div className="modalOverlay">
          <form className="modalCard stack" onSubmit={handleManualApplyPayment}>
            <h2>Record partial payment</h2>
            <label>
              Amount paid (INR)
              <input
                type="number"
                min="1"
                step="0.01"
                value={manualForm.amountInr}
                onChange={(e) => setManualForm((f) => ({ ...f, amountInr: e.target.value }))}
              />
            </label>
            <label>
              Payment date
              <input
                type="date"
                value={manualForm.paidAt}
                onChange={(e) => setManualForm((f) => ({ ...f, paidAt: e.target.value }))}
              />
            </label>
            <label>
              Reference number
              <input
                value={manualForm.referenceText}
                onChange={(e) => setManualForm((f) => ({ ...f, referenceText: e.target.value }))}
              />
            </label>
            <label>
              Notes
              <textarea
                value={manualForm.noteText}
                onChange={(e) => setManualForm((f) => ({ ...f, noteText: e.target.value }))}
              />
            </label>
            <div>
              <button type="submit" className="primaryBtn" disabled={manualBusyDueId === manualForm.dueId}>
                {manualBusyDueId === manualForm.dueId ? 'Recording…' : 'Record payment'}
              </button>{' '}
              <button type="button" className="secondaryBtn" onClick={() => setManualForm(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
      {scheduleForm ? (
        <div className="modalOverlay">
          <form className="modalCard stack" onSubmit={submitScheduleForm}>
            <h2>Edit part schedule</h2>
            <label>
              Number of parts
              <input
                type="number"
                min="1"
                value={scheduleForm.parts.length}
                onChange={(e) => setScheduleCount(e.target.value)}
              />
            </label>
            {scheduleForm.parts.map((part, index) => (
              <div key={index} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  Part {index + 1} amount (INR)
                  <input
                    type="number"
                    min="1"
                    step="0.01"
                    value={part.amountInr}
                    onChange={(e) => updateSchedulePart(index, 'amountInr', e.target.value)}
                  />
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    value={part.dueDate}
                    onChange={(e) => updateSchedulePart(index, 'dueDate', e.target.value)}
                  />
                </label>
              </div>
            ))}
            <div>
              <button type="submit" className="primaryBtn">
                Save parts
              </button>{' '}
              <button type="button" className="secondaryBtn" onClick={() => setScheduleForm(null)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
