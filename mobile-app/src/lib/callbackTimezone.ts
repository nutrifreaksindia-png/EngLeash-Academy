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

const timeFmt = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

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
  if (!hours || !ymd) return { local: slotId };
  const startMs = istSlotInstantMs(ymd, hours.startHour);
  const endMs = istSlotInstantMs(ymd, hours.endHour);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return { local: slotId };

  const local = `${timeFmt.format(new Date(startMs))} – ${timeFmt.format(new Date(endMs))}`;
  if (isUserInIst() || timeZone === ACADEMY_TZ) return { local };

  const istFmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: ACADEMY_TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const ist = `${istFmt.format(new Date(startMs))} – ${istFmt.format(new Date(endMs))} IST`;
  return { local, ist };
}

export function timezoneFootnote(): string {
  if (isUserInIst()) {
    return 'Times are in India Standard Time (IST).';
  }
  return 'Times shown in your local timezone. Our team calls on IST academy hours.';
}
