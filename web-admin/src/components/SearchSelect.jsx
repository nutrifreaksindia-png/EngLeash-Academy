import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Searchable single-select (combobox).
 * options: [{ id, label, subLabel? }]
 * value: id | '' | null
 */
export default function SearchSelect({
  label,
  options = [],
  value = '',
  onChange,
  placeholder = 'Search…',
  emptyText = 'No matches',
  allLabel = 'All',
  allowClear = true,
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
    if (value === '' || value == null) return null;
    return options.find((o) => String(o.id) === String(value)) || null;
  }, [options, value]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => {
      const hay = `${o.label || ''} ${o.subLabel || ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [options, q]);

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  return (
    <div className={`smsRoot ${compact ? 'smsCompact' : ''} ${className}`.trim()} ref={rootRef}>
      {label ? <label className="assignFieldLabel">{label}</label> : null}
      <div
        className={`smsControl ${open ? 'smsOpen' : ''}`}
        onClick={() => setOpen(true)}
      >
        <div className="smsChips">
          {selected && !open ? (
            <span className="smsChip">
              <span className="smsChipText">{selected.label}</span>
              {allowClear ? (
                <button
                  type="button"
                  className="smsChipX"
                  aria-label="Clear"
                  onClick={(e) => {
                    e.stopPropagation();
                    onChange('');
                  }}
                >
                  ×
                </button>
              ) : null}
            </span>
          ) : null}
          <input
            className="smsInput"
            value={open ? q : selected ? '' : q}
            placeholder={selected && !open ? '' : placeholder}
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
          {allowClear ? (
            <button
              type="button"
              className={`smsOption ${!selected ? 'smsOptionOn' : ''}`}
              onClick={() => {
                onChange('');
                setOpen(false);
                setQ('');
              }}
            >
              <span className="smsOptionMain">
                <span className="smsOptionLabel">{allLabel}</span>
              </span>
              {!selected ? <span className="smsCheck">✓</span> : null}
            </button>
          ) : null}
          {filtered.length === 0 ? (
            <div className="smsEmpty">{emptyText}</div>
          ) : (
            filtered.map((o) => {
              const on = selected && String(selected.id) === String(o.id);
              return (
                <button
                  key={o.id}
                  type="button"
                  className={`smsOption ${on ? 'smsOptionOn' : ''}`}
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                    setQ('');
                  }}
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
