const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, '..', 'data', 'academy.db');
const db = new Database(dbPath);

function setDay(dayNumber, relPath) {
  const title = `Day ${String(dayNumber).padStart(2, '0')}`;
  const lesson = db.prepare('SELECT id, title, video_url FROM lessons WHERE title = ?').get(title);
  if (!lesson) {
    console.log('No lesson found for ' + title);
    return;
  }
  db.prepare('UPDATE lessons SET video_url = ? WHERE id = ?').run(relPath, lesson.id);
  console.log('Updated ' + title + ' (id=' + lesson.id + ') to ' + relPath);
}

setDay(1, '/uploads/day-01/index.m3u8');
setDay(2, '/uploads/day-02/index.m3u8');
setDay(3, '/uploads/day-03/index.m3u8');

db.close();
console.log('Done setting HLS URLs for Day 01, 02 and 03.');
