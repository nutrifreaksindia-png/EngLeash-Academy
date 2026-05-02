import React from 'react';

export default function ToastStack({ toasts }) {
  if (!toasts?.length) return null;
  return (
    <div className="toastStack">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type || 'info'}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
