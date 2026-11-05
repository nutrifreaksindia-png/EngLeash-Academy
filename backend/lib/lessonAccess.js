const db = require('../db');
const { courseIdsForLesson, learnerHasCourseAccess } = require('./courseAccess');

function grantSourceLabel(src) {
  const s = String(src || '').toLowerCase();
  if (s === 'subscribe_direct') return 'Subscribed to the course';
  if (s === 'subscribe_batch') return 'Course subscription via batch';
  if (s === 'renewal') return 'Subscription renewal';
  if (s === 'combo_subscribe') return 'Combo subscription';
  if (s === 'combo_renewal') return 'Combo renewal';
  if (s === 'purchase_library' || s === 'purchase_direct') return 'Course purchase';
  if (s === 'free_enroll') return 'Free enrollment';
  if (s === 'batch_course') return 'Batch membership';
  return src ? String(src).replace(/_/g, ' ') : 'Course access';
}

function activeOverride(userId, lessonId) {
  const uid = Number(userId);
  const lid = Number(lessonId);
  if (!Number.isFinite(uid) || !Number.isFinite(lid)) return null;
  return (
    db
      .prepare(
        `SELECT id, effect FROM lesson_access_overrides
         WHERE lesson_id = ? AND user_id = ? AND revoked_at IS NULL
         ORDER BY id DESC LIMIT 1`,
      )
      .get(lid, uid) || null
  );
}

function isLessonDenied(userId, lessonId) {
  return activeOverride(userId, lessonId)?.effect === 'deny';
}

function isLessonGranted(userId, lessonId) {
  return activeOverride(userId, lessonId)?.effect === 'grant';
}

function deniedLessonIdSet(userId) {
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return new Set();
  const rows = db
    .prepare(
      `SELECT lesson_id AS id FROM lesson_access_overrides
       WHERE user_id = ? AND effect = 'deny' AND revoked_at IS NULL`,
    )
    .all(uid);
  return new Set(rows.map((r) => Number(r.id)).filter(Number.isFinite));
}

function revokeActiveOverrides(lessonId, userId) {
  db.prepare(
    `UPDATE lesson_access_overrides SET revoked_at = datetime('now')
     WHERE lesson_id = ? AND user_id = ? AND revoked_at IS NULL`,
  ).run(lessonId, userId);
}

function setLessonOverride(lessonId, userId, effect, createdBy) {
  const lid = Number(lessonId);
  const uid = Number(userId);
  if (!Number.isFinite(lid) || !Number.isFinite(uid)) {
    const e = new Error('Invalid lesson or user');
    e.statusCode = 400;
    throw e;
  }
  const lesson = db.prepare('SELECT id FROM lesson_library WHERE id = ?').get(lid);
  if (!lesson) {
    const e = new Error('Lesson not found');
    e.statusCode = 404;
    throw e;
  }
  const user = db.prepare('SELECT id, role, name, email FROM users WHERE id = ?').get(uid);
  if (!user) {
    const e = new Error('User not found');
    e.statusCode = 404;
    throw e;
  }
  if (!['grant', 'deny'].includes(effect)) {
    const e = new Error('effect must be grant or deny');
    e.statusCode = 400;
    throw e;
  }
  if (user.role === 'Admin') {
    const e = new Error('Admin access is not managed at lesson level');
    e.statusCode = 400;
    throw e;
  }
  const tx = db.transaction(() => {
    revokeActiveOverrides(lid, uid);
    const result = db
      .prepare(
        `INSERT INTO lesson_access_overrides (lesson_id, user_id, effect, created_by)
         VALUES (?, ?, ?, ?)`,
      )
      .run(lid, uid, effect, createdBy || null);
    return result.lastInsertRowid;
  });
  const id = tx();
  return db.prepare('SELECT * FROM lesson_access_overrides WHERE id = ?').get(id);
}

