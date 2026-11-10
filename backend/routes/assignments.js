const express = require('express');
const multer = require('multer');
const db = require('../db');
const uploadMemory = require('../uploadMemory');
const { auth, requireRole } = require('../middleware/auth');
const { isSpacesConfigured, uploadToSpaces, deleteObjectsUnderPrefix } = require('../services/spaces');
const {
  canMutateLibraryByCreatedBy,
  canSetAssignmentPublic,
  canViewAssignment,
  hideOthersDrafts,
  stripCreatorFields,
  stripRows,
} = require('../lib/libraryScope');
const {
  filterLibraryRowsForTrainer,
  trainerCanViewLibraryItem,
  activeBatchIdsForTrainer,
} = require('../lib/trainerScope');

function trainerBatchIds(userId) {
  const set = activeBatchIdsForTrainer(Number(userId));
  return set instanceof Set ? Array.from(set) : [];
}
const {
  derivedAssignmentLabel,
  normalizeResponseType,
  normalizeHeader,
  expandRecurrenceDates,
  serializeLibraryRow,
  parseJsonSafe,
  academyToday,
  addDaysYmd,
  RESPONSE_TYPES,
} = require('../lib/assignmentHelpers');
const { expiresAtFromRetentionDays } = require('../lib/appSettings');

const router = express.Router();
const uploadSingle = uploadMemory.single('file');
/** Accept legacy `file` and multi `files` in one request. */
const uploadSubmissionMedia = uploadMemory.fields([
  { name: 'file', maxCount: 1 },
  { name: 'files', maxCount: 20 },
]);

function collectUploadedFiles(req) {
  const out = [];
  const bag = req.files || {};
  for (const f of bag.files || []) out.push(f);
  for (const f of bag.file || []) out.push(f);
  if (req.file) out.push(req.file);
  return out;
}

function listSubmissionFiles(submissionId) {
  return db
    .prepare(
      `SELECT id, submission_id, file_key, file_url, mime_type, kind, file_name, sort_order, created_at
       FROM assignment_submission_files
       WHERE submission_id = ?
       ORDER BY sort_order ASC, id ASC`,
    )
    .all(submissionId);
}

function serializeSubmissionFiles(submission, spacesExpired) {
  if (!submission?.id) return [];
  let rows = listSubmissionFiles(submission.id);
  if (!rows.length && submission.file_url) {
    rows = [
      {
        id: null,
        submission_id: submission.id,
        file_key: submission.file_key || '',
        file_url: submission.file_url,
        mime_type: submission.mime_type || null,
        kind: submission.response_type || 'file',
        file_name: null,
        sort_order: 0,
      },
    ];
  }
  return rows.map((f) => ({
    id: f.id,
    url: spacesExpired ? '' : f.file_url || '',
    mime_type: f.mime_type || null,
    kind: f.kind || submission.response_type || 'file',
    file_name: f.file_name || null,
    sort_order: f.sort_order || 0,
  }));
}

function truthyDraft(val) {
  if (val === true || val === 1 || val === '1') return true;
  if (String(val).toLowerCase() === 'true') return true;
  return false;
}

function truthyFlag(val) {
  return truthyDraft(val);
}

function normalizeContentHtml(val) {
  if (val == null) return '';
  return String(val);
}

