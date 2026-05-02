const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { uploadLessonVideoToSpaces, isSpacesConfigured } = require('../services/spaces');

async function main() {
  if (!isSpacesConfigured()) {
    console.error('Spaces is not configured. Set SPACES_ENDPOINT, SPACES_BUCKET, SPACES_KEY, SPACES_SECRET.');
    process.exit(1);
  }

  const keepLocal = process.argv.includes('--keep-local');
  const dbPath = path.join(__dirname, '..', 'data', 'academy.db');
  const uploadsDir = path.join(__dirname, '..', 'uploads');
  const db = new Database(dbPath);

  const lessons = db
    .prepare(
      "SELECT id, course_id, title, video_url FROM lessons WHERE video_url LIKE '/uploads/%' ORDER BY id"
    )
    .all();

  console.log(`Found ${lessons.length} lesson video(s) using local /uploads paths.`);
  let migrated = 0;
  let skipped = 0;

  for (const lesson of lessons) {
    const rel = lesson.video_url.replace(/^\/+/, '');
    const localPath = path.join(__dirname, '..', rel);
    if (!fs.existsSync(localPath)) {
      console.log(`Skip lesson ${lesson.id}: local file missing (${localPath})`);
      skipped += 1;
      continue;
    }

    const buffer = fs.readFileSync(localPath);
    const uploaded = await uploadLessonVideoToSpaces({
      buffer,
      mimeType: undefined,
      originalName: path.basename(localPath),
      courseId: lesson.course_id,
      lessonId: lesson.id,
    });

    db.prepare('UPDATE lessons SET video_url = ? WHERE id = ?').run(uploaded.publicUrl, lesson.id);
    if (!keepLocal) fs.unlinkSync(localPath);

    migrated += 1;
    console.log(`Migrated lesson ${lesson.id} (${lesson.title}) -> ${uploaded.publicUrl}`);
  }

  db.close();
  console.log(`Done. Migrated=${migrated}, Skipped=${skipped}, keepLocal=${keepLocal}`);
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
