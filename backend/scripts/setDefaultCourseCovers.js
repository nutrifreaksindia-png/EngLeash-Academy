const db = require('../db');

const FALLBACK_COVERS = [
  'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1280&h=720&q=80',
  'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1280&h=720&q=80',
  'https://images.unsplash.com/photo-1457369804613-52c61a468e7d?auto=format&fit=crop&w=1280&h=720&q=80',
  'https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=1280&h=720&q=80',
  'https://images.unsplash.com/photo-1513258496099-48168024aec0?auto=format&fit=crop&w=1280&h=720&q=80',
];

const rows = db
  .prepare("SELECT id FROM courses WHERE image_url IS NULL OR TRIM(COALESCE(image_url, '')) = '' ORDER BY id")
  .all();

if (rows.length === 0) {
  console.log('No courses needed default covers.');
  process.exit(0);
}

const upd = db.prepare('UPDATE courses SET image_url = ? WHERE id = ?');
rows.forEach((r, idx) => {
  const url = FALLBACK_COVERS[idx % FALLBACK_COVERS.length];
  upd.run(url, r.id);
});

console.log(`Updated ${rows.length} course(s) with default cover photos.`);
