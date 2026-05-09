const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/my', auth, (req, res) => {
  const list = db.prepare(`
    SELECT ce.id, ce.course_id, ce.enrollment_type, ce.status, ce.requested_at, ce.approved_at, c.name as course_name, c.description
    FROM course_enrollments ce
    JOIN courses c ON c.id = ce.course_id
    WHERE ce.user_id = ?
    ORDER BY ce.requested_at DESC
  `).all(req.user.id);
  if (list.length === 0) {
    const legacy = db.prepare(`
      SELECT e.id, e.course_id, 'free' AS enrollment_type, 'approved' AS status, e.enrolled_at AS requested_at, e.enrolled_at AS approved_at, c.name AS course_name, c.description
      FROM enrollments e
      JOIN courses c ON c.id = e.course_id
      WHERE e.user_id = ?
      ORDER BY e.enrolled_at DESC
    `).all(req.user.id);
    return res.json(legacy);
  }
  res.json(list);
});

router.post('/enroll', auth, requireRole('Trainer', 'Student', 'Lab'), (req, res) => {
  const { course_id, enrollmentType } = req.body;
  if (!course_id) return res.status(400).json({ error: 'course_id is required' });
  const course = db.prepare('SELECT id, enrollment_type, course_status FROM courses WHERE id = ? AND is_published = 1').get(course_id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (course.course_status && course.course_status !== 'Active') {
    return res.status(400).json({ error: 'Course is not active' });
  }
  const courseType = String(course.enrollment_type || 'free').toLowerCase();
  if (enrollmentType != null && String(enrollmentType).trim() !== '') {
    const requested = String(enrollmentType).toLowerCase();
    if (requested !== courseType) {
      return res.status(400).json({ error: 'Enrollment type does not match this course' });
    }
  }
  const type = courseType;
  const finalStatus = type === 'free' ? 'approved' : 'pending';
  try {
    db.prepare(`
      INSERT INTO course_enrollments (user_id, course_id, enrollment_type, status, approved_at, approved_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.user.id, course_id, type, finalStatus, finalStatus === 'approved' ? new Date().toISOString() : null, finalStatus === 'approved' ? req.user.id : null);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Already enrolled' });
    throw e;
  }
  if (finalStatus === 'approved') {
    db.prepare('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)').run(req.user.id, course_id);
  }
  const row = db.prepare('SELECT * FROM course_enrollments WHERE user_id = ? AND course_id = ?').get(req.user.id, course_id);
  res.status(201).json(row);
});

router.get('/courses/:courseId/open-batches', auth, requireRole('Student', 'Lab', 'Trainer', 'Admin'), (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid courseId' });
  const rows = db.prepare(`
    SELECT
      b.id,
      b.batch_number,
      b.title,
      b.name,
      b.session_type,
      b.duration_days,
      b.training_schedule_json,
      b.batch_status,
      b.planned_start_date,
      b.actual_start_date,
      (
        SELECT COUNT(*)
        FROM batch_sessions bs
        WHERE bs.batch_id = b.id
          AND bs.status != 'cancelled'
          AND date(bs.session_date) <= date('now')
      ) AS sessions_passed
    FROM batches b
    WHERE b.course_id = ?
      AND COALESCE(b.enrollment_open_status, 'closed') = 'open'
    ORDER BY COALESCE(b.batch_number, 999999), b.id
  `).all(courseId);
  res.json({ batches: rows });
});

router.post('/apply-batch', auth, requireRole('Student', 'Lab'), (req, res) => {
  const courseId = Number(req.body?.course_id);
  const batchId = Number(req.body?.batch_id);
  if (!Number.isFinite(courseId) || !Number.isFinite(batchId)) {
    return res.status(400).json({ error: 'course_id and batch_id are required' });
  }
  const batch = db.prepare(`
    SELECT id, course_id, enrollment_open_status
    FROM batches
    WHERE id = ?
  `).get(batchId);
  if (!batch || Number(batch.course_id) !== courseId) {
    return res.status(404).json({ error: 'Batch not found for course' });
  }
  if ((batch.enrollment_open_status || 'closed') !== 'open') {
    return res.status(409).json({ error: 'Batch is currently closed for applications' });
  }
  const existing = db.prepare(`
    SELECT id, status FROM course_enrollments
    WHERE user_id = ? AND course_id = ?
  `).get(req.user.id, courseId);
  if (!existing) {
    db.prepare(`
      INSERT INTO course_enrollments (user_id, course_id, enrollment_type, status, batch_id)
      VALUES (?, ?, 'apply', 'pending', ?)
    `).run(req.user.id, courseId, batchId);
  } else if (existing.status === 'approved') {
    return res.status(409).json({ error: 'Application already approved for this course' });
  } else {
    db.prepare(`
      UPDATE course_enrollments
      SET enrollment_type = 'apply', status = 'pending', batch_id = ?, approved_at = NULL, approved_by = NULL, notes = NULL
      WHERE id = ?
    `).run(batchId, existing.id);
  }
  const row = db.prepare(`
    SELECT * FROM course_enrollments
    WHERE user_id = ? AND course_id = ?
  `).get(req.user.id, courseId);
  res.status(201).json(row);
});

router.get('/pending-applications', auth, requireRole('Admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT
      ce.id,
      ce.user_id,
      ce.course_id,
      ce.batch_id,
      ce.enrollment_type,
      ce.status,
      ce.requested_at,
      u.name AS user_name,
      u.email AS user_email,
      c.name AS course_name,
      COALESCE(b.title, b.name) AS requested_batch_title,
      b.batch_number AS requested_batch_number
    FROM course_enrollments ce
    JOIN users u ON u.id = ce.user_id
    JOIN courses c ON c.id = ce.course_id
    LEFT JOIN batches b ON b.id = ce.batch_id
    WHERE ce.status = 'pending' AND ce.enrollment_type = 'apply'
    ORDER BY ce.requested_at ASC
  `).all();
  res.json(rows);
});

router.post('/applications/:id/approve', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  const selectedBatchId = req.body?.batchId == null || req.body.batchId === '' ? null : Number(req.body.batchId);
  const row = db.prepare('SELECT * FROM course_enrollments WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Application not found' });
  if (row.enrollment_type !== 'apply') return res.status(409).json({ error: 'Only apply applications can be approved here' });
  const targetBatchId = Number.isFinite(selectedBatchId) ? selectedBatchId : row.batch_id;
  if (!Number.isFinite(targetBatchId)) return res.status(400).json({ error: 'Batch is required for approval' });
  const targetBatch = db.prepare('SELECT id, course_id FROM batches WHERE id = ?').get(targetBatchId);
  if (!targetBatch || Number(targetBatch.course_id) !== Number(row.course_id)) {
    return res.status(400).json({ error: 'Selected batch does not belong to this course' });
  }
  db.prepare(`
    UPDATE course_enrollments
    SET status = 'approved', batch_id = ?, approved_at = ?, approved_by = ?
    WHERE id = ?
  `).run(targetBatchId, new Date().toISOString(), req.user.id, id);
  db.prepare('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)').run(row.user_id, row.course_id);
  db.prepare('INSERT OR IGNORE INTO batch_members (batch_id, student_id) VALUES (?, ?)').run(targetBatchId, row.user_id);
  const latest = db.prepare('SELECT * FROM course_enrollments WHERE id = ?').get(id);
  res.json(latest);
});

