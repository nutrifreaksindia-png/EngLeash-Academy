/** Client-side callback date rules (mirror backend `callbackBookingRules.js` for UX). */

export function formatIstYmd(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export function istWeekdayFromYmd(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  return new Date(Date.UTC(y, mo - 1, d, 6, 30, 0)).getUTCDay();
}

export function isSecondSaturdayYmd(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return false;
  const d = Number(m[3]);
  const wd = istWeekdayFromYmd(ymd);
  return wd === 6 && d >= 8 && d <= 14;
}

export function isCallbackDateAllowed(ymd: string, holidays: Set<string>): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || '').trim())) return false;
  const today = formatIstYmd();
  if (String(ymd).trim() < today) return false;
  const wd = istWeekdayFromYmd(ymd);
  if (wd === 0) return false;
  if (isSecondSaturdayYmd(ymd)) return false;
  if (holidays.has(String(ymd).trim())) return false;
  return true;
}

export function addDaysIstFromYmd(startYmd: string, deltaDays: number): string {
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

export function buildCallbackDateOptions(holidayList: string[], maxPick = 40, searchDays = 180): string[] {
  const holidays = new Set((holidayList || []).map((h) => String(h).trim()).filter(Boolean));
  const out: string[] = [];
  let ymd = formatIstYmd();
  for (let i = 0; i < searchDays && out.length < maxPick; i++) {
    if (isCallbackDateAllowed(ymd, holidays)) out.push(ymd);
    ymd = addDaysIstFromYmd(ymd, 1);
  }
  return out;
}
