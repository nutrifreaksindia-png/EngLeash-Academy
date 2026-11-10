import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Compact searchable multi-select with chips.
 * options: [{ id, label, subLabel? }]
 */
export default function SearchMultiSelect({
  label,
  options = [],
  value = [],
  onChange,
  placeholder = 'Search…',
  emptyText = 'No matches',
  compact = false,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const rootRef = useRef(null);

  useEffect(() => {
    function onDoc(e) {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const selected = useMemo(() => {
    const set = new Set(value.map(Number));
    return options.filter((o) => set.has(Number(o.id)));
  }, [options, value]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => {
      const hay = `${o.label || ''} ${o.subLabel || ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [options, q]);

  function toggle(id) {
    const n = Number(id);
    if (value.map(Number).includes(n)) onChange(value.filter((x) => Number(x) !== n));
    else onChange([...value, n]);
  }

  function remove(id) {
    onChange(value.filter((x) => Number(x) !== Number(id)));
  }

  return (
    <div className={`smsRoot ${compact ? 'smsCompact' : ''} ${className}`.trim()} ref={rootRef}>
      {label ? <label className="assignFieldLabel">{label}</label> : null}
      <div className={`smsControl ${open ? 'smsOpen' : ''}`} onClick={() => setOpen(true)}>
        <div className="smsChips">
          {selected.map((o) => (
            <span key={o.id} className="smsChip">
              <span className="smsChipText">{o.label}</span>
              <button
                type="button"
                className="smsChipX"
                aria-label={`Remove ${o.label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  remove(o.id);
                }}
              >
                ×
              </button>
            </span>
          ))}
          <input
            className="smsInput"
            value={q}
            placeholder={selected.length ? '' : placeholder}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
          />
        </div>
      </div>
      {open ? (
        <div className="smsMenu" role="listbox">
          {filtered.length === 0 ? (
            <div className="smsEmpty">{emptyText}</div>
          ) : (
            filtered.map((o) => {
              const on = value.map(Number).includes(Number(o.id));
              return (
                <button
                  key={o.id}
                  type="button"
                  className={`smsOption ${on ? 'smsOptionOn' : ''}`}
                  onClick={() => toggle(o.id)}
                >
                  <span className="smsOptionMain">
                    <span className="smsOptionLabel">{o.label}</span>
                    {o.subLabel ? <span className="smsOptionSub">{o.subLabel}</span> : null}
                  </span>
                  {on ? <span className="smsCheck">✓</span> : null}
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
