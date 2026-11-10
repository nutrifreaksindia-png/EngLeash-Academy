/** Shared assignment vocabulary (S1–S3) for mobile. */

export type AssignmentResponseType =
  | 'text'
  | 'image'
  | 'video'
  | 'file'
  | 'voice'
  | 'other'
  | string;

export type AssignmentWorkStatus = 'not_started' | 'submitted' | 'graded';

export type AssignmentTimeState = 'due_today' | 'overdue' | 'upcoming' | 'past';

export function responseTypeLabel(type?: string | null): string {
  const t = String(type || '').toLowerCase();
  if (t === 'text') return 'Write';
  if (t === 'image') return 'Photo';
  if (t === 'video') return 'Video';
  if (t === 'voice') return 'Voice note';
  if (t === 'file') return 'File';
  if (t === 'other') return 'Check-in';
  return 'Assignment';
}

export function responseTypeIcon(
  type?: string | null,
): 'create-outline' | 'camera-outline' | 'videocam-outline' | 'mic-outline' | 'document-outline' | 'checkmark-circle-outline' {
  const t = String(type || '').toLowerCase();
  if (t === 'text') return 'create-outline';
  if (t === 'image') return 'camera-outline';
  if (t === 'video') return 'videocam-outline';
  if (t === 'voice') return 'mic-outline';
  if (t === 'other') return 'checkmark-circle-outline';
  return 'document-outline';
}

export function workStatusFromSubmission(opts: {
  done?: boolean;
  reviewStatus?: string | null;
  score?: number | null;
}): AssignmentWorkStatus {
  const reviewed =
    String(opts.reviewStatus || '').toLowerCase() === 'reviewed' ||
    (opts.score != null && Number.isFinite(Number(opts.score)));
  if (reviewed) return 'graded';
  if (opts.done) return 'submitted';
  return 'not_started';
}

export function workStatusLabel(status: AssignmentWorkStatus): string {
  if (status === 'graded') return 'Reviewed';
  if (status === 'submitted') return 'Submitted';
  return 'Not started';
}

function parseDay(value?: string | null): Date | null {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(`${s.slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a: Date, b: Date): number {
  const ms = startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

/** Human due / schedule line (S2). */
export function formatAssignmentDue(opts: {
  dueAt?: string | null;
  scheduleDate?: string | null;
  now?: Date;
}): string {
  const now = opts.now || new Date();
  const due = parseDay(opts.dueAt) || parseDay(opts.scheduleDate);
  if (!due) return 'No due date';

  const hasTime = Boolean(opts.dueAt && String(opts.dueAt).includes('T'));
  const timePart = hasTime
    ? due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';

  const delta = daysBetween(now, due);
  if (delta === 0) return timePart ? `Today ${timePart}` : 'Today';
  if (delta === 1) return timePart ? `Tomorrow ${timePart}` : 'Tomorrow';
  if (delta === -1) return timePart ? `Yesterday ${timePart}` : 'Yesterday';
  if (delta < -1) return `Overdue by ${Math.abs(delta)} days`;

  if (opts.scheduleDate && !opts.dueAt) {
    return `Day ${String(opts.scheduleDate).slice(0, 10)}`;
  }

  const datePart = due.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: due.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
  return timePart ? `${datePart} ${timePart}` : datePart;
}

export function timeStateFromDates(opts: {
  dueAt?: string | null;
  scheduleDate?: string | null;
  filter?: 'today' | 'overdue' | 'upcoming';
  now?: Date;
}): AssignmentTimeState {
  if (opts.filter === 'overdue') return 'overdue';
  if (opts.filter === 'upcoming') return 'upcoming';
  if (opts.filter === 'today') return 'due_today';

  const now = opts.now || new Date();
  const today = ymdLocal(now);
  const dueDay = String(opts.dueAt || opts.scheduleDate || '').slice(0, 10);
  const schedule = String(opts.scheduleDate || '').slice(0, 10);
  if (dueDay && dueDay < today && schedule && schedule <= today) return 'overdue';
  if (schedule > today) return 'upcoming';
  if (dueDay === today || schedule === today) return 'due_today';
  return 'past';
}

/** List chip: work status wins over time state when submitted/graded. */
export function listStatusChip(opts: {
  done?: boolean;
  reviewStatus?: string | null;
  score?: number | null;
  dueAt?: string | null;
  scheduleDate?: string | null;
  filter?: 'today' | 'due_today' | 'overdue' | 'upcoming' | 'completed';
}): { label: string; tone: 'neutral' | 'danger' | 'warn' | 'info' | 'success' } {
  const work = workStatusFromSubmission({
    done: opts.done,
    reviewStatus: opts.reviewStatus,
    score: opts.score,
  });
  if (work === 'graded') return { label: 'Reviewed', tone: 'success' };
  if (work === 'submitted') return { label: 'Submitted', tone: 'info' };

  if (opts.filter === 'overdue') return { label: 'Overdue', tone: 'danger' };
  if (opts.filter === 'upcoming') return { label: 'Upcoming', tone: 'neutral' };
  if (opts.filter === 'today' || opts.filter === 'due_today') {
    return { label: 'Due today', tone: 'warn' };
  }

  const time = timeStateFromDates({
    dueAt: opts.dueAt,
    scheduleDate: opts.scheduleDate,
    filter: opts.filter === 'completed' ? undefined : (opts.filter as any),
  });
  if (time === 'overdue') return { label: 'Overdue', tone: 'danger' };
  if (time === 'upcoming') return { label: 'Upcoming', tone: 'neutral' };
  if (time === 'due_today') return { label: 'Due today', tone: 'warn' };
  return { label: 'Not started', tone: 'neutral' };
}

/** Open window: schedule day through due date (inclusive). */
export function isInDueTodayWindow(opts: {
  dueAt?: string | null;
  scheduleDate?: string | null;
  now?: Date;
}): boolean {
  const now = opts.now || new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  const schedule = String(opts.scheduleDate || '').slice(0, 10);
  const due = String(opts.dueAt || opts.scheduleDate || '').slice(0, 10);
  if (!schedule || !due) return false;
  return schedule <= today && due >= today;
}
