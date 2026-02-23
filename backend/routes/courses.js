const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, (req, res) => {
  const { role } = req.user;
  if (role === 'Admin') {
    const courses = db.prepare(
      'SELECT id, name, description, image_url, sort_order, is_published, created_at FROM courses ORDER BY sort_order, id'
    ).all();
    return res.json(courses);
  }
  const courses = db.prepare(`
    SELECT c.id, c.name, c.description, c.image_url, c.sort_order, c.is_published, c.created_at
    FROM courses c
    INNER JOIN enrollments e ON e.course_id = c.id AND e.user_id = ?
    WHERE c.is_published = 1
    ORDER BY c.sort_order, c.id
  `).all(req.user.id);
  res.json(courses);
});

router.get('/catalog', auth, requireRole('Admin', 'Trainer', 'Student'), (req, res) => {
  const courses = db.prepare(
    'SELECT id, name, description, image_url, sort_order FROM courses WHERE is_published = 1 ORDER BY sort_order, id'
  ).all();
  const enrolled = db.prepare('SELECT course_id FROM enrollments WHERE user_id = ?').all(req.user.id).map(r => r.course_id);
  res.json(courses.map(c => ({ ...c, enrolled: enrolled.includes(c.id) })));
});

router.get('/:id', auth, (req, res) => {
  const c = db.prepare(
    'SELECT id, name, description, image_url, sort_order, is_published, created_at FROM courses WHERE id = ?'
  ).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  if (req.user.role !== 'Admin') {
    const enrolled = db.prepare('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?').get(req.user.id, c.id);
    if (!enrolled) return res.status(403).json({ error: 'Not enrolled in this course' });
  }
  res.json(c);
});

router.post('/', auth, requireRole('Admin'), (req, res) => {
  const { name, description, image_url, sort_order } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  db.prepare(
    'INSERT INTO courses (name, description, image_url, sort_order) VALUES (?, ?, ?, ?)'
  ).run(name || '', description || '', image_url || null, sort_order ?? 0);
  const row = db.prepare('SELECT * FROM courses WHERE id = last_insert_rowid()').get();
  res.status(201).json(row);
});

router.put('/:id', auth, requireRole('Admin'), (req, res) => {
  const { name, description, image_url, sort_order, is_published } = req.body;
  db.prepare(
    'UPDATE courses SET name = COALESCE(?, name), description = COALESCE(?, description), image_url = COALESCE(?, image_url), sort_order = COALESCE(?, sort_order), is_published = COALESCE(?, is_published) WHERE id = ?'
  ).run(name, description, image_url, sort_order, is_published, req.params.id);
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  res.json(c);
});

router.delete('/:id', auth, requireRole('Admin'), (req, res) => {
  db.prepare('DELETE FROM courses WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
