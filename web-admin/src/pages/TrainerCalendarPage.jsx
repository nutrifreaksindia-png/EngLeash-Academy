import React, { useEffect, useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfWeek(d) {
  const x = new Date(d);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function parseWhen(row) {
  const start = row.live_starts_at || row.starts_at;
  const end = row.live_ends_at || row.ends_at;
  const startMs = start ? new Date(start).getTime() : NaN;
  const endMs = end ? new Date(end).getTime() : NaN;
  return { startMs, endMs };
}

function timeLabel(value) {
  if (!value) return '';
  const s = String(value);
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return s;
}

export default function TrainerCalendarPage({ loadSessions, holidays = [], onOpenBatch }) {
  const [anchor, setAnchor] = useState(() => startOfWeek(new Date()));
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor]);
  const from = ymd(days[0]);
  const to = ymd(days[6]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const data = await loadSessions(from, to);
        if (!cancelled) setRows(Array.isArray(data) ? data : []);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Could not load calendar');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const holidaySet = useMemo(
    () => new Set((holidays || []).map((h) => h.holiday_date || h.holidayDate).filter(Boolean)),
    [holidays],
  );

  const clashIds = useMemo(() => {
    const ids = new Set();
    const timed = rows
      .filter((r) => r.status !== 'cancelled')
      .map((r) => ({ r, ...parseWhen(r) }))
      .filter((x) => Number.isFinite(x.startMs) && Number.isFinite(x.endMs));
    for (let i = 0; i < timed.length; i += 1) {
      for (let j = i + 1; j < timed.length; j += 1) {
        const a = timed[i];
        const b = timed[j];
        if (a.startMs < b.endMs && b.startMs < a.endMs) {
          ids.add(a.r.id);
          ids.add(b.r.id);
        }
      }
    }
    return ids;
  }, [rows]);

  const byDate = useMemo(() => {
    const map = {};
    rows.forEach((r) => {
      const key = r.session_date;
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    return map;
  }, [rows]);

  return (
    <div className="stack">
      <SectionCard
        title="Calendar"
        subtitle={`${from} → ${to}. Overlapping sessions are highlighted.`}
        actions={
          <>
            <button type="button" className="secondaryBtn" onClick={() => setAnchor(addDays(anchor, -7))}>
              Previous week
            </button>
            <button type="button" className="secondaryBtn" onClick={() => setAnchor(startOfWeek(new Date()))}>
              This week
            </button>
            <button type="button" className="secondaryBtn" onClick={() => setAnchor(addDays(anchor, 7))}>
              Next week
            </button>
          </>
        }
      >
        {loading ? <p className="muted">Loading…</p> : null}
        {error ? <p className="muted">{error}</p> : null}
        <div className="trainerCalGrid">
          {days.map((d) => {
            const key = ymd(d);
            const isHoliday = holidaySet.has(key);
            return (
              <div key={key} className={`trainerCalDay ${isHoliday ? 'holiday' : ''}`}>
                <div className="trainerCalDayHead">
                  <strong>
                    {d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </strong>
                  {isHoliday ? <span className="badge inactive">Holiday</span> : null}
                </div>
                {(byDate[key] || []).map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={`trainerCalEvent ${clashIds.has(s.id) ? 'clash' : ''} ${s.status === 'cancelled' ? 'cancelled' : ''}`}
                    onClick={() => onOpenBatch?.(s.batch_id)}
                  >
                    <span>{timeLabel(s.starts_at) || '—'}</span>
                    <span>{s.batch_title || s.batch_name}</span>
                    <span className="muted">{s.lesson_title || `Day ${s.session_day}`}</span>
                    {clashIds.has(s.id) ? <span className="trainerCalClash">Clash</span> : null}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
