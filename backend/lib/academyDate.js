/** Civil dates in the academy timezone. Uses the same offset as live session time parsing (default IST, +330). */
function academyOffsetMinutes() {
  const n = Number(process.env.LIVE_DEFAULT_TZ_OFFSET_MINUTES || 330);
  return Number.isFinite(n) ? n : 330;
}

/** YYYY-MM-DD for "today" in the academy timezone. */
function academyToday(nowMs = Date.now()) {
  return new Date(nowMs + academyOffsetMinutes() * 60 * 1000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD shifted by whole days from a YYYY-MM-DD string. */
function addDaysYmd(ymd, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

module.exports = { academyOffsetMinutes, academyToday, addDaysYmd };
