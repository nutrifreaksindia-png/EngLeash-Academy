const express = require('express');
const path = require('path');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const uploadMemory = require('../uploadMemory');
const { isSpacesConfigured, uploadLessonTemplateVideoToSpaces } = require('../services/spaces');

const router = express.Router();
const baseUrl = process.env.STORAGE_URL || process.env.API_URL || '';

function canAccessCourse(db, userId, role, courseId) {
  if (role === 'Admin') return true;
  const e = db.prepare("SELECT 1 FROM course_enrollments WHERE user_id = ? AND course_id = ? AND status = 'approved'").get(userId, courseId)
    || db.prepare('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?').get(userId, courseId);
  return !!e;
}

router.get('/course/:courseId', auth, (req, res) => {
  const { courseId } = req.params;
  if (!canAccessCourse(db, req.user.id, req.user.role, courseId)) {
    return res.status(403).json({ error: 'Not enrolled in this course' });
  }
  const mapped = db.prepare(`
    SELECT cl.id, cl.course_id, ll.id AS lesson_id, ll.title, cl.day_number AS sort_order, ll.video_url
    FROM course_lessons cl
    JOIN lesson_library ll ON ll.id = cl.lesson_id
    WHERE cl.course_id = ?
    ORDER BY cl.day_number, cl.sequence_in_day, cl.id
  `).all(courseId);
  const lessons = mapped.length
    ? mapped.map((m) => ({ id: m.lesson_id, map_id: m.id, course_id: m.course_id, title: m.title, sort_order: m.sort_order, video_url: m.video_url }))
    : db.prepare(
        'SELECT id, course_id, title, sort_order, video_url FROM lessons WHERE course_id = ? ORDER BY sort_order, id'
      ).all(courseId);
  res.json(lessons);
});

router.get('/:id', auth, (req, res) => {
  let lesson = db.prepare(
    'SELECT id, course_id, title, sort_order, video_url FROM lessons WHERE id = ?'
  ).get(req.params.id);
  let fromLibrary = false;
  if (!lesson) {
    const mapped = db.prepare(`
      SELECT cl.course_id, ll.id, ll.title, cl.day_number AS sort_order, ll.video_url, ll.study_material_html, ll.worksheet_html, ll.worksheet_answer_key_html
      FROM lesson_library ll
      JOIN course_lessons cl ON cl.lesson_id = ll.id
      WHERE ll.id = ?
      ORDER BY cl.day_number ASC
      LIMIT 1
    `).get(req.params.id);
    if (mapped) {
      lesson = mapped;
      fromLibrary = true;
    }
  }
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
  const quizAssignments = db.prepare(
    `SELECT a.id, a.quiz_version_id, a.scope_type, a.scope_id, a.is_required, a.order_index,
            b.title AS quiz_title
     FROM quiz_assignments a
     JOIN quiz_versions v ON v.id = a.quiz_version_id
     JOIN quiz_bank b ON b.id = v.quiz_bank_id
     WHERE (a.scope_type = 'lesson' AND a.scope_id = ?)
        OR (a.scope_type = 'course' AND a.scope_id = ?)
     ORDER BY a.order_index, a.id`
  ).all(lesson.id, lesson.course_id);
  const videoAssignments = db.prepare(
    `SELECT a.id, a.video_id, a.scope_type, a.scope_id, a.is_required, a.order_index,
            v.title AS video_title, v.description AS video_description, v.video_url
     FROM video_assignments a
     JOIN video_library v ON v.id = a.video_id
     WHERE (a.scope_type = 'lesson' AND a.scope_id = ?)
        OR (a.scope_type = 'course' AND a.scope_id = ?)
     ORDER BY a.order_index, a.id`
  ).all(lesson.id, lesson.course_id);
  const studyMaterialAssignments = db.prepare(
    `SELECT a.id, a.material_id, a.scope_type, a.scope_id, a.is_required, a.order_index,
            m.title AS material_title, m.description AS material_description, m.content_json
     FROM study_material_assignments a
     JOIN study_material_library m ON m.id = a.material_id
     WHERE COALESCE(m.is_draft, 0) = 0
       AND ((a.scope_type = 'lesson' AND a.scope_id = ?)
        OR (a.scope_type = 'course' AND a.scope_id = ?))
     ORDER BY a.order_index, a.id`
  ).all(lesson.id, lesson.course_id);
  const allowVideoDownload = req.user.role === 'Admin';
  const videoUrl = lesson.video_url
    ? (lesson.video_url.startsWith('http') ? lesson.video_url : `${baseUrl}${lesson.video_url}`)
    : null;
  res.json({
    ...lesson,
    source: fromLibrary ? 'lesson_library' : 'lessons',
    videoUrl,
    allowVideoDownload,
    classNotes: notes.map(n => ({ ...n, fileUrl: n.file_path.startsWith('http') ? n.file_path : `${baseUrl}${n.file_path}` })),
    worksheets: worksheets.map(w => ({ ...w, fileUrl: w.file_path.startsWith('http') ? w.file_path : `${baseUrl}${w.file_path}` })),
    quiz: quiz ? { ...quiz, questions: quizQuestions.map(q => ({ ...q, options: JSON.parse(q.options || '[]') })) } : null,
    quizAssignments,
    videoAssignments,
    studyMaterialAssignments,
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

router.get('/library', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const rows = db.prepare(`
    SELECT id, title, description, video_url, study_material_html, worksheet_html, worksheet_answer_key_html, assignment_title, created_at
    FROM lesson_library
    ORDER BY id DESC
  `).all();
  res.json(rows);
});

router.get('/admin/all', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const library = db.prepare(`
    SELECT id, title, description, video_url, study_material_html, worksheet_html, worksheet_answer_key_html, assignment_title, created_at
    FROM lesson_library
    ORDER BY id DESC
  `).all().map((r) => ({ ...r, source: 'lesson_library' }));

  const legacy = db.prepare(`
    SELECT l.id, l.title, l.video_url, l.created_at, c.name AS course_name, l.sort_order
    FROM lessons l
    JOIN courses c ON c.id = l.course_id
    ORDER BY l.id DESC
  `).all().map((r) => ({
    id: `legacy-${r.id}`,
    title: r.title,
    description: `Course: ${r.course_name} • Sort: ${r.sort_order}`,
    video_url: r.video_url,
    study_material_html: null,
    worksheet_html: null,
    worksheet_answer_key_html: null,
    assignment_title: null,
    created_at: r.created_at,
    source: 'legacy_lessons',
  }));

  res.json([...library, ...legacy]);
});

router.post('/library', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const {
    title,
    description,
    videoUrl,
    studyMaterialHtml,
    worksheetHtml,
    worksheetAnswerKeyHtml,
    assignmentTitle,
  } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  db.prepare(`
    INSERT INTO lesson_library (
      title, description, video_url, study_material_html, worksheet_html, worksheet_answer_key_html, assignment_title, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    title.trim(),
    description || null,
    videoUrl || null,
    studyMaterialHtml || null,
    worksheetHtml || null,
    worksheetAnswerKeyHtml || null,
    assignmentTitle || null,
    req.user.id
  );
  const row = db.prepare('SELECT * FROM lesson_library WHERE id = last_insert_rowid()').get();
  res.status(201).json(row);
});

router.put('/library/:id', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const id = Number(req.params.id);
  const {
    title,
    description,
    videoUrl,
    studyMaterialHtml,
    worksheetHtml,
    worksheetAnswerKeyHtml,
    assignmentTitle,
  } = req.body;
  db.prepare(`
    UPDATE lesson_library SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      video_url = COALESCE(?, video_url),
      study_material_html = COALESCE(?, study_material_html),
      worksheet_html = COALESCE(?, worksheet_html),
      worksheet_answer_key_html = COALESCE(?, worksheet_answer_key_html),
      assignment_title = COALESCE(?, assignment_title),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title || null,
    description || null,
    videoUrl || null,
    studyMaterialHtml || null,
    worksheetHtml || null,
    worksheetAnswerKeyHtml || null,
    assignmentTitle || null,
    id
  );
  const row = db.prepare('SELECT * FROM lesson_library WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Lesson template not found' });
  res.json(row);
});

