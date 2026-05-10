const express = require('express');
const path = require('path');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const uploadMemory = require('../uploadMemory');
const { isSpacesConfigured, uploadLessonTemplateVideoToSpaces, deleteObjectsUnderPrefix } = require('../services/spaces');
const {
  canViewStudyMaterial,
  canViewWorksheet,
  canViewAssignment,
} = require('../lib/libraryScope');
const { syncCourseLessonSlots } = require('../lib/syncCourseLessonSlots');
const { userHasCourseAccess } = require('../lib/courseAccess');
const { maxUnlockedLessonDay, lessonDayNumberForCourse } = require('../lib/dayWiseProgress');

const router = express.Router();
const baseUrl = process.env.STORAGE_URL || process.env.API_URL || '';

const ITEM_TYPES = new Set(['video', 'study_material', 'worksheet', 'quiz', 'assignment']);

function normalizeCompositionItems(body) {
  const raw = body?.items;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row, idx) => {
      const type = String(row?.type || row?.itemType || '').trim();
      const id = Number(row?.id ?? row?.itemId);
      if (!ITEM_TYPES.has(type) || !Number.isFinite(id)) return null;
      return { type, id, sortOrder: idx };
    })
    .filter(Boolean);
}

function validateLibraryRef(type, id) {
  if (type === 'video') {
    const r = db.prepare('SELECT id FROM video_library WHERE id = ?').get(id);
    if (!r) throw new Error(`Video ${id} not found`);
    return;
  }
  if (type === 'study_material') {
    const r = db.prepare('SELECT id, is_draft FROM study_material_library WHERE id = ?').get(id);
    if (!r) throw new Error(`Study material ${id} not found`);
    if (Number(r.is_draft) === 1) throw new Error('Draft study materials cannot be added to a lesson');
    return;
  }
  if (type === 'worksheet') {
    const r = db.prepare('SELECT id, is_draft FROM worksheet_library WHERE id = ?').get(id);
    if (!r) throw new Error(`Worksheet ${id} not found`);
    if (Number(r.is_draft) === 1) throw new Error('Draft worksheets cannot be added to a lesson');
    return;
  }
  if (type === 'quiz') {
    const r = db.prepare('SELECT id FROM quiz_bank WHERE id = ?').get(id);
    if (!r) throw new Error(`Quiz bank ${id} not found`);
    const ver = db.prepare('SELECT id FROM quiz_versions WHERE quiz_bank_id = ? ORDER BY version_no DESC LIMIT 1').get(id);
    if (!ver) throw new Error(`Quiz bank ${id} has no version — publish a version first`);
    return;
  }
  if (type === 'assignment') {
    const r = db.prepare('SELECT id, is_draft FROM assignment_library WHERE id = ?').get(id);
    if (!r) throw new Error(`Assignment ${id} not found`);
    if (Number(r.is_draft) === 1) throw new Error('Draft assignments cannot be added to a lesson');
    return;
  }
}

