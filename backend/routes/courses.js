const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const upload = require('../upload');
const { syncCourseLessonSlots } = require('../lib/syncCourseLessonSlots');
const { userHasCourseAccess } = require('../lib/courseAccess');
const { isSpacesConfigured, deleteObjectsUnderPrefix } = require('../services/spaces');

const router = express.Router();

router.get('/', auth, (req, res) => {
  const { role } = req.user;
  if (role === 'Admin' || role === 'Creator') {
    const courses = db.prepare(
      `SELECT id, name, description, image_url, sort_order, is_published, created_at,
              highlights, specifications_html, duration_days, lesson_schedule_json, modes_json, languages_json,
              fee_inr, discount_inr, course_status, enrollment_type, progression_type
       FROM courses ORDER BY sort_order, id`
    ).all();
    return res.json(courses);
  }
  let courses = db.prepare(`
    SELECT c.id, c.name, c.description, c.image_url, c.sort_order, c.is_published, c.created_at,
           c.highlights, c.specifications_html, c.duration_days, c.lesson_schedule_json, c.modes_json, c.languages_json,
           c.fee_inr, c.discount_inr, c.course_status, c.enrollment_type, c.progression_type
    FROM courses c
    INNER JOIN course_enrollments e ON e.course_id = c.id AND e.user_id = ? AND e.status = 'approved'
    WHERE c.is_published = 1 AND COALESCE(c.course_status, 'Active') = 'Active'
    ORDER BY c.sort_order, c.id
  `).all(req.user.id);
  if (courses.length === 0) {
    courses = db.prepare(`
      SELECT c.id, c.name, c.description, c.image_url, c.sort_order, c.is_published, c.created_at,
             c.highlights, c.specifications_html, c.duration_days, c.lesson_schedule_json, c.modes_json, c.languages_json,
             c.fee_inr, c.discount_inr, c.course_status, c.enrollment_type, c.progression_type
      FROM courses c
      INNER JOIN enrollments e ON e.course_id = c.id AND e.user_id = ?
      WHERE c.is_published = 1 AND COALESCE(c.course_status, 'Active') = 'Active'
      ORDER BY c.sort_order, c.id
    `).all(req.user.id);
  }
  res.json(courses);
});

router.get('/catalog', auth, requireRole('Admin', 'Trainer', 'Student', 'Lab'), (req, res) => {
  const courses = db.prepare(
    `SELECT id, name, description, image_url, sort_order, highlights, duration_days, modes_json, languages_json,
            fee_inr, discount_inr, course_status, enrollment_type, progression_type
     FROM courses WHERE is_published = 1 AND COALESCE(course_status, 'Active') = 'Active' ORDER BY sort_order, id`
  ).all();
  let enrolledRows = db.prepare('SELECT course_id, status FROM course_enrollments WHERE user_id = ?').all(req.user.id);
  if (enrolledRows.length === 0) {
    enrolledRows = db.prepare("SELECT course_id, 'approved' AS status FROM enrollments WHERE user_id = ?").all(req.user.id);
  }
  const enrollmentByCourse = new Map(enrolledRows.map((r) => [r.course_id, r.status]));
  res.json(courses.map(c => ({ ...c, enrollmentStatus: enrollmentByCourse.get(c.id) || null, enrolled: enrollmentByCourse.get(c.id) === 'approved' })));
});

/** Published catalog for marketing / mobile landing (no auth). */
router.get('/public', (req, res) => {
  const courses = db.prepare(
    `SELECT id, name, description, image_url, sort_order, highlights, duration_days, modes_json, languages_json,
            fee_inr, discount_inr, course_status, enrollment_type, progression_type
     FROM courses WHERE is_published = 1 AND COALESCE(course_status, 'Active') = 'Active' ORDER BY sort_order, id`
  ).all();
  res.json(courses);
});

router.get('/public/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid course id' });
  const c = db.prepare(
    `SELECT id, name, description, image_url, sort_order, highlights, duration_days, modes_json, languages_json,
            fee_inr, discount_inr, course_status, enrollment_type, progression_type, specifications_html
     FROM courses WHERE id = ? AND is_published = 1 AND COALESCE(course_status, 'Active') = 'Active'`
  ).get(id);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  res.json(c);
});

