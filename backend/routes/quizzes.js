const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const {
  canMutateLibraryByCreatedBy,
  canViewQuizBank,
  stripCreatorFields,
  stripRows,
} = require('../lib/libraryScope');

const router = express.Router();

function canAccessLesson(db, userId, role, lessonId) {
  const lesson = db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(lessonId);
  if (!lesson) return false;
  if (role === 'Admin') return true;
  const e = db.prepare('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?').get(userId, lesson.course_id);
  return !!e;
}

function canAccessCourse(db, userId, role, courseId) {
  if (role === 'Admin') return true;
  const e = db.prepare("SELECT 1 FROM course_enrollments WHERE user_id = ? AND course_id = ? AND status = 'approved'").get(userId, courseId)
    || db.prepare('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?').get(userId, courseId);
  return !!e;
}

function normalizeText(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

function normalizeTextInsensitive(s) {
  return normalizeText(s).toLowerCase();
}

function parseJsonSafe(raw, fallback = null) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    return fallback;
  }
}

function ensureQuestionPayload(questions) {
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('questions array is required');
  }
  questions.forEach((q, idx) => {
    if (!q || typeof q !== 'object') throw new Error(`Question ${idx + 1}: invalid object`);
    if (!q.type || !['mcq_single', 'mcq_multi', 'matching', 'fill_blank'].includes(q.type)) {
      throw new Error(`Question ${idx + 1}: unsupported type`);
    }
    if (!normalizeText(q.prompt)) throw new Error(`Question ${idx + 1}: prompt is required`);
    if (!Number.isFinite(Number(q.points || 1))) throw new Error(`Question ${idx + 1}: points must be numeric`);

    if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
      if (!Array.isArray(q.options) || q.options.length < 2) {
        throw new Error(`Question ${idx + 1}: at least 2 options required`);
      }
      const correctCount = q.options.filter((o) => o && o.is_correct).length;
      if (q.type === 'mcq_single' && correctCount !== 1) {
        throw new Error(`Question ${idx + 1}: mcq_single needs exactly 1 correct option`);
      }
      if (q.type === 'mcq_multi' && correctCount < 1) {
        throw new Error(`Question ${idx + 1}: mcq_multi needs at least 1 correct option`);
      }
    } else if (q.type === 'matching') {
      if (!Array.isArray(q.pairs) || q.pairs.length < 2) {
        throw new Error(`Question ${idx + 1}: matching requires at least 2 pairs`);
      }
      q.pairs.forEach((p, pIdx) => {
        if (!normalizeText(p.left_text) || !normalizeText(p.right_text)) {
          throw new Error(`Question ${idx + 1}, pair ${pIdx + 1}: both sides required`);
        }
      });
    } else if (q.type === 'fill_blank') {
      if (!Array.isArray(q.solutions) || q.solutions.length < 1) {
        throw new Error(`Question ${idx + 1}: fill_blank requires at least 1 solution`);
      }
      q.solutions.forEach((s, sIdx) => {
        if (!normalizeText(s.blank_key) || !normalizeText(s.answer_text)) {
          throw new Error(`Question ${idx + 1}, solution ${sIdx + 1}: blank_key and answer_text required`);
        }
      });
    }
  });
}

function hydrateQuestions(versionId) {
  const questions = db.prepare(
    `SELECT id, quiz_version_id, type, prompt, explanation, points, sort_order
     FROM quiz_questions_v2
     WHERE quiz_version_id = ?
     ORDER BY sort_order, id`
  ).all(versionId);

  return questions.map((q) => {
    if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
      const options = db.prepare(
        `SELECT id, option_text, sort_order, is_correct
         FROM quiz_question_options
         WHERE question_id = ?
         ORDER BY sort_order, id`
      ).all(q.id);
      return { ...q, options };
    }
    if (q.type === 'matching') {
      const pairs = db.prepare(
        `SELECT id, left_text, right_text, sort_order
         FROM quiz_matching_pairs
         WHERE question_id = ?
         ORDER BY sort_order, id`
      ).all(q.id);
      return { ...q, pairs };
    }
    const solutions = db.prepare(
      `SELECT id, blank_key, answer_text, is_case_sensitive, alt_group
       FROM quiz_blank_solutions
       WHERE question_id = ?
       ORDER BY id`
    ).all(q.id);
    return { ...q, solutions };
  });
}

