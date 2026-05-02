import React, { useEffect } from 'react';

export default function Modal({ open, title, onClose, children, variant = 'modal' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  const cardClass = variant === 'drawer' ? 'modalCard drawerCard' : 'modalCard';
  const overlayClass = variant === 'drawer' ? 'modalOverlay drawerOverlay' : 'modalOverlay';
  return (
    <div className={overlayClass} onClick={onClose}>
      <div className={cardClass} onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <h3>{title}</h3>
          <button className="secondaryBtn" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