router.get('/:id', auth, (req, res) => {
  const c = db.prepare(`
    SELECT id, name, description, image_url, sort_order, is_published, created_at,
           highlights, specifications_html, duration_days, lesson_schedule_json, modes_json, languages_json,
           fee_inr, discount_inr, course_status, enrollment_type, progression_type
    FROM courses WHERE id = ?
  `).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  if (req.user.role !== 'Admin') {
    const enrolled =
      db.prepare("SELECT 1 FROM course_enrollments WHERE user_id = ? AND course_id = ? AND status = 'approved'").get(req.user.id, c.id)
      || db.prepare('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.user.id, c.id);
    const access = !!(enrolled || userHasCourseAccess(req.user.id, c.id));
    if (!access) return res.status(403).json({ error: 'Not enrolled in this course' });
  }
  res.json(c);
});

router.post('/', auth, requireRole('Admin'), (req, res) => {
  const {
    name, description, image_url, sort_order,
    highlights, specificationsHtml, durationDays, lessonSchedule, modes, languages,
    feeInr, discountInr, courseStatus, enrollmentType,
    progressionType,
    is_published: isPublishedBody,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const published =
    isPublishedBody === undefined || isPublishedBody === null
      ? 1
      : isPublishedBody === true || isPublishedBody === 1 || isPublishedBody === '1'
        ? 1
        : 0;
  db.prepare(
    `INSERT INTO courses (
      name, description, image_url, sort_order, is_published, highlights, specifications_html, duration_days, lesson_schedule_json, modes_json, languages_json,
      fee_inr, discount_inr, course_status, enrollment_type, progression_type
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name || '',
    description || '',
    image_url || null,
    sort_order ?? 0,
    published,
    highlights || null,
    specificationsHtml || null,
    durationDays ?? 1,
    lessonSchedule ? JSON.stringify(lessonSchedule) : null,
    modes ? JSON.stringify(modes) : null,
    languages ? JSON.stringify(languages) : null,
    feeInr ?? 0,
    discountInr ?? 0,
    courseStatus || 'Active',
    enrollmentType || 'free',
    progressionType === 'day_wise' ? 'day_wise' : 'unlock_all'
  );
  const row = db.prepare('SELECT * FROM courses WHERE id = last_insert_rowid()').get();
  syncCourseLessonSlots(row.id);
  res.status(201).json(row);
});

router.put('/:id', auth, requireRole('Admin'), (req, res) => {
  const {
    name, description, image_url, sort_order, is_published,
    highlights, specificationsHtml, durationDays, lessonSchedule, modes, languages,
    feeInr, discountInr, courseStatus, enrollmentType,
    progressionType,
  } = req.body;

  db.prepare(
    `UPDATE courses SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      image_url = COALESCE(?, image_url),
      sort_order = COALESCE(?, sort_order),
      is_published = COALESCE(?, is_published),
      highlights = COALESCE(?, highlights),
      specifications_html = COALESCE(?, specifications_html),
      duration_days = COALESCE(?, duration_days),
      lesson_schedule_json = COALESCE(?, lesson_schedule_json),
      modes_json = COALESCE(?, modes_json),
      languages_json = COALESCE(?, languages_json),
      fee_inr = COALESCE(?, fee_inr),
      discount_inr = COALESCE(?, discount_inr),
      course_status = COALESCE(?, course_status),
      enrollment_type = COALESCE(?, enrollment_type)
    WHERE id = ?`
  ).run(
    name,
    description,
    image_url,
    sort_order,
    is_published,
    highlights,
    specificationsHtml,
    durationDays,
    lessonSchedule ? JSON.stringify(lessonSchedule) : null,
    modes ? JSON.stringify(modes) : null,
    languages ? JSON.stringify(languages) : null,
    feeInr,
    discountInr,
    courseStatus,
    enrollmentType,
    req.params.id
  );
  if (progressionType !== undefined) {
    const pt = progressionType === 'day_wise' ? 'day_wise' : 'unlock_all';
    db.prepare('UPDATE courses SET progression_type = ? WHERE id = ?').run(pt, req.params.id);
  }
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  syncCourseLessonSlots(Number(req.params.id));
  res.json(c);
});

router.post('/:id/cover', auth, requireRole('Admin'), upload.single('file'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid course id' });
  if (!req.file) return res.status(400).json({ error: 'Image file is required' });
  const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(id);
  if (!course) return res.status(404).json({ error: 'Course not found' });

  const rel = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE courses SET image_url = ? WHERE id = ?').run(rel, id);
  const updated = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  res.json({ ...updated, imageUrl: `${process.env.API_URL || ''}${rel}` });
});

router.delete('/:id', auth, requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(id);
  if (!course) return res.status(404).json({ error: 'Course not found' });

  if (isSpacesConfigured()) {
    try {
      await deleteObjectsUnderPrefix(`pre-recorded/course-${id}/`);
    } catch (e) {
      console.error('[course-delete] Spaces prerecorded', id, e);
    }
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM razorpay_billing_orders WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_access_grants WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM razorpay_course_orders WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_enrollments WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM enrollments WHERE course_id = ?').run(id);
    db.prepare(
      `DELETE FROM quiz_attempts_v2 WHERE assignment_id IN (
        SELECT id FROM quiz_assignments WHERE scope_type = 'course' AND scope_id = ?
      )`,
    ).run(id);
    db.prepare("DELETE FROM quiz_assignments WHERE scope_type = 'course' AND scope_id = ?").run(id);
    db.prepare("DELETE FROM video_assignments WHERE scope_type = 'course' AND scope_id = ?").run(id);
    db.prepare("DELETE FROM study_material_assignments WHERE scope_type = 'course' AND scope_id = ?").run(id);
    db.prepare("DELETE FROM worksheet_assignments WHERE scope_type = 'course' AND scope_id = ?").run(id);
    try {
      db.prepare('UPDATE batches SET course_id = NULL, subscription_package_id = NULL WHERE course_id = ?').run(id);
    } catch (_) {
      db.prepare('UPDATE batches SET course_id = NULL WHERE course_id = ?').run(id);
    }
    db.prepare("DELETE FROM billing_packages WHERE scope = 'course' AND course_id = ?").run(id);
    db.prepare('DELETE FROM course_combo_members WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_lessons WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  });
  tx();
  res.status(204).send();
});

module.exports = router;
