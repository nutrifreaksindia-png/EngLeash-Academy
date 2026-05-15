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

  async function handleManualApplyPayment(profile) {
    const due = profile?.nextUnpaidDue;
    if (!due?.id || !recordManualApplyPayment) return;
    const ref = window.prompt('Optional cash reference / receipt number', '') || '';
    try {
      setManualBusyDueId(due.id);
      const payment = await recordManualApplyPayment(due.id, { referenceText: ref });
      pushToast('Manual payment recorded', 'success');
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
              <option value="apply_installment">Apply installment</option>
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
                  return (
                    <tr key={row.id}>
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
                          disabled={!due || due.dueStatus === 'paid' || manualBusyDueId === due.id}
                          onClick={() => handleManualApplyPayment(row)}
                        >
                          {due && manualBusyDueId === due.id ? 'Recording…' : 'Record cash'}
                        </button>
                      </td>
                    </tr>
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
    </>
  );
}