function saveQuestionsForVersion(versionId, questions) {
  const existing = db.prepare('SELECT id FROM quiz_questions_v2 WHERE quiz_version_id = ?').all(versionId);
  existing.forEach((q) => {
    db.prepare('DELETE FROM quiz_question_options WHERE question_id = ?').run(q.id);
    db.prepare('DELETE FROM quiz_matching_pairs WHERE question_id = ?').run(q.id);
    db.prepare('DELETE FROM quiz_blank_solutions WHERE question_id = ?').run(q.id);
  });
  db.prepare('DELETE FROM quiz_questions_v2 WHERE quiz_version_id = ?').run(versionId);

  const insertQuestion = db.prepare(
    `INSERT INTO quiz_questions_v2 (quiz_version_id, type, prompt, explanation, points, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertOption = db.prepare(
    `INSERT INTO quiz_question_options (question_id, option_text, sort_order, is_correct)
     VALUES (?, ?, ?, ?)`
  );
  const insertPair = db.prepare(
    `INSERT INTO quiz_matching_pairs (question_id, left_text, right_text, sort_order)
     VALUES (?, ?, ?, ?)`
  );
  const insertBlank = db.prepare(
    `INSERT INTO quiz_blank_solutions (question_id, blank_key, answer_text, is_case_sensitive, alt_group)
     VALUES (?, ?, ?, ?, ?)`
  );

  questions.forEach((q, idx) => {
    const qRes = insertQuestion.run(
      versionId,
      q.type,
      normalizeText(q.prompt),
      q.explanation ? String(q.explanation) : null,
      Number(q.points || 1),
      Number(q.sort_order ?? idx)
    );
    const questionId = qRes.lastInsertRowid;

    if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
      q.options.forEach((o, oIdx) => {
        insertOption.run(questionId, String(o.option_text || '').trim(), Number(o.sort_order ?? oIdx), o.is_correct ? 1 : 0);
      });
    } else if (q.type === 'matching') {
      q.pairs.forEach((p, pIdx) => {
        insertPair.run(questionId, String(p.left_text || '').trim(), String(p.right_text || '').trim(), Number(p.sort_order ?? pIdx));
      });
    } else if (q.type === 'fill_blank') {
      q.solutions.forEach((s) => {
        insertBlank.run(
          questionId,
          String(s.blank_key || '').trim(),
          String(s.answer_text || '').trim(),
          s.is_case_sensitive ? 1 : 0,
          s.alt_group ? String(s.alt_group) : null
        );
      });
    }
  });
}

function getAssignmentForLearner(assignmentId, user) {
  const assignment = db.prepare(
    `SELECT a.*, v.quiz_bank_id, v.title AS version_title, v.time_limit_sec, v.shuffle_questions, v.passing_pct,
            b.title AS quiz_title, b.description AS quiz_description
     FROM quiz_assignments a
     JOIN quiz_versions v ON v.id = a.quiz_version_id
     JOIN quiz_bank b ON b.id = v.quiz_bank_id
     WHERE a.id = ?`
  ).get(assignmentId);
  if (!assignment) return null;

  if (assignment.scope_type === 'course') {
    if (!canAccessCourse(db, user.id, user.role, assignment.scope_id)) return { error: 'Access denied' };
  } else if (assignment.scope_type === 'lesson') {
    const lesson = db.prepare('SELECT course_id FROM lessons WHERE id = ?').get(assignment.scope_id)
      || db.prepare('SELECT course_id FROM course_lessons WHERE lesson_id = ? LIMIT 1').get(assignment.scope_id);
    if (!lesson || !canAccessCourse(db, user.id, user.role, lesson.course_id)) return { error: 'Access denied' };
  }
  return assignment;
}

function gradeQuestion(question, response) {
  const maxPoints = Number(question.points || 1);
  if (question.type === 'mcq_single') {
    const selected = Number(response?.selectedIndex);
    const correct = (question.options || []).find((o) => Number(o.is_correct) === 1);
    const ok = correct && selected === Number(correct.sort_order);
    return { isCorrect: !!ok, earned: ok ? maxPoints : 0 };
  }
  if (question.type === 'mcq_multi') {
    const selected = Array.isArray(response?.selectedIndices) ? response.selectedIndices.map(Number).sort((a, b) => a - b) : [];
    const expected = (question.options || [])
      .filter((o) => Number(o.is_correct) === 1)
      .map((o) => Number(o.sort_order))
      .sort((a, b) => a - b);
    const ok = selected.length === expected.length && selected.every((v, i) => v === expected[i]);
    return { isCorrect: ok, earned: ok ? maxPoints : 0 };
  }
  if (question.type === 'matching') {
    const map = response?.matches && typeof response.matches === 'object' ? response.matches : {};
    const expected = (question.pairs || []).reduce((acc, p) => {
      acc[normalizeTextInsensitive(p.left_text)] = normalizeTextInsensitive(p.right_text);
      return acc;
    }, {});
    const leftKeys = Object.keys(expected);
    const ok = leftKeys.length > 0 && leftKeys.every((left) => normalizeTextInsensitive(map[left]) === expected[left]);
    return { isCorrect: ok, earned: ok ? maxPoints : 0 };
  }
  const answers = Array.isArray(response?.blanks) ? response.blanks : [];
  const map = answers.reduce((acc, b) => {
    acc[String(b.blank_key || '').trim()] = String(b.answer_text || '');
    return acc;
  }, {});
  const solutions = Array.isArray(question.solutions) ? question.solutions : [];
  if (solutions.length === 0) return { isCorrect: false, earned: 0 };
  const ok = solutions.every((s) => {
    const actual = map[s.blank_key] ?? '';
    if (Number(s.is_case_sensitive) === 1) return normalizeText(actual) === normalizeText(s.answer_text);
    return normalizeTextInsensitive(actual) === normalizeTextInsensitive(s.answer_text);
  });
  return { isCorrect: ok, earned: ok ? maxPoints : 0 };
}

// v2 authoring APIs
router.get('/v2', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const sql = `
    SELECT b.id, b.title, b.description, b.status, b.created_by, b.created_at, b.updated_at,
           MAX(u.name) AS creator_name,
           MAX(v.version_no) AS latest_version
     FROM quiz_bank b
     LEFT JOIN users u ON u.id = b.created_by
     LEFT JOIN quiz_versions v ON v.quiz_bank_id = b.id
     GROUP BY b.id
     ORDER BY b.updated_at DESC, b.id DESC`;
  let rows = db.prepare(sql).all();
  if (req.user.role === 'Creator') {
    rows = rows.filter((b) => b.status !== 'draft' || Number(b.created_by) === Number(req.user.id));
  }
  res.json(stripRows(req.user, rows));
});

router.post('/v2', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const { title, description, status } = req.body || {};
  if (!normalizeText(title)) return res.status(400).json({ error: 'title is required' });
  const st = ['draft', 'published', 'archived'].includes(status) ? status : 'draft';
  const r = db.prepare(
    `INSERT INTO quiz_bank (title, description, status, created_by) VALUES (?, ?, ?, ?)`
  ).run(normalizeText(title), description ? String(description) : null, st, req.user.id);
  const row = db.prepare('SELECT * FROM quiz_bank WHERE id = ?').get(r.lastInsertRowid);
  res.status(201).json(stripCreatorFields(req.user, row));
});

router.get('/v2/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const bank = db.prepare(
    `SELECT b.*, u.name AS creator_name FROM quiz_bank b LEFT JOIN users u ON u.id = b.created_by WHERE b.id = ?`
  ).get(id);
  if (!bank) return res.status(404).json({ error: 'Quiz not found' });
  if (!canViewQuizBank(req.user, bank)) {
    return res.status(404).json({ error: 'Quiz not found' });
  }
  const versions = db.prepare(
    `SELECT * FROM quiz_versions WHERE quiz_bank_id = ? ORDER BY version_no DESC, id DESC`
  ).all(id).map((v) => ({ ...v, questions: hydrateQuestions(v.id) }));
  const assignments = db.prepare(
    `SELECT * FROM quiz_assignments WHERE quiz_version_id IN (SELECT id FROM quiz_versions WHERE quiz_bank_id = ?)
     ORDER BY id DESC`
  ).all(id);
  const bankOut = stripCreatorFields(req.user, bank);
  res.json({ ...bankOut, versions, assignments });
});

router.put('/v2/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const prev = db.prepare('SELECT * FROM quiz_bank WHERE id = ?').get(id);
  if (!prev) return res.status(404).json({ error: 'Quiz not found' });
  if (!canMutateLibraryByCreatedBy(req.user, prev)) return res.status(403).json({ error: 'Forbidden' });
  const { title, description, status } = req.body || {};
  const st = status == null ? prev.status : status;
  if (!['draft', 'published', 'archived'].includes(st)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(
    `UPDATE quiz_bank
     SET title = COALESCE(?, title), description = COALESCE(?, description), status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(title ? normalizeText(title) : null, description ?? null, st, id);
  const row = db.prepare('SELECT * FROM quiz_bank WHERE id = ?').get(id);
  res.json(stripCreatorFields(req.user, row));
});

