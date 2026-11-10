const db = require('../db');

/**
 * What a Trainer may see: courses of the batches they lead or co-teach that are not completed
 * (draft batches count so they can prepare), the lessons of those courses, and library items that are
 * in those lessons, mapped to those courses/lessons, or created by the trainer.
 *
 * Lesson-scoped `*_assignments.scope_id` can hold a `lesson_library.id` or a legacy `lessons.id`,
 * so both lesson sets are matched there; `lesson_library_items` only references `lesson_library`.
 */
const SCOPE_CTE = `
  WITH
  t_batches AS (
    SELECT b.id, b.course_id FROM batches b
    WHERE COALESCE(b.batch_status, 'draft') <> 'completed'
      AND (
        b.trainer_id = @uid
        OR EXISTS (SELECT 1 FROM batch_trainers bt WHERE bt.batch_id = b.id AND bt.trainer_id = @uid)
      )
  ),
  t_courses AS (
    SELECT bc.course_id AS id FROM batch_courses bc WHERE bc.batch_id IN (SELECT id FROM t_batches)
    UNION
    SELECT course_id AS id FROM t_batches WHERE course_id IS NOT NULL
  ),
  t_lessons AS (
    SELECT DISTINCT cl.lesson_id AS id FROM course_lessons cl
    WHERE cl.lesson_id IS NOT NULL AND cl.course_id IN (SELECT id FROM t_courses)
  ),
  t_legacy_lessons AS (
    SELECT l.id FROM lessons l WHERE l.course_id IN (SELECT id FROM t_courses)
  )
`;

const MAPPING_IN_SCOPE = `(
  (a.scope_type = 'course' AND a.scope_id IN (SELECT id FROM t_courses))
  OR (
    a.scope_type = 'lesson'
    AND (a.scope_id IN (SELECT id FROM t_lessons) OR a.scope_id IN (SELECT id FROM t_legacy_lessons))
  )
)`;

function lessonItemsSql(itemType) {
  return `SELECT item_id AS id FROM lesson_library_items
          WHERE item_type = '${itemType}' AND lesson_id IN (SELECT id FROM t_lessons)`;
}

const VISIBLE_ITEMS_SQL = {
  video: `
    SELECT id FROM video_library WHERE created_by = @uid
    UNION ${lessonItemsSql('video')}
    UNION SELECT a.video_id AS id FROM video_assignments a WHERE ${MAPPING_IN_SCOPE}`,
  study_material: `
    SELECT id FROM study_material_library WHERE created_by = @uid
    UNION ${lessonItemsSql('study_material')}
    UNION SELECT a.material_id AS id FROM study_material_assignments a WHERE ${MAPPING_IN_SCOPE}`,
  worksheet: `
    SELECT id FROM worksheet_library WHERE created_by = @uid
    UNION ${lessonItemsSql('worksheet')}
    UNION SELECT a.worksheet_id AS id FROM worksheet_assignments a WHERE ${MAPPING_IN_SCOPE}`,
  quiz: `
    SELECT id FROM quiz_bank WHERE created_by = @uid
    UNION ${lessonItemsSql('quiz')}
    UNION SELECT v.quiz_bank_id AS id FROM quiz_assignments a
          JOIN quiz_versions v ON v.id = a.quiz_version_id
          WHERE ${MAPPING_IN_SCOPE}`,
  assignment: `
    SELECT id FROM assignment_library WHERE created_by = @uid
    UNION SELECT id FROM assignment_library
          WHERE COALESCE(is_public, 0) = 1 AND COALESCE(is_draft, 0) = 0
    UNION ${lessonItemsSql('assignment')}`,
};

function isTrainer(user) {
  return user?.role === 'Trainer';
}

function idSet(rows) {
  return new Set(rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n)));
}

function scopedIds(userId, cteName) {
  return idSet(db.prepare(`${SCOPE_CTE} SELECT id FROM ${cteName}`).all({ uid: Number(userId) }));
}

function scopedHas(userId, cteName, id) {
  const n = Number(id);
  if (!Number.isFinite(n)) return false;
  return !!db
    .prepare(`${SCOPE_CTE} SELECT 1 FROM ${cteName} WHERE id = @id LIMIT 1`)
    .get({ uid: Number(userId), id: n });
}

function activeBatchIdsForTrainer(userId) {
  return scopedIds(userId, 't_batches');
}

function courseIdsForTrainer(userId) {
  return scopedIds(userId, 't_courses');
}

function subtractDeniedLessons(userId, ids) {
  const { deniedLessonIdSet } = require('./lessonAccess');
  const denied = deniedLessonIdSet(userId);
  if (!denied.size) return ids;
  for (const id of denied) ids.delete(id);
  return ids;
}

/** `lesson_library` ids reached through `course_lessons`. */
function lessonIdsForTrainer(userId) {
  return subtractDeniedLessons(userId, scopedIds(userId, 't_lessons'));
}

/** Legacy `lessons` ids of the trainer's courses. */
function legacyLessonIdsForTrainer(userId) {
  return subtractDeniedLessons(userId, scopedIds(userId, 't_legacy_lessons'));
}

function trainerHasCourse(userId, courseId) {
  return scopedHas(userId, 't_courses', courseId);
}

/** Matches either lesson source, like lesson-scoped content mappings do. */
function trainerHasLesson(userId, lessonId) {
  const { isLessonDenied } = require('./lessonAccess');
  if (isLessonDenied(userId, lessonId)) return false;
  return scopedHas(userId, 't_lessons', lessonId) || scopedHas(userId, 't_legacy_lessons', lessonId);
}

function visibleItemsSql(itemType) {
  const sql = VISIBLE_ITEMS_SQL[itemType];
  if (!sql) throw new Error(`Unknown library item type: ${itemType}`);
  return sql;
}

function visibleLibraryIds(user, itemType) {
  return idSet(
    db.prepare(`${SCOPE_CTE} SELECT id FROM (${visibleItemsSql(itemType)})`).all({ uid: Number(user.id) }),
  );
}

/** Non-Trainers are not limited here; their own role rules apply. */
function trainerCanViewLibraryItem(user, itemType, itemId) {
  if (!isTrainer(user)) return true;
  const n = Number(itemId);
  if (!Number.isFinite(n)) return false;
  return !!db
    .prepare(`${SCOPE_CTE} SELECT 1 FROM (${visibleItemsSql(itemType)}) WHERE id = @id LIMIT 1`)
    .get({ uid: Number(user.id), id: n });
}

function filterLibraryRowsForTrainer(user, itemType, rows, idKey = 'id') {
  if (!isTrainer(user) || !Array.isArray(rows)) return rows;
  const visible = visibleLibraryIds(user, itemType);
  return rows.filter((r) => visible.has(Number(r[idKey])));
}

module.exports = {
  isTrainer,
  activeBatchIdsForTrainer,
  courseIdsForTrainer,
  lessonIdsForTrainer,
  legacyLessonIdsForTrainer,
  trainerHasCourse,
  trainerHasLesson,
  visibleLibraryIds,
  trainerCanViewLibraryItem,
  filterLibraryRowsForTrainer,
};
