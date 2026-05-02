/**
 * One-off maintenance:
 * 1) Deletes all objects under DigitalOcean Spaces prefixes pre-recorded/ and live-recordings/ (when configured).
 * 2) Clears SQLite test domain data: courses, lessons, batches, live sessions, enrollments, non-Admin users, etc.
 *    Keeps every user with role Admin.
 * 3) Replaces 2026 holidays in DB with Tamil Nadu government public holidays for 2026 (notified list; festival
 *    dates based on state circular — subject to moon sighting where applicable).
 *
 * Usage (from backend/):
 *   node scripts/purgeTestContentAndSeedTnHolidays2026.js --confirm
 *
 * Options:
 *   --confirm       Required. Refuses to run without it.
 *   --skip-spaces   Do not call Spaces (DB-only).
 *
 * Uses backend/db.js (data/academy.db). Stop the API first to avoid a locked DB. For Spaces, set SPACES_* unless --skip-spaces.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { ensureV1Tables } = require('../migrations/v1');
const { isSpacesConfigured, deleteAllMediaObjectsInSpaces } = require('../services/spaces');

const args = process.argv.slice(2);
if (!args.includes('--confirm')) {
  console.error('Refusing to run: pass --confirm (see script header).');
  process.exit(1);
}
const skipSpaces = args.includes('--skip-spaces');

/** Tamil Nadu public holidays 2026 — dates per state notification (e.g. G.O.(Ms.) No. 708, Nov 2025). */
const TN_GOVT_HOLIDAYS_2026 = [
  ['2026-01-01', "New Year's Day"],
  ['2026-01-15', 'Pongal'],
  ['2026-01-16', 'Thiruvalluvar Day'],
  ['2026-01-17', 'Uzhavar Thirunal'],
  ['2026-01-26', 'Republic Day'],
  ['2026-02-01', 'Thai Poosam'],
  ['2026-03-19', "Telugu New Year's Day"],
  ["2026-03-21", "Ramzan (Id-ul-Fitr) — subject to moon sighting"],
  ['2026-03-31', 'Mahavir Jayanthi'],
  ['2026-04-01', 'Annual closing of accounts (commercial & co-operative banks)'],
  ['2026-04-03', 'Good Friday'],
  ['2026-04-14', "Tamil New Year's Day / Dr. B.R. Ambedkar's Birthday"],
  ['2026-05-01', 'May Day'],
  ['2026-05-28', "Bakrid (Id-ul-Azha) — subject to moon sighting"],
  ['2026-06-26', "Muharram (Yaom-e-Shahadath) — subject to moon sighting"],
  ['2026-08-15', 'Independence Day'],
  ['2026-08-26', "Milad-un-Nabi (Prophet's Birthday) — subject to moon sighting"],
  ['2026-09-04', 'Krishna Jayanthi'],
  ['2026-09-14', 'Vinayakar Chathurthi'],
  ['2026-10-02', 'Gandhi Jayanthi'],
  ['2026-10-19', 'Ayutha Pooja'],
  ['2026-10-20', 'Vijaya Dasami'],
  ['2026-11-08', 'Deepavali'],
  ['2026-12-25', 'Christmas'],
];

async function main() {
  if (!skipSpaces && isSpacesConfigured()) {
    const { deleted, prefixes } = await deleteAllMediaObjectsInSpaces();
    console.log(`Spaces: removed ${deleted} object(s) under: ${prefixes.join(', ')}`);
  } else if (!skipSpaces && !isSpacesConfigured()) {
    console.warn('Spaces env not set; skipped bucket purge. Use --skip-spaces to silence this when intentional.');
  } else {
    console.log('Spaces: skipped (--skip-spaces).');
  }

  const db = require('../db');
  db.pragma('foreign_keys = ON');
  ensureV1Tables(db);

  const admins = db.prepare("SELECT id FROM users WHERE role = 'Admin'").all();
  if (!admins.length) {
    console.error('No user with role Admin found. Aborting.');
    db.close();
    process.exit(1);
  }
  const adminId = admins[0].id;

  const run = (sql, params = []) => db.prepare(sql).run(...params);

  const tx = db.transaction(() => {
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

    run('DELETE FROM quiz_attempts');

    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='course_lessons'").get()) {
      run('DELETE FROM course_lessons');
    }
    run('DELETE FROM enrollments');
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='course_enrollments'").get()) {
      run('DELETE FROM course_enrollments');
    }

    run('DELETE FROM courses');

    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='lesson_library'").get()) {
      run('DELETE FROM lesson_library');
    }

    run('DELETE FROM sessions');

    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='user_profiles'").get()) {
      run(`DELETE FROM user_profiles WHERE user_id NOT IN (SELECT id FROM users WHERE role = 'Admin')`);
    }
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='student_profiles'").get()) {
      run(`DELETE FROM student_profiles WHERE user_id NOT IN (SELECT id FROM users WHERE role = 'Admin')`);
    }

    run(`DELETE FROM holidays WHERE holiday_date >= '2026-01-01' AND holiday_date <= '2026-12-31'`);

    run(`DELETE FROM users WHERE role != 'Admin'`);
  });

  tx();

  const ins = db.prepare(
    'INSERT OR REPLACE INTO holidays (holiday_date, reason, created_by) VALUES (?, ?, ?)'
  );
  const holidayTx = db.transaction(() => {
    for (const [date, reason] of TN_GOVT_HOLIDAYS_2026) {
      ins.run(date, reason, adminId);
    }
  });
  holidayTx();

  const remainingUsers = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const remainingCourses = db.prepare('SELECT COUNT(*) AS c FROM courses').get().c;
  const holidayCount = db.prepare("SELECT COUNT(*) AS c FROM holidays WHERE holiday_date LIKE '2026-%'").get().c;

  db.close();

  console.log('Database purge complete.');
  console.log(`  Users remaining: ${remainingUsers} (Admin only)`);
  console.log(`  Courses remaining: ${remainingCourses}`);
  console.log(`  2026 holidays in DB: ${holidayCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
