/**
 * Removes classroom / course domain data while keeping:
 *   - Library: video_library, study_material_library, worksheet_library, quiz_bank (+ versions/questions/…),
 *              assignment_library (and their assets where applicable)
 *   - Users: Admin, Trainer, Creator, Lab (staff). Also keeps video_categories and holidays unchanged.
 *
 * Deletes:
 *   - All Student accounts (+ profiles, enrollments, session rows for those users, payments tied to them, etc.)
 *   - All batches, live sessions, batch assignments/submissions/attendance, live recording DB rows
 *   - Courses, course enrollments (new + legacy enrollments table), lesson templates (lesson_library),
 *     course_lessons, legacy lessons + legacy lesson attachments if present
 *   - Course/combo billing: billing_packages, course_combos, razorpay_* orders for courses, access grants
 *   - Scoped library links pointing at deleted courses or lesson templates only (quiz/video/study/worksheet assignments
 *     where scope_type IN ('course','lesson'))
 *
 * DigitalOcean Spaces (when SPACES_* is set): deletes only classroom media prefixes —
 *   live-recordings/live-session-recordings/
 *   live-recordings/assignments/
 * It does NOT delete pre-recorded/ (video library + lesson template videos live there).
 *
 * Usage from backend directory (stop API first to avoid SQLITE_BUSY):
 *   node scripts/purgeClassroomDataKeepLibrary.js --confirm
 *
 *   --skip-spaces     Skip Spaces deletion (database only).
 */
'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const args = process.argv.slice(2);
if (!args.includes('--confirm')) {
  console.error('Refusing to run without --confirm (see script header).');
  process.exit(1);
}
const skipSpaces = args.includes('--skip-spaces');

const { ensureV1Tables } = require('../migrations/v1');
const { isSpacesConfigured, deleteObjectsUnderPrefix } = require('../services/spaces');

function tableExists(db, name) {
  const r = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  return !!r;
}

async function purgeSpacesPrefixes() {
  if (skipSpaces) {
    console.log('Spaces: skipped (--skip-spaces).');
    return;
  }
  if (!isSpacesConfigured()) {
    console.warn('Spaces not configured; skipping bucket deletes. Export SPACES_* or pass --skip-spaces.');
    return;
  }
  const prefixes = ['live-recordings/live-session-recordings/', 'live-recordings/assignments/'];
  for (const p of prefixes) {
    const n = await deleteObjectsUnderPrefix(p);
    console.log(`Spaces: deleted ~${n} object(s) under "${p}"`);
  }
}