function replaceLessonLibraryComposition(lessonId, items, userId) {
  const seen = new Set();
  items.forEach((row) => {
    const key = `${row.type}:${row.id}`;
    if (seen.has(key)) throw new Error('Duplicate library item in composition');
    seen.add(key);
    validateLibraryRef(row.type, row.id);
  });

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM lesson_library_items WHERE lesson_id = ?').run(lessonId);
    db.prepare("DELETE FROM video_assignments WHERE scope_type = 'lesson' AND scope_id = ?").run(lessonId);
    db.prepare("DELETE FROM study_material_assignments WHERE scope_type = 'lesson' AND scope_id = ?").run(lessonId);
    db.prepare("DELETE FROM worksheet_assignments WHERE scope_type = 'lesson' AND scope_id = ?").run(lessonId);
    db.prepare("DELETE FROM quiz_assignments WHERE scope_type = 'lesson' AND scope_id = ?").run(lessonId);

    const insItem = db.prepare(
      `INSERT INTO lesson_library_items (lesson_id, sort_order, item_type, item_id) VALUES (?, ?, ?, ?)`,
    );
    const insVid = db.prepare(
      `INSERT INTO video_assignments (video_id, scope_type, scope_id, order_index, is_required, created_by)
       VALUES (?, 'lesson', ?, ?, 0, ?)`,
    );
    const insMat = db.prepare(
      `INSERT INTO study_material_assignments (material_id, scope_type, scope_id, order_index, is_required, created_by)
       VALUES (?, 'lesson', ?, ?, 0, ?)`,
    );
    const insWs = db.prepare(
      `INSERT INTO worksheet_assignments (worksheet_id, scope_type, scope_id, order_index, is_required, created_by)
       VALUES (?, 'lesson', ?, ?, 0, ?)`,
    );
    const insQz = db.prepare(
      `INSERT INTO quiz_assignments (quiz_version_id, scope_type, scope_id, order_index, is_required, created_by)
       VALUES (?, 'lesson', ?, ?, 0, ?)`,
    );

    items.forEach((row, idx) => {
      insItem.run(lessonId, idx, row.type, row.id);
      if (row.type === 'video') insVid.run(row.id, lessonId, idx, userId);
      else if (row.type === 'study_material') insMat.run(row.id, lessonId, idx, userId);
      else if (row.type === 'worksheet') insWs.run(row.id, lessonId, idx, userId);
      else if (row.type === 'quiz') {
        const ver = db.prepare('SELECT id FROM quiz_versions WHERE quiz_bank_id = ? ORDER BY version_no DESC LIMIT 1').get(row.id);
        insQz.run(ver.id, lessonId, idx, userId);
      }
    });
  });
  tx();
}

function resolveCompositionLabels(lessonId) {
  const rows = db
    .prepare(
      `SELECT sort_order, item_type, item_id FROM lesson_library_items WHERE lesson_id = ? ORDER BY sort_order ASC`,
    )
    .all(lessonId);
  const out = [];
  for (const r of rows) {
    let title = '';
    let description = '';
    if (r.item_type === 'video') {
      const v = db.prepare('SELECT title, description FROM video_library WHERE id = ?').get(r.item_id);
      title = v?.title || 'Video';
      description = v?.description || '';
    } else if (r.item_type === 'study_material') {
      const m = db.prepare('SELECT title, description FROM study_material_library WHERE id = ?').get(r.item_id);
      title = m?.title || 'Study material';
      description = m?.description || '';
    } else if (r.item_type === 'worksheet') {
      const w = db.prepare('SELECT title, description FROM worksheet_library WHERE id = ?').get(r.item_id);
      title = w?.title || 'Worksheet';
      description = w?.description || '';
    } else if (r.item_type === 'quiz') {
      const b = db.prepare('SELECT title, description FROM quiz_bank WHERE id = ?').get(r.item_id);
      title = b?.title || 'Quiz';
      description = b?.description || '';
    } else if (r.item_type === 'assignment') {
      const a = db.prepare('SELECT title, description FROM assignment_library WHERE id = ?').get(r.item_id);
      title = a?.title || 'Assignment';
      description = a?.description || '';
    }
    out.push({
      sortOrder: r.sort_order,
      type: r.item_type,
      id: r.item_id,
      title,
      description,
    });
  }
  return out;
}