router.post('/library/:id/video', auth, requireRole('Admin', 'Trainer'), uploadMemory.single('file'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid lesson template id' });
    if (!req.file) return res.status(400).json({ error: 'Video file is required' });
    if (!isSpacesConfigured()) {
      return res.status(503).json({
        error: 'DigitalOcean Spaces is not configured',
        requiredEnv: ['SPACES_ENDPOINT', 'SPACES_BUCKET', 'SPACES_KEY', 'SPACES_SECRET'],
      });
    }
    const existing = db.prepare('SELECT id FROM lesson_library WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'Lesson template not found' });

    const uploaded = await uploadLessonTemplateVideoToSpaces({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      templateId: id,
    });
    db.prepare('UPDATE lesson_library SET video_url = ?, updated_at = datetime(\'now\') WHERE id = ?').run(uploaded.publicUrl, id);
    const row = db.prepare('SELECT * FROM lesson_library WHERE id = ?').get(id);
    res.json({ ...row, videoUrl: uploaded.publicUrl, storageKey: uploaded.key });
  } catch (error) {
    res.status(500).json({ error: error.message || 'Video upload failed' });
  }
});

router.delete('/library/:id', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM lesson_library WHERE id = ?').run(id);
  res.status(204).end();
});

router.post('/course/:courseId/map', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const courseId = Number(req.params.courseId);
  const { lessonId, dayNumber, sequenceInDay } = req.body;
  if (!lessonId || !dayNumber) {
    return res.status(400).json({ error: 'lessonId and dayNumber are required' });
  }
  const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const lesson = db.prepare('SELECT id FROM lesson_library WHERE id = ?').get(Number(lessonId));
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  db.prepare(`
    INSERT INTO course_lessons (course_id, lesson_id, day_number, sequence_in_day)
    VALUES (?, ?, ?, ?)
  `).run(courseId, Number(lessonId), Number(dayNumber), Number(sequenceInDay || 1));
  res.status(201).json({ ok: true });
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