function sanitizeName(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function listAssets(assignmentId) {
  return db
    .prepare('SELECT * FROM assignment_assets WHERE assignment_id = ? ORDER BY sort_order, id')
    .all(assignmentId);
}

function getLibraryOr404(id) {
  return db
    .prepare(
      'SELECT m.*, cu.name AS creator_name FROM assignment_library m LEFT JOIN users cu ON cu.id = m.created_by WHERE m.id = ?',
    )
    .get(id);
}

function studentBatchIds(userId) {
  return db
    .prepare(
      `SELECT DISTINCT bm.batch_id AS id
       FROM batch_members bm
       WHERE bm.student_id = ?`,
    )
    .all(userId)
    .map((r) => Number(r.id))
    .filter(Boolean);
}

function isStudentTargeted(occurrenceId, studentId) {
  const targets = db
    .prepare('SELECT student_id FROM assignment_occurrence_students WHERE occurrence_id = ?')
    .all(occurrenceId);
  if (!targets.length) return true;
  return targets.some((t) => Number(t.student_id) === Number(studentId));
}

function materializeLessonOccurrencesForBatch(batchId, onOrBeforeYmd) {
  const sessions = db
    .prepare(
      `SELECT id, lesson_id, session_date, session_day
       FROM batch_sessions
       WHERE batch_id = ? AND status <> 'cancelled'
         AND lesson_id IS NOT NULL
         AND session_date IS NOT NULL
         AND session_date <= ?
       ORDER BY session_date`,
    )
    .all(batchId, onOrBeforeYmd);

  const ins = db.prepare(
    `INSERT OR IGNORE INTO assignment_occurrences
      (library_id, source, batch_id, lesson_id, schedule_date, due_at, notes, max_score, created_by)
     VALUES (?, 'lesson', ?, ?, ?, ?, NULL, 10, NULL)`,
  );

  for (const s of sessions) {
    const lessonId = Number(s.lesson_id);
    const scheduleDate = String(s.session_date).slice(0, 10);
    if (!lessonId || !scheduleDate) continue;
    const items = db
      .prepare(
        `SELECT item_id FROM lesson_library_items
         WHERE lesson_id = ? AND item_type = 'assignment'
         ORDER BY sort_order, id`,
      )
      .all(lessonId);
    for (const it of items) {
      const libId = Number(it.item_id);
      const lib = db.prepare('SELECT id, is_draft FROM assignment_library WHERE id = ?').get(libId);
      if (!lib || Number(lib.is_draft) === 1) continue;
      // Lesson-sourced: due end of the next calendar day after the session.
      const dueYmd = addDaysYmd(scheduleDate, 1);
      ins.run(libId, batchId, lessonId, scheduleDate, `${dueYmd}T23:59:59`);
    }
  }
}

function occurrencePayload(row, studentId = null) {
  if (!row) return null;
  const lib = row.library_id
    ? db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(row.library_id)
    : null;
  const assets = lib ? listAssets(lib.id) : [];
  let submission = null;
  if (studentId) {
    submission = db
      .prepare(
        `SELECT * FROM assignment_submissions
         WHERE occurrence_id = ? AND student_id = ?
         ORDER BY id DESC LIMIT 1`,
      )
      .get(row.id, studentId);
  }
  const batch = db
    .prepare('SELECT id, name, title, batch_number, trainer_id FROM batches WHERE id = ?')
    .get(row.batch_id);
  const spacesStatus = submission?.spaces_status === 'expired' ? 'expired' : 'active';
  const spacesExpired = spacesStatus === 'expired';
  const batchTitle = batch?.title || batch?.name || null;
  const batchNumber = batch?.batch_number != null ? Number(batch.batch_number) : null;
  const batchTrainerName = batch?.trainer_id
    ? db.prepare('SELECT name FROM users WHERE id = ?').get(batch.trainer_id)?.name || null
    : null;
  let reviewerName = null;
  if (submission?.reviewed_by) {
    reviewerName =
      db.prepare('SELECT name FROM users WHERE id = ?').get(submission.reviewed_by)?.name || null;
  }
  if (!reviewerName) reviewerName = batchTrainerName;
  return {
    ...row,
    displayLabel: derivedAssignmentLabel(lib || { id: row.library_id, title: row.notes }),
    library: lib ? serializeLibraryRow(lib, assets) : null,
    batchName:
      batchTitle && batchNumber != null
        ? `${batchTitle} · #${batchNumber}`
        : batchTitle,
    batch_number: batchNumber,
    batch_trainer_name: batchTrainerName,
    submission: submission
      ? (() => {
          const files = serializeSubmissionFiles(submission, spacesExpired);
          const primaryUrl = spacesExpired
            ? ''
            : files[0]?.url || submission.file_url || '';
          return {
            ...submission,
            file_url: primaryUrl,
            mime_type: files[0]?.mime_type || submission.mime_type || null,
            spaces_status: spacesStatus,
            spacesExpired,
            reviewer_name: reviewerName,
            files,
          };
        })()
      : null,
    spacesExpired,
    done: Boolean(
      submission &&
        (submission.status === 'done' ||
          submission.status === 'submitted' ||
          submission.file_url ||
          submission.text_body ||
          spacesExpired ||
          listSubmissionFiles(submission.id).length > 0),
    ),
  };
}

/* -------------------- Library list / create -------------------- */

router.get('/', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  let rows = db
    .prepare(
      `
    SELECT m.id, m.title, m.description, m.label, m.response_type, m.header_json, m.is_draft,
           m.is_public, m.created_by, m.created_at, m.updated_at, m.content_html, m.recurrence_json,
           MAX(cu.name) AS creator_name,
           (
             SELECT COUNT(*) FROM assignment_assets aa WHERE aa.assignment_id = m.id
           ) AS asset_count
    FROM assignment_library m
    LEFT JOIN users cu ON cu.id = m.created_by
    GROUP BY m.id
    ORDER BY m.updated_at DESC, m.id DESC
  `,
    )
    .all();
  rows = filterLibraryRowsForTrainer(req.user, 'assignment', hideOthersDrafts(req.user, rows));
  res.json(
    stripRows(
      req.user,
      rows.map((r) => ({
        ...r,
        displayLabel: derivedAssignmentLabel(r),
        response_type: normalizeResponseType(r.response_type),
        header: normalizeHeader(r.header_json),
        is_public: Number(r.is_public) === 1 ? 1 : 0,
        asset_count: Number(r.asset_count) || 0,
      })),
    ),
  );
});

