const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'academy.db');
const db = new Database(dbPath);

function cleanDay(dayNumber) {
  const titlePrefix = `Day ${String(dayNumber).padStart(2, '0')}`;
  const lessons = db.prepare(
    'SELECT id, title, video_url FROM lessons WHERE title LIKE ? ORDER BY id'
  ).all(`${titlePrefix}%`);

  if (lessons.length <= 1) {
    console.log(`No duplicates for ${titlePrefix}`);
    return;
  }

  // Prefer a lesson that does NOT use sample/public URLs; otherwise keep the first.
  const keep = lessons.find(
    l => l.video_url && !l.video_url.includes('gtv-videos-bucket') && !l.video_url.includes('sample-video')
  ) || lessons[0];

  console.log(`Keeping ${titlePrefix}: id=${keep.id}, video_url=${keep.video_url}`);

  const toDelete = lessons.filter(l => l.id !== keep.id);
  toDelete.forEach(l => {
    console.log(`Deleting duplicate lesson id=${l.id}, title=${l.title}, video_url=${l.video_url}`);

    // Clean up related data
    const quizIds = db
      .prepare('SELECT id FROM quizzes WHERE lesson_id = ?')
      .all(l.id)
      .map(q => q.id);

    if (quizIds.length > 0) {
      db.prepare(
        `DELETE FROM quiz_questions WHERE quiz_id IN (${quizIds.map(() => '?').join(',')})`
      ).run(...quizIds);
    }

    db.prepare('DELETE FROM quizzes WHERE lesson_id = ?').run(l.id);
    db.prepare('DELETE FROM class_notes WHERE lesson_id = ?').run(l.id);
    db.prepare('DELETE FROM worksheets WHERE lesson_id = ?').run(l.id);
    db.prepare('DELETE FROM lessons WHERE id = ?').run(l.id);
  });
}

[1, 2, 3].forEach(cleanDay);

db.close();
console.log('Cleanup complete.');
