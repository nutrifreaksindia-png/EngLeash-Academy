/** Callback booking rules (IST calendar dates, academy working-hour slots). */

const CALLBACK_TIME_SLOTS = [
  { id: '10-11', label: '10:00 a.m. – 11:00 a.m.' },
  { id: '11-12', label: '11:00 a.m. – 12:00 p.m.' },
  { id: '12-13', label: '12:00 p.m. – 1:00 p.m.' },
  { id: '15-16', label: '3:00 p.m. – 4:00 p.m.' },
  { id: '16-17', label: '4:00 p.m. – 5:00 p.m.' },
  { id: '17-18', label: '5:00 p.m. – 6:00 p.m.' },
  { id: '18-19', label: '6:00 p.m. – 7:00 p.m.' },
];

const SLOT_IDS = new Set(CALLBACK_TIME_SLOTS.map((s) => s.id));

function formatIstYmd(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

/** Weekday 0=Sun..6=Sat for the given civil Y-M-D in Asia/Kolkata. */
function istWeekdayFromYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  const utc = new Date(Date.UTC(y, mo - 1, d, 6, 30, 0));
  return utc.getUTCDay();
}

function isSecondSaturdayYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return false;
  const d = Number(m[3]);
  const wd = istWeekdayFromYmd(ymd);
  return wd === 6 && d >= 8 && d <= 14;
}

function addDaysIstFromYmd(startYmd, deltaDays) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(startYmd || '').trim());
  if (!m) return startYmd;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 6, 30, 0) + deltaDays * 86400000;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(t));
}

/** Last IST calendar day (inclusive) allowed for callback booking: today + 6 days = 7-day window. */
function istLatestAllowedCallbackYmd() {
  let ymd = formatIstYmd();
  for (let i = 0; i < 6; i += 1) {
    ymd = addDaysIstFromYmd(ymd, 1);
  }
  return ymd;
}

function isDisallowedCalendarDay(ymd, holidayDates) {
  const wd = istWeekdayFromYmd(ymd);
  if (wd === 0) return { ok: false, reason: 'Sundays are not available' };
  if (isSecondSaturdayYmd(ymd)) return { ok: false, reason: 'Second Saturdays are not available' };
  if (holidayDates && holidayDates.has(String(ymd).trim())) {
    return { ok: false, reason: 'This date is a configured holiday' };
  }
  return { ok: true };
}

function validateCallbackDate(ymd, holidayDates) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || '').trim())) {
    return { ok: false, reason: 'Invalid date' };
  }
  const y = String(ymd).trim();
  const today = formatIstYmd();
  if (y < today) {
    return { ok: false, reason: 'Pick today or a future date' };
  }
  const latest = istLatestAllowedCallbackYmd();
  if (y > latest) {
    return { ok: false, reason: 'Pick a date within the next 7 days' };
  }
  return isDisallowedCalendarDay(ymd, holidayDates);
}

function validateCallbackSlot(slotId) {
  const id = String(slotId || '').trim();
  if (!SLOT_IDS.has(id)) return { ok: false, reason: 'Invalid time slot' };
  return { ok: true };
}

function normalizePhoneLocal(raw) {
  return String(raw || '').replace(/\D/g, '');
}

function normalizeCountryDialCode(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (!s.startsWith('+')) s = `+${s.replace(/^\+/, '')}`;
  return s;
}

module.exports = {
  CALLBACK_TIME_SLOTS,
  SLOT_IDS,
  formatIstYmd,
  istWeekdayFromYmd,
  isSecondSaturdayYmd,
  isDisallowedCalendarDay,
  validateCallbackDate,
  validateCallbackSlot,
  normalizePhoneLocal,
  normalizeCountryDialCode,
};
