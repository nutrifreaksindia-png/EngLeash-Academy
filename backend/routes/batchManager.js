const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const uploadMemory = require('../uploadMemory');
const { isSpacesConfigured, uploadToSpaces, deleteObjectsUnderPrefix } = require('../services/spaces');
const { ensureLiveSessionsForBatch, combineDateTime } = require('../services/ensureLiveSessionsForBatch');
const liveRecording = require('../services/liveRecording');

const router = express.Router();
const {
  syncBatchMemberCourseAccess,
  syncAllBatchMembersCourseAccess,
  removeBatchStudentAccess,
  purgeAllMembersAccessForDeletingBatch,
} = require('../lib/courseAccess');

function normalizeBatchCoursesInput(body) {
  const rows = [];
  const seen = new Set();

  if (Array.isArray(body.courses) && body.courses.length) {
    for (let i = 0; i < body.courses.length; i += 1) {
      const item = body.courses[i];
      const courseId = item?.courseId != null && item.courseId !== '' ? Number(item.courseId) : null;
      if (courseId == null || !Number.isFinite(courseId)) continue;
      if (seen.has(courseId)) return { ok: false, error: 'Duplicate course in courses list' };
      seen.add(courseId);
      const pkgRaw = item?.subscriptionPackageId ?? item?.billingPackageId;
      const pkgNum = pkgRaw != null && pkgRaw !== '' ? Number(pkgRaw) : null;
      rows.push({
        courseId,
        subscriptionPackageId: Number.isFinite(pkgNum) ? pkgNum : null,
        sortOrder: rows.length,
      });
    }
    return { ok: true, rows };
  }

  const legacyCid = body.courseId != null && body.courseId !== '' ? Number(body.courseId) : null;
  if (legacyCid != null && Number.isFinite(legacyCid)) {
    const pkgRaw = body.subscriptionPackageId;
    const pkgNum = pkgRaw != null && pkgRaw !== '' ? Number(pkgRaw) : null;
    rows.push({
      courseId: legacyCid,
      subscriptionPackageId: Number.isFinite(pkgNum) ? pkgNum : null,
      sortOrder: 0,
    });
  }
  return { ok: true, rows };
}

function validateBatchCourseRows(rows) {
  for (const r of rows) {
    const course = db.prepare('SELECT id, enrollment_type FROM courses WHERE id = ?').get(r.courseId);
    if (!course) return { ok: false, error: `Course ${r.courseId} not found` };
    const et = String(course.enrollment_type || '').toLowerCase();
    if (et === 'subscribe' && !r.subscriptionPackageId) {
      return { ok: false, error: 'Each subscribe course on the batch must have a subscription package' };
    }
    if (r.subscriptionPackageId) {
      const pkg = db
        .prepare(
          `SELECT id FROM billing_packages WHERE id = ? AND scope = 'course' AND course_id = ?
           AND package_kind = 'subscription' AND is_active = 1`,
        )
        .get(r.subscriptionPackageId, r.courseId);
      if (!pkg) return { ok: false, error: `Invalid subscription package for course ${r.courseId}` };
    }
  }
  return { ok: true };
}

function legacyBatchCourseColumnsFromRows(rows) {
  const first = rows.length ? rows[0] : null;
  return {
    course_id: first ? first.courseId : null,
    subscription_package_id: first && first.subscriptionPackageId ? first.subscriptionPackageId : null,
  };
}

function persistBatchCourses(batchId, rows) {
  db.prepare('DELETE FROM batch_courses WHERE batch_id = ?').run(batchId);
  const ins = db.prepare(`
    INSERT INTO batch_courses (batch_id, course_id, billing_package_id, sort_order)
    VALUES (?, ?, ?, ?)
  `);
  for (const r of rows) {
    ins.run(batchId, r.courseId, r.subscriptionPackageId || null, r.sortOrder);
  }
}

function parseJsonArray(value, fallback = []) {
  try {
    if (!value) return fallback;
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : fallback;
  } catch (_) {
    return fallback;
  }
}

/** Admin UI may set batches.trainer_id to a non-trainer (e.g. creator); lead is then first row in batch_trainers. */
function trainerCanEditRestrictedBatchFields(batchId, batch, userId) {
  const primary = db.prepare('SELECT role FROM users WHERE id = ?').get(batch.trainer_id);
  const primaryIsTrainer = primary && primary.role === 'Trainer';
  if (primaryIsTrainer && batch.trainer_id === userId) return true;
  if (!primaryIsTrainer) {
    const first = db
      .prepare('SELECT trainer_id FROM batch_trainers WHERE batch_id = ? ORDER BY id ASC LIMIT 1')
      .get(batchId);
    if (first && first.trainer_id === userId) return true;
  }
  return false;
}

function assertBatchStaffAccess(req, batchId, batch) {
  if (req.user.role === 'Admin') return;
  if (req.user.role === 'Trainer') {
    const ok =
      batch.trainer_id === req.user.id ||
      db.prepare('SELECT 1 FROM batch_trainers WHERE batch_id = ? AND trainer_id = ?').get(batchId, req.user.id);
    if (!ok) {
      const e = new Error('Forbidden');
      e.statusCode = 403;
      throw e;
    }
    return;
  }
  const e = new Error('Forbidden');
  e.statusCode = 403;
  throw e;
}