function runPurge(db) {
  db.pragma('foreign_keys = ON');
  ensureV1Tables(db);
  const run = (sql, params = []) => {
    try {
      return db.prepare(sql).run(...params);
    } catch (e) {
      console.error('SQL failed:', sql, e.message);
      throw e;
    }
  };

  const tx = db.transaction(() => {
    /* --- Payments & access referencing courses/combos/packages (before batch & billing teardown) --- */
    if (tableExists(db, 'razorpay_billing_orders')) run('DELETE FROM razorpay_billing_orders');
    if (tableExists(db, 'course_access_grants')) run('DELETE FROM course_access_grants');
    if (tableExists(db, 'razorpay_course_orders')) run('DELETE FROM razorpay_course_orders');

    /* --- Enrollments reference batches/courses; remove before batches --- */
    if (tableExists(db, 'course_enrollments')) run('DELETE FROM course_enrollments');
    if (tableExists(db, 'enrollments')) run('DELETE FROM enrollments');

    /* --- Remove library→course/lesson links only (keep bank / library rows) --- */
    if (tableExists(db, 'quiz_attempts_v2') && tableExists(db, 'quiz_assignments')) {
      run(`DELETE FROM quiz_attempts_v2 WHERE assignment_id IN (
        SELECT id FROM quiz_assignments WHERE scope_type IN ('course','lesson')
      )`);
    }
    if (tableExists(db, 'quiz_assignments')) {
      run(`DELETE FROM quiz_assignments WHERE scope_type IN ('course','lesson')`);
    }
    if (tableExists(db, 'video_assignments')) {
      run(`DELETE FROM video_assignments WHERE scope_type IN ('course','lesson')`);
    }
    if (tableExists(db, 'study_material_assignments')) {
      run(`DELETE FROM study_material_assignments WHERE scope_type IN ('course','lesson')`);
    }
    if (tableExists(db, 'worksheet_assignments')) {
      run(`DELETE FROM worksheet_assignments WHERE scope_type IN ('course','lesson')`);
    }

    /* --- Clear batch→billing FK, then billing & combos --- */
    if (tableExists(db, 'batches')) {
      try {
        run('UPDATE batches SET subscription_package_id = NULL WHERE subscription_package_id IS NOT NULL');
      } catch (_) {
        /* column may be missing on very old DBs */
      }
    }
    if (tableExists(db, 'billing_packages')) run('DELETE FROM billing_packages');
    if (tableExists(db, 'course_combo_members')) run('DELETE FROM course_combo_members');
    if (tableExists(db, 'course_combos')) run('DELETE FROM course_combos');

    /* --- Live / batch --- */
    if (tableExists(db, 'live_session_recordings')) run('DELETE FROM live_session_recordings');
    if (tableExists(db, 'live_chat_messages')) run('DELETE FROM live_chat_messages');
    if (tableExists(db, 'live_reactions')) run('DELETE FROM live_reactions');
    if (tableExists(db, 'live_session_logs')) run('DELETE FROM live_session_logs');
    if (tableExists(db, 'live_session_hands')) run('DELETE FROM live_session_hands');
    if (tableExists(db, 'live_session_speakers')) run('DELETE FROM live_session_speakers');
    if (tableExists(db, 'live_session_participants')) run('DELETE FROM live_session_participants');
    if (tableExists(db, 'live_sessions')) run('DELETE FROM live_sessions');

    if (tableExists(db, 'assignment_submissions')) run('DELETE FROM assignment_submissions');
    if (tableExists(db, 'batch_assignments')) run('DELETE FROM batch_assignments');
    if (tableExists(db, 'batch_session_attendance')) run('DELETE FROM batch_session_attendance');
    if (tableExists(db, 'batch_sessions')) run('DELETE FROM batch_sessions');
    if (tableExists(db, 'batch_members')) run('DELETE FROM batch_members');
    if (tableExists(db, 'batch_trainers')) run('DELETE FROM batch_trainers');
    if (tableExists(db, 'batches')) run('DELETE FROM batches');

    /* --- Modern curriculum --- */
    if (tableExists(db, 'course_lessons')) run('DELETE FROM course_lessons');
    if (tableExists(db, 'lesson_library')) {
      /* lesson_library_items CASCADE from lesson_library */
      run('DELETE FROM lesson_library');
    }

    /* --- Legacy per-course lessons (if still present) --- */
    if (tableExists(db, 'quiz_attempts') && tableExists(db, 'quizzes')) {
      run('DELETE FROM quiz_attempts');
    }
    if (tableExists(db, 'quiz_questions') && tableExists(db, 'quizzes')) {
      run('DELETE FROM quiz_questions');
    }
    if (tableExists(db, 'quizzes')) run('DELETE FROM quizzes');
    if (tableExists(db, 'class_notes')) run('DELETE FROM class_notes');
    /* Legacy "worksheets" attached to old lessons table — not worksheet_library */
    if (
      tableExists(db, 'worksheets') &&
      db.prepare('PRAGMA table_info(worksheets)').all().some((c) => c.name === 'lesson_id')
    ) {
      try {
        run('DELETE FROM worksheets');
      } catch (_) {}
    }
    if (tableExists(db, 'lessons')) run('DELETE FROM lessons');

    if (tableExists(db, 'courses')) run('DELETE FROM courses');

    /* --- Students only (keep Admin, Trainer, Creator, Lab) --- */
    if (tableExists(db, 'users')) {
      run(`DELETE FROM users WHERE role = 'Student'`);
    }
  });

  tx();
}

async function main() {
  await purgeSpacesPrefixes();

  const db = require('../db');
  try {
    runPurge(db);
  } finally {
    try {
      db.close();
    } catch (_) {}
  }

  console.log('Purge complete. Library tables and staff users (Admin/Trainer/Creator/Lab) were preserved.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
