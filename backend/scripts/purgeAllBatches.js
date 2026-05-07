/**
 * Deletes every batch and dependent rows: live session artifacts, assignment submissions,
 * batch sessions (including attendance via CASCADE), members, and trainers.
 *
 * Does not touch courses, lesson_library, users, holidays, or quiz/course enrollments.
 *
 * Usage (from backend/):
 *   node scripts/purgeAllBatches.js --confirm
 *
 * Uses backend/db.js (data/academy.db). Stop the API server first to avoid SQLITE_BUSY locks.
 */

const args = process.argv.slice(2);
if (!args.includes('--confirm')) {
  console.error('Refusing to run: pass --confirm (see script header).');
  process.exit(1);
}

const { ensureV1Tables } = require('../migrations/v1');
const db = require('../db');
db.pragma('foreign_keys = ON');
ensureV1Tables(db);

const run = (sql, params = []) => db.prepare(sql).run(...params);

const count = (table) => {
  try {
    return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  } catch {
    return null;
  }
};

const before = {
  batches: count('batches'),
  batch_sessions: count('batch_sessions'),
  live_sessions: count('live_sessions'),
};

const tx = db.transaction(() => {
  try {
    run('DELETE FROM live_chat_messages');
  } catch (_) {
    /* table may be missing on very old DBs */
  }
  try {
    run('DELETE FROM live_reactions');
  } catch (_) {
    /* table may be missing on very old DBs */
  }
  run('DELETE FROM live_session_logs');
  run('DELETE FROM live_session_hands');
  run('DELETE FROM live_session_speakers');
  run('DELETE FROM live_session_participants');
  run('DELETE FROM live_sessions');

  run('DELETE FROM assignment_submissions');
  run('DELETE FROM batch_assignments');
  run('DELETE FROM batch_sessions');
  run('DELETE FROM batch_members');
  run('DELETE FROM batch_trainers');
  run('DELETE FROM batches');
});

tx();

const after = {
  batches: count('batches'),
  batch_sessions: count('batch_sessions'),
  live_sessions: count('live_sessions'),
};

db.close();

console.log('Batch purge complete.');
console.log(`  batches: ${before.batches} → ${after.batches}`);
console.log(`  batch_sessions: ${before.batch_sessions} → ${after.batch_sessions}`);
console.log(`  live_sessions: ${before.live_sessions} → ${after.live_sessions}`);
