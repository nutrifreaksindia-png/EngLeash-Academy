const db = require('../db');
const { ensureV1Tables } = require('../migrations/v1');

ensureV1Tables(db);

const legacyQuizzes = db.prepare('SELECT id, lesson_id, title FROM quizzes ORDER BY id').all();
if (!legacyQuizzes.length) {
  console.log('No legacy quizzes found.');
  process.exit(0);
}

const tx = db.transaction(() => {
  const insBank = db.prepare(
    `INSERT INTO quiz_bank (title, description, status, created_by) VALUES (?, ?, 'published', ?)`
  );
  const insVersion = db.prepare(
    `INSERT INTO quiz_versions (quiz_bank_id, version_no, title, passing_pct, published_by)
     VALUES (?, 1, ?, 0, ?)`
  );
  const insQuestion = db.prepare(
    `INSERT INTO quiz_questions_v2 (quiz_version_id, type, prompt, points, sort_order)
     VALUES (?, 'mcq_single', ?, 1, ?)`
  );
  const insOption = db.prepare(
    `INSERT INTO quiz_question_options (question_id, option_text, sort_order, is_correct)
     VALUES (?, ?, ?, ?)`
  );
  const insAssign = db.prepare(
    `INSERT INTO quiz_assignments (quiz_version_id, scope_type, scope_id, is_required, created_by)
     VALUES (?, 'lesson', ?, 1, ?)`
  );

  legacyQuizzes.forEach((q) => {
    const exists = db.prepare(
      `SELECT 1
       FROM quiz_assignments a
       JOIN quiz_versions v ON v.id = a.quiz_version_id
       WHERE a.scope_type = 'lesson' AND a.scope_id = ? AND v.title = ?`
    ).get(q.lesson_id, q.title || null);
    if (exists) return;

    const creator = db.prepare("SELECT id FROM users WHERE role = 'Admin' ORDER BY id LIMIT 1").get()?.id
      || db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id
      || 1;

    const b = insBank.run(q.title || `Legacy Quiz ${q.id}`, 'Backfilled from legacy quizzes table', creator);
    const quizBankId = b.lastInsertRowid;
    const v = insVersion.run(quizBankId, q.title || `Legacy Quiz ${q.id}`, creator);
    const versionId = v.lastInsertRowid;
    const questions = db.prepare(
      `SELECT id, question_text, options, correct_index, sort_order
       FROM quiz_questions
       WHERE quiz_id = ?
       ORDER BY sort_order, id`
    ).all(q.id);
    questions.forEach((qq, idx) => {
      const iq = insQuestion.run(versionId, qq.question_text, Number(qq.sort_order ?? idx));
      const questionId = iq.lastInsertRowid;
      const options = (() => {
        try {
          const arr = JSON.parse(qq.options || '[]');
          return Array.isArray(arr) ? arr : [];
        } catch {
          return [];
        }
      })();
      options.forEach((opt, optIdx) => {
        insOption.run(questionId, String(opt || ''), optIdx, Number(qq.correct_index) === optIdx ? 1 : 0);
      });
    });
    insAssign.run(versionId, q.lesson_id, creator);
  });
});

tx();
console.log('Legacy quiz backfill completed.');