function buildOrderedContentForLearner(reqUser, lessonId) {
  const rows = db
    .prepare(
      `SELECT sort_order, item_type, item_id FROM lesson_library_items WHERE lesson_id = ? ORDER BY sort_order ASC`,
    )
    .all(lessonId);
  const out = [];
  for (const r of rows) {
    if (r.item_type === 'video') {
      const v = db.prepare('SELECT id, title, description, video_url FROM video_library WHERE id = ?').get(r.item_id);
      if (!v) continue;
      const a = db
        .prepare(
          `SELECT a.id FROM video_assignments a WHERE a.video_id = ? AND a.scope_type = 'lesson' AND a.scope_id = ?`,
        )
        .get(r.item_id, lessonId);
      const videoUrl = v.video_url
        ? v.video_url.startsWith('http')
          ? v.video_url
          : `${baseUrl}${v.video_url}`
        : null;
      out.push({
        orderIndex: r.sort_order,
        type: 'video',
        id: v.id,
        title: v.title,
        description: v.description || '',
        videoUrl,
        videoAssignmentId: a?.id ?? null,
      });
    } else if (r.item_type === 'study_material') {
      const m = db.prepare('SELECT * FROM study_material_library WHERE id = ?').get(r.item_id);
      if (!m || !canViewStudyMaterial(reqUser, m)) continue;
      out.push({
        orderIndex: r.sort_order,
        type: 'study_material',
        id: m.id,
        title: m.title,
        description: m.description || '',
      });
    } else if (r.item_type === 'worksheet') {
      const w = db.prepare('SELECT * FROM worksheet_library WHERE id = ?').get(r.item_id);
      if (!w || !canViewWorksheet(reqUser, w)) continue;
      out.push({
        orderIndex: r.sort_order,
        type: 'worksheet',
        id: w.id,
        title: w.title,
        description: w.description || '',
      });
    } else if (r.item_type === 'quiz') {
      const b = db.prepare('SELECT id, title, description FROM quiz_bank WHERE id = ?').get(r.item_id);
      if (!b) continue;
      const ver = db
        .prepare('SELECT id FROM quiz_versions WHERE quiz_bank_id = ? ORDER BY version_no DESC LIMIT 1')
        .get(r.item_id);
      if (!ver) continue;
      const qa = db
        .prepare(
          `SELECT a.id FROM quiz_assignments a
           WHERE a.quiz_version_id = ? AND a.scope_type = 'lesson' AND a.scope_id = ?`,
        )
        .get(ver.id, lessonId);
      out.push({
        orderIndex: r.sort_order,
        type: 'quiz',
        id: b.id,
        title: b.title,
        description: b.description || '',
        quizVersionId: ver.id,
        quizAssignmentId: qa?.id ?? null,
      });
    } else if (r.item_type === 'assignment') {
      const al = db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(r.item_id);
      if (!al || !canViewAssignment(reqUser, al)) continue;
      out.push({
        orderIndex: r.sort_order,
        type: 'assignment',
        id: al.id,
        title: al.title,
        description: al.description || '',
      });
    }
  }
  return out;
}

function canAccessCourse(database, userId, role, courseId) {
  if (role === 'Admin') return true;
  const e =
    database
      .prepare("SELECT 1 FROM course_enrollments WHERE user_id = ? AND course_id = ? AND status = 'approved'")
      .get(userId, courseId)
    || database.prepare('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?').get(userId, courseId);
  return !!e || userHasCourseAccess(userId, courseId);
}

/** Admin: one row per day 1..duration (synced with course); lesson optional until assigned. */
router.get('/course/:courseId/schedule', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const courseId = Number(req.params.courseId);
  const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  syncCourseLessonSlots(courseId);
  const rows = db.prepare(`
    SELECT cl.id AS mapId, cl.day_number AS dayNumber, cl.sequence_in_day AS sequenceInDay,
           cl.lesson_id AS lessonId, ll.title AS lessonTitle
    FROM course_lessons cl
    LEFT JOIN lesson_library ll ON ll.id = cl.lesson_id
    WHERE cl.course_id = ? AND cl.sequence_in_day = 1
    ORDER BY cl.day_number, cl.id
  `).all(courseId);
  res.json(rows);
});

