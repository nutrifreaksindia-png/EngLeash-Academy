/** Shared assignment vocabulary (S1–S3) for web admin. */

export function responseTypeLabel(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'text') return 'Write';
  if (t === 'image') return 'Photo';
  if (t === 'video') return 'Video';
  if (t === 'voice') return 'Voice note';
  if (t === 'file') return 'File';
  if (t === 'other') return 'Check-in';
  return 'Assignment';
}

export function workStatusFromSubmission({ done, reviewStatus, score } = {}) {
  const reviewed =
    String(reviewStatus || '').toLowerCase() === 'reviewed' ||
    (score != null && Number.isFinite(Number(score)));
  if (reviewed) return 'graded';
  if (done) return 'submitted';
  return 'not_started';
}

export function workStatusLabel(status) {
  if (status === 'graded') return 'Reviewed';
  if (status === 'submitted') return 'Submitted';
  return 'Not started';
}

export function reviewStatusLabel(reviewStatus, status) {
  const r = String(reviewStatus || '').toLowerCase();
  if (r === 'reviewed') return 'Reviewed';
  if (r === 'pending' || String(status || '').toLowerCase() === 'done') return 'Submitted';
  return workStatusLabel(workStatusFromSubmission({ done: Boolean(status), reviewStatus }));
}

function parseDay(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(`${s.slice(0, 10)}T12:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfLocalDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysBetween(a, b) {
  const ms = startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime();
  return Math.round(ms / (24 * 60 * 60 * 1000));
}

export function formatAssignmentDue({ dueAt, scheduleDate, now = new Date() } = {}) {
  const due = parseDay(dueAt) || parseDay(scheduleDate);
  if (!due) return 'No due date';

  const hasTime = Boolean(dueAt && String(dueAt).includes('T'));
  const timePart = hasTime
    ? due.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';

  const delta = daysBetween(now, due);
  if (delta === 0) return timePart ? `Today ${timePart}` : 'Today';
  if (delta === 1) return timePart ? `Tomorrow ${timePart}` : 'Tomorrow';
  if (delta === -1) return timePart ? `Yesterday ${timePart}` : 'Yesterday';
  if (delta < -1) return `Overdue by ${Math.abs(delta)} days`;

  if (scheduleDate && !dueAt) {
    return `Day ${String(scheduleDate).slice(0, 10)}`;
  }

  const datePart = due.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: due.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
  return timePart ? `${datePart} ${timePart}` : datePart;
}
