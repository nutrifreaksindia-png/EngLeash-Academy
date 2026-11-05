const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { ensureV1Tables } = require('../migrations/v1');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

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
    CREATE TABLE IF NOT EXISTS sessions (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      token_jti TEXT NOT NULL,
      device_name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      image_url TEXT,
      sort_order INTEGER DEFAULT 0,
      is_published INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      video_url TEXT,
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

async function main() {
  const tempDbPath = path.join(os.tmpdir(), `engleash-trainer-verify-${Date.now()}.db`);
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

  const adminId = 9401;
  const trainerAId = 9402;
  const trainerBId = 9403;
  const studentId = 9404;
  const courseAId = 9410;
  const courseBId = 9411;
  const batchAId = 9420;
  const batchBId = 9421;
  const lessonAId = 9430;
  const videoOwnId = 9440;
  const videoScopedId = 9441;
  const videoOtherId = 9442;
  const adminJti = 'trainer-admin';
  const trainerAJti = 'trainer-a';
  const trainerBJti = 'trainer-b';

  function addUser(id, email, name, role, jti) {
    tempDb
      .prepare(
        `INSERT INTO users (id, email, password_hash, name, role, created_at, status, mobile_number)
         VALUES (?, ?, 'x', ?, ?, datetime('now'), 'approved', '9876543210')`,
      )
      .run(id, email, name, role);
    tempDb
      .prepare(`INSERT INTO sessions (user_id, token_jti, device_name, created_at) VALUES (?, ?, 'Verify', datetime('now'))`)
      .run(id, jti);
  }

  addUser(adminId, 'trainer.admin@example.com', 'Admin', 'Admin', adminJti);
  addUser(trainerAId, 'trainer.a@example.com', 'Trainer A', 'Trainer', trainerAJti);
  addUser(trainerBId, 'trainer.b@example.com', 'Trainer B', 'Trainer', trainerBJti);
  addUser(studentId, 'trainer.student@example.com', 'Student', 'Student', 'trainer-student');

  tempDb
    .prepare(
      `INSERT INTO courses (id, name, description, is_published, course_status, enrollment_type, duration_days, created_at)
       VALUES (?, ?, '', 1, 'Active', 'free', 5, datetime('now'))`,
    )
    .run(courseAId, 'Course A');
  tempDb
    .prepare(
      `INSERT INTO courses (id, name, description, is_published, course_status, enrollment_type, duration_days, created_at)
       VALUES (?, ?, '', 1, 'Active', 'free', 5, datetime('now'))`,
    )
    .run(courseBId, 'Course B');

  tempDb
    .prepare(
      `INSERT INTO batches (id, name, title, session_type, trainer_id, created_by, course_id, batch_status, batch_number, duration_days, created_at)
       VALUES (?, 'Batch A', 'Batch A', 'group', ?, ?, ?, 'started', 101, 5, datetime('now'))`,
    )
    .run(batchAId, trainerAId, adminId, courseAId);
  tempDb.prepare('INSERT INTO batch_trainers (batch_id, trainer_id) VALUES (?, ?)').run(batchAId, trainerAId);
  tempDb.prepare('INSERT INTO batch_courses (batch_id, course_id, sort_order) VALUES (?, ?, 0)').run(batchAId, courseAId);
  tempDb.prepare('INSERT INTO batch_members (batch_id, student_id) VALUES (?, ?)').run(batchAId, studentId);

  tempDb
    .prepare(
      `INSERT INTO batches (id, name, title, session_type, trainer_id, created_by, course_id, batch_status, batch_number, duration_days, created_at)
       VALUES (?, 'Batch B', 'Batch B', 'group', ?, ?, ?, 'started', 102, 5, datetime('now'))`,
    )
    .run(batchBId, trainerBId, adminId, courseBId);
  tempDb.prepare('INSERT INTO batch_trainers (batch_id, trainer_id) VALUES (?, ?)').run(batchBId, trainerBId);
  tempDb.prepare('INSERT INTO batch_courses (batch_id, course_id, sort_order) VALUES (?, ?, 0)').run(batchBId, courseBId);

  tempDb.prepare(`INSERT INTO lesson_library (id, title, created_by) VALUES (?, 'Lesson A', ?)`).run(lessonAId, adminId);
  tempDb.prepare(`INSERT INTO course_lessons (course_id, lesson_id, day_number, sequence_in_day) VALUES (?, ?, 1, 1)`).run(courseAId, lessonAId);

  tempDb.prepare(`INSERT INTO video_library (id, title, video_url, created_by) VALUES (?, 'Own video', 'http://x/own', ?)`).run(videoOwnId, trainerAId);
  tempDb.prepare(`INSERT INTO video_library (id, title, video_url, created_by) VALUES (?, 'Scoped video', 'http://x/scoped', ?)`).run(videoScopedId, adminId);
  tempDb.prepare(`INSERT INTO video_library (id, title, video_url, created_by) VALUES (?, 'Other video', 'http://x/other', ?)`).run(videoOtherId, trainerBId);
  tempDb
    .prepare(`INSERT INTO lesson_library_items (lesson_id, sort_order, item_type, item_id) VALUES (?, 1, 'video', ?)`)
    .run(lessonAId, videoScopedId);

  const paymentRoutes = require('../routes/payments').router;
  const batchManagerRoutes = require('../routes/batchManager');
  const videoRoutes = require('../routes/videos');
  const libraryOwnershipRoutes = require('../routes/libraryOwnership');
  const { runBatchCompletionSweep } = require('../services/batchCompletion');
  const { academyToday, addDaysYmd } = require('../lib/academyDate');

  const app = express();
  app.use(express.json());
  app.use('/api/payments', paymentRoutes);
  app.use('/api/batch-manager', batchManagerRoutes);
  app.use('/api/videos', videoRoutes);
  app.use('/api/library/ownership', libraryOwnershipRoutes);

  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const adminToken = jwt.sign({ userId: adminId, jti: adminJti }, JWT_SECRET);
  const trainerAToken = jwt.sign({ userId: trainerAId, jti: trainerAJti }, JWT_SECRET);
  const trainerBToken = jwt.sign({ userId: trainerBId, jti: trainerBJti }, JWT_SECRET);

  async function jsonRequest(url, token, method = 'GET', body, expectedStatus) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (expectedStatus != null) {
      if (res.status !== expectedStatus) {
        throw new Error(`${method} ${url} expected ${expectedStatus} got ${res.status}: ${data.error || res.statusText}`);
      }
      return data;
    }
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${data.error || res.statusText}`);
    return data;
  }

  await jsonRequest(`${base}/api/payments/admin`, trainerAToken, 'GET', null, 403);
  await jsonRequest(`${base}/api/payments/admin/apply-enquiries`, trainerAToken, 'GET', null, 403);
  await jsonRequest(`${base}/api/batch-manager`, trainerAToken, 'POST', { title: 'Nope', batchType: 'group', batchNumber: 999 }, 403);
  await jsonRequest(`${base}/api/batch-manager/${batchAId}/members`, trainerAToken, 'POST', { studentId }, 403);

  const videos = await jsonRequest(`${base}/api/videos`, trainerAToken);
  const ids = new Set((Array.isArray(videos) ? videos : []).map((v) => Number(v.id)));
  if (!ids.has(videoOwnId) || !ids.has(videoScopedId) || ids.has(videoOtherId)) {
    throw new Error(`Trainer A library scope wrong: ${[...ids].join(',')}`);
  }

  await jsonRequest(`${base}/api/videos/${videoScopedId}`, trainerAToken, 'PUT', { title: 'Hijack' }, 403);
  await jsonRequest(`${base}/api/videos/${videoOwnId}`, trainerAToken, 'PUT', { title: 'Own video edited' });

  await jsonRequest(`${base}/api/library/ownership/transfer`, adminToken, 'POST', {
    itemType: 'video',
    itemId: videoOwnId,
    toUserId: trainerBId,
  });
  await jsonRequest(`${base}/api/videos/${videoOwnId}`, trainerAToken, 'PUT', { title: 'Still mine?' }, 403);
  await jsonRequest(`${base}/api/videos/${videoOwnId}`, trainerBToken, 'PUT', { title: 'Now B owns it' });

  const yesterday = addDaysYmd(academyToday(), -1);
  tempDb
    .prepare(
      `INSERT INTO batch_sessions (batch_id, session_day, lesson_title, session_date, status)
       VALUES (?, 1, 'Last day', ?, 'scheduled')`,
    )
    .run(batchAId, yesterday);
  const sweep = runBatchCompletionSweep(academyToday());
  if (!sweep.completed) throw new Error('Expected batch A to auto-complete');
  const after = tempDb.prepare('SELECT batch_status FROM batches WHERE id = ?').get(batchAId);
  if (after.batch_status !== 'completed') throw new Error('Batch A was not marked completed');

  const videosAfter = await jsonRequest(`${base}/api/videos`, trainerAToken);
  const idsAfter = new Set((Array.isArray(videosAfter) ? videosAfter : []).map((v) => Number(v.id)));
  if (idsAfter.has(videoScopedId)) {
    throw new Error('Trainer A still sees course A content after batch completion');
  }

  await jsonRequest(`${base}/api/batch-manager/${batchAId}/reopen`, adminToken, 'POST');
  const videosReopened = await jsonRequest(`${base}/api/videos`, trainerAToken);
  const idsReopened = new Set((Array.isArray(videosReopened) ? videosReopened : []).map((v) => Number(v.id)));
  if (!idsReopened.has(videoScopedId)) {
    throw new Error('Trainer A should see course A content after reopen');
  }

  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  tempDb.close();
  fs.unlinkSync(tempDbPath);
  console.log('verifyTrainerScope: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