router.get('/course/:courseId', auth, (req, res) => {
  const { courseId } = req.params;
  const cid = Number(courseId);
  if (!Number.isFinite(cid)) return res.status(400).json({ error: 'Invalid course id' });
  if (!canAccessCourse(db, req.user.id, req.user.role, courseId)) {
    return res.status(403).json({ error: 'Not enrolled in this course' });
  }
  const staffBypass = ['Admin', 'Trainer', 'Creator'].includes(req.user.role);
  const courseRow = db.prepare('SELECT progression_type FROM courses WHERE id = ?').get(cid);
  const pt = String(courseRow?.progression_type || 'unlock_all').toLowerCase();
  let maxDay = null;
  if (!staffBypass && pt === 'day_wise') {
    maxDay = maxUnlockedLessonDay(req.user.id, cid);
  }
  const mapped = db.prepare(`
    SELECT cl.id, cl.course_id, ll.id AS lesson_id, ll.title, cl.day_number AS sort_order, ll.video_url
    FROM course_lessons cl
    JOIN lesson_library ll ON ll.id = cl.lesson_id
    WHERE cl.course_id = ?
    ORDER BY cl.day_number, cl.sequence_in_day, cl.id
  `).all(cid);
  let rows = mapped;
  if (maxDay != null && Number.isFinite(maxDay)) {
    rows = mapped.filter((m) => Number(m.sort_order) <= maxDay);
  }
  const lessons = rows.length
    ? rows.map((m) => ({
        id: m.lesson_id,
        map_id: m.id,
        course_id: m.course_id,
        title: m.title,
        sort_order: m.sort_order,
        video_url: m.video_url,
      }))
    : db
        .prepare('SELECT id, course_id, title, sort_order, video_url FROM lessons WHERE course_id = ? ORDER BY sort_order, id')
        .all(cid);
  res.json(lessons);
});

