/** Display IST callback slots in the user's local timezone (submit still uses IST ymd + slot id). */

const ACADEMY_TZ = 'Asia/Kolkata';

export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ACADEMY_TZ;
  } catch {
    return ACADEMY_TZ;
  }
}

export function isUserInIst(): boolean {
  return deviceTimeZone() === ACADEMY_TZ;
}

function parseSlotHours(slotId: string): { startHour: number; endHour: number } | null {
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(String(slotId || '').trim());
  if (!m) return null;
  const startHour = Number(m[1]);
  const endHour = Number(m[2]);
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) return null;
  return { startHour, endHour };
}

/** IST calendar date + slot hour → UTC ms for formatting in local TZ. */
function istSlotInstantMs(ymd: string, hour: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return NaN;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  // IST = UTC+5:30 → UTC hour = IST hour - 5.5
  return Date.UTC(y, mo - 1, d, hour - 5, -30, 0);
}

/** IST wall-clock hour (10–19) → "10 a.m.", "12 p.m.", "1 p.m.", etc. */
export function formatCallbackWallHour(hour: number): string {
  const h12 = hour % 12 || 12;
  const isPm = hour >= 12;
  return `${h12} ${isPm ? 'p.m.' : 'a.m.'}`;
}

function formatCallbackInstant(d: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value?.toLowerCase();
  if (!Number.isFinite(hour)) return '';
  const suffix = dayPeriod === 'pm' ? 'p.m.' : 'a.m.';
  if (minute === 0) return `${hour} ${suffix}`;
  const mm = String(minute).padStart(2, '0');
  return `${hour}:${mm} ${suffix}`;
}

function formatIstSlotRangeLabel(slotId: string): string {
  const hours = parseSlotHours(slotId);
  if (!hours) return slotId;
  return `${formatCallbackWallHour(hours.startHour)} - ${formatCallbackWallHour(hours.endHour)}`;
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const dateLongFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

export function formatCallbackDateChip(ymd: string, timeZone = deviceTimeZone()): string {
  const ms = istSlotInstantMs(ymd, 12);
  if (!Number.isFinite(ms)) return ymd;
  return dateFmt.format(new Date(ms));
}

export function formatCallbackDateLong(ymd: string, timeZone = deviceTimeZone()): string {
  const ms = istSlotInstantMs(ymd, 12);
  if (!Number.isFinite(ms)) return ymd;
  return dateLongFmt.format(new Date(ms));
}

export function formatCallbackSlotRange(
  slotId: string,
  ymd: string,
  timeZone = deviceTimeZone(),
): { local: string; ist?: string } {
  const hours = parseSlotHours(slotId);
  if (!hours) return { local: formatIstSlotRangeLabel(slotId) };

  // Slots are IST wall hours; skip conversion when date is unknown or user is on IST.
  if (!ymd || isUserInIst() || timeZone === ACADEMY_TZ) {
    return { local: formatIstSlotRangeLabel(slotId) };
  }

  const startMs = istSlotInstantMs(ymd, hours.startHour);
  const endMs = istSlotInstantMs(ymd, hours.endHour);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return { local: formatIstSlotRangeLabel(slotId) };
  }

  const start = new Date(startMs);
  const end = new Date(endMs);
  const local = `${formatCallbackInstant(start, timeZone)} - ${formatCallbackInstant(end, timeZone)}`;
  const ist = `${formatCallbackInstant(start, ACADEMY_TZ)} - ${formatCallbackInstant(end, ACADEMY_TZ)} IST`;
  return { local, ist };
}

export function timezoneFootnote(): string {
  if (isUserInIst()) {
    return 'Times are in India Standard Time (IST).';
  }
  return 'Times shown in your local timezone. Our team calls on IST academy hours.';
}
