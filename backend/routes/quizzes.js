const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

function canAccessLesson(db, userId, role, lessonId) {
  const lesson = db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(lessonId);
  if (!lesson) return false;
  if (role === 'Admin') return true;
  const e = db.prepare('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?').get(userId, lesson.course_id);
  return !!e;
}

router.get('/lesson/:lessonId', auth, (req, res) => {
  const { lessonId } = req.params;
  if (!canAccessLesson(db, req.user.id, req.user.role, lessonId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const quiz = db.prepare('SELECT id, lesson_id, title FROM quizzes WHERE lesson_id = ?').get(lessonId);
  if (!quiz) return res.json(null);
  const questions = db.prepare(
    'SELECT id, question_text, options, correct_index, sort_order FROM quiz_questions WHERE quiz_id = ? ORDER BY sort_order'
  ).all(quiz.id);
  res.json({
    ...quiz,
    questions: questions.map(q => ({
      id: q.id,
      question_text: q.question_text,
      options: JSON.parse(q.options || '[]'),
      sort_order: q.sort_order,
    })),
  });
});

router.post('/lesson/:lessonId/submit', auth, (req, res) => {
  const { lessonId } = req.params;
  const { answers } = req.body;
  if (!canAccessLesson(db, req.user.id, req.user.role, lessonId)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const quiz = db.prepare('SELECT id FROM quizzes WHERE lesson_id = ?').get(lessonId);
  if (!quiz) return res.status(404).json({ error: 'Quiz not found' });
  const questions = db.prepare('SELECT id, correct_index FROM quiz_questions WHERE quiz_id = ? ORDER BY sort_order').all(quiz.id);
  const answerMap = Array.isArray(answers) ? answers : (answers && answers.answers ? answers.answers : []);
  let score = 0;
  questions.forEach((q, i) => {
    const userAnswer = answerMap[i] ?? answerMap.find(a => a.questionId === q.id)?.selectedIndex;
    if (Number(userAnswer) === q.correct_index) score++;
  });
  const total = questions.length;
  db.prepare(
    'INSERT INTO quiz_attempts (user_id, quiz_id, score, total, answers) VALUES (?, ?, ?, ?, ?)'
  ).run(req.user.id, quiz.id, score, total, JSON.stringify(answerMap));
  res.json({ score, total, passed: total > 0 && score === total });
});

module.exports = router;