router.get('/:id', auth, (req, res) => {
  const courseIdParam = req.query.courseId != null && req.query.courseId !== '' ? Number(req.query.courseId) : null;
  let lesson = db.prepare(
    'SELECT id, course_id, title, sort_order, video_url FROM lessons WHERE id = ?'
  ).get(req.params.id);
  let fromLibrary = false;
  if (!lesson) {
    if (courseIdParam != null && Number.isFinite(courseIdParam)) {
      const mappedOne = db
        .prepare(
          `
      SELECT cl.course_id, ll.id, ll.title, cl.day_number AS sort_order, ll.video_url, ll.study_material_html, ll.worksheet_html, ll.worksheet_answer_key_html
      FROM lesson_library ll
      JOIN course_lessons cl ON cl.lesson_id = ll.id
      WHERE ll.id = ? AND cl.course_id = ?
      LIMIT 1
    `,
        )
        .get(req.params.id, courseIdParam);
      if (mappedOne) {
        lesson = mappedOne;
        fromLibrary = true;
      }
    }
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
  }
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  if (!canAccessCourse(db, req.user.id, req.user.role, lesson.course_id)) {
    return res.status(403).json({ error: 'Not enrolled in this course' });
  }
  const staffBypass = ['Admin', 'Trainer', 'Creator'].includes(req.user.role);
  if (!staffBypass && fromLibrary) {
    const cRow = db.prepare('SELECT progression_type FROM courses WHERE id = ?').get(lesson.course_id);
    const pt = String(cRow?.progression_type || 'unlock_all').toLowerCase();
    if (pt === 'day_wise') {
      const ln = lessonDayNumberForCourse(lesson.course_id, Number(req.params.id));
      const maxD = maxUnlockedLessonDay(req.user.id, lesson.course_id);
      if (ln != null && ln > maxD) {
        return res.status(403).json({ error: 'This lesson is not available until its class day (day-wise course).' });
      }
    }
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
  const libraryWorksheetAssignments = db.prepare(
    `SELECT a.id, a.worksheet_id, a.scope_type, a.scope_id, a.is_required, a.order_index,
            w.title AS worksheet_title, w.description AS worksheet_description, w.content_json
     FROM worksheet_assignments a
     JOIN worksheet_library w ON w.id = a.worksheet_id
     WHERE COALESCE(w.is_draft, 0) = 0
       AND ((a.scope_type = 'lesson' AND a.scope_id = ?)
        OR (a.scope_type = 'course' AND a.scope_id = ?))
     ORDER BY a.order_index, a.id`
  ).all(lesson.id, lesson.course_id);
  const allowVideoDownload = req.user.role === 'Admin';
  const videoUrl = lesson.video_url
    ? (lesson.video_url.startsWith('http') ? lesson.video_url : `${baseUrl}${lesson.video_url}`)
    : null;
  let orderedContent = null;
  if (fromLibrary) {
    try {
      orderedContent = buildOrderedContentForLearner(req.user, lesson.id);
    } catch (_) {
      orderedContent = [];
    }
  }
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
    libraryWorksheetAssignments,
    orderedContent,
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
    SELECT ll.*,
           (SELECT COUNT(*) FROM lesson_library_items li WHERE li.lesson_id = ll.id) AS item_count
    FROM lesson_library ll
    ORDER BY ll.id DESC
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

router.get('/library/:id/composition', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id FROM lesson_library WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Lesson not found' });
  try {
    const items = resolveCompositionLabels(id);
    res.json({ lessonId: id, items });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load composition' });
  }
});

router.put('/library/:id/composition', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id FROM lesson_library WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Lesson not found' });
  try {
    const items = normalizeCompositionItems(req.body);
    replaceLessonLibraryComposition(id, items, req.user.id);
    const labels = resolveCompositionLabels(id);
    res.json({ lessonId: id, items: labels });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Invalid composition' });
  }
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

router.delete('/library/:id', auth, requireRole('Admin', 'Trainer'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });

  try {
    db.prepare(
      `DELETE FROM quiz_attempts_v2 WHERE assignment_id IN (
        SELECT id FROM quiz_assignments WHERE scope_type = 'lesson' AND scope_id = ?
      )`,
    ).run(id);
    db.prepare("DELETE FROM video_assignments WHERE scope_type = 'lesson' AND scope_id = ?").run(id);
    db.prepare("DELETE FROM study_material_assignments WHERE scope_type = 'lesson' AND scope_id = ?").run(id);
    db.prepare("DELETE FROM worksheet_assignments WHERE scope_type = 'lesson' AND scope_id = ?").run(id);
    db.prepare("DELETE FROM quiz_assignments WHERE scope_type = 'lesson' AND scope_id = ?").run(id);
    db.prepare('DELETE FROM lesson_library_items WHERE lesson_id = ?').run(id);

    if (isSpacesConfigured()) {
      try {
        await deleteObjectsUnderPrefix(`pre-recorded/course-library/lesson-template-${id}/`);
      } catch (e) {
        console.error('[lesson-library-delete] Spaces template', id, e);
      }
    }

    db.prepare('DELETE FROM lesson_library WHERE id = ?').run(id);
    res.status(204).end();
  } catch (e) {
    console.error('[lesson-library-delete]', id, e);
    res.status(500).json({ error: e.message || 'Delete failed' });
  }
});

/** Assign or clear the lesson template for a fixed day slot (day count comes from course duration). */
router.put('/schedule/:mapId', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const mapId = Number(req.params.mapId);
  const row = db.prepare('SELECT * FROM course_lessons WHERE id = ?').get(mapId);
  if (!row) return res.status(404).json({ error: 'Schedule entry not found' });
  if (Number(row.sequence_in_day) !== 1) {
    return res.status(400).json({ error: 'Invalid schedule row' });
  }
  const { lessonId } = req.body;
  if (!Object.prototype.hasOwnProperty.call(req.body, 'lessonId')) {
    return res.status(400).json({ error: 'lessonId is required (null clears the assignment)' });
  }
  if (lessonId === null || lessonId === '') {
    db.prepare('UPDATE course_lessons SET lesson_id = NULL WHERE id = ?').run(mapId);
    return res.json({ ok: true });
  }
  const lid = Number(lessonId);
  if (!Number.isFinite(lid)) return res.status(400).json({ error: 'Invalid lessonId' });
  const lesson = db.prepare('SELECT id FROM lesson_library WHERE id = ?').get(lid);
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  try {
    db.prepare('UPDATE course_lessons SET lesson_id = ? WHERE id = ?').run(lid, mapId);
  } catch (e) {
    if (e && e.code && String(e.code).includes('CONSTRAINT')) {
      return res.status(409).json({ error: 'Could not assign lesson (constraint conflict)' });
    }
    throw e;
  }
  res.json({ ok: true });
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
