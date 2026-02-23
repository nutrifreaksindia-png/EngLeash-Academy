const express = require('express');
const path = require('path');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();
const baseUrl = process.env.STORAGE_URL || process.env.API_URL || '';

function canAccessCourse(db, userId, role, courseId) {
  if (role === 'Admin') return true;
  const e = db.prepare('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?').get(userId, courseId);
  return !!e;
}

router.get('/course/:courseId', auth, (req, res) => {
  const { courseId } = req.params;
  if (!canAccessCourse(db, req.user.id, req.user.role, courseId)) {
    return res.status(403).json({ error: 'Not enrolled in this course' });
  }
  const lessons = db.prepare(
    'SELECT id, course_id, title, sort_order, video_url FROM lessons WHERE course_id = ? ORDER BY sort_order, id'
  ).all(courseId);
  res.json(lessons);
});

router.get('/:id', auth, (req, res) => {
  const lesson = db.prepare(
    'SELECT id, course_id, title, sort_order, video_url FROM lessons WHERE id = ?'
  ).get(req.params.id);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  if (!canAccessCourse(db, req.user.id, req.user.role, lesson.course_id)) {
    return res.status(403).json({ error: 'Not enrolled in this course' });
  }
  const notes = db.prepare('SELECT id, title, file_path FROM class_notes WHERE lesson_id = ?').all(lesson.id);
  const worksheets = db.prepare('SELECT id, title, file_path FROM worksheets WHERE lesson_id = ?').all(lesson.id);
  const quiz = db.prepare('SELECT id, title FROM quizzes WHERE lesson_id = ?').get(lesson.id);
  const quizQuestions = quiz
    ? db.prepare('SELECT id, question_text, options, correct_index, sort_order FROM quiz_questions WHERE quiz_id = ? ORDER BY sort_order').all(quiz.id)
    : [];
  const allowVideoDownload = req.user.role === 'Admin';
  const videoUrl = lesson.video_url
    ? (lesson.video_url.startsWith('http') ? lesson.video_url : `${baseUrl}${lesson.video_url}`)
    : null;
  res.json({
    ...lesson,
    videoUrl,
    allowVideoDownload,
    classNotes: notes.map(n => ({ ...n, fileUrl: n.file_path.startsWith('http') ? n.file_path : `${baseUrl}${n.file_path}` })),
    worksheets: worksheets.map(w => ({ ...w, fileUrl: w.file_path.startsWith('http') ? w.file_path : `${baseUrl}${w.file_path}` })),
    quiz: quiz ? { ...quiz, questions: quizQuestions.map(q => ({ ...q, options: JSON.parse(q.options || '[]') })) } : null,
  });
});

router.post('/', auth, requireRole('Admin'), (req, res) => {
  const { course_id, title, sort_order, video_url } = req.body;
  if (!course_id || !title) return res.status(400).json({ error: 'course_id and title are required' });
  db.prepare(
    'INSERT INTO lessons (course_id, title, sort_order, video_url) VALUES (?, ?, ?, ?)'
  ).run(course_id, title, sort_order ?? 0, video_url || null);
  const row = db.prepare('SELECT * FROM lessons WHERE id = last_insert_rowid()').get();
  res.status(201).json(row);
});

router.put('/:id', auth, requireRole('Admin'), (req, res) => {
  const { title, sort_order, video_url } = req.body;
  db.prepare(
    'UPDATE lessons SET title = COALESCE(?, title), sort_order = COALESCE(?, sort_order), video_url = COALESCE(?, video_url) WHERE id = ?'
  ).run(title, sort_order, video_url, req.params.id);
  const row = db.prepare('SELECT * FROM lessons WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Lesson not found' });
  res.json(row);
});

router.delete('/:id', auth, requireRole('Admin'), (req, res) => {
  db.prepare('DELETE FROM lessons WHERE id = ?').run(req.params.id);
  res.status(204).send();
});

module.exports = router;
