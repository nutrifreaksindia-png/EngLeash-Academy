const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'academy.db');
if (!fs.existsSync(path.dirname(dbPath))) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}

const db = new Database(dbPath);

const hash = (p) => bcrypt.hashSync(p, 10);

// Users: Admin, Trainer, Student, Lab (all password: password123)
const users = [
  { email: 'admin@engleash.com', password_hash: hash('password123'), name: 'Admin User', role: 'Admin' },
  { email: 'trainer@engleash.com', password_hash: hash('password123'), name: 'Trainer One', role: 'Trainer' },
  { email: 'student@engleash.com', password_hash: hash('password123'), name: 'Student One', role: 'Student' },
  { email: 'lab@engleash.com', password_hash: hash('password123'), name: 'Lab Device', role: 'Lab' },
];

const insertUser = db.prepare(
  'INSERT OR IGNORE INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)'
);
users.forEach(u => insertUser.run(u.email, u.password_hash, u.name, u.role));

// Sample course (skip if already exists)
let courseId = db.prepare('SELECT id FROM courses LIMIT 1').get()?.id;
if (!courseId) {
  const insertCourse = db.prepare(
    'INSERT INTO courses (name, description, sort_order) VALUES (?, ?, ?)'
  );
  insertCourse.run('English Basics - Level 1', 'Introduction to English grammar and vocabulary.', 0);
  courseId = db.prepare('SELECT last_insert_rowid()').get()['last_insert_rowid()'];
}

// Lessons Day 01, Day 02, Day 03 (use public sample URLs so playback works without local files)
const sampleVideoUrls = [
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
  'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4',
];
const existingLessons = db.prepare('SELECT id FROM lessons WHERE course_id = ?').all(courseId);
const insertLesson = db.prepare(
  'INSERT INTO lessons (course_id, title, sort_order, video_url) VALUES (?, ?, ?, ?)'
);
if (existingLessons.length === 0) {
  for (let i = 1; i <= 3; i++) {
    const title = `Day ${String(i).padStart(2, '0')}`;
    insertLesson.run(courseId, title, i, sampleVideoUrls[i - 1]);
  }
}

// Fix existing lessons that still have placeholder /uploads/sample-video paths
const placeholderLessons = db.prepare("SELECT id FROM lessons WHERE video_url LIKE '/uploads/sample-video%' ORDER BY id").all();
placeholderLessons.forEach((row, i) => {
  db.prepare('UPDATE lessons SET video_url = ? WHERE id = ?').run(sampleVideoUrls[i % sampleVideoUrls.length], row.id);
});

// Enroll trainer and student in course
const trainerId = db.prepare('SELECT id FROM users WHERE role = ?').get('Trainer').id;
const studentId = db.prepare('SELECT id FROM users WHERE role = ?').get('Student').id;
const labId = db.prepare('SELECT id FROM users WHERE role = ?').get('Lab').id;
const insertEnroll = db.prepare('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)');
insertEnroll.run(trainerId, courseId);
insertEnroll.run(studentId, courseId);
insertEnroll.run(labId, courseId);

// Default batches for live classes
const insertBatch = db.prepare(
  'INSERT INTO batches (name, session_type, trainer_id, created_by) VALUES (?, ?, ?, ?)'
);
let groupBatchId = db.prepare("SELECT id FROM batches WHERE name = 'Morning Spoken English - Batch A'").get()?.id;
if (!groupBatchId) {
  insertBatch.run('Morning Spoken English - Batch A', 'group', trainerId, trainerId);
  groupBatchId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
}
let oneToOneBatchId = db.prepare("SELECT id FROM batches WHERE name = '1:1 Coaching - Student One'").get()?.id;
if (!oneToOneBatchId) {
  insertBatch.run('1:1 Coaching - Student One', 'one_to_one', trainerId, trainerId);
  oneToOneBatchId = db.prepare('SELECT last_insert_rowid() AS id').get().id;
}
db.prepare('INSERT OR IGNORE INTO batch_members (batch_id, student_id) VALUES (?, ?)').run(groupBatchId, studentId);
db.prepare('INSERT OR IGNORE INTO batch_members (batch_id, student_id) VALUES (?, ?)').run(oneToOneBatchId, studentId);

