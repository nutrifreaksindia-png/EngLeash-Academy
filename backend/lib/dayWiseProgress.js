const db = require('../db');

function ymdToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Max lesson day_number a learner may open for a day-wise course (inclusive).
 * Uses batch calendar: all session days up to and including today.
 * @returns {number} 0 if nothing unlocked yet
 */
function maxUnlockedLessonDay(userId, courseId) {
  const today = ymdToday();
  const batchIds = db
    .prepare(
      `SELECT b.id FROM batches b
       INNER JOIN batch_members bm ON bm.batch_id = b.id AND bm.student_id = ?
       WHERE b.course_id = ?`,
    )
    .all(userId, courseId);

  let maxDay = 0;
  for (const { id } of batchIds) {
    const r = db
      .prepare(
        `SELECT MAX(bs.session_day) AS mx
         FROM batch_sessions bs
         WHERE bs.batch_id = ?
           AND bs.session_date <= ?
           AND COALESCE(bs.status, '') != 'cancelled'`,
      )
      .get(id, today);
    const mx = r && r.mx != null ? Number(r.mx) : 0;
    if (mx > maxDay) maxDay = mx;
  }

  if (maxDay > 0) return maxDay;

  /* No batch: approximate from access start + calendar days */
  const course = db.prepare('SELECT duration_days FROM courses WHERE id = ?').get(courseId);
  const dur = Math.max(1, Number(course?.duration_days || 1));
  const grant = db
    .prepare(
      `SELECT MIN(starts_at_ms) AS st FROM course_access_grants
       WHERE user_id = ? AND course_id = ? AND revoked_at_ms IS NULL`,
    )
    .get(userId, courseId);
  const enr = db
    .prepare(
      `SELECT COALESCE(approved_at, requested_at) AS t
       FROM course_enrollments WHERE user_id = ? AND course_id = ? AND status = 'approved'`,
    )
    .get(userId, courseId);
  let startMs = grant && grant.st != null ? Number(grant.st) : null;
  if (startMs == null && enr?.t) {
    const parsed = Date.parse(String(enr.t));
    startMs = Number.isFinite(parsed) ? parsed : Date.now();
  }
  if (startMs == null) startMs = Date.now();
  const elapsedDays = Math.floor((Date.now() - startMs) / 86400000) + 1;
  return Math.max(0, Math.min(dur, elapsedDays));
}

function lessonDayNumberForCourse(courseId, lessonLibraryId) {
  const r = db
    .prepare(
      `SELECT MIN(cl.day_number) AS d
       FROM course_lessons cl
       WHERE cl.course_id = ? AND cl.lesson_id = ?`,
    )
    .get(courseId, lessonLibraryId);
  return r && r.d != null ? Number(r.d) : null;
}

function myCourseScheduleHint(userId, course) {
  const pt = String(course.progression_type || 'unlock_all').toLowerCase();
  if (pt !== 'day_wise') return null;

  const today = ymdToday();
  const row = db
    .prepare(
      `SELECT bs.session_day, ll.title
       FROM batch_sessions bs
       JOIN batches b ON b.id = bs.batch_id AND b.course_id = ?
       JOIN batch_members bm ON bm.batch_id = b.id AND bm.student_id = ?
       JOIN course_lessons cl
         ON cl.course_id = b.course_id
        AND cl.day_number = bs.session_day
        AND COALESCE(cl.sequence_in_day, 1) = 1
       JOIN lesson_library ll ON ll.id = cl.lesson_id
       WHERE bs.session_date = ? AND COALESCE(bs.status, '') != 'cancelled'
       LIMIT 1`,
    )
    .get(course.id, userId, today);

  if (row && row.title) {
    return `Today's lesson: ${String(row.title).trim()}`;
  }

  const maxD = maxUnlockedLessonDay(userId, course.id);
  if (maxD < 1) return 'Day-wise schedule — lessons unlock on class days.';

  const titleRow = db
    .prepare(
      `SELECT ll.title FROM course_lessons cl
       JOIN lesson_library ll ON ll.id = cl.lesson_id
       WHERE cl.course_id = ? AND cl.day_number = ? AND COALESCE(cl.sequence_in_day, 1) = 1
       LIMIT 1`,
    )
    .get(course.id, maxD);

  if (titleRow?.title) {
    return `Open through day ${maxD}: ${String(titleRow.title).trim()}`;
  }
  return `Day-wise — open through day ${maxD}`;
}

module.exports = {
  ymdToday,
  maxUnlockedLessonDay,
  lessonDayNumberForCourse,
  myCourseScheduleHint,
};
