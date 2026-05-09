/** Mirrors backend `LIVE_JOIN_EARLY_MS` default (5 minutes before start). */
export const LIVE_JOIN_EARLY_MS = 5 * 60 * 1000;

/** Aligns with backend `joinTimeAllows` for subscribers (scheduled/live sessions). */
export function joinWindowAllows(args: {
  liveStatus: string;
  startsAt: string;
  endsAt: string;
  earlyMs?: number;
}): boolean {
  const { liveStatus, startsAt, endsAt } = args;
  const earlyMs = args.earlyMs ?? LIVE_JOIN_EARLY_MS;
  if (liveStatus !== 'scheduled' && liveStatus !== 'live') return false;
  if (liveStatus === 'ended' || liveStatus === 'cancelled') return false;
  const now = Date.now();
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return now >= start - earlyMs && now <= end;
}

export function userMayJoinLiveSession(args: {
  userRole?: string;
  liveStatus: string;
  startsAt: string;
  endsAt: string;
}): boolean {
  const bypass = args.userRole === 'Admin' || args.userRole === 'Trainer';
  const okStatus = args.liveStatus === 'scheduled' || args.liveStatus === 'live';
  if (!okStatus) return false;
  if (bypass) return true;
  return joinWindowAllows({
    liveStatus: args.liveStatus,
    startsAt: args.startsAt,
    endsAt: args.endsAt,
  });
}

export function joinOpensAtLabel(startsAt: string, earlyMs: number = LIVE_JOIN_EARLY_MS): string {
  const start = new Date(startsAt).getTime();
  if (Number.isNaN(start)) return '';
  const open = new Date(start - earlyMs);
  return `Join opens ${open.toLocaleString()}`;
}
