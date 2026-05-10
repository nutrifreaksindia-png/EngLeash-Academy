import React from 'react';

export default function ToastStack({ toasts }) {
  const visible = (toasts || []).filter((t) => String(t.text ?? '').trim());
  if (!visible.length) return null;
  return (
    <div className="toastStack">
      {visible.map((t) => (
        <div key={t.id} className={`toast ${t.type || 'info'}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