function restoreLessonOverride(overrideId, lessonId = null) {
  const oid = Number(overrideId);
  if (!Number.isFinite(oid)) {
    const e = new Error('Invalid override id');
    e.statusCode = 400;
    throw e;
  }
  const row = db.prepare('SELECT * FROM lesson_access_overrides WHERE id = ? AND revoked_at IS NULL').get(oid);
  if (!row) {
    const e = new Error('Override not found or already restored');
    e.statusCode = 404;
    throw e;
  }
  if (lessonId != null && Number(row.lesson_id) !== Number(lessonId)) {
    const e = new Error('Override does not belong to this lesson');
    e.statusCode = 400;
    throw e;
  }
  db.prepare(`UPDATE lesson_access_overrides SET revoked_at = datetime('now') WHERE id = ?`).run(oid);
  return { ok: true };
}

function mappedCourses(lessonId) {
  return db
    .prepare(
      `SELECT DISTINCT c.id, c.name
       FROM course_lessons cl
       JOIN courses c ON c.id = cl.course_id
       WHERE cl.lesson_id = ?
       ORDER BY c.name`,
    )
    .all(Number(lessonId));
}

const GRANT_WINDOW_SQL = `
  g.revoked_at_ms IS NULL
  AND (
    (g.ends_at_ms IS NULL AND (g.starts_at_ms IS NULL OR g.starts_at_ms <= @now))
    OR (
      g.ends_at_ms IS NOT NULL
      AND g.grace_ends_at_ms IS NOT NULL
      AND g.starts_at_ms IS NOT NULL
      AND @now >= g.starts_at_ms AND @now <= g.grace_ends_at_ms
    )
  )
`;

function listLessonAccess(lessonId, nowMs = Date.now()) {
  const lid = Number(lessonId);
  const lesson = db.prepare('SELECT id, title FROM lesson_library WHERE id = ?').get(lid);
  if (!lesson) return null;

  const courses = mappedCourses(lid);
  const byUser = new Map();

  function person(userId, role, name, email) {
    const id = Number(userId);
    if (!byUser.has(id)) {
      byUser.set(id, {
        userId: id,
        role,
        name: name || '',
        email: email || '',
        reasons: [],
        status: 'active',
        overrideId: null,
      });
    }
    return byUser.get(id);
  }

  const grantRows = db
    .prepare(
      `SELECT g.id AS grant_id, g.user_id, g.source, g.course_id, g.batch_id,
              u.name, u.email, u.role, c.name AS course_name,
              b.title AS batch_title, b.batch_number
       FROM course_access_grants g
       JOIN users u ON u.id = g.user_id
       JOIN courses c ON c.id = g.course_id
       JOIN course_lessons cl ON cl.course_id = g.course_id AND cl.lesson_id = @lid
       LEFT JOIN batches b ON b.id = g.batch_id
       WHERE ${GRANT_WINDOW_SQL}
         AND u.role IN ('Student', 'Lab')
       ORDER BY u.name, g.id`,
    )
    .all({ lid, now: nowMs });

  for (const r of grantRows) {
    const p = person(r.user_id, r.role, r.name, r.email);
    const batchBit = r.batch_title
      ? ` · batch ${r.batch_number != null ? `#${r.batch_number} ` : ''}${r.batch_title}`
      : '';
    p.reasons.push({
      kind: 'course_grant',
      label: `${grantSourceLabel(r.source)} · ${r.course_name}${batchBit}`,
      courseId: r.course_id,
      batchId: r.batch_id,
      grantId: r.grant_id,
    });
  }

  const trainerRows = db
    .prepare(
      `SELECT DISTINCT u.id AS user_id, u.name, u.email, u.role,
              b.id AS batch_id, b.title AS batch_title, b.batch_number, c.id AS course_id, c.name AS course_name
       FROM course_lessons cl
       JOIN courses c ON c.id = cl.course_id
       JOIN batches b ON COALESCE(b.batch_status, 'draft') <> 'completed'
         AND (
           EXISTS (SELECT 1 FROM batch_courses bc WHERE bc.batch_id = b.id AND bc.course_id = cl.course_id)
           OR b.course_id = cl.course_id
         )
       JOIN users u ON u.role = 'Trainer' AND (
         b.trainer_id = u.id
         OR EXISTS (SELECT 1 FROM batch_trainers bt WHERE bt.batch_id = b.id AND bt.trainer_id = u.id)
       )
       WHERE cl.lesson_id = ?
       ORDER BY u.name, b.id`,
    )
    .all(lid);

  for (const r of trainerRows) {
    const p = person(r.user_id, r.role, r.name, r.email);
    const batchLabel = `${r.batch_number != null ? `#${r.batch_number} ` : ''}${r.batch_title || 'Batch'}`;
    p.reasons.push({
      kind: 'trainer_batch',
      label: `Trainer on ${batchLabel} · ${r.course_name}`,
      courseId: r.course_id,
      batchId: r.batch_id,
    });
  }

  const overrides = db
    .prepare(
      `SELECT o.id, o.user_id, o.effect, u.name, u.email, u.role
       FROM lesson_access_overrides o
       JOIN users u ON u.id = o.user_id
       WHERE o.lesson_id = ? AND o.revoked_at IS NULL
       ORDER BY o.id DESC`,
    )
    .all(lid);

  for (const o of overrides) {
    const p = person(o.user_id, o.role, o.name, o.email);
    if (p.overrideId != null) continue;
    p.overrideId = o.id;
    if (o.effect === 'deny') {
      p.status = 'removed';
    } else if (o.effect === 'grant') {
      p.status = 'active';
      p.reasons.push({ kind: 'direct', label: 'Direct lesson grant' });
    }
  }

  const people = [...byUser.values()].map((p) => {
    const seen = new Set();
    p.reasons = p.reasons.filter((r) => {
      const key = r.label;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (p.status === 'removed' && !p.reasons.length) {
      p.reasons.push({ kind: 'removed', label: 'Lesson access removed by admin' });
    }
    return p;
  });

  people.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'removed' ? 1 : -1;
    const roleCmp = String(a.role).localeCompare(String(b.role));
    if (roleCmp) return roleCmp;
    return String(a.name || a.email).localeCompare(String(b.name || b.email), undefined, { sensitivity: 'base' });
  });

  return { lessonId: lid, title: lesson.title, courses, people };
}

