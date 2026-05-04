const db = require('../db');

const MAX_DURATION_DAYS = 3660;

/**
 * Ensures course_lessons has exactly one row per day 1..duration_days (sequence_in_day = 1).
 * Drops slots beyond duration and extra sequences. Inserts placeholder rows (lesson_id NULL) for missing days.
 */
function syncCourseLessonSlots(courseId) {
  const c = db.prepare('SELECT id, duration_days FROM courses WHERE id = ?').get(courseId);
  if (!c) return;
  const n = Math.min(MAX_DURATION_DAYS, Math.max(1, Number(c.duration_days || 1)));

  db.transaction(() => {
    db.prepare(
      `DELETE FROM course_lessons
       WHERE course_id = ? AND (day_number > ? OR sequence_in_day > 1)`
    ).run(courseId, n);

    const dupDays = db
      .prepare(
        `SELECT day_number FROM course_lessons
         WHERE course_id = ? AND sequence_in_day = 1
         GROUP BY day_number HAVING COUNT(*) > 1`
      )
      .all(courseId);

    for (const { day_number: dayNum } of dupDays) {
      const rows = db
        .prepare(
          `SELECT id, lesson_id FROM course_lessons
           WHERE course_id = ? AND day_number = ? AND sequence_in_day = 1
           ORDER BY (lesson_id IS NULL) ASC, id ASC`
        )
        .all(courseId, dayNum);
      const keep = rows.find((r) => r.lesson_id != null) || rows[0];
      if (!keep) continue;
      for (const r of rows) {
        if (r.id !== keep.id) db.prepare('DELETE FROM course_lessons WHERE id = ?').run(r.id);
      }
    }

    for (let d = 1; d <= n; d += 1) {
      const exists = db
        .prepare(
          `SELECT id FROM course_lessons
           WHERE course_id = ? AND day_number = ? AND sequence_in_day = 1`
        )
        .get(courseId, d);
      if (!exists) {
        db.prepare(
          `INSERT INTO course_lessons (course_id, lesson_id, day_number, sequence_in_day)
           VALUES (?, NULL, ?, 1)`
        ).run(courseId, d);
      }
    }
  })();
}

module.exports = { syncCourseLessonSlots, MAX_DURATION_DAYS };