router.post('/', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  try {
    let isDraft = truthyDraft(req.body?.isDraft ?? req.body?.is_draft);
    const header = normalizeHeader(req.body?.header ?? req.body?.headerJson);
    const contentHtml = normalizeContentHtml(req.body?.contentHtml);
    const responseType = normalizeResponseType(req.body?.responseType ?? req.body?.response_type);
    const recurrence = req.body?.recurrence ?? req.body?.recurrenceJson ?? null;
    let label = String(req.body?.label || '').trim();
    if (!label && header?.type === 'text') label = String(header.text || '').trim();
    if (!label) label = stripFirst(contentHtml) || (isDraft ? 'Untitled draft' : '');
    if (!label) {
      if (!isDraft) return res.status(400).json({ error: 'Add a text header or body so the assignment can be named' });
      isDraft = true;
      label = 'Untitled draft';
    }
    const title = label.slice(0, 200);
    let isPublic = 0;
    if (req.body?.isPublic !== undefined || req.body?.is_public !== undefined) {
      isPublic = truthyFlag(req.body?.isPublic ?? req.body?.is_public) ? 1 : 0;
    }
    if (isDraft) isPublic = 0;
    if (isPublic && !canSetAssignmentPublic(req.user, { created_by: req.user.id })) {
      return res.status(403).json({ error: 'Only admins or the creating trainer can make an assignment public' });
    }
    const r = db
      .prepare(
        `INSERT INTO assignment_library
          (title, description, content_html, created_by, is_draft, is_public, label, response_type, header_json, recurrence_json)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        title,
        contentHtml,
        req.user.id,
        isDraft ? 1 : 0,
        isPublic,
        label,
        responseType,
        header ? JSON.stringify(header) : JSON.stringify({ type: 'text', text: label }),
        recurrence ? JSON.stringify(recurrence) : null,
      );
    const created = getLibraryOr404(r.lastInsertRowid);
    res.status(201).json(stripCreatorFields(req.user, serializeLibraryRow(created, [])));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid payload' });
  }
});

function stripFirst(html) {
  const t = String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.slice(0, 120);
}

/* -------------------- Student + trainer occurrence APIs (before /:id) -------------------- */

router.get('/my', auth, requireRole('Student', 'Lab', 'Admin', 'Trainer'), (req, res) => {
  const today = academyToday();
  const filter = String(req.query.filter || 'today').toLowerCase();
  const batchIds = studentBatchIds(req.user.id);
  if (!batchIds.length) return res.json([]);

  for (const bid of batchIds) {
    materializeLessonOccurrencesForBatch(bid, today);
  }

  const placeholders = batchIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT o.*
       FROM assignment_occurrences o
       WHERE o.batch_id IN (${placeholders})
         AND COALESCE(o.status, 'active') != 'cancelled'
       ORDER BY o.schedule_date DESC, o.id DESC`,
    )
    .all(...batchIds);

  const out = [];
  for (const row of rows) {
    if (!isStudentTargeted(row.id, req.user.id)) continue;
    const payload = occurrencePayload(row, req.user.id);
    const scheduleDate = String(row.schedule_date || '').slice(0, 10);
    const dueDay = row.due_at ? String(row.due_at).slice(0, 10) : scheduleDate;
    const done = payload.done;

    // Filters:
    // - due_today / today: open window from schedule day through due date (inclusive), not completed
    // - overdue: past due, not completed
    // - upcoming: schedule day still in the future, not completed
    // - completed: submitted / done
    if (done) {
      if (filter === 'completed') out.push(payload);
    } else if (filter === 'completed') {
      /* skip open items */
    } else if (filter === 'today' || filter === 'due_today') {
      if (scheduleDate && dueDay && scheduleDate <= today && dueDay >= today) out.push(payload);
    } else if (filter === 'overdue') {
      if (dueDay && dueDay < today) out.push(payload);
    } else if (filter === 'upcoming') {
      if (scheduleDate > today) out.push(payload);
    } else {
      if (scheduleDate <= today) out.push(payload);
    }
  }
  res.json(out);
});