// Seed a couple of upcoming sessions.
const now = Date.now();
const plusMinutes = (mins) => new Date(now + mins * 60 * 1000).toISOString();
const sessionRows = [
  {
    batchId: groupBatchId,
    title: 'Group Speaking Practice',
    startsAt: plusMinutes(10),
    endsAt: plusMinutes(70),
  },
  {
    batchId: oneToOneBatchId,
    title: '1:1 Pronunciation Coaching',
    startsAt: plusMinutes(120),
    endsAt: plusMinutes(165),
  },
];
const insertLiveSession = db.prepare(`
  INSERT INTO live_sessions (batch_id, title, agora_channel, starts_at, ends_at, status, created_by)
  VALUES (?, ?, ?, ?, ?, 'scheduled', ?)
`);
sessionRows.forEach((s) => {
  const exists = db.prepare(
    "SELECT 1 FROM live_sessions WHERE batch_id = ? AND title = ? AND status IN ('scheduled', 'live')"
  ).get(s.batchId, s.title);
  if (!exists) {
    const channel = `live_seed_${s.batchId}_${Math.random().toString(36).slice(2, 8)}`;
    insertLiveSession.run(s.batchId, s.title, channel, s.startsAt, s.endsAt, trainerId);
  }
});

// Demo live sessions — recreated each seed so times stay "now" (easy to see in the app).
// Admin sees all sessions; Trainer/Student see sessions for their batches (seeded above).
db.prepare("DELETE FROM live_sessions WHERE title LIKE 'TEST:%'").run();
const insertTestSession = db.prepare(`
  INSERT INTO live_sessions (batch_id, title, agora_channel, starts_at, ends_at, status, created_by)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const mkChannel = () => `live_test_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
const testSessions = [
  {
    batchId: groupBatchId,
    title: 'TEST: Group class (starts in ~10 min)',
    startMin: 10,
    endMin: 80,
    status: 'scheduled',
  },
  {
    batchId: groupBatchId,
    title: 'TEST: Group class (ongoing — join now)',
    startMin: -20,
    endMin: 40,
    status: 'live',
  },
  {
    batchId: oneToOneBatchId,
    title: 'TEST: 1:1 session (starts in ~2 hours)',
    startMin: 120,
    endMin: 180,
    status: 'scheduled',
  },
  {
    batchId: groupBatchId,
    title: 'TEST: Group class (tomorrow)',
    startMin: 24 * 60,
    endMin: 25 * 60,
    status: 'scheduled',
  },
];
testSessions.forEach((s) => {
  insertTestSession.run(
    s.batchId,
    s.title,
    mkChannel(),
    plusMinutes(s.startMin),
    plusMinutes(s.endMin),
    s.status,
    trainerId
  );
});

// Class notes and worksheets (placeholder paths - real files can be uploaded via API)
const lessonIds = db.prepare('SELECT id FROM lessons WHERE course_id = ? ORDER BY sort_order').all(courseId);
const insertNote = db.prepare('INSERT INTO class_notes (lesson_id, title, file_path) VALUES (?, ?, ?)');
const insertWorksheet = db.prepare('INSERT INTO worksheets (lesson_id, title, file_path) VALUES (?, ?, ?)');
lessonIds.forEach((row, i) => {
  insertNote.run(row.id, `Notes Day ${String(i + 1).padStart(2, '0')}`, `/uploads/notes-lesson-${row.id}.pdf`);
  insertWorksheet.run(row.id, `Worksheet Day ${String(i + 1).padStart(2, '0')}`, `/uploads/worksheet-lesson-${row.id}.pdf`);
});

// Quiz for first lesson
const insertQuiz = db.prepare('INSERT INTO quizzes (lesson_id, title) VALUES (?, ?)');
insertQuiz.run(lessonIds[0].id, 'Day 01 Quiz');
const quizId = db.prepare('SELECT last_insert_rowid()').get()['last_insert_rowid()'];
const insertQ = db.prepare(
  'INSERT INTO quiz_questions (quiz_id, question_text, options, correct_index, sort_order) VALUES (?, ?, ?, ?, ?)'
);
insertQ.run(quizId, 'What is the correct greeting?', JSON.stringify(['Hello', 'Bye', 'Nothing', 'Maybe']), 0, 0);
insertQ.run(quizId, 'Choose the article for "apple".', JSON.stringify(['a', 'an', 'the', 'none']), 1, 1);

console.log('Seed data inserted. Users + sample lessons + batches + live sessions are ready.');
db.close();
