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

// Lessons Day 01, Day 02, Day 03
const insertLesson = db.prepare(
  'INSERT INTO lessons (course_id, title, sort_order, video_url) VALUES (?, ?, ?, ?)'
);
for (let i = 1; i <= 3; i++) {
  const title = `Day ${String(i).padStart(2, '0')}`;
  insertLesson.run(courseId, title, i, `/uploads/sample-video-${i}.mp4`);
}

// Enroll trainer and student in course
const trainerId = db.prepare('SELECT id FROM users WHERE role = ?').get('Trainer').id;
const studentId = db.prepare('SELECT id FROM users WHERE role = ?').get('Student').id;
const labId = db.prepare('SELECT id FROM users WHERE role = ?').get('Lab').id;
const insertEnroll = db.prepare('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)');
insertEnroll.run(trainerId, courseId);
insertEnroll.run(studentId, courseId);
insertEnroll.run(labId, courseId);

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

console.log('Seed data inserted. Users: admin@engleash.com, trainer@engleash.com, student@engleash.com, lab@engleash.com (password: password123)');
db.close();
