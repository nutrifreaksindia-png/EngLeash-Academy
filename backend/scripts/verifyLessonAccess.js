const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { ensureV1Tables } = require('../migrations/v1');

function coreSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      session_type TEXT NOT NULL DEFAULT 'group',
      trainer_id INTEGER NOT NULL REFERENCES users(id),
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS batch_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      joined_at TEXT DEFAULT (datetime('now')),
      UNIQUE(batch_id, student_id)
    );
  `);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  const tempDbPath = path.join(os.tmpdir(), `engleash-lesson-access-${Date.now()}.db`);
  const tempDb = new Database(tempDbPath);
  tempDb.pragma('foreign_keys = ON');
  coreSchema(tempDb);
  ensureV1Tables(tempDb);

  const dbModulePath = path.resolve(__dirname, '..', 'db.js');
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: tempDb,
  };

  const adminId = 8101;
  const trainerId = 8102;
  const studentId = 8103;
  const otherStudentId = 8104;
  const now = Date.now();

  tempDb.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(adminId, 'la-admin@test', 'x', 'Admin', 'Admin');
  tempDb.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(trainerId, 'la-trainer@test', 'x', 'Trainer A', 'Trainer');
  tempDb.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(studentId, 'la-student@test', 'x', 'Student A', 'Student');
  tempDb.prepare('INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)').run(otherStudentId, 'la-student2@test', 'x', 'Student B', 'Student');
  tempDb.prepare('INSERT INTO courses (id, name) VALUES (?, ?)').run(91, 'Grammar');
  tempDb.prepare('INSERT INTO lesson_library (id, title, created_by) VALUES (?, ?, ?)').run(501, 'Nouns (Part I)', adminId);
  tempDb.prepare('INSERT INTO course_lessons (course_id, lesson_id, day_number, sequence_in_day) VALUES (?, ?, ?, ?)').run(91, 501, 1, 1);
  tempDb.prepare(
    `INSERT INTO batches (id, name, title, trainer_id, created_by, course_id, batch_status, batch_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(71, 'Morning', 'Morning', trainerId, adminId, 91, 'started', 1);
  tempDb.prepare(
    `INSERT INTO course_access_grants (user_id, course_id, source, starts_at_ms, ends_at_ms, grace_ends_at_ms, batch_id)
     VALUES (?, ?, ?, ?, NULL, NULL, ?)`,
  ).run(studentId, 91, 'subscribe_batch', now - 1000, 71);

  const { listLessonAccess, setLessonOverride, restoreLessonOverride } = require('../lib/lessonAccess');
  const { learnerCanAccessLesson } = require('../lib/courseAccess');
  const { trainerHasLesson } = require('../lib/trainerScope');

  const listed = listLessonAccess(501, now);
  assert(listed.people.length === 2, `expected 2 people, got ${listed.people.length}`);
  const student = listed.people.find((p) => p.userId === studentId);
  const trainer = listed.people.find((p) => p.userId === trainerId);
  assert(student && student.status === 'active', 'student should have access');
  assert(student.reasons.some((r) => /batch/i.test(r.label) || /subscri/i.test(r.label)), 'student reason missing');
  assert(trainer && trainer.status === 'active', 'trainer should have access');
  assert(trainer.reasons.some((r) => /Trainer on/i.test(r.label)), 'trainer reason missing');
  assert(learnerCanAccessLesson(studentId, 'Student', 501, 91, now) === true, 'student should access lesson');
  assert(trainerHasLesson(trainerId, 501) === true, 'trainer should see lesson');

  const deny = setLessonOverride(501, studentId, 'deny', adminId);
  assert(deny.effect === 'deny', 'deny override not created');
  assert(learnerCanAccessLesson(studentId, 'Student', 501, 91, now) === false, 'denied student still has lesson access');
  assert(learnerCanAccessLesson(otherStudentId, 'Student', 501, 91, now) === false, 'unenrolled student should not gain access');
  const afterDeny = listLessonAccess(501, now);
  const deniedStudent = afterDeny.people.find((p) => p.userId === studentId);
  assert(deniedStudent.status === 'removed', 'student should show as removed');
  assert(deniedStudent.overrideId === deny.id, 'override id mismatch');

  setLessonOverride(501, trainerId, 'deny', adminId);
  assert(trainerHasLesson(trainerId, 501) === false, 'denied trainer still has lesson');

  restoreLessonOverride(deny.id, 501);
  assert(learnerCanAccessLesson(studentId, 'Student', 501, 91, now) === true, 'restored student cannot access');
  assert(trainerHasLesson(trainerId, 501) === false, 'trainer deny should remain');

  tempDb.close();
  fs.unlinkSync(tempDbPath);
  console.log('verifyLessonAccess ok');
}

main();
