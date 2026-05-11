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

export default function PaymentsPage({ loadPayments, openInvoice, pushToast = () => {} }) {
  const [rows, setRows] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [invoiceBusyId, setInvoiceBusyId] = React.useState(null);
  const [search, setSearch] = React.useState('');
  const [paymentKind, setPaymentKind] = React.useState('');

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

  return (
    <>
      <h1 style={{ margin: '0 0 20px', fontWeight: '800', color: 'var(--ink, #0f172a)' }}>Payments &amp; invoices</h1>
      <SectionCard
        title="Revenue ledger"
        subtitle="Successful purchase and subscription payments with invoice downloads."
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
    </>
  );
}
