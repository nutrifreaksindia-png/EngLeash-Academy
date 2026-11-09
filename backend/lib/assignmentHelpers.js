const { addDaysYmd, academyToday } = require('./academyDate');

const RESPONSE_TYPES = ['text', 'image', 'video', 'file', 'voice', 'other'];

function parseJsonSafe(raw, fallback = null) {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** List label without relying on title/description fields. */
function derivedAssignmentLabel(row) {
  const label = String(row?.label || '').trim();
  if (label) return label;
  const header = parseJsonSafe(row?.header_json, null);
  if (header && header.type === 'text' && String(header.text || '').trim()) {
    return String(header.text).trim().slice(0, 120);
  }
  if (header && header.type === 'link' && String(header.url || '').trim()) {
    return String(header.title || header.url).trim().slice(0, 120);
  }
  const fromHtml = stripHtml(row?.content_html);
  if (fromHtml) return fromHtml.slice(0, 120);
  const title = String(row?.title || '').trim();
  if (title && title !== 'Untitled draft') return title;
  return row?.id != null ? `Assignment #${row.id}` : 'Assignment';
}

function normalizeResponseType(raw) {
  const t = String(raw || 'file').trim().toLowerCase();
  return RESPONSE_TYPES.includes(t) ? t : 'file';
}

function normalizeHeader(raw) {
  const h = typeof raw === 'string' ? parseJsonSafe(raw, null) : raw;
  if (!h || typeof h !== 'object') return null;
  const type = String(h.type || 'text').trim();
  const allowed = ['text', 'image', 'video', 'audio', 'pdf', 'file', 'link'];
  if (!allowed.includes(type)) return null;
  return {
    type,
    text: h.text != null ? String(h.text) : undefined,
    url: h.url != null ? String(h.url) : undefined,
    title: h.title != null ? String(h.title) : undefined,
    assetId: h.assetId != null ? Number(h.assetId) : undefined,
    storageKey: h.storageKey != null ? String(h.storageKey) : undefined,
    mimeType: h.mimeType != null ? String(h.mimeType) : undefined,
  };
}

/**
 * Recurrence JSON shape (Google Calendar–like subset):
 * {
 *   frequency: 'daily'|'weekly',
 *   interval: 1,
 *   byWeekday: [0-6] Sunday=0 (weekly only),
 *   count: number | null,
 *   until: 'YYYY-MM-DD' | null
 * }
 * Returns list of YYYY-MM-DD including the start date.
 */
function expandRecurrenceDates(startYmd, recurrence) {
  const start = String(startYmd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return [];
  const rule = parseJsonSafe(recurrence, null);
  if (!rule || !rule.frequency) return [start];

  const frequency = String(rule.frequency).toLowerCase();
  const interval = Math.max(1, Number(rule.interval) || 1);
  const count = rule.count != null ? Math.max(1, Number(rule.count) || 1) : null;
  const until = rule.until ? String(rule.until).slice(0, 10) : null;
  const byWeekday = Array.isArray(rule.byWeekday)
    ? rule.byWeekday.map((d) => Number(d)).filter((d) => d >= 0 && d <= 6)
    : null;

  const out = [];
  const maxIterations = 400;
  let cursor = start;
  let guard = 0;

  function weekdayUtc(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) return 0;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  }

  while (guard < maxIterations) {
    guard += 1;
    if (until && cursor > until) break;
    if (count != null && out.length >= count) break;

    if (frequency === 'weekly' && byWeekday && byWeekday.length) {
      if (byWeekday.includes(weekdayUtc(cursor))) out.push(cursor);
    } else {
      out.push(cursor);
    }

    if (count != null && out.length >= count) break;
    if (until && cursor >= until) break;

    if (frequency === 'weekly') {
      cursor = addDaysYmd(cursor, interval === 1 && byWeekday && byWeekday.length ? 1 : 7 * interval);
    } else {
      cursor = addDaysYmd(cursor, interval);
    }
    if (!cursor) break;
  }

  if (!out.length) return [start];
  return out;
}

function serializeLibraryRow(row, assets = []) {
  if (!row) return null;
  return {
    ...row,
    displayLabel: derivedAssignmentLabel(row),
    response_type: normalizeResponseType(row.response_type),
    header: normalizeHeader(row.header_json),
    recurrence: parseJsonSafe(row.recurrence_json, null),
    assets,
  };
}

module.exports = {
  RESPONSE_TYPES,
  parseJsonSafe,
  stripHtml,
  derivedAssignmentLabel,
  normalizeResponseType,
  normalizeHeader,
  expandRecurrenceDates,
  serializeLibraryRow,
  academyToday,
};
