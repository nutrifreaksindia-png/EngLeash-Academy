const express = require('express');
const multer = require('multer');
const db = require('../db');
const uploadMemory = require('../uploadMemory');
const { auth, requireRole } = require('../middleware/auth');
const { isSpacesConfigured, uploadToSpaces, deleteObjectsUnderPrefix } = require('../services/spaces');
const {
  canMutateLibraryByCreatedBy,
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
  RESPONSE_TYPES,
} = require('../lib/assignmentHelpers');

const router = express.Router();
const uploadSingle = uploadMemory.single('file');

function truthyDraft(val) {
  if (val === true || val === 1 || val === '1') return true;
  if (String(val).toLowerCase() === 'true') return true;
  return false;
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
      // Due end of schedule day by default for lesson-sourced.
      ins.run(libId, batchId, lessonId, scheduleDate, `${scheduleDate}T23:59:59`);
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
  const batch = db.prepare('SELECT id, name, title FROM batches WHERE id = ?').get(row.batch_id);
  return {
    ...row,
    displayLabel: derivedAssignmentLabel(lib || { id: row.library_id, title: row.notes }),
    library: lib ? serializeLibraryRow(lib, assets) : null,
    batchName: batch?.title || batch?.name || null,
    submission,
    done: Boolean(
      submission &&
        (submission.status === 'done' ||
          submission.status === 'submitted' ||
          submission.file_url ||
          submission.text_body),
    ),
  };
}

/* -------------------- Library list / create -------------------- */

router.get('/', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  let rows = db
    .prepare(
      `
    SELECT m.id, m.title, m.description, m.label, m.response_type, m.header_json, m.is_draft,
           m.created_by, m.created_at, m.updated_at, m.content_html, m.recurrence_json,
           MAX(cu.name) AS creator_name
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
    const r = db
      .prepare(
        `INSERT INTO assignment_library
          (title, description, content_html, created_by, is_draft, label, response_type, header_json, recurrence_json)
         VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        title,
        contentHtml,
        req.user.id,
        isDraft ? 1 : 0,
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

    if (filter === 'today') {
      if (scheduleDate === today || dueDay === today) out.push(payload);
    } else if (filter === 'overdue') {
      if (!done && dueDay && dueDay < today && scheduleDate <= today) out.push(payload);
    } else if (filter === 'upcoming') {
      if (scheduleDate > today) out.push(payload);
    } else {
      if (scheduleDate <= today) out.push(payload);
    }
  }
  res.json(out);
});

