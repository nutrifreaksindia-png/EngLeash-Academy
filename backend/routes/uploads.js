const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const upload = require('../upload');
const uploadMemory = require('../uploadMemory');
const { isSpacesConfigured, uploadLessonVideoToSpaces } = require('../services/spaces');

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

router.post('/lesson/:lessonId/video', auth, requireRole('Admin'), uploadMemory.single('file'), async (req, res) => {
  try {
    const { lessonId } = req.params;
    if (!req.file) return res.status(400).json({ error: 'File required' });
    if (!isSpacesConfigured()) {
      return res.status(503).json({
        error: 'DigitalOcean Spaces is not configured',
        requiredEnv: ['SPACES_ENDPOINT', 'SPACES_BUCKET', 'SPACES_KEY', 'SPACES_SECRET'],
      });
    }

    const lesson = db.prepare('SELECT id, course_id FROM lessons WHERE id = ?').get(lessonId);
    if (!lesson) return res.status(404).json({ error: 'Lesson not found' });

    const uploaded = await uploadLessonVideoToSpaces({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      courseId: lesson.course_id,
      lessonId: lesson.id,
    });

    db.prepare('UPDATE lessons SET video_url = ? WHERE id = ?').run(uploaded.publicUrl, lessonId);
    const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
    res.json({ ...row, videoUrl: uploaded.publicUrl, storageKey: uploaded.key });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Video upload failed' });
  }
});

module.exports = router;