router.get('/my/counts', auth, requireRole('Student', 'Lab', 'Admin', 'Trainer'), (req, res) => {
  const today = academyToday();
  const batchIds = studentBatchIds(req.user.id);
  if (!batchIds.length) {
    return res.json({ today: 0, due_today: 0, overdue: 0, upcoming: 0, completed: 0 });
  }

  for (const bid of batchIds) {
    materializeLessonOccurrencesForBatch(bid, today);
  }

  const placeholders = batchIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT o.*
       FROM assignment_occurrences o
       WHERE o.batch_id IN (${placeholders})
         AND COALESCE(o.status, 'active') != 'cancelled'`,
    )
    .all(...batchIds);

  let todayCount = 0;
  let overdueCount = 0;
  let upcomingCount = 0;
  let completedCount = 0;
  for (const row of rows) {
    if (!isStudentTargeted(row.id, req.user.id)) continue;
    const payload = occurrencePayload(row, req.user.id);
    const scheduleDate = String(row.schedule_date || '').slice(0, 10);
    const dueDay = row.due_at ? String(row.due_at).slice(0, 10) : scheduleDate;
    const done = payload.done;
    if (done) {
      completedCount += 1;
      continue;
    }
    if (scheduleDate && dueDay && scheduleDate <= today && dueDay >= today) todayCount += 1;
    if (dueDay && dueDay < today) overdueCount += 1;
    if (scheduleDate > today) upcomingCount += 1;
  }
  res.json({
    today: todayCount,
    due_today: todayCount,
    overdue: overdueCount,
    upcoming: upcomingCount,
    completed: completedCount,
  });
});

/** Resolve lesson schedule day (Day 1, Day 2…) → session_date for a batch. */
function resolveBatchSessionDate(batchId, displayDay) {
  const sessions = db
    .prepare(
      `SELECT session_day, session_date, lesson_title, status
       FROM batch_sessions
       WHERE batch_id = ?
       ORDER BY session_day`,
    )
    .all(batchId);
  let display = 0;
  for (const s of sessions) {
    if (String(s.status || '') === 'cancelled') continue;
    display += 1;
    if (display === Number(displayDay)) {
      const ymd = String(s.session_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) {
        throw new Error(`Batch ${batchId} day ${displayDay} has no session date`);
      }
      return { scheduleDate: ymd, sessionDay: s.session_day, lessonTitle: s.lesson_title || null };
    }
  }
  throw new Error(`Batch ${batchId} has no lesson schedule day ${displayDay}`);
}

router.post('/set', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  try {
    const libraryIds = Array.isArray(req.body?.libraryIds)
      ? req.body.libraryIds.map(Number).filter(Boolean)
      : [];
    const batchIds = Array.isArray(req.body?.batchIds) ? req.body.batchIds.map(Number).filter(Boolean) : [];
    const sessionDayRaw = req.body?.sessionDay ?? req.body?.lessonDay ?? null;
    const legacyDay = String(req.body?.day || req.body?.scheduleDate || '').slice(0, 10);
    const sessionDay =
      sessionDayRaw != null && String(sessionDayRaw).trim() !== ''
        ? Number(sessionDayRaw)
        : Number.isFinite(Number(req.body?.day)) && !/^\d{4}-\d{2}-\d{2}$/.test(String(req.body?.day || ''))
          ? Number(req.body.day)
          : null;
    const dueAt = req.body?.dueAt != null ? String(req.body.dueAt) : null;
    const notes = req.body?.notes != null ? String(req.body.notes) : null;
    const studentIds = Array.isArray(req.body?.studentIds)
      ? req.body.studentIds.map(Number).filter(Boolean)
      : [];
    const recurrence = req.body?.recurrence ?? null;
    const maxScore = req.body?.maxScore != null ? Number(req.body.maxScore) : 10;

    if (!libraryIds.length) return res.status(400).json({ error: 'libraryIds required' });
    if (!batchIds.length) return res.status(400).json({ error: 'batchIds required' });
    const useSessionDay = Number.isFinite(sessionDay) && sessionDay >= 1;
    if (!useSessionDay && !/^\d{4}-\d{2}-\d{2}$/.test(legacyDay)) {
      return res.status(400).json({ error: 'sessionDay (lesson Day 1, 2, …) is required' });
    }

    if (req.user.role === 'Trainer') {
      const allowed = new Set(trainerBatchIds(req.user.id));
      for (const bid of batchIds) {
        if (!allowed.has(bid)) return res.status(403).json({ error: 'Not staff on one or more batches' });
      }
    }

    const created = [];
    const insOcc = db.prepare(
      `INSERT INTO assignment_occurrences
        (library_id, source, batch_id, lesson_id, schedule_date, due_at, notes, recurrence_json, parent_occurrence_id, max_score, created_by)
       VALUES (?, 'trainer_set', ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insStudent = db.prepare(
      'INSERT OR IGNORE INTO assignment_occurrence_students (occurrence_id, student_id) VALUES (?, ?)',
    );

    const tx = db.transaction(() => {
      for (const libId of libraryIds) {
        const lib = db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(libId);
        if (!lib || Number(lib.is_draft) === 1) {
          throw new Error(`Assignment ${libId} not found or is draft`);
        }
        if (!trainerCanViewLibraryItem(req.user, 'assignment', libId)) {
          throw new Error(`Assignment ${libId} is not available to assign`);
        }
        const rule = recurrence || parseJsonSafe(lib.recurrence_json, null);
        for (const bid of batchIds) {
          const startYmd = useSessionDay
            ? resolveBatchSessionDate(bid, sessionDay).scheduleDate
            : legacyDay;
          const dates = expandRecurrenceDates(startYmd, rule);
          let parentId = null;
          dates.forEach((scheduleDate, idx) => {
            const due =
              dueAt && idx === 0
                ? dueAt
                : dueAt
                  ? `${scheduleDate}${String(dueAt).includes('T') ? String(dueAt).slice(10) : 'T23:59:59'}`
                  : `${scheduleDate}T23:59:59`;
            const r = insOcc.run(
              libId,
              bid,
              scheduleDate,
              due,
              notes,
              rule ? JSON.stringify(rule) : null,
              parentId,
              Number.isFinite(maxScore) ? maxScore : 10,
              req.user.id,
            );
            const occId = r.lastInsertRowid;
            if (idx === 0) parentId = occId;
            for (const sid of studentIds) insStudent.run(occId, sid);
            created.push(occId);
          });
        }
      }
    });
    tx();

    res.status(201).json({
      createdIds: created,
      occurrences: created.map((id) =>
        occurrencePayload(db.prepare('SELECT * FROM assignment_occurrences WHERE id = ?').get(id)),
      ),
    });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to set assignment' });
  }
});

router.get('/trainer', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchFilter = req.query.batchId != null ? Number(req.query.batchId) : null;
  let batchIds;
  if (req.user.role === 'Admin') {
    batchIds = batchFilter
      ? [batchFilter]
      : db.prepare('SELECT id FROM batches ORDER BY id DESC').all().map((r) => r.id);
  } else {
    batchIds = trainerBatchIds(req.user.id);
    if (batchFilter) batchIds = batchIds.filter((id) => id === batchFilter);
  }
  if (!batchIds.length) return res.json([]);
  const placeholders = batchIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT o.* FROM assignment_occurrences o
       WHERE o.batch_id IN (${placeholders})
         AND COALESCE(o.status, 'active') != 'cancelled'
       ORDER BY o.schedule_date DESC, o.id DESC
       LIMIT 500`,
    )
    .all(...batchIds);
  res.json(rows.map((r) => occurrencePayload(r)));
});

router.get('/trainer/responses', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const batchFilter = req.query.batchId != null ? Number(req.query.batchId) : null;
  let batchIds =
    req.user.role === 'Admin'
      ? db.prepare('SELECT id FROM batches').all().map((r) => r.id)
      : trainerBatchIds(req.user.id);
  if (batchFilter) batchIds = batchIds.filter((id) => id === batchFilter);
  if (!batchIds.length) return res.json([]);
  const placeholders = batchIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT s.*, o.schedule_date, o.due_at, o.batch_id AS occ_batch_id, o.library_id, o.max_score AS occurrence_max_score,
              u.name AS student_name, b.title AS batch_title, b.name AS batch_name, b.batch_number
       FROM assignment_submissions s
       JOIN assignment_occurrences o ON o.id = s.occurrence_id
       JOIN users u ON u.id = s.student_id
       JOIN batches b ON b.id = o.batch_id
       WHERE o.batch_id IN (${placeholders})
         AND COALESCE(o.status, 'active') != 'cancelled'
       ORDER BY
         CASE WHEN COALESCE(s.review_status, 'pending') = 'pending' THEN 0 ELSE 1 END,
         s.submitted_at DESC, s.id DESC
       LIMIT 500`,
    )
    .all(...batchIds);
  res.json(
    rows.map((r) => {
      const title = r.batch_title || r.batch_name;
      const num = r.batch_number != null ? Number(r.batch_number) : null;
      const spacesExpired = r.spaces_status === 'expired';
      const files = serializeSubmissionFiles(r, spacesExpired);
      return {
        ...r,
        max_score: r.occurrence_max_score != null ? r.occurrence_max_score : r.max_score,
        displayLabel: derivedAssignmentLabel(
          db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(r.library_id) || {},
        ),
        batchName: title && num != null ? `${title} · #${num}` : title,
        batch_number: num,
        file_url: spacesExpired ? '' : files[0]?.url || r.file_url || '',
        files,
      };
    }),
  );
});

