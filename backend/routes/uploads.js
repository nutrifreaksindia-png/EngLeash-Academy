const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const upload = require('../upload');

const router = express.Router();
const baseUrl = process.env.STORAGE_URL || process.env.API_URL || '';

function canAccessLesson(db, userId, role, lessonId) {
  const lesson = db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(lessonId);
  if (!lesson) return false;
  if (role === 'Admin') return true;
  const e = db.prepare('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?').get(userId, lesson.course_id);
  return !!e;
}

router.post('/lesson/:lessonId/notes', auth, requireRole('Admin'), upload.single('file'), (req, res) => {
  const { lessonId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'File required' });
  const rel = `/uploads/${req.file.filename}`;
  db.prepare('INSERT INTO class_notes (lesson_id, title, file_path) VALUES (?, ?, ?)').run(lessonId, req.body.title || 'Notes', rel);
  const row = db.prepare('SELECT * FROM class_notes WHERE id = last_insert_rowid()').get();
  res.status(201).json({ ...row, fileUrl: `${baseUrl}${rel}` });
});

router.post('/lesson/:lessonId/worksheet', auth, requireRole('Admin'), upload.single('file'), (req, res) => {
  const { lessonId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'File required' });
  const rel = `/uploads/${req.file.filename}`;
  db.prepare('INSERT INTO worksheets (lesson_id, title, file_path) VALUES (?, ?, ?)').run(lessonId, req.body.title || 'Worksheet', rel);
  const row = db.prepare('SELECT * FROM worksheets WHERE id = last_insert_rowid()').get();
  res.status(201).json({ ...row, fileUrl: `${baseUrl}${rel}` });
});

router.post('/lesson/:lessonId/video', auth, requireRole('Admin'), upload.single('file'), (req, res) => {
  const { lessonId } = req.params;
  if (!req.file) return res.status(400).json({ error: 'File required' });
  const rel = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE lessons SET video_url = ? WHERE id = ?').run(rel, lessonId);
  const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  res.json({ ...row, videoUrl: `${baseUrl}${rel}` });
});

module.exports = router;
