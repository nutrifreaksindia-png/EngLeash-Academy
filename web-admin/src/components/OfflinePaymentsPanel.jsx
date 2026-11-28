import React from 'react';
import SectionCard from './SectionCard';
import SearchSelect from './SearchSelect';

export const METHOD_OPTIONS = [
  ['cash', 'Cash'],
  ['bank_transfer', 'Bank transfer'],
  ['upi', 'UPI'],
  ['other', 'Other'],
];

const METHOD_LABELS = { ...Object.fromEntries(METHOD_OPTIONS), razorpay: 'Razorpay' };
const STATUS_LABELS = { paid: 'Paid', partial: 'Partially paid', pending: 'Pending', no_fee: 'No fee set' };

/** One key per form fill, so a double submit or retry cannot record the same payment twice. */
export function newRequestKey() {
  return `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const money = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN')}`;
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const emptyForm = () => ({
  amountInr: '',
  method: 'cash',
  paidAt: today(),
  batchId: '',
  referenceText: '',
  noteText: '',
  requestKey: newRequestKey(),
});

export default function OfflinePaymentsPanel({ students, courses, batches, api, onRecorded, onOpenInvoice, pushToast: toast }) {
  // The parent recreates this callback on every render; a stable wrapper keeps the form from being reset.
  const toastRef = React.useRef(toast);
  toastRef.current = toast;
  const pushToast = React.useCallback((...args) => toastRef.current?.(...args), []);
  const [studentId, setStudentId] = React.useState('');
  const [courseId, setCourseId] = React.useState('');
  const [statement, setStatement] = React.useState(null);
  const [account, setAccount] = React.useState(null);
  const [feeInput, setFeeInput] = React.useState('');
  const [form, setForm] = React.useState(emptyForm);
  const [busy, setBusy] = React.useState(false);
  const apiRef = React.useRef(api);
  apiRef.current = api;
  const selectionRef = React.useRef('');
  selectionRef.current = `${studentId}:${courseId}`;

  const refresh = React.useCallback(async () => {
    const selection = `${studentId}:${courseId}`;
    if (!studentId) {
      setStatement(null);
      setAccount(null);
      return;
    }
    try {
      const [nextStatement, nextAccount] = await Promise.all([
        apiRef.current.statement(studentId),
        courseId ? apiRef.current.account(studentId, courseId) : Promise.resolve(null),
      ]);
      if (selectionRef.current !== selection) return;
      setStatement(nextStatement);
      setAccount(nextAccount);
      setFeeInput(nextAccount ? String(nextAccount.feePaise / 100) : '');
    } catch (error) {
      pushToast(error?.message || 'Could not load student payments', 'error');
    }
  }, [studentId, courseId, pushToast]);

  React.useEffect(() => {
    setStatement(null);
    setAccount(null);
    setForm(emptyForm());
    void refresh();
  }, [refresh]);

  const courseBatches = (batches || []).filter((b) => String(b.course_id) === String(courseId));
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function saveFee() {
    try {
      setBusy(true);
      await api.setFee(studentId, courseId, feeInput);
      pushToast('Agreed fee saved', 'success');
      await refresh();
    } catch (error) {
      pushToast(error?.message || 'Could not save fee', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    try {
      setBusy(true);
      const result = await api.record({
        ...form,
        userId: Number(studentId),
        courseId: Number(courseId),
        batchId: form.batchId || null,
        amountInr: Number(form.amountInr),
      });
      pushToast(result?.duplicate ? 'This payment was already recorded' : 'Payment recorded', 'success');
      setForm(emptyForm());
      await Promise.all([refresh(), onRecorded?.()]);
    } catch (error) {
      pushToast(error?.message || 'Could not record payment', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Student payments (offline)"
      subtitle="Record cash, bank transfer or UPI payments. This does not change course access; add students to batches from Batches."
    >
      <div className="stack" style={{ gap: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
          <SearchSelect
            label="Student"
            value={studentId}
            onChange={(id) => setStudentId(id || '')}
            allLabel="Select student"
            placeholder="Search name or email…"
            options={(students || []).map((u) => ({ id: u.id, label: u.name || u.email, subLabel: u.email }))}
          />
          <SearchSelect
            label="Course"
            value={courseId}
            onChange={(id) => setCourseId(id || '')}
            allLabel="Select course"
            placeholder="Search course…"
            options={(courses || []).map((c) => ({ id: c.id, label: c.name }))}
          />
        </div>

        {statement?.accounts?.length ? (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Course</th>
                  <th>Course fee</th>
                  <th>Paid</th>
                  <th>Outstanding</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {statement.accounts.map((a) => (
                  <tr key={a.courseId}>
                    <td>
                      <button type="button" className="secondaryBtn" onClick={() => setCourseId(String(a.courseId))}>
                        {a.courseName}
                      </button>
                    </td>
                    <td>{money(a.feePaise)}</td>
                    <td>{money(a.paidPaise)}</td>
                    <td>{money(a.outstandingPaise)}</td>
                    <td>{STATUS_LABELS[a.status] || a.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {account ? (
          <p style={{ margin: 0 }}>
            <strong>{account.courseName}:</strong> fee {money(account.feePaise)} · paid {money(account.paidPaise)} · outstanding{' '}
            {money(account.outstandingPaise)} · {STATUS_LABELS[account.status] || account.status}
          </p>
        ) : null}

        {account?.applyPlanId ? (
          <p className="muted">This student has an apply payment plan for this course. Record payments under Apply course dues below.</p>
        ) : null}

        {account && !account.applyPlanId ? (
          <>
            <div className="row">
              <label>
                Agreed course fee (INR)
                <input type="number" min="0" step="0.01" value={feeInput} onChange={(e) => setFeeInput(e.target.value)} />
              </label>
              <button type="button" className="secondaryBtn" onClick={saveFee} disabled={busy || feeInput === ''}>
                Save fee
              </button>
            </div>
            {account.outstandingPaise > 0 ? (
              <form className="stack" onSubmit={submit}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                  <label>
                    Amount received (INR)
                    <input type="number" min="1" step="0.01" required value={form.amountInr} onChange={set('amountInr')} />
                  </label>
                  <label>
                    Payment method
                    <select value={form.method} onChange={set('method')}>
                      {METHOD_OPTIONS.map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Payment date
                    <input type="date" required max={today()} value={form.paidAt} onChange={set('paidAt')} />
                  </label>
                  <label>
                    Batch (optional)
                    <select value={form.batchId} onChange={set('batchId')}>
                      <option value="">No batch</option>
                      {courseBatches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.title || b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Reference / transaction ID
                    <input value={form.referenceText} onChange={set('referenceText')} />
                  </label>
                  <label>
                    Remarks
                    <input value={form.noteText} onChange={set('noteText')} />
                  </label>
                </div>
                <div>
                  <button type="submit" className="primaryBtn" disabled={busy}>
                    {busy ? 'Recording…' : 'Record payment'}
                  </button>
                </div>
              </form>
            ) : null}
          </>
        ) : null}

        {statement ? (
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Course</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Remarks</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {statement.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{String(p.paidAtIso || '').slice(0, 10)}</td>
                    <td>{p.title}</td>
                    <td>{money(p.amountPaise)}</td>
                    <td>{METHOD_LABELS[p.paymentMethod] || p.paymentMethod}</td>
                    <td style={{ wordBreak: 'break-all' }}>{p.reference || '—'}</td>
                    <td>{p.remarks || '—'}</td>
                    <td>
                      {p.hasInvoice ? (
                        <button type="button" className="secondaryBtn" onClick={() => onOpenInvoice(p)}>
                          Invoice PDF
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {statement.payments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      No payments recorded for this student.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