router.get('/occurrences/:occurrenceId', auth, (req, res) => {
  const id = Number(req.params.occurrenceId);
  const row = db.prepare('SELECT * FROM assignment_occurrences WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (req.user.role === 'Student' || req.user.role === 'Lab') {
    const mine = studentBatchIds(req.user.id);
    if (!mine.includes(Number(row.batch_id)) || !isStudentTargeted(id, req.user.id)) {
      return res.status(404).json({ error: 'Not found' });
    }
    return res.json(occurrencePayload(row, req.user.id));
  }
  if (req.user.role === 'Trainer') {
    const allowed = trainerBatchIds(req.user.id);
    if (!allowed.includes(Number(row.batch_id))) return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(occurrencePayload(row));
});

router.patch('/occurrences/:occurrenceId', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const id = Number(req.params.occurrenceId);
  const row = db.prepare('SELECT * FROM assignment_occurrences WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'Trainer' && !trainerBatchIds(req.user.id).includes(Number(row.batch_id))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (String(row.status || '') === 'cancelled') {
    return res.status(409).json({ error: 'Occurrence is cancelled' });
  }
  const dueAt =
    req.body?.dueAt !== undefined || req.body?.due_at !== undefined
      ? req.body?.dueAt ?? req.body?.due_at
      : undefined;
  const notes = req.body?.notes !== undefined ? req.body.notes : undefined;
  if (dueAt === undefined && notes === undefined) {
    return res.status(400).json({ error: 'dueAt or notes required' });
  }
  db.prepare(
    `UPDATE assignment_occurrences SET
       due_at = CASE WHEN ? THEN ? ELSE due_at END,
       notes = CASE WHEN ? THEN ? ELSE notes END
     WHERE id = ?`,
  ).run(
    dueAt !== undefined ? 1 : 0,
    dueAt === null || dueAt === '' ? null : String(dueAt),
    notes !== undefined ? 1 : 0,
    notes == null ? null : String(notes),
    id,
  );
  const updated = db.prepare('SELECT * FROM assignment_occurrences WHERE id = ?').get(id);
  res.json(occurrencePayload(updated));
});

router.delete('/occurrences/:occurrenceId', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  const id = Number(req.params.occurrenceId);
  const row = db.prepare('SELECT * FROM assignment_occurrences WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'Trainer' && !trainerBatchIds(req.user.id).includes(Number(row.batch_id))) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  // Soft-cancel when status column exists; otherwise delete targeting rows + occurrence.
  db.prepare(`UPDATE assignment_occurrences SET status = 'cancelled' WHERE id = ?`).run(id);
  const updated = db.prepare('SELECT * FROM assignment_occurrences WHERE id = ?').get(id);
  res.json(occurrencePayload(updated));
});

