import React, { useState } from 'react';

export default function TransferOwnerControl({ itemType, itemId, staffUsers = [], onTransfer, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [toUserId, setToUserId] = useState('');
  const [busy, setBusy] = useState(false);

  if (!onTransfer) return null;

  async function submit(e) {
    e.preventDefault();
    if (!toUserId) return;
    setBusy(true);
    try {
      await onTransfer({ itemType, itemId, toUserId: Number(toUserId) });
      setOpen(false);
      setToUserId('');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="secondaryBtn" disabled={disabled} onClick={() => setOpen(true)}>
        Transfer owner
      </button>
    );
  }

  return (
    <form className="row transferOwnerForm" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
      <select value={toUserId} onChange={(e) => setToUserId(e.target.value)} required disabled={busy}>
        <option value="">Transfer to…</option>
        {(staffUsers || []).map((u) => (
          <option key={u.id} value={u.id}>
            {u.name || u.email} ({u.role})
          </option>
        ))}
      </select>
      <button type="submit" disabled={busy || !toUserId}>
        {busy ? 'Saving…' : 'Confirm'}
      </button>
      <button type="button" className="secondaryBtn" onClick={() => setOpen(false)} disabled={busy}>
        Cancel
      </button>
    </form>
  );
}
