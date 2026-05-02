import React, { useEffect, useRef, useState } from 'react';

export default function ActionMenu({ children }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="actionMenu" ref={rootRef}>
      <button type="button" className="actionMenuBtn" onClick={() => setOpen((v) => !v)}>⋯</button>
      {open ? <div className="actionMenuList" onClick={() => setOpen(false)}>{children}</div> : null}
    </div>
  );
}