router.post(
  '/occurrences/:occurrenceId/submit',
  auth,
  requireRole('Student', 'Lab'),
  uploadSubmissionMedia,
  async (req, res) => {
    try {
      const occurrenceId = Number(req.params.occurrenceId);
      const row = db.prepare('SELECT * FROM assignment_occurrences WHERE id = ?').get(occurrenceId);
      if (!row) return res.status(404).json({ error: 'Not found' });
      const mine = studentBatchIds(req.user.id);
      if (!mine.includes(Number(row.batch_id)) || !isStudentTargeted(occurrenceId, req.user.id)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const lib = row.library_id
        ? db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(row.library_id)
        : null;
      const responseType = normalizeResponseType(
        req.body?.responseType || lib?.response_type || 'file',
      );
      const textBody = req.body?.textBody != null ? String(req.body.textBody) : null;
      const append =
        req.body?.append === true ||
        req.body?.append === '1' ||
        req.body?.append === 'true';

      const incoming = collectUploadedFiles(req);
      const uploadedFiles = [];

      if (responseType === 'other') {
        // mark done with no media
      } else if (responseType === 'text') {
        if (!textBody || !textBody.trim()) return res.status(400).json({ error: 'textBody required' });
      } else {
        if (!incoming.length) return res.status(400).json({ error: 'file is required' });
        if (!isSpacesConfigured()) return res.status(503).json({ error: 'Storage is not configured' });
        for (let i = 0; i < incoming.length; i += 1) {
          const file = incoming[i];
          const ext = (file.originalname || '').split('.').pop() || 'bin';
          const base =
            sanitizeName(file.originalname?.replace(/\.[^.]+$/, '') || responseType) || responseType;
          const key = `live-recordings/assignments/occurrence-${occurrenceId}/${req.user.id}-${Date.now()}-${i}-${base}.${ext}`;
          const uploaded = await uploadToSpaces({
            buffer: file.buffer,
            mimeType: file.mimetype,
            key,
          });
          uploadedFiles.push({
            fileKey: uploaded.key,
            fileUrl: uploaded.publicUrl,
            mimeType: file.mimetype || null,
            fileName: file.originalname || null,
            kind: responseType,
          });
        }
      }

      // Each occurrence must own its own batch_assignments stub. Never reuse
      // "latest for batch" — that caused ON CONFLICT(assignment_id, student_id)
      // to overwrite a different assignment's submission.
      let assignmentId = row.legacy_batch_assignment_id
        ? Number(row.legacy_batch_assignment_id)
        : null;
      if (!assignmentId) {
        const stub = db
          .prepare(
            `INSERT INTO batch_assignments (batch_id, title, description, due_date, max_score, created_by)
             VALUES (?, ?, NULL, ?, ?, ?)`,
          )
          .run(
            row.batch_id,
            derivedAssignmentLabel(lib || { id: row.library_id }),
            row.due_at,
            row.max_score || 10,
            req.user.id,
          );
        assignmentId = stub.lastInsertRowid;
        db.prepare('UPDATE assignment_occurrences SET legacy_batch_assignment_id = ? WHERE id = ?').run(
          assignmentId,
          occurrenceId,
        );
      }

      const expiresAt = expiresAtFromRetentionDays();
      const existingSub = db
        .prepare(
          `SELECT id FROM assignment_submissions
           WHERE occurrence_id = ? AND student_id = ?
           ORDER BY id DESC LIMIT 1`,
        )
        .get(occurrenceId, req.user.id);

      const primary = uploadedFiles[0] || null;
      let primaryKey = primary?.fileKey || '';
      let primaryUrl = primary?.fileUrl || '';
      let primaryMime = primary?.mimeType || null;

      if (existingSub?.id && append && !primary) {
        const prev = db.prepare('SELECT * FROM assignment_submissions WHERE id = ?').get(existingSub.id);
        primaryKey = prev?.file_key || '';
        primaryUrl = prev?.file_url || '';
        primaryMime = prev?.mime_type || null;
      }

      if (existingSub?.id && append && primary && !listSubmissionFiles(existingSub.id).length && primaryUrl) {
        // keep existing primary if appending onto a legacy single-file row
      } else if (existingSub?.id && append && !primary) {
        /* text-only append — keep media */
      }

      if (existingSub?.id && append) {
        const prev = db.prepare('SELECT * FROM assignment_submissions WHERE id = ?').get(existingSub.id);
        if (!primaryUrl && prev?.file_url) {
          primaryKey = prev.file_key || 'none';
          primaryUrl = prev.file_url;
          primaryMime = prev.mime_type || null;
        }
      }

      let submissionId = existingSub?.id || null;
      if (existingSub?.id) {
        db.prepare(
          `UPDATE assignment_submissions SET
             assignment_id = ?,
             batch_id = ?,
             file_key = ?,
             file_url = ?,
             response_type = ?,
             text_body = COALESCE(?, text_body),
             mime_type = ?,
             status = 'done',
             review_status = 'pending',
             score = NULL,
             feedback = NULL,
             reviewed_by = NULL,
             reviewed_at = NULL,
             submitted_at = datetime('now'),
             expires_at = ?,
             spaces_status = ?
           WHERE id = ?`,
        ).run(
          assignmentId,
          row.batch_id,
          primaryKey || 'none',
          primaryUrl || '',
          responseType,
          textBody,
          primaryMime,
          expiresAt,
          primaryKey && primaryKey !== 'none' ? 'active' : 'none',
          existingSub.id,
        );
        submissionId = existingSub.id;
      } else {
        const inserted = db
          .prepare(
            `INSERT INTO assignment_submissions
            (assignment_id, batch_id, student_id, file_key, file_url, occurrence_id, response_type, text_body, mime_type, status, review_status, score, feedback, reviewed_by, reviewed_at, expires_at, spaces_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', 'pending', NULL, NULL, NULL, NULL, ?, ?)`,
          )
          .run(
            assignmentId,
            row.batch_id,
            req.user.id,
            primaryKey || 'none',
            primaryUrl || '',
            occurrenceId,
            responseType,
            textBody,
            primaryMime,
            expiresAt,
            primaryKey && primaryKey !== 'none' ? 'active' : 'none',
          );
        submissionId = inserted.lastInsertRowid;
      }

      if (uploadedFiles.length && submissionId) {
        if (!append) {
          db.prepare('DELETE FROM assignment_submission_files WHERE submission_id = ?').run(submissionId);
        }
        const maxOrder =
          db
            .prepare(
              'SELECT COALESCE(MAX(sort_order), -1) AS m FROM assignment_submission_files WHERE submission_id = ?',
            )
            .get(submissionId)?.m ?? -1;
        const insFile = db.prepare(
          `INSERT INTO assignment_submission_files
            (submission_id, file_key, file_url, mime_type, kind, file_name, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        uploadedFiles.forEach((f, idx) => {
          insFile.run(
            submissionId,
            f.fileKey,
            f.fileUrl,
            f.mimeType,
            f.kind,
            f.fileName,
            Number(maxOrder) + 1 + idx,
          );
        });
        // Keep submission primary pointing at first file in the set
        const first = listSubmissionFiles(submissionId)[0];
        if (first) {
          db.prepare(
            `UPDATE assignment_submissions SET file_key = ?, file_url = ?, mime_type = ?, spaces_status = 'active' WHERE id = ?`,
          ).run(first.file_key, first.file_url, first.mime_type, submissionId);
        }
      }

      const submission = db
        .prepare(
          'SELECT * FROM assignment_submissions WHERE occurrence_id = ? AND student_id = ? ORDER BY id DESC LIMIT 1',
        )
        .get(occurrenceId, req.user.id);
      res.json({ ok: true, submission, occurrence: occurrencePayload(row, req.user.id) });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Submit failed' });
    }
  },
);

router.put(
  '/occurrences/:occurrenceId/submissions/:submissionId/review',
  auth,
  requireRole('Admin', 'Trainer'),
  uploadSingle,
  async (req, res) => {
    try {
      const occurrenceId = Number(req.params.occurrenceId);
      const submissionId = Number(req.params.submissionId);
      const row = db.prepare('SELECT * FROM assignment_occurrences WHERE id = ?').get(occurrenceId);
      if (!row) return res.status(404).json({ error: 'Not found' });
      if (req.user.role === 'Trainer' && !trainerBatchIds(req.user.id).includes(Number(row.batch_id))) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      const existing = db
        .prepare('SELECT * FROM assignment_submissions WHERE id = ? AND occurrence_id = ?')
        .get(submissionId, occurrenceId);
      if (!existing) return res.status(404).json({ error: 'Submission not found' });

      // Score removed from review UX — keep null unless explicitly provided for legacy clients.
      const score =
        req.body?.score != null && String(req.body.score).trim() !== ''
          ? Number(req.body.score)
          : null;
      const feedback = req.body?.feedback != null ? String(req.body.feedback) : existing.feedback;
      const clearAudio =
        req.body?.clearFeedbackAudio === true ||
        req.body?.clearFeedbackAudio === '1' ||
        req.body?.clearFeedbackAudio === 'true';

      let feedbackAudioUrl = existing.feedback_audio_url || null;
      let feedbackAudioKey = existing.feedback_audio_key || null;

      if (clearAudio) {
        feedbackAudioUrl = null;
        feedbackAudioKey = null;
      }

      if (req.file) {
        if (!isSpacesConfigured()) return res.status(503).json({ error: 'Storage is not configured' });
        const ext = (req.file.originalname || '').split('.').pop() || 'webm';
        const key = `live-recordings/assignments/feedback/occurrence-${occurrenceId}/${submissionId}-${Date.now()}.${ext}`;
        const uploaded = await uploadToSpaces({
          buffer: req.file.buffer,
          mimeType: req.file.mimetype || 'audio/webm',
          key,
        });
        feedbackAudioKey = uploaded.key;
        feedbackAudioUrl = uploaded.publicUrl;
      }

      if (!String(feedback || '').trim() && !feedbackAudioUrl) {
        return res.status(400).json({ error: 'Feedback text or voice note is required' });
      }

      db.prepare(
        `UPDATE assignment_submissions SET
          score = ?, feedback = ?, feedback_audio_url = ?, feedback_audio_key = ?,
          review_status = 'reviewed',
          reviewed_by = ?, reviewed_at = datetime('now')
         WHERE id = ? AND occurrence_id = ?`,
      ).run(
        Number.isFinite(score) ? score : null,
        feedback,
        feedbackAudioUrl,
        feedbackAudioKey,
        req.user.id,
        submissionId,
        occurrenceId,
      );
      const updated = db.prepare('SELECT * FROM assignment_submissions WHERE id = ?').get(submissionId);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: error.message || 'Review failed' });
    }
  },
);

/* -------------------- Library detail / update / assets -------------------- */

router.get('/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const row = getLibraryOr404(id);
  if (!row) return res.status(404).json({ error: 'Assignment not found' });
  if (!canViewAssignment(req.user, row) || !trainerCanViewLibraryItem(req.user, 'assignment', id)) {
    return res.status(404).json({ error: 'Assignment not found' });
  }
  res.json(stripCreatorFields(req.user, serializeLibraryRow(row, listAssets(id))));
});

router.put('/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Assignment not found' });
  if (!canMutateLibraryByCreatedBy(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const isDraftReq = req.body?.isDraft !== undefined || req.body?.is_draft !== undefined;
    const nextIsDraft = isDraftReq ? (truthyDraft(req.body?.isDraft ?? req.body?.is_draft) ? 1 : 0) : null;

    let label = req.body?.label != null ? String(req.body.label).trim() : null;
    const headerIn = req.body?.header !== undefined || req.body?.headerJson !== undefined;
    const header = headerIn ? normalizeHeader(req.body?.header ?? req.body?.headerJson) : null;
    if (label === '' && header?.type === 'text') label = String(header.text || '').trim();

    let contentHtml = null;
    if (req.body?.contentHtml != null) contentHtml = normalizeContentHtml(req.body.contentHtml);

    const responseType =
      req.body?.responseType != null || req.body?.response_type != null
        ? normalizeResponseType(req.body?.responseType ?? req.body?.response_type)
        : null;

    const recurrenceIn = req.body?.recurrence !== undefined || req.body?.recurrenceJson !== undefined;
    const recurrence = recurrenceIn ? req.body?.recurrence ?? req.body?.recurrenceJson : undefined;

    const draftEffective = nextIsDraft !== null ? nextIsDraft : Number(row.is_draft || 0);
    const nextLabel =
      label != null
        ? label || (draftEffective === 1 ? 'Untitled draft' : derivedAssignmentLabel(row))
        : null;
    const title = nextLabel != null ? nextLabel.slice(0, 200) : null;

    const publicIn = req.body?.isPublic !== undefined || req.body?.is_public !== undefined;
    let setPublic = false;
    let nextIsPublic = 0;
    if (draftEffective === 1) {
      // Drafts are never public — clear if previously set.
      if (Number(row.is_public) === 1 || publicIn) {
        setPublic = true;
        nextIsPublic = 0;
      }
    } else if (publicIn) {
      if (!canSetAssignmentPublic(req.user, row)) {
        return res.status(403).json({ error: 'Only admins or the creating trainer can change public sharing' });
      }
      setPublic = true;
      nextIsPublic = truthyFlag(req.body?.isPublic ?? req.body?.is_public) ? 1 : 0;
    }

    db.prepare(
      `UPDATE assignment_library SET
        title = COALESCE(?, title),
        label = COALESCE(?, label),
        content_html = COALESCE(?, content_html),
        response_type = COALESCE(?, response_type),
        header_json = COALESCE(?, header_json),
        recurrence_json = CASE WHEN ? THEN ? ELSE recurrence_json END,
        is_draft = COALESCE(?, is_draft),
        is_public = CASE WHEN ? = 1 THEN ? ELSE is_public END,
        updated_at = datetime('now')
      WHERE id = ?`,
    ).run(
      title,
      nextLabel,
      contentHtml,
      responseType,
      header ? JSON.stringify(header) : null,
      recurrenceIn ? 1 : 0,
      recurrenceIn ? (recurrence ? JSON.stringify(recurrence) : null) : null,
      nextIsDraft,
      setPublic ? 1 : 0,
      nextIsPublic,
      id,
    );
    const updated = getLibraryOr404(id);
    res.json(stripCreatorFields(req.user, serializeLibraryRow(updated, listAssets(id))));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid payload' });
  }
});

router.delete('/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Assignment not found' });
  if (!canMutateLibraryByCreatedBy(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  void deleteObjectsUnderPrefix(`pre-recorded/assignments/assignment-${id}/`).catch(() => {});
  db.prepare('DELETE FROM assignment_library WHERE id = ?').run(id);
  res.status(204).end();
});

router.post('/:id/assets', auth, requireRole('Admin', 'Trainer', 'Creator'), uploadSingle, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const assignment = db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(id);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (!canMutateLibraryByCreatedBy(req.user, assignment)) return res.status(403).json({ error: 'Forbidden' });

    const assetType = String(req.body?.assetType || '').trim();
    const allowed = ['image', 'gif', 'pdf', 'audio', 'video', 'file', 'link'];
    if (!allowed.includes(assetType)) {
      return res.status(400).json({ error: `assetType must be one of ${allowed.join(', ')}` });
    }

    if (assetType === 'link') {
      const url = String(req.body?.url || '').trim();
      if (!url) return res.status(400).json({ error: 'url is required for link' });
      const sortOrder = Number(req.body?.sortOrder || 0);
      const metaJson = req.body?.metaJson
        ? typeof req.body.metaJson === 'string'
          ? req.body.metaJson
          : JSON.stringify(req.body.metaJson)
        : null;
      const r = db
        .prepare(
          `INSERT INTO assignment_assets (assignment_id, asset_type, url, storage_key, meta_json, sort_order)
           VALUES (?, 'link', ?, NULL, ?, ?)`,
        )
        .run(id, url, metaJson, Number.isFinite(sortOrder) ? sortOrder : 0);
      return res.status(201).json(db.prepare('SELECT * FROM assignment_assets WHERE id = ?').get(r.lastInsertRowid));
    }

    if (!req.file) return res.status(400).json({ error: 'file is required' });
    if (!isSpacesConfigured()) return res.status(503).json({ error: 'DigitalOcean Spaces is not configured' });

    const ext = (req.file.originalname || '').split('.').pop() || 'bin';
    const base =
      sanitizeName(req.file.originalname?.replace(/\.[^.]+$/, '') || `${assetType}-asset`) ||
      `${assetType}-asset`;
    const key = `pre-recorded/assignments/assignment-${id}/${assetType}/${Date.now()}-${base}.${ext}`;
    const uploaded = await uploadToSpaces({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      key,
    });
    const sortOrder = Number(req.body?.sortOrder || 0);
    const metaJson = req.body?.metaJson
      ? typeof req.body.metaJson === 'string'
        ? req.body.metaJson
        : JSON.stringify(req.body.metaJson)
      : null;
    const r = db
      .prepare(
        `INSERT INTO assignment_assets (assignment_id, asset_type, url, storage_key, meta_json, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        assetType,
        uploaded.publicUrl,
        uploaded.key,
        metaJson,
        Number.isFinite(sortOrder) ? sortOrder : 0,
      );
    res.status(201).json(db.prepare('SELECT * FROM assignment_assets WHERE id = ?').get(r.lastInsertRowid));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Asset upload failed' });
  }
});

router.delete('/:id/assets/:assetId', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const assetId = Number(req.params.assetId);
  const assignment = db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(id);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  if (!canMutateLibraryByCreatedBy(req.user, assignment)) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM assignment_assets WHERE id = ? AND assignment_id = ?').run(assetId, id);
  res.status(204).end();
});

module.exports = router;
module.exports.RESPONSE_TYPES = RESPONSE_TYPES;
module.exports.materializeLessonOccurrencesForBatch = materializeLessonOccurrencesForBatch;
