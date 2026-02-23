const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/my', auth, (req, res) => {
  const list = db.prepare(`
    SELECT e.id, e.course_id, e.enrolled_at, c.name as course_name, c.description
    FROM enrollments e
    JOIN courses c ON c.id = e.course_id
    WHERE e.user_id = ?
    ORDER BY e.enrolled_at DESC
  `).all(req.user.id);
  res.json(list);
});

router.post('/enroll', auth, requireRole('Trainer', 'Student', 'Lab'), (req, res) => {
  const { course_id } = req.body;
  if (!course_id) return res.status(400).json({ error: 'course_id is required' });
  const course = db.prepare('SELECT id FROM courses WHERE id = ? AND is_published = 1').get(course_id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  try {
    db.prepare('INSERT INTO enrollments (user_id, course_id) VALUES (?, ?)').run(req.user.id, course_id);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Already enrolled' });
    throw e;
  }
  const row = db.prepare('SELECT * FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.user.id, course_id);
  res.status(201).json(row);
});

router.delete('/:courseId', auth, requireRole('Trainer', 'Student', 'Lab'), (req, res) => {
  db.prepare('DELETE FROM enrollments WHERE user_id = ? AND course_id = ?').run(req.user.id, req.params.courseId);
  res.status(204).send();
});

module.exports = router;
