const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const uploadMemory = require('../uploadMemory');
const { isSpacesConfigured, uploadToSpaces } = require('../services/spaces');

const router = express.Router();

function parseJsonArray(value, fallback = []) {
  try {
    if (!value) return fallback;
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : fallback;
  } catch (_) {
    return fallback;
  }
}

function isHoliday(dateText) {
  return !!db.prepare('SELECT 1 FROM holidays WHERE holiday_date = ?').get(dateText);
}

function weekdayName(date) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

function generateSessionsForBatch(batchId, startDate, actorId) {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch) throw new Error('Batch not found');
  if (!batch.course_id) throw new Error('Batch has no course selected');

  const course = db.prepare('SELECT id, duration_days, lesson_schedule_json FROM courses WHERE id = ?').get(batch.course_id);
  if (!course) throw new Error('Course not found');

  const schedule = batch.training_schedule_json ? JSON.parse(batch.training_schedule_json) : {};
  const daysOfWeek = Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length
    ? schedule.daysOfWeek
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const startTime = schedule.startTime || null;
  const endTime = schedule.endTime || null;

  const mapRows = db.prepare(`
    SELECT cl.day_number, ll.id AS lesson_id, ll.title
    FROM course_lessons cl
    JOIN lesson_library ll ON ll.id = cl.lesson_id
    WHERE cl.course_id = ?
    ORDER BY cl.day_number, cl.sequence_in_day
  `).all(course.id);
  const lessonByDay = new Map();
  mapRows.forEach((r) => {
    if (!lessonByDay.has(r.day_number)) lessonByDay.set(r.day_number, r);
  });

  db.prepare('DELETE FROM batch_sessions WHERE batch_id = ?').run(batchId);

  const durationDays = Number(course.duration_days || 1);
  let day = 1;
  let cursor = new Date(`${startDate}T00:00:00`);
  while (day <= durationDays) {
    const dateText = cursor.toISOString().slice(0, 10);
    const wd = weekdayName(cursor);
    if (daysOfWeek.includes(wd) && !isHoliday(dateText)) {
      const mapped = lessonByDay.get(day);
      db.prepare(`
        INSERT INTO batch_sessions (batch_id, session_day, lesson_id, lesson_title, session_date, starts_at, ends_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')
      `).run(batchId, day, mapped?.lesson_id || null, mapped?.title || `Day ${String(day).padStart(2, '0')}`, dateText, startTime, endTime);
      day += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  db.prepare("UPDATE batches SET actual_start_date = ?, batch_status = 'started' WHERE id = ?").run(startDate, batchId);
  return db.prepare('SELECT * FROM batch_sessions WHERE batch_id = ? ORDER BY session_day').all(batchId);
}

router.get('/', auth, (req, res) => {
  const isAdmin = req.user.role === 'Admin';
  let rows;
  if (isAdmin) {
    rows = db.prepare(`
        SELECT b.*, c.name AS course_name
        FROM batches b
        LEFT JOIN courses c ON c.id = b.course_id
        ORDER BY b.id DESC
      `).all();
  } else if (req.user.role === 'Student' || req.user.role === 'Lab') {
    rows = db.prepare(`
        SELECT b.*, c.name AS course_name
        FROM batches b
        LEFT JOIN courses c ON c.id = b.course_id
        WHERE EXISTS (SELECT 1 FROM batch_members bm WHERE bm.batch_id = b.id AND bm.student_id = ?)
        ORDER BY b.id DESC
      `).all(req.user.id);
  } else {
    rows = db.prepare(`
        SELECT b.*, c.name AS course_name
        FROM batches b
        LEFT JOIN courses c ON c.id = b.course_id
        WHERE b.trainer_id = ? OR EXISTS (SELECT 1 FROM batch_trainers bt WHERE bt.batch_id = b.id AND bt.trainer_id = ?)
        ORDER BY b.id DESC
      `).all(req.user.id, req.user.id);
  }
  res.json(rows);
});

router.post('/', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const {
    title,
    batchType,
    courseId,
    trainingSchedule,
    meetingId,
    students,
    trainers,
    plannedStartDate,
    notes,
  } = req.body;
  if (!title || !batchType || !courseId) {
    return res.status(400).json({ error: 'title, batchType and courseId are required' });
  }
  const trainerId = req.user.role === 'Trainer' ? req.user.id : Number((trainers && trainers[0]) || req.user.id);
  const row = db.prepare(`
    INSERT INTO batches (
      name, title, session_type, trainer_id, created_by, course_id, training_schedule_json, meeting_id, planned_start_date, notes, batch_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(
    title.trim(),
    title.trim(),
    batchType,
    trainerId,
    req.user.id,
    Number(courseId),
    trainingSchedule ? JSON.stringify(trainingSchedule) : null,
    meetingId || null,
    plannedStartDate || null,
    notes || null
  );
  const batchId = row.lastInsertRowid;

  (Array.isArray(students) ? students : []).forEach((sid) => {
    db.prepare('INSERT OR IGNORE INTO batch_members (batch_id, student_id) VALUES (?, ?)').run(batchId, Number(sid));
  });
  (Array.isArray(trainers) ? trainers : [trainerId]).forEach((tid) => {
    db.prepare('INSERT OR IGNORE INTO batch_trainers (batch_id, trainer_id) VALUES (?, ?)').run(batchId, Number(tid));
  });

  const created = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  res.status(201).json(created);
});

router.post('/:id/start', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const startDate = req.body.startDate || new Date().toISOString().slice(0, 10);
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (req.user.role === 'Trainer' && batch.trainer_id !== req.user.id) {
    return res.status(403).json({ error: 'You can only start your own batch' });
  }
  try {
    const sessions = generateSessionsForBatch(batchId, startDate, req.user.id);
    res.json({ ok: true, sessions });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not start batch' });
  }
});

router.get('/:id/sessions', auth, (req, res) => {
  const batchId = Number(req.params.id);
  const sessions = db.prepare('SELECT * FROM batch_sessions WHERE batch_id = ? ORDER BY session_day').all(batchId);
  res.json(sessions);
});

router.get('/:id/sessions/audit', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const rows = db.prepare(`
    SELECT
      bs.id,
      bs.session_day,
      bs.session_date,
      bs.lesson_title,
      bs.status,
      bs.cancellation_reason,
      bs.updated_at,
      u.name AS cancelled_by_name,
      u.email AS cancelled_by_email
    FROM batch_sessions bs
    LEFT JOIN users u ON u.id = bs.cancelled_by
    WHERE bs.batch_id = ? AND bs.status = 'cancelled'
    ORDER BY bs.updated_at DESC, bs.id DESC
  `).all(batchId);
  res.json(rows);
});

router.get('/:id/members', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const members = db.prepare(`
    SELECT bm.student_id AS user_id, u.name, u.email, u.role
    FROM batch_members bm
    JOIN users u ON u.id = bm.student_id
    WHERE bm.batch_id = ?
    ORDER BY u.name
  `).all(batchId);
  res.json(members);
});

router.post('/:id/members', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const studentId = Number(req.body.studentId);
  if (!studentId) return res.status(400).json({ error: 'studentId is required' });
  const user = db.prepare("SELECT id, role FROM users WHERE id = ? AND role IN ('Student','Lab')").get(studentId);
  if (!user) return res.status(404).json({ error: 'Student/Lab user not found' });
  db.prepare('INSERT OR IGNORE INTO batch_members (batch_id, student_id) VALUES (?, ?)').run(batchId, studentId);
  res.status(201).json({ ok: true });
});

router.delete('/:id/members/:studentId', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const studentId = Number(req.params.studentId);
  db.prepare('DELETE FROM batch_members WHERE batch_id = ? AND student_id = ?').run(batchId, studentId);
  res.status(204).end();
});

router.get('/:id/trainers', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const trainers = db.prepare(`
    SELECT bt.trainer_id AS user_id, u.name, u.email, u.role
    FROM batch_trainers bt
    JOIN users u ON u.id = bt.trainer_id
    WHERE bt.batch_id = ?
    ORDER BY u.name
  `).all(batchId);
  res.json(trainers);
});

router.post('/:id/trainers', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const trainerId = Number(req.body.trainerId);
  if (!trainerId) return res.status(400).json({ error: 'trainerId is required' });
  const user = db.prepare("SELECT id FROM users WHERE id = ? AND role = 'Trainer'").get(trainerId);
  if (!user) return res.status(404).json({ error: 'Trainer not found' });
  db.prepare('INSERT OR IGNORE INTO batch_trainers (batch_id, trainer_id) VALUES (?, ?)').run(batchId, trainerId);
  db.prepare('UPDATE batches SET trainer_id = COALESCE(trainer_id, ?) WHERE id = ?').run(trainerId, batchId);
  res.status(201).json({ ok: true });
});

router.delete('/:id/trainers/:trainerId', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const trainerId = Number(req.params.trainerId);
  db.prepare('DELETE FROM batch_trainers WHERE batch_id = ? AND trainer_id = ?').run(batchId, trainerId);
  res.status(204).end();
});

router.get('/my/today', auth, (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(`
    SELECT bs.*, b.title AS batch_title, b.name AS batch_name, b.id AS batch_id
    FROM batch_sessions bs
    JOIN batches b ON b.id = bs.batch_id
    WHERE bs.session_date = ?
      AND (
        ? = 'Admin'
        OR (? IN ('Student','Lab') AND EXISTS (SELECT 1 FROM batch_members bm WHERE bm.batch_id = b.id AND bm.student_id = ?))
        OR (? = 'Trainer' AND (b.trainer_id = ? OR EXISTS (SELECT 1 FROM batch_trainers bt WHERE bt.batch_id = b.id AND bt.trainer_id = ?)))
      )
    ORDER BY bs.starts_at
  `).all(today, req.user.role, req.user.role, req.user.id, req.user.role, req.user.id, req.user.id);
  res.json(rows);
});

router.post('/:id/sessions/:sessionId/cancel', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const reason = String(req.body.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  const session = db.prepare('SELECT * FROM batch_sessions WHERE id = ? AND batch_id = ?').get(sessionId, batchId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  db.prepare(`
    UPDATE batch_sessions
    SET status = 'cancelled', cancellation_reason = ?, cancelled_by = ?
    WHERE id = ?
  `).run(reason, req.user.id, sessionId);

  const tail = db.prepare(`
    SELECT * FROM batch_sessions
    WHERE batch_id = ? AND session_day > ? AND status = 'scheduled'
    ORDER BY session_day
  `).all(batchId, session.session_day);
  tail.forEach((row) => {
    db.prepare('UPDATE batch_sessions SET session_day = ? WHERE id = ?').run(row.session_day - 1, row.id);
  });

  res.json({ ok: true });
});

router.post('/:id/assignments', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const { title, description, dueDate } = req.body;
  if (!title) return res.status(400).json({ error: 'title is required' });
  const result = db.prepare(`
    INSERT INTO batch_assignments (batch_id, title, description, due_date, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(batchId, title.trim(), description || null, dueDate || null, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM batch_assignments WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/:id/assignments', auth, (req, res) => {
  const batchId = Number(req.params.id);
  const assignments = db.prepare('SELECT * FROM batch_assignments WHERE batch_id = ? ORDER BY id DESC').all(batchId);
  res.json(assignments);
});

router.post('/:id/assignments/:assignmentId/submit', auth, requireRole('Student', 'Lab'), uploadMemory.single('file'), async (req, res) => {
  const batchId = Number(req.params.id);
  const assignmentId = Number(req.params.assignmentId);
  if (!req.file) return res.status(400).json({ error: 'PDF file required' });
  if (!isSpacesConfigured()) return res.status(503).json({ error: 'Spaces is not configured' });

  const isMember = db.prepare('SELECT 1 FROM batch_members WHERE batch_id = ? AND student_id = ?').get(batchId, req.user.id);
  if (!isMember) return res.status(403).json({ error: 'Not a student in this batch' });

  const ext = (req.file.originalname || '').toLowerCase().endsWith('.pdf') ? '.pdf' : '.pdf';
  const fileName = `${Date.now()}-${req.user.id}-assignment${ext}`;
  const key = `live-recordings/assignments/batch-${batchId}/assignment-${assignmentId}/${fileName}`;
  const uploaded = await uploadToSpaces({
    buffer: req.file.buffer,
    mimeType: 'application/pdf',
    key,
  });

  db.prepare(`
    INSERT INTO assignment_submissions (assignment_id, batch_id, student_id, file_key, file_url)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(assignment_id, student_id) DO UPDATE SET file_key = excluded.file_key, file_url = excluded.file_url, submitted_at = datetime('now')
  `).run(assignmentId, batchId, req.user.id, uploaded.key, uploaded.publicUrl);

  res.status(201).json({ ok: true, fileUrl: uploaded.publicUrl });
});

router.get('/:id/assignments/:assignmentId/submissions', auth, (req, res) => {
  const batchId = Number(req.params.id);
  const assignmentId = Number(req.params.assignmentId);
  const submissions = db.prepare(`
    SELECT s.id, s.student_id, u.name AS student_name, u.email AS student_email, s.file_url, s.submitted_at
    FROM assignment_submissions s
    JOIN users u ON u.id = s.student_id
    WHERE s.batch_id = ? AND s.assignment_id = ?
    ORDER BY s.submitted_at DESC
  `).all(batchId, assignmentId);
  res.json(submissions);
});

router.get('/holidays/list', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const rows = db.prepare('SELECT * FROM holidays ORDER BY holiday_date').all();
  res.json(rows);
});

router.post('/holidays', auth, requireRole('Admin'), (req, res) => {
  const { holidayDate, reason } = req.body;
  if (!holidayDate) return res.status(400).json({ error: 'holidayDate is required' });
  db.prepare('INSERT OR REPLACE INTO holidays (holiday_date, reason, created_by) VALUES (?, ?, ?)')
    .run(holidayDate, reason || null, req.user.id);
  res.status(201).json({ ok: true });
});

router.delete('/holidays/:date', auth, requireRole('Admin'), (req, res) => {
  db.prepare('DELETE FROM holidays WHERE holiday_date = ?').run(req.params.date);
  res.status(204).end();
});

module.exports = router;