router.post('/set', auth, requireRole('Admin', 'Trainer'), (req, res) => {
  try {
    const libraryIds = Array.isArray(req.body?.libraryIds)
      ? req.body.libraryIds.map(Number).filter(Boolean)
      : [];
    const batchIds = Array.isArray(req.body?.batchIds) ? req.body.batchIds.map(Number).filter(Boolean) : [];
    const day = String(req.body?.day || req.body?.scheduleDate || '').slice(0, 10);
    const dueAt = req.body?.dueAt != null ? String(req.body.dueAt) : null;
    const notes = req.body?.notes != null ? String(req.body.notes) : null;
    const studentIds = Array.isArray(req.body?.studentIds)
      ? req.body.studentIds.map(Number).filter(Boolean)
      : [];
    const recurrence = req.body?.recurrence ?? null;
    const maxScore = req.body?.maxScore != null ? Number(req.body.maxScore) : 10;

    if (!libraryIds.length) return res.status(400).json({ error: 'libraryIds required' });
    if (!batchIds.length) return res.status(400).json({ error: 'batchIds required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: 'day must be YYYY-MM-DD' });

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
        const rule = recurrence || parseJsonSafe(lib.recurrence_json, null);
        const dates = expandRecurrenceDates(day, rule);
        for (const bid of batchIds) {
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
      `SELECT s.*, o.schedule_date, o.due_at, o.batch_id AS occ_batch_id, o.library_id,
              u.name AS student_name, b.title AS batch_title, b.name AS batch_name
       FROM assignment_submissions s
       JOIN assignment_occurrences o ON o.id = s.occurrence_id
       JOIN users u ON u.id = s.student_id
       JOIN batches b ON b.id = o.batch_id
       WHERE o.batch_id IN (${placeholders})
       ORDER BY s.submitted_at DESC, s.id DESC
       LIMIT 500`,
    )
    .all(...batchIds);
  res.json(
    rows.map((r) => ({
      ...r,
      displayLabel: derivedAssignmentLabel(
        db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(r.library_id) || {},
      ),
      batchName: r.batch_title || r.batch_name,
    })),
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

router.post(
  '/occurrences/:occurrenceId/submit',
  auth,
  requireRole('Student', 'Lab'),
  uploadSingle,
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

      let fileKey = '';
      let fileUrl = '';
      let mimeType = null;

      if (responseType === 'other') {
        // mark done with no media
      } else if (responseType === 'text') {
        if (!textBody || !textBody.trim()) return res.status(400).json({ error: 'textBody required' });
      } else {
        if (!req.file) return res.status(400).json({ error: 'file is required' });
        if (!isSpacesConfigured()) return res.status(503).json({ error: 'Storage is not configured' });
        const ext = (req.file.originalname || '').split('.').pop() || 'bin';
        const base =
          sanitizeName(req.file.originalname?.replace(/\.[^.]+$/, '') || responseType) || responseType;
        const key = `live-recordings/assignments/occurrence-${occurrenceId}/${req.user.id}-${Date.now()}-${base}.${ext}`;
        const uploaded = await uploadToSpaces({
          buffer: req.file.buffer,
          mimeType: req.file.mimetype,
          key,
        });
        fileKey = uploaded.key;
        fileUrl = uploaded.publicUrl;
        mimeType = req.file.mimetype;
      }

      const legacyAssignmentId =
        row.legacy_batch_assignment_id ||
        db
          .prepare('SELECT id FROM batch_assignments WHERE batch_id = ? ORDER BY id DESC LIMIT 1')
          .get(row.batch_id)?.id ||
        null;

      // Keep legacy NOT NULL assignment_id if present; use placeholder 0-row via insert into batch if needed.
      let assignmentId = legacyAssignmentId;
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

      db.prepare(
        `INSERT INTO assignment_submissions
          (assignment_id, batch_id, student_id, file_key, file_url, occurrence_id, response_type, text_body, mime_type, status, review_status, score, feedback, reviewed_by, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'done', 'pending', NULL, NULL, NULL, NULL)
         ON CONFLICT(assignment_id, student_id) DO UPDATE SET
           file_key = excluded.file_key,
           file_url = excluded.file_url,
           occurrence_id = excluded.occurrence_id,
           response_type = excluded.response_type,
           text_body = excluded.text_body,
           mime_type = excluded.mime_type,
           status = 'done',
           review_status = 'pending',
           score = NULL,
           feedback = NULL,
           reviewed_by = NULL,
           reviewed_at = NULL,
           submitted_at = datetime('now')`,
      ).run(
        assignmentId,
        row.batch_id,
        req.user.id,
        fileKey || 'none',
        fileUrl || '',
        occurrenceId,
        responseType,
        textBody,
        mimeType,
      );

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
  (req, res) => {
    const occurrenceId = Number(req.params.occurrenceId);
    const submissionId = Number(req.params.submissionId);
    const row = db.prepare('SELECT * FROM assignment_occurrences WHERE id = ?').get(occurrenceId);
    if (!row) return res.status(404).json({ error: 'Not found' });
    if (req.user.role === 'Trainer' && !trainerBatchIds(req.user.id).includes(Number(row.batch_id))) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const score = req.body?.score != null ? Number(req.body.score) : null;
    const feedback = req.body?.feedback != null ? String(req.body.feedback) : null;
    db.prepare(
      `UPDATE assignment_submissions SET
        score = ?, feedback = ?, review_status = 'reviewed',
        reviewed_by = ?, reviewed_at = datetime('now')
       WHERE id = ? AND occurrence_id = ?`,
    ).run(score, feedback, req.user.id, submissionId, occurrenceId);
    const updated = db.prepare('SELECT * FROM assignment_submissions WHERE id = ?').get(submissionId);
    res.json(updated);
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

    db.prepare(
      `UPDATE assignment_library SET
        title = COALESCE(?, title),
        label = COALESCE(?, label),
        content_html = COALESCE(?, content_html),
        response_type = COALESCE(?, response_type),
        header_json = COALESCE(?, header_json),
        recurrence_json = CASE WHEN ? THEN ? ELSE recurrence_json END,
        is_draft = COALESCE(?, is_draft),
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