router.delete('/v2/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const prev = db.prepare('SELECT * FROM quiz_bank WHERE id = ?').get(id);
  if (!prev) return res.status(404).json({ error: 'Quiz not found' });
  if (!canMutateLibraryByCreatedBy(req.user, prev)) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM quiz_bank WHERE id = ?').run(id);
  res.json({ ok: true });
});

router.post('/v2/:id/versions', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const quizBankId = Number(req.params.id);
  const bank = db.prepare('SELECT * FROM quiz_bank WHERE id = ?').get(quizBankId);
  if (!bank) return res.status(404).json({ error: 'Quiz not found' });
  if (!canMutateLibraryByCreatedBy(req.user, bank)) return res.status(403).json({ error: 'Forbidden' });

  const { title, timeLimitSec, shuffleQuestions, passingPct, questions = [] } = req.body || {};
  try {
    ensureQuestionPayload(questions);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const latest = db.prepare('SELECT MAX(version_no) AS v FROM quiz_versions WHERE quiz_bank_id = ?').get(quizBankId)?.v || 0;
  const versionNo = Number(latest) + 1;
  const insertVersion = db.prepare(
    `INSERT INTO quiz_versions (quiz_bank_id, version_no, title, time_limit_sec, shuffle_questions, passing_pct, published_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    const r = insertVersion.run(
      quizBankId,
      versionNo,
      title ? String(title) : null,
      timeLimitSec == null ? null : Number(timeLimitSec),
      shuffleQuestions ? 1 : 0,
      passingPct == null ? 0 : Number(passingPct),
      req.user.id
    );
    const versionId = r.lastInsertRowid;
    saveQuestionsForVersion(versionId, questions);
    db.prepare("UPDATE quiz_bank SET status = 'published', updated_at = datetime('now') WHERE id = ?").run(quizBankId);
    return versionId;
  });

  const versionId = tx();
  const version = db.prepare('SELECT * FROM quiz_versions WHERE id = ?').get(versionId);
  res.status(201).json({ ...version, questions: hydrateQuestions(versionId) });
});

router.post('/v2/:id/questions', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const quizBankId = Number(req.params.id);
  const bank = db.prepare('SELECT * FROM quiz_bank WHERE id = ?').get(quizBankId);
  if (!bank) return res.status(404).json({ error: 'Quiz not found' });
  if (!canMutateLibraryByCreatedBy(req.user, bank)) return res.status(403).json({ error: 'Forbidden' });
  const { versionId, questions = [] } = req.body || {};
  const version = db.prepare('SELECT * FROM quiz_versions WHERE id = ? AND quiz_bank_id = ?').get(Number(versionId), quizBankId);
  if (!version) return res.status(404).json({ error: 'Version not found' });
  try {
    ensureQuestionPayload(questions);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  saveQuestionsForVersion(version.id, questions);
  db.prepare("UPDATE quiz_bank SET updated_at = datetime('now') WHERE id = ?").run(quizBankId);
  res.json({ ...version, questions: hydrateQuestions(version.id) });
});

router.post('/v2/:id/assignments', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const quizBankId = Number(req.params.id);
  const bank = db.prepare('SELECT * FROM quiz_bank WHERE id = ?').get(quizBankId);
  if (!bank) return res.status(404).json({ error: 'Quiz not found' });
  if (!canMutateLibraryByCreatedBy(req.user, bank)) return res.status(403).json({ error: 'Forbidden' });
  const {
    quizVersionId,
    scopeType,
    scopeId,
    availabilityStart,
    availabilityEnd,
    isRequired,
    orderIndex,
  } = req.body || {};
  if (!['course', 'lesson'].includes(scopeType)) return res.status(400).json({ error: 'scopeType must be course or lesson' });
  const version = db.prepare('SELECT * FROM quiz_versions WHERE id = ? AND quiz_bank_id = ?').get(Number(quizVersionId), quizBankId);
  if (!version) return res.status(404).json({ error: 'quizVersionId not found for this quiz' });
  if (!Number.isFinite(Number(scopeId))) return res.status(400).json({ error: 'scopeId must be numeric' });

  if (scopeType === 'course') {
    const c = db.prepare('SELECT id FROM courses WHERE id = ?').get(Number(scopeId));
    if (!c) return res.status(404).json({ error: 'Course not found' });
  } else {
    const l = db.prepare('SELECT id FROM lessons WHERE id = ?').get(Number(scopeId))
      || db.prepare('SELECT lesson_id AS id FROM course_lessons WHERE lesson_id = ? LIMIT 1').get(Number(scopeId));
    if (!l) return res.status(404).json({ error: 'Lesson not found' });
  }

  const r = db.prepare(
    `INSERT INTO quiz_assignments
     (quiz_version_id, scope_type, scope_id, availability_start, availability_end, is_required, order_index, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    version.id,
    scopeType,
    Number(scopeId),
    availabilityStart ? String(availabilityStart) : null,
    availabilityEnd ? String(availabilityEnd) : null,
    isRequired ? 1 : 0,
    Number(orderIndex || 0),
    req.user.id
  );
  res.status(201).json(db.prepare('SELECT * FROM quiz_assignments WHERE id = ?').get(r.lastInsertRowid));
});

// v2 learner delivery APIs
router.get('/v2/assignments', auth, (req, res) => {
  const courseId = req.query.courseId != null ? Number(req.query.courseId) : null;
  const lessonId = req.query.lessonId != null ? Number(req.query.lessonId) : null;
  const nowIso = new Date().toISOString();

  const rows = db.prepare(
    `SELECT a.*, v.title AS version_title, b.title AS quiz_title, b.description AS quiz_description
     FROM quiz_assignments a
     JOIN quiz_versions v ON v.id = a.quiz_version_id
     JOIN quiz_bank b ON b.id = v.quiz_bank_id
     WHERE
       (a.scope_type = 'course' AND (? IS NOT NULL AND a.scope_id = ?))
       OR
       (a.scope_type = 'lesson' AND (? IS NOT NULL AND a.scope_id = ?))
     ORDER BY a.order_index, a.id`
  ).all(courseId, courseId, lessonId, lessonId);

  const visible = rows.filter((a) => {
    if (a.availability_start && String(a.availability_start) > nowIso) return false;
    if (a.availability_end && String(a.availability_end) < nowIso) return false;
    if (a.scope_type === 'course') return canAccessCourse(db, req.user.id, req.user.role, a.scope_id);
    return canAccessLesson(db, req.user.id, req.user.role, a.scope_id);
  }).map((a) => {
    const latest = db.prepare(
      `SELECT id, attempt_no, score, max_score, submitted_at
       FROM quiz_attempts_v2
       WHERE assignment_id = ? AND user_id = ?
       ORDER BY attempt_no DESC, id DESC
       LIMIT 1`
    ).get(a.id, req.user.id);
    return { ...a, latestAttempt: latest || null };
  });

  res.json(visible);
});

router.get('/v2/assignment/:assignmentId', auth, (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const assignment = getAssignmentForLearner(assignmentId, req.user);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  if (assignment.error) return res.status(403).json({ error: assignment.error });
  const questions = hydrateQuestions(assignment.quiz_version_id).map((q) => {
    if (q.type === 'mcq_single' || q.type === 'mcq_multi') {
      return {
        ...q,
        options: (q.options || []).map((o) => ({ id: o.id, option_text: o.option_text, sort_order: o.sort_order })),
      };
    }
    if (q.type === 'fill_blank') {
      return {
        ...q,
        solutions: (q.solutions || []).map((s) => ({ blank_key: s.blank_key, is_case_sensitive: s.is_case_sensitive, alt_group: s.alt_group })),
      };
    }
    return q;
  });
  const latest = db.prepare(
    `SELECT id, attempt_no, score, max_score, submitted_at
     FROM quiz_attempts_v2
     WHERE assignment_id = ? AND user_id = ?
     ORDER BY attempt_no DESC, id DESC
     LIMIT 1`
  ).get(assignmentId, req.user.id);
  res.json({
    assignment,
    quiz: {
      id: assignment.quiz_bank_id,
      title: assignment.quiz_title || assignment.version_title || 'Quiz',
      description: assignment.quiz_description || null,
      questions,
    },
    latestAttempt: latest || null,
  });
});

router.post('/v2/assignment/:assignmentId/submit', auth, (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const assignment = getAssignmentForLearner(assignmentId, req.user);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  if (assignment.error) return res.status(403).json({ error: assignment.error });
  const nowIso = new Date().toISOString();
  if (assignment.availability_start && String(assignment.availability_start) > nowIso) {
    return res.status(400).json({ error: 'Quiz not available yet' });
  }
  if (assignment.availability_end && String(assignment.availability_end) < nowIso) {
    return res.status(400).json({ error: 'Quiz window closed' });
  }

  const questions = hydrateQuestions(assignment.quiz_version_id);
  const answerMap = req.body?.answers && typeof req.body.answers === 'object' ? req.body.answers : {};
  let score = 0;
  let maxScore = 0;
  const graded = [];
  questions.forEach((q) => {
    maxScore += Number(q.points || 1);
    const response = answerMap[q.id] ?? null;
    const g = gradeQuestion(q, response);
    score += g.earned;
    graded.push({ questionId: q.id, response, ...g });
  });

  const latestAttempt = db.prepare(
    `SELECT attempt_no FROM quiz_attempts_v2 WHERE assignment_id = ? AND user_id = ? ORDER BY attempt_no DESC, id DESC LIMIT 1`
  ).get(assignmentId, req.user.id);
  const nextAttemptNo = Number(latestAttempt?.attempt_no || 0) + 1;

  const tx = db.transaction(() => {
    const a = db.prepare(
      `INSERT INTO quiz_attempts_v2 (assignment_id, user_id, attempt_no, started_at, submitted_at, score, max_score, status)
       VALUES (?, ?, ?, datetime('now'), datetime('now'), ?, ?, 'submitted')`
    ).run(assignmentId, req.user.id, nextAttemptNo, score, maxScore);
    const attemptId = a.lastInsertRowid;
    const ins = db.prepare(
      `INSERT INTO quiz_attempt_responses (attempt_id, question_id, response_json, is_correct, earned_points)
       VALUES (?, ?, ?, ?, ?)`
    );
    graded.forEach((g) => {
      ins.run(attemptId, g.questionId, JSON.stringify(g.response), g.isCorrect ? 1 : 0, g.earned);
    });
    return attemptId;
  });
  const attemptId = tx();
  const passingPct = Number(assignment.passing_pct || 0);
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  res.json({
    attemptId,
    score,
    maxScore,
    pct,
    attemptNo: nextAttemptNo,
    passed: maxScore > 0 ? pct >= passingPct : false,
  });
});

router.get('/v2/assignment/:assignmentId/attempts/latest', auth, (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const assignment = getAssignmentForLearner(assignmentId, req.user);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  if (assignment.error) return res.status(403).json({ error: assignment.error });

  const latest = db.prepare(
    `SELECT id, assignment_id, user_id, attempt_no, started_at, submitted_at, score, max_score, status
     FROM quiz_attempts_v2
     WHERE assignment_id = ? AND user_id = ?
     ORDER BY attempt_no DESC, id DESC
     LIMIT 1`
  ).get(assignmentId, req.user.id);
  if (!latest) return res.json(null);
  const responses = db.prepare(
    `SELECT question_id, response_json, is_correct, earned_points
     FROM quiz_attempt_responses
     WHERE attempt_id = ?
     ORDER BY id`
  ).all(latest.id).map((r) => ({ ...r, response: parseJsonSafe(r.response_json, null) }));
  res.json({ ...latest, responses });
});

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