function isHoliday(dateText) {
  return !!db.prepare('SELECT 1 FROM holidays WHERE holiday_date = ?').get(dateText);
}

function weekdayName(date) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()];
}

function parseLocalDate(dateText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  return new Date(y, mo - 1, d);
}

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseSessionInstantMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return NaN;
  const hasTz = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw);
  if (hasTz) return new Date(raw).getTime();
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return new Date(raw).getTime();
  const defaultOffsetMin = Number(process.env.LIVE_DEFAULT_TZ_OFFSET_MINUTES || 330);
  const sign = defaultOffsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(defaultOffsetMin);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  const sec = m[3] || '00';
  return new Date(`${m[1]}T${m[2]}:${sec}${sign}${hh}:${mm}`).getTime();
}

function nextEligibleSessionDate(afterDateText, daysOfWeek) {
  const base = parseLocalDate(afterDateText);
  if (!base) return null;
  const cursor = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  for (let i = 0; i < 366; i += 1) {
    cursor.setDate(cursor.getDate() + 1);
    const dateText = formatLocalDate(cursor);
    const wd = weekdayName(cursor);
    if (daysOfWeek.includes(wd) && !isHoliday(dateText)) return dateText;
  }
  return null;
}

function generateSessionsForBatch(batchId, startDate, actorId) {
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch) throw new Error('Batch not found');

  const schedule = batch.training_schedule_json ? JSON.parse(batch.training_schedule_json) : {};
  const daysOfWeek = Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length
    ? schedule.daysOfWeek
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const startTime = schedule.startTime || null;
  const endTime = schedule.endTime || null;

  const lessonByDay = new Map();
  /** How many numbered session days (N teaching meetings) to create. */
  let durationCap = null;

  if (batch.course_id) {
    const course = db.prepare('SELECT id, duration_days, lesson_schedule_json FROM courses WHERE id = ?').get(
      batch.course_id
    );
    if (!course) throw new Error('Course not found');

    const mapRows = db.prepare(`
      SELECT cl.day_number, ll.id AS lesson_id, ll.title AS lesson_title
      FROM course_lessons cl
      JOIN lesson_library ll ON ll.id = cl.lesson_id
      WHERE cl.course_id = ?
      ORDER BY cl.day_number, cl.sequence_in_day
    `).all(course.id);
    mapRows.forEach((r) => {
      if (!lessonByDay.has(r.day_number)) lessonByDay.set(r.day_number, r);
    });

    durationCap =
      batch.duration_days != null && Number(batch.duration_days) > 0
        ? Number(batch.duration_days)
        : Number(course.duration_days || 1);
  } else {
    const n =
      batch.duration_days != null && Number(batch.duration_days) > 0 ? Number(batch.duration_days) : null;
    if (!Number.isFinite(n) || n < 1) {
      throw new Error(
        'Set session count on the batch (Course & duration dialog) before starting without a linked course.'
      );
    }
    durationCap = n;
  }

  db.prepare('DELETE FROM batch_sessions WHERE batch_id = ?').run(batchId);
  let day = 1;
  const startCursor = parseLocalDate(startDate);
  if (!startCursor) throw new Error('startDate must be YYYY-MM-DD');
  const cursor = new Date(startCursor.getFullYear(), startCursor.getMonth(), startCursor.getDate());
  while (day <= durationCap) {
    const dateText = formatLocalDate(cursor);
    const wd = weekdayName(cursor);
    if (daysOfWeek.includes(wd) && !isHoliday(dateText)) {
      const mapped = lessonByDay.get(day);
      db.prepare(`
        INSERT INTO batch_sessions (batch_id, session_day, lesson_id, lesson_title, session_date, starts_at, ends_at, status, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', datetime('now'))
      `).run(
        batchId,
        day,
        mapped?.lesson_id || null,
        String(mapped?.lesson_title || '').trim() || `Day ${String(day).padStart(2, '0')}`,
        dateText,
        startTime,
        endTime
      );
      day += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  db.prepare("UPDATE batches SET actual_start_date = ?, batch_status = 'started' WHERE id = ?").run(startDate, batchId);
  return db.prepare('SELECT * FROM batch_sessions WHERE batch_id = ? ORDER BY session_day').all(batchId);
}

function lessonByDayMapForCourse(courseId) {
  if (!courseId) return new Map();
  const rows = db.prepare(`
    SELECT cl.day_number, ll.id AS lesson_id, ll.title AS lesson_title
    FROM course_lessons cl
    JOIN lesson_library ll ON ll.id = cl.lesson_id
    WHERE cl.course_id = ?
    ORDER BY cl.day_number, cl.sequence_in_day
  `).all(courseId);
  const map = new Map();
  rows.forEach((r) => {
    if (!map.has(r.day_number)) {
      map.set(Number(r.day_number), {
        lesson_id: r.lesson_id,
        lesson_title: String(r.lesson_title || '').trim(),
      });
    }
  });
  return map;
}

function isBatchTeachingSlotConsumed(row) {
  if (row.status === 'completed') return true;
  const endInstant = combineDateTime(row.session_date, row.ends_at);
  const endMs = parseSessionInstantMs(row.live_ends_at || endInstant || '');
  if (!Number.isNaN(endMs) && Date.now() > endMs) return true;
  const ls = String(row.live_status || '').toLowerCase();
  if (ls === 'ended' || ls === 'cancelled') return true;
  return false;
}

/** After cancellations: walk non-cancelled sessions in calendar order. Each slot consumes one curriculum day.
 * Past/completed slots keep stored lessons; future scheduled slots get lesson(courseDay). */
function remapLessonsForBatch(batchId, courseId) {
  const lessonMap = lessonByDayMapForCourse(courseId);
  const rows = db
    .prepare(
      `
    SELECT bs.id, bs.status, bs.session_date, bs.session_day,
           ls.ends_at AS live_ends_at, ls.status AS live_status
    FROM batch_sessions bs
    LEFT JOIN live_sessions ls ON ls.batch_session_id = bs.id
    WHERE bs.batch_id = ? AND bs.status != 'cancelled'
    ORDER BY bs.session_date ASC, bs.session_day ASC
  `
    )
    .all(batchId);
  let curriculumDay = 1;
  const upd = db.prepare(`
    UPDATE batch_sessions
    SET lesson_id = ?, lesson_title = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  for (const row of rows) {
    const mapped = lessonMap.get(curriculumDay);
    const title =
      String(mapped?.lesson_title || '').trim() || `Day ${String(curriculumDay).padStart(2, '0')}`;
    const consumed = isBatchTeachingSlotConsumed(row);
    const shouldRewrite = row.status === 'scheduled' && !consumed;
    if (shouldRewrite) {
      upd.run(mapped?.lesson_id || null, title, row.id);
    }
    curriculumDay += 1;
  }
}

router.get('/', auth, (req, res) => {
  const isAdmin = req.user.role === 'Admin';
  let rows;
  const courseNameExpr =
    "COALESCE((SELECT GROUP_CONCAT(co.name, ' · ') FROM batch_courses bc JOIN courses co ON co.id = bc.course_id WHERE bc.batch_id = b.id), c.name) AS course_name";

  if (isAdmin) {
    rows = db.prepare(`
        SELECT b.*, ${courseNameExpr}
        FROM batches b
        LEFT JOIN courses c ON c.id = b.course_id
        ORDER BY b.id DESC
      `).all();
  } else if (req.user.role === 'Student' || req.user.role === 'Lab') {
    rows = db.prepare(`
        SELECT b.*, ${courseNameExpr}
        FROM batches b
        LEFT JOIN courses c ON c.id = b.course_id
        WHERE EXISTS (SELECT 1 FROM batch_members bm WHERE bm.batch_id = b.id AND bm.student_id = ?)
        ORDER BY b.id DESC
      `).all(req.user.id);
  } else {
    rows = db.prepare(`
        SELECT b.*, ${courseNameExpr}
        FROM batches b
        LEFT JOIN courses c ON c.id = b.course_id
        WHERE b.trainer_id = ? OR EXISTS (SELECT 1 FROM batch_trainers bt WHERE bt.batch_id = b.id AND bt.trainer_id = ?)
        ORDER BY b.id DESC
      `).all(req.user.id, req.user.id);
  }
  res.json(rows);
});

/** Active course-scoped subscription packages (for batch subscription_package_id). Trainers need this; public billing list requires published courses. */
router.get('/course/:courseId/subscribe-packages', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course id' });
  const course = db.prepare('SELECT id, enrollment_type, name FROM courses WHERE id = ?').get(courseId);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const rows = db
    .prepare(
      `SELECT id, package_kind, duration_unit, duration_count, fee_inr, discount_inr, sort_order, is_active
       FROM billing_packages
       WHERE scope = 'course' AND course_id = ? AND package_kind = 'subscription'
       ORDER BY sort_order ASC, id ASC`,
    )
    .all(courseId);
  res.json({
    course: { id: course.id, name: course.name, enrollmentType: course.enrollment_type },
    packages: rows.map((r) => ({ ...r, is_active: !!r.is_active })),
  });
});

router.get('/:id(\\d+)', auth, requireRole('Admin', 'Trainer', 'Student', 'Lab'), (req, res) => {
  const batchId = Number(req.params.id);
  const courseNameExpr =
    "COALESCE((SELECT GROUP_CONCAT(co.name, ' · ') FROM batch_courses bc JOIN courses co ON co.id = bc.course_id WHERE bc.batch_id = b.id), c.name) AS course_name";

  const row = db.prepare(`SELECT b.*, ${courseNameExpr} FROM batches b LEFT JOIN courses c ON c.id = b.course_id WHERE b.id = ?`).get(batchId);
  if (!row) return res.status(404).json({ error: 'Batch not found' });
  if (req.user.role === 'Student' || req.user.role === 'Lab') {
    const member = db
      .prepare('SELECT 1 FROM batch_members WHERE batch_id = ? AND student_id = ?')
      .get(batchId, req.user.id);
    if (!member) return res.status(403).json({ error: 'Forbidden' });
  } else if (req.user.role === 'Trainer') {
    const ok =
      row.trainer_id === req.user.id ||
      db.prepare('SELECT 1 FROM batch_trainers WHERE batch_id = ? AND trainer_id = ?').get(batchId, req.user.id);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  let batchCourses = db
    .prepare(
      `
      SELECT bc.course_id, bc.billing_package_id AS subscription_package_id, bc.sort_order,
             c.name AS course_name, c.enrollment_type
      FROM batch_courses bc
      JOIN courses c ON c.id = bc.course_id
      WHERE bc.batch_id = ?
      ORDER BY bc.sort_order ASC, bc.id ASC`,
    )
    .all(batchId);

  if (!batchCourses.length && row.course_id) {
    const cm = db.prepare('SELECT enrollment_type FROM courses WHERE id = ?').get(row.course_id);
    batchCourses = [
      {
        course_id: row.course_id,
        subscription_package_id: row.subscription_package_id ?? null,
        sort_order: 0,
        course_name: db.prepare('SELECT name FROM courses WHERE id = ?').get(row.course_id)?.name || null,
        enrollment_type: cm?.enrollment_type ?? null,
      },
    ];
  }

  res.json({ ...row, batchCourses });
});

router.put('/:id(\\d+)', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (req.user.role === 'Trainer') {
    const ok =
      batch.trainer_id === req.user.id ||
      db.prepare('SELECT 1 FROM batch_trainers WHERE batch_id = ? AND trainer_id = ?').get(batchId, req.user.id);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }

  if (req.user.role === 'Trainer' && !trainerCanEditRestrictedBatchFields(batchId, batch, req.user.id)) {
    const bt = req.body.title;
    const bn = req.body.batchNumber;
    let bodyCourseId = batch.course_id;
    if ('courseId' in req.body) {
      bodyCourseId =
        req.body.courseId == null || req.body.courseId === '' ? null : Number(req.body.courseId);
    }
    const touchesRestricted =
      (bt != null && String(bt).trim() && String(bt).trim() !== batch.title) ||
      ('courseId' in req.body && bodyCourseId !== batch.course_id) ||
      ('courses' in req.body && Array.isArray(req.body.courses)) ||
      (bn != null && bn !== '' && Number(bn) !== batch.batch_number);
    if (touchesRestricted) {
      return res.status(403).json({
        error: 'Only the lead trainer can change title, course, or batch number',
      });
    }
  }

  const {
    title,
    plannedStartDate,
    durationDays,
    trainingSchedule,
    notes,
    batchNumber,
    meetingId,
    enrollmentOpenStatus,
    subscriptionPackageId,
  } = req.body;

  let nextTitle = batch.title;
  let nextName = batch.name;
  if (title != null && String(title).trim()) {
    nextTitle = String(title).trim();
    nextName = nextTitle;
  }

  let nextCourseId = batch.course_id;
  let nextSubscriptionPackageId = batch.subscription_package_id;

  if ('courses' in req.body && Array.isArray(req.body.courses)) {
    const normalized = normalizeBatchCoursesInput({ courses: req.body.courses });
    if (!normalized.ok) return res.status(400).json({ error: normalized.error });
    const chk = validateBatchCourseRows(normalized.rows);
    if (!chk.ok) return res.status(400).json({ error: chk.error });
    persistBatchCourses(batchId, normalized.rows);
    const leg = legacyBatchCourseColumnsFromRows(normalized.rows);
    nextCourseId = leg.course_id;
    nextSubscriptionPackageId = leg.subscription_package_id;
  } else {
    if ('courseId' in req.body) {
      nextCourseId =
        req.body.courseId == null || req.body.courseId === '' ? null : Number(req.body.courseId);
      if (nextCourseId != null && !Number.isFinite(nextCourseId)) {
        return res.status(400).json({ error: 'Invalid courseId' });
      }
    }

    if ('subscriptionPackageId' in req.body) {
      nextSubscriptionPackageId =
        subscriptionPackageId == null || subscriptionPackageId === ''
          ? null
          : Number(subscriptionPackageId);
      if (nextSubscriptionPackageId != null && !Number.isFinite(nextSubscriptionPackageId)) {
        return res.status(400).json({ error: 'Invalid subscriptionPackageId' });
      }
    }

    if ('courseId' in req.body || 'subscriptionPackageId' in req.body) {
      const rows =
        nextCourseId != null
          ? [
              {
                courseId: nextCourseId,
                subscriptionPackageId: nextSubscriptionPackageId,
                sortOrder: 0,
              },
            ]
          : [];
      const chk = validateBatchCourseRows(rows);
      if (!chk.ok) return res.status(400).json({ error: chk.error });
      persistBatchCourses(batchId, rows);
    }
  }

  let nextBatchNumber = batch.batch_number;
  if (batchNumber != null && batchNumber !== '') {
    const bn = Number(batchNumber);
    if (!Number.isFinite(bn) || bn < 1) return res.status(400).json({ error: 'Invalid batchNumber' });
    const clash = db
      .prepare('SELECT id FROM batches WHERE session_type = ? AND batch_number = ? AND id != ?')
      .get(batch.session_type, bn, batchId);
    if (clash) return res.status(409).json({ error: 'Batch number already used for this batch type' });
    nextBatchNumber = bn;
  }

  const nextPlanned =
    plannedStartDate !== undefined ? plannedStartDate || null : batch.planned_start_date;
  let nextDur = batch.duration_days;
  if (durationDays !== undefined) {
    nextDur =
      durationDays === null || durationDays === ''
        ? null
        : Number(durationDays);
    if (nextDur != null && (!Number.isFinite(nextDur) || nextDur < 1)) {
      return res.status(400).json({ error: 'Invalid durationDays' });
    }
  }

  let nextSchedule = batch.training_schedule_json;
  if (trainingSchedule !== undefined) {
    if (batch.batch_status === 'started') {
      return res.status(409).json({ error: 'Cannot change class schedule after the batch has started' });
    }
    nextSchedule = trainingSchedule ? JSON.stringify(trainingSchedule) : null;
  }

  const nextNotes = notes !== undefined ? notes || null : batch.notes;
  const nextMeeting = meetingId !== undefined ? meetingId || null : batch.meeting_id;
  const nextEnrollmentOpenStatus =
    enrollmentOpenStatus === 'open' || enrollmentOpenStatus === 'closed'
      ? enrollmentOpenStatus
      : batch.enrollment_open_status || 'closed';

  db.prepare(
    `
    UPDATE batches SET
      name = ?, title = ?, course_id = ?, planned_start_date = ?, duration_days = ?,
      training_schedule_json = ?, notes = ?, meeting_id = ?, batch_number = ?, enrollment_open_status = ?,
      subscription_package_id = ?
    WHERE id = ?
  `
  ).run(
    nextName,
    nextTitle,
    nextCourseId,
    nextPlanned,
    nextDur,
    nextSchedule,
    nextNotes,
    nextMeeting,
    nextBatchNumber,
    nextEnrollmentOpenStatus,
    nextSubscriptionPackageId,
    batchId
  );

  const courseLinkageChanged =
    ('courses' in req.body && Array.isArray(req.body.courses)) ||
    'courseId' in req.body ||
    'subscriptionPackageId' in req.body;

  if (courseLinkageChanged) {
    const memberRows = db.prepare('SELECT student_id FROM batch_members WHERE batch_id = ?').all(batchId);
    for (const m of memberRows) {
      try {
        syncBatchMemberCourseAccess(batchId, m.student_id);
      } catch (_) {
        /* best-effort */
      }
    }
  }

  const courseNameExpr =
    "COALESCE((SELECT GROUP_CONCAT(co.name, ' · ') FROM batch_courses bc JOIN courses co ON co.id = bc.course_id WHERE bc.batch_id = b.id), c.name) AS course_name";

  const updated = db.prepare(`SELECT b.*, ${courseNameExpr} FROM batches b LEFT JOIN courses c ON c.id = b.course_id WHERE b.id = ?`).get(batchId);

  let batchCourses = db
    .prepare(
      `
      SELECT bc.course_id, bc.billing_package_id AS subscription_package_id, bc.sort_order,
             c.name AS course_name, c.enrollment_type
      FROM batch_courses bc
      JOIN courses c ON c.id = bc.course_id
      WHERE bc.batch_id = ?
      ORDER BY bc.sort_order ASC, bc.id ASC`,
    )
    .all(batchId);

  if (!batchCourses.length && updated.course_id) {
    const cm = db.prepare('SELECT enrollment_type FROM courses WHERE id = ?').get(updated.course_id);
    batchCourses = [
      {
        course_id: updated.course_id,
        subscription_package_id: updated.subscription_package_id ?? null,
        sort_order: 0,
        course_name: db.prepare('SELECT name FROM courses WHERE id = ?').get(updated.course_id)?.name || null,
        enrollment_type: cm?.enrollment_type ?? null,
      },
    ];
  }

  res.json({ ...updated, batchCourses });
});

router.delete('/:id(\\d+)', auth, requireRole('Admin'), async (req, res) => {
  const batchId = Number(req.params.id);
  const batch = db.prepare('SELECT id, batch_status FROM batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  const wantFull =
    req.query.full === '1' ||
    req.query.full === 'true' ||
    String(req.body?.confirmFullDelete || '').toLowerCase() === 'true';

  if (batch.batch_status === 'started' && !wantFull) {
    return res.status(409).json({
      error:
        'Started batches need a full delete. In web admin choose “Delete batch completely”, or call DELETE /batch-manager/:id?full=1 (removes Spaces recordings and all related rows).',
    });
  }

  try {
    const prefixRows = db
      .prepare(
        `SELECT DISTINCT storage_prefix FROM live_session_recordings WHERE batch_id = ? AND storage_prefix IS NOT NULL`,
      )
      .all(batchId);
    const prefixes = prefixRows.map((r) => String(r.storage_prefix || '').replace(/^\/+/, '')).filter(Boolean);

    if (isSpacesConfigured()) {
      /* eslint-disable no-await-in-loop */
      for (const p of prefixes) {
        try {
          await deleteObjectsUnderPrefix(p);
        } catch (e) {
          console.error('[batch-delete] Spaces prefix', p, e);
        }
      }
      try {
        await deleteObjectsUnderPrefix(`live-recordings/live-session-recordings/batch-${batchId}/`);
      } catch (e) {
        console.error('[batch-delete] Spaces batch recordings root', e);
      }
      try {
        await deleteObjectsUnderPrefix(`live-recordings/assignments/batch-${batchId}/`);
      } catch (e) {
        console.error('[batch-delete] Spaces assignment uploads', e);
      }
      /* eslint-enable no-await-in-loop */
    }

    /* course_enrollments.batch_id / course_access_grants.batch_id were added without ON DELETE CASCADE */
    db.transaction(() => {
      purgeAllMembersAccessForDeletingBatch(batchId);
      db.prepare('UPDATE course_enrollments SET batch_id = NULL WHERE batch_id = ?').run(batchId);
      db.prepare('DELETE FROM course_access_grants WHERE batch_id = ?').run(batchId);
      db.prepare('DELETE FROM batches WHERE id = ?').run(batchId);
    })();
    res.status(204).end();
  } catch (e) {
    console.error('[batch-delete]', batchId, e);
    res.status(500).json({ error: e.message || 'Batch delete failed' });
  }
});

router.post('/', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const {
    title,
    batchType,
    trainingSchedule,
    meetingId,
    students,
    trainers,
    plannedStartDate,
    notes,
    batchNumber,
    durationDays,
    enrollmentOpenStatus,
  } = req.body;

  if (!title || !batchType || batchNumber == null || batchNumber === '') {
    return res.status(400).json({ error: 'title, batchType and batchNumber are required' });
  }
  const bn = Number(batchNumber);
  if (!Number.isFinite(bn) || bn < 1) {
    return res.status(400).json({ error: 'Invalid batchNumber' });
  }
  const clash = db.prepare('SELECT id FROM batches WHERE session_type = ? AND batch_number = ?').get(batchType, bn);
  if (clash) {
    return res.status(409).json({ error: 'Batch number already used for this batch type' });
  }

  const normalizedCourses = normalizeBatchCoursesInput(req.body);
  if (!normalizedCourses.ok) return res.status(400).json({ error: normalizedCourses.error });
  const courseCheck = validateBatchCourseRows(normalizedCourses.rows);
  if (!courseCheck.ok) return res.status(400).json({ error: courseCheck.error });
  const legacyCols = legacyBatchCourseColumnsFromRows(normalizedCourses.rows);

  const trainerCandidates = Array.isArray(trainers) ? trainers.map(Number).filter((x) => Number.isFinite(x)) : [];
  const trainerId =
    req.user.role === 'Trainer' ? req.user.id : trainerCandidates[0] || req.user.id;

  const durationDaysNum =
    durationDays != null && durationDays !== '' ? Number(durationDays) : null;

  const row = db.prepare(`
    INSERT INTO batches (
      name, title, session_type, trainer_id, created_by, course_id, training_schedule_json, meeting_id, planned_start_date, notes, batch_status, batch_number, duration_days, enrollment_open_status, subscription_package_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
  `).run(
    title.trim(),
    title.trim(),
    batchType,
    trainerId,
    req.user.id,
    legacyCols.course_id,
    trainingSchedule ? JSON.stringify(trainingSchedule) : null,
    meetingId || null,
    plannedStartDate || null,
    notes || null,
    bn,
    Number.isFinite(durationDaysNum) && durationDaysNum > 0 ? durationDaysNum : null,
    enrollmentOpenStatus === 'closed' ? 'closed' : 'open',
    legacyCols.subscription_package_id
  );
  const batchId = row.lastInsertRowid;

  try {
    persistBatchCourses(batchId, normalizedCourses.rows);
  } catch (e) {
    db.prepare('DELETE FROM batches WHERE id = ?').run(batchId);
    return res.status(500).json({ error: e.message || 'Could not save batch courses' });
  }

  (Array.isArray(students) ? students : []).forEach((sid) => {
    const uid = Number(sid);
    if (!Number.isFinite(uid)) return;
    db.prepare('INSERT OR IGNORE INTO batch_members (batch_id, student_id) VALUES (?, ?)').run(batchId, uid);
    try {
      syncBatchMemberCourseAccess(batchId, uid);
    } catch (_) {
      /* best-effort; admin can fix */
    }
  });
  const trainerAttach = trainerCandidates.length > 0 ? trainerCandidates : [trainerId];
  trainerAttach.forEach((tid) => {
    db.prepare('INSERT OR IGNORE INTO batch_trainers (batch_id, trainer_id) VALUES (?, ?)').run(batchId, tid);
  });

  const courseNameExprCreated =
    "COALESCE((SELECT GROUP_CONCAT(co.name, ' · ') FROM batch_courses bc JOIN courses co ON co.id = bc.course_id WHERE bc.batch_id = b.id), c.name) AS course_name";

  const created = db
    .prepare(`SELECT b.*, ${courseNameExprCreated} FROM batches b LEFT JOIN courses c ON c.id = b.course_id WHERE b.id = ?`)
    .get(batchId);

  let batchCoursesCreated = db
    .prepare(
      `
      SELECT bc.course_id, bc.billing_package_id AS subscription_package_id, bc.sort_order,
             c.name AS course_name, c.enrollment_type
      FROM batch_courses bc
      JOIN courses c ON c.id = bc.course_id
      WHERE bc.batch_id = ?
      ORDER BY bc.sort_order ASC, bc.id ASC`,
    )
    .all(batchId);

  if (!batchCoursesCreated.length && created.course_id) {
    const cm = db.prepare('SELECT enrollment_type FROM courses WHERE id = ?').get(created.course_id);
    batchCoursesCreated = [
      {
        course_id: created.course_id,
        subscription_package_id: created.subscription_package_id ?? null,
        sort_order: 0,
        course_name: db.prepare('SELECT name FROM courses WHERE id = ?').get(created.course_id)?.name || null,
        enrollment_type: cm?.enrollment_type ?? null,
      },
    ];
  }

  res.status(201).json({ ...created, batchCourses: batchCoursesCreated });
});

router.post('/:id/start', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  const raw = String(req.body.startDate || '').trim();
  if (!raw) {
    return res.status(400).json({ error: 'startDate is required (YYYY-MM-DD)' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return res.status(400).json({ error: 'startDate must be YYYY-MM-DD' });
  }
  const startDate = raw;
  if (req.user.role === 'Trainer') {
    const ok =
      batch.trainer_id === req.user.id ||
      db.prepare('SELECT 1 FROM batch_trainers WHERE batch_id = ? AND trainer_id = ?').get(batchId, req.user.id);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const sessions = generateSessionsForBatch(batchId, startDate, req.user.id);
    let liveSummary = { created: 0, updated: 0, total: 0 };
    try {
      liveSummary = ensureLiveSessionsForBatch(batchId);
    } catch (liveErr) {
      console.error('ensureLiveSessionsForBatch', batchId, liveErr);
    }
    try {
      syncAllBatchMembersCourseAccess(batchId);
    } catch (syncErr) {
      console.error('syncAllBatchMembersCourseAccess on batch start', batchId, syncErr);
    }
    res.json({ ok: true, sessions, liveSessions: liveSummary });
  } catch (e) {
    res.status(400).json({ error: e.message || 'Could not start batch' });
  }
});

router.get('/:id/sessions', auth, (req, res) => {
  const batchId = Number(req.params.id);
  const sessions = db
    .prepare(
      `
    SELECT bs.*,
           COALESCE(ll.title, bs.lesson_title) AS lesson_title,
           ls.id AS live_session_id,
           ls.status AS live_status,
           ls.starts_at AS live_starts_at,
           ls.ends_at AS live_ends_at,
           ls.agora_channel AS live_agora_channel,
           (
             SELECT COUNT(*) FROM live_session_participants p
             WHERE p.live_session_id = ls.id AND p.left_at IS NULL
           ) AS live_active_participants
    FROM batch_sessions bs
    LEFT JOIN lesson_library ll ON ll.id = bs.lesson_id
    LEFT JOIN live_sessions ls ON ls.batch_session_id = bs.id
    WHERE bs.batch_id = ?
    ORDER BY bs.session_day
  `
    )
    .all(batchId);
  let displayDayCounter = 0;
  const withDisplayDay = sessions.map((s) => {
    if (s.status === 'cancelled') {
      return { ...s, display_day: null };
    }
    displayDayCounter += 1;
    return { ...s, display_day: displayDayCounter };
  });

  const reconciled = withDisplayDay.map((s) => {
    if (s.status === 'cancelled') return s;

    const endInstant = combineDateTime(s.session_date, s.ends_at);
    const endMs = parseSessionInstantMs(s.live_ends_at || endInstant || '');
    const active = Number(s.live_active_participants || 0);
    let nextLive = s.live_status;

    if (!s.live_session_id) {
      if (!Number.isNaN(endMs) && Date.now() > endMs && active === 0) {
        nextLive = 'ended';
      }
      return { ...s, live_status: nextLive || s.live_status };
    }

    if (s.live_status === 'cancelled') return s;
    if (s.live_status === 'ended') return s;

    if (active > 0) nextLive = 'live';
    else if (!Number.isNaN(endMs) && Date.now() > endMs && active === 0) nextLive = 'ended';
    else nextLive = 'scheduled';

    return { ...s, live_status: nextLive };
  });
  reconciled.forEach((s) => {
    if (s.live_session_id) {
      db.prepare('UPDATE live_sessions SET status = ? WHERE id = ?').run(s.live_status, s.live_session_id);
    }
  });
  res.json(reconciled);
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

router.get('/:id/attendance', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  try {
    assertBatchStaffAccess(req, batchId, batch);
  } catch (e) {
    return res.status(e.statusCode || 403).json({ error: 'Forbidden' });
  }

  const members = db
    .prepare(
      `
    SELECT bm.student_id AS user_id, u.name, u.email, u.role
    FROM batch_members bm
    JOIN users u ON u.id = bm.student_id
    WHERE bm.batch_id = ?
    ORDER BY u.name
  `
    )
    .all(batchId);

  const sessions = db.prepare('SELECT * FROM batch_sessions WHERE batch_id = ? ORDER BY session_day').all(batchId);

  const marks = db
    .prepare(
      `
    SELECT a.batch_session_id, a.student_id, a.status, a.marked_by, a.updated_at
    FROM batch_session_attendance a
    JOIN batch_sessions s ON s.id = a.batch_session_id
    WHERE s.batch_id = ?
  `
    )
    .all(batchId);

  res.json({ members, sessions, marks });
});

router.put('/:id/sessions/:sessionId/attendance', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const sessionId = Number(req.params.sessionId);
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  try {
    assertBatchStaffAccess(req, batchId, batch);
  } catch (e) {
    return res.status(e.statusCode || 403).json({ error: 'Forbidden' });
  }

  const session = db.prepare('SELECT * FROM batch_sessions WHERE id = ? AND batch_id = ?').get(sessionId, batchId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const entries = req.body.entries;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries array required' });

  const allowed = new Set(['present', 'absent', 'late', 'excused']);
  const delStmt = db.prepare('DELETE FROM batch_session_attendance WHERE batch_session_id = ? AND student_id = ?');
  const upsert = db.prepare(`
    INSERT INTO batch_session_attendance (batch_session_id, student_id, status, marked_by, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(batch_session_id, student_id) DO UPDATE SET
      status = excluded.status,
      marked_by = excluded.marked_by,
      updated_at = datetime('now')
  `);
  const memberRow = db.prepare('SELECT 1 FROM batch_members WHERE batch_id = ? AND student_id = ?');

  try {
    const tx = db.transaction(() => {
      for (const row of entries) {
        const studentId = Number(row.studentId);
        if (!studentId) continue;
        const st = row.status;
        if (st == null || st === '') {
          delStmt.run(sessionId, studentId);
          continue;
        }
        if (!allowed.has(st)) throw new Error(`Invalid status: ${st}`);
        if (!memberRow.get(batchId, studentId)) throw new Error('Student is not in this batch');
        upsert.run(sessionId, studentId, st, req.user.id);
      }
    });
    tx();
  } catch (e) {
    return res.status(400).json({ error: e.message || 'Update failed' });
  }

  const marks = db
    .prepare(
      `
    SELECT batch_session_id, student_id, status, marked_by, updated_at
    FROM batch_session_attendance
    WHERE batch_session_id = ?
  `
    )
    .all(sessionId);

  res.json({ ok: true, marks });
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
  try {
    syncBatchMemberCourseAccess(batchId, studentId);
  } catch (_) {
    /* best-effort */
  }
  res.status(201).json({ ok: true });
});

router.delete('/:id/members/:studentId', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchId = Number(req.params.id);
  const studentId = Number(req.params.studentId);
  try {
    removeBatchStudentAccess(batchId, studentId);
  } catch (e) {
    console.error('removeBatchStudentAccess', batchId, studentId, e);
  }
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
    SELECT bs.*, b.title AS batch_title, b.name AS batch_name, b.id AS batch_id,
           ls.id AS live_session_id,
           ls.status AS live_status,
           ls.starts_at AS live_starts_at,
           ls.ends_at AS live_ends_at
    FROM batch_sessions bs
    JOIN batches b ON b.id = bs.batch_id
    LEFT JOIN live_sessions ls ON ls.batch_session_id = bs.id
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
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  const schedule = batch?.training_schedule_json ? JSON.parse(batch.training_schedule_json) : {};
  const daysOfWeek = Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length
    ? schedule.daysOfWeek
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE batch_sessions
      SET status = 'cancelled', cancellation_reason = ?, cancelled_by = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(reason, req.user.id, sessionId);

    db.prepare(`UPDATE live_sessions SET status = 'cancelled' WHERE batch_session_id = ?`).run(sessionId);

    const maxDay =
      Number(
        db.prepare('SELECT COALESCE(MAX(session_day), 0) AS max_day FROM batch_sessions WHERE batch_id = ?').get(batchId)
          ?.max_day || 0
      );

    const lastScheduledByDate = db.prepare(`
      SELECT session_date
      FROM batch_sessions
      WHERE batch_id = ? AND status = 'scheduled'
      ORDER BY session_date DESC, session_day DESC
      LIMIT 1
    `).get(batchId);
    const anchorDate = lastScheduledByDate?.session_date || session.session_date;
    const appendDate = nextEligibleSessionDate(anchorDate, daysOfWeek);
    if (appendDate) {
      db.prepare(`
        INSERT INTO batch_sessions (batch_id, session_day, lesson_id, lesson_title, session_date, starts_at, ends_at, status, updated_at)
        VALUES (?, ?, NULL, ?, ?, ?, ?, 'scheduled', datetime('now'))
      `).run(
        batchId,
        maxDay + 1,
        '',
        appendDate,
        session.starts_at || null,
        session.ends_at || null
      );
    }

    remapLessonsForBatch(batchId, batch?.course_id || null);
  });
  tx();

  liveRecording.forceStopForBatchSessionLink(sessionId);

  try {
    ensureLiveSessionsForBatch(batchId);
  } catch (liveErr) {
    console.error('ensureLiveSessionsForBatch on cancel', batchId, liveErr);
  }

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
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });
  if (req.user.role === 'Student' || req.user.role === 'Lab') {
    const ok = db
      .prepare('SELECT 1 FROM batch_members WHERE batch_id = ? AND student_id = ?')
      .get(batchId, req.user.id);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });
  } else if (req.user.role === 'Trainer') {
    try {
      assertBatchStaffAccess(req, batchId, batch);
    } catch (e) {
      return res.status(e.statusCode || 403).json({ error: 'Forbidden' });
    }
  } else if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
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
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch) return res.status(404).json({ error: 'Batch not found' });

  if (req.user.role === 'Student' || req.user.role === 'Lab') {
    const member = db
      .prepare('SELECT 1 FROM batch_members WHERE batch_id = ? AND student_id = ?')
      .get(batchId, req.user.id);
    if (!member) return res.status(403).json({ error: 'Forbidden' });
    const rows = db
      .prepare(
        `
      SELECT s.id, s.student_id, u.name AS student_name, u.email AS student_email, s.file_url, s.submitted_at
      FROM assignment_submissions s
      JOIN users u ON u.id = s.student_id
      WHERE s.batch_id = ? AND s.assignment_id = ? AND s.student_id = ?
      ORDER BY s.submitted_at DESC
    `
      )
      .all(batchId, assignmentId, req.user.id);
    return res.json(rows);
  }

  if (req.user.role === 'Trainer') {
    try {
      assertBatchStaffAccess(req, batchId, batch);
    } catch (e) {
      return res.status(e.statusCode || 403).json({ error: 'Forbidden' });
    }
  } else if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }

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