router.post('/applications/:id/disapprove', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM course_enrollments WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Application not found' });
  db.prepare(`
    UPDATE course_enrollments
    SET status = 'rejected', approved_at = ?, approved_by = ?, notes = ?
    WHERE id = ?
  `).run(new Date().toISOString(), req.user.id, req.body?.notes || null, id);
  const latest = db.prepare('SELECT * FROM course_enrollments WHERE id = ?').get(id);
  res.json(latest);
});

router.post('/:id/approve', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM course_enrollments WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Enrollment not found' });
  db.prepare("UPDATE course_enrollments SET status = 'approved', approved_at = ?, approved_by = ? WHERE id = ?")
    .run(new Date().toISOString(), req.user.id, id);
  const latest = db.prepare('SELECT * FROM course_enrollments WHERE id = ?').get(id);
  db.prepare('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)').run(latest.user_id, latest.course_id);
  res.json(latest);
});

router.get('/pending', auth, requireRole('Admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT ce.id, ce.user_id, ce.course_id, ce.enrollment_type, ce.status, ce.requested_at, u.name AS user_name, u.email AS user_email, c.name AS course_name
    FROM course_enrollments ce
    JOIN users u ON u.id = ce.user_id
    JOIN courses c ON c.id = ce.course_id
    WHERE ce.status = 'pending'
    ORDER BY ce.requested_at ASC
  `).all();
  res.json(rows);
});

router.delete('/:courseId', auth, requireRole('Trainer', 'Student', 'Lab'), (req, res) => {
  db.prepare('DELETE FROM course_enrollments WHERE user_id = ? AND course_id = ?').run(req.user.id, req.params.courseId);
  db.prepare('DELETE FROM enrollments WHERE user_id = ? AND course_id = ?').run(req.user.id, req.params.courseId);
  res.status(204).send();
});

module.exports = router;