/**
 * After course/batch inheritance: deny always blocks; grant always allows.
 * Callers still apply their own inherited check when this returns null.
 */
function lessonOverrideEffect(userId, lessonId) {
  const o = activeOverride(userId, lessonId);
  if (!o) return null;
  return o.effect;
}

function userMayAccessLesson(user, lessonId, preferredCourseId = null, nowMs = Date.now()) {
  const lid = Number(lessonId);
  if (!Number.isFinite(lid) || !user) return false;
  const effect = lessonOverrideEffect(user.id, lid);
  if (user.role !== 'Admin' && effect === 'deny') return false;
  if (effect === 'grant') return true;
  if (user.role === 'Admin') return true;
  if (user.role === 'Trainer') {
    const { trainerHasLesson } = require('./trainerScope');
    return trainerHasLesson(user.id, lid);
  }
  const uid = user.id;
  const preferred = preferredCourseId != null ? Number(preferredCourseId) : NaN;
  if (Number.isFinite(preferred)) {
    const belongs =
      db.prepare('SELECT 1 FROM lessons WHERE id = ? AND course_id = ?').get(lid, preferred) ||
      db.prepare('SELECT 1 FROM course_lessons WHERE lesson_id = ? AND course_id = ?').get(lid, preferred);
    if (belongs && learnerHasCourseAccess(uid, preferred, nowMs)) return true;
  }
  return courseIdsForLesson(lid).some((cid) => learnerHasCourseAccess(uid, cid, nowMs));
}

module.exports = {
  isLessonDenied,
  isLessonGranted,
  deniedLessonIdSet,
  setLessonOverride,
  restoreLessonOverride,
  listLessonAccess,
  lessonOverrideEffect,
  userMayAccessLesson,
  grantSourceLabel,
};
