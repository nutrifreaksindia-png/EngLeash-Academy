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
  const type = enrollmentType || course.enrollment_type || 'free';
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
