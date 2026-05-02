const express = require('express');
const db = require('../db');
const multer = require('multer');
const uploadMemory = require('../uploadMemory');
const { auth, requireRole } = require('../middleware/auth');
const { isSpacesConfigured, uploadToSpaces } = require('../services/spaces');
const { canMutateLibraryByCreatedBy, stripCreatorFields, stripRows } = require('../lib/libraryScope');

const router = express.Router();

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function uploadVideoSingle(req, res, next) {
  uploadMemory.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'Video file is too large (max 1GB).' });
      }
      return res.status(400).json({ error: `Upload failed: ${err.message}` });
    }
    return res.status(400).json({ error: err.message || 'Upload failed' });
  });
}

router.get('/', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const rows = db.prepare(`
    SELECT v.*, vc.name AS category_name, vc.slug AS category_slug,
      MAX(creator.name) AS creator_name,
      COUNT(a.id) AS assignment_count
    FROM video_library v
    LEFT JOIN users creator ON creator.id = v.created_by
    LEFT JOIN video_categories vc ON vc.id = v.category_id
    LEFT JOIN video_assignments a ON a.video_id = v.id
    GROUP BY v.id
    ORDER BY v.updated_at DESC, v.id DESC
  `).all();
  res.json(stripRows(req.user, rows));
});

router.get('/categories', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const rows = db.prepare('SELECT * FROM video_categories ORDER BY name').all();
  res.json(rows);
});

router.post('/categories', auth, requireRole('Admin'), (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const slug = slugify(name);
  if (!slug) return res.status(400).json({ error: 'invalid category name' });
  const r = db.prepare('INSERT INTO video_categories (name, slug) VALUES (?, ?)').run(name, slug);
  res.status(201).json(db.prepare('SELECT * FROM video_categories WHERE id = ?').get(r.lastInsertRowid));
});

router.delete('/categories/:id', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  const used = db.prepare('SELECT 1 FROM video_library WHERE category_id = ? LIMIT 1').get(id);
  if (used) return res.status(400).json({ error: 'Category is in use by videos' });
  db.prepare('DELETE FROM video_categories WHERE id = ?').run(id);
  res.status(204).end();
});

router.post('/', auth, requireRole('Admin', 'Trainer', 'Creator'), uploadVideoSingle, async (req, res) => {
  try {
    const title = String(req.body?.title || '').trim();
    const description = String(req.body?.description || '').trim();
    const categoryId = Number(req.body?.categoryId);
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!Number.isFinite(categoryId)) return res.status(400).json({ error: 'categoryId is required' });
    if (!req.file) return res.status(400).json({ error: 'video file is required' });
    if (!String(req.file.mimetype || '').startsWith('video/')) {
      return res.status(400).json({ error: 'Selected file is not a video.' });
    }
    if (!isSpacesConfigured()) return res.status(503).json({ error: 'DigitalOcean Spaces is not configured' });
    const category = db.prepare('SELECT id, slug FROM video_categories WHERE id = ?').get(categoryId);
    if (!category) return res.status(404).json({ error: 'Selected category not found' });

    const ext = (req.file.originalname || '').split('.').pop() || 'mp4';
    const seed = db.prepare('INSERT INTO video_library (title, description, video_url, category_id, created_by) VALUES (?, ?, ?, ?, ?)').run(
      title,
      description || null,
      '',
      category.id,
      req.user.id
    );
    const videoId = Number(seed.lastInsertRowid);
    const key = `pre-recorded/${category.slug}/video-library/video-${videoId}/${Date.now()}-${title.toLowerCase().replace(/[^a-z0-9.-]+/g, '-')}.${ext}`;
    const uploaded = await uploadToSpaces({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      key,
    });
    db.prepare('UPDATE video_library SET video_url = ?, storage_key = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(uploaded.publicUrl, uploaded.key, videoId);
    const row = db.prepare('SELECT * FROM video_library WHERE id = ?').get(videoId);
    res.status(201).json(stripCreatorFields(req.user, row));
  } catch (error) {
    console.error('Video upload failed:', error);
    res.status(500).json({ error: error.message || 'Video upload failed' });
  }
});

router.put('/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM video_library WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Video not found' });
  if (!canMutateLibraryByCreatedBy(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  const title = req.body?.title != null ? String(req.body.title).trim() : null;
  const description = req.body?.description != null ? String(req.body.description).trim() : null;
  const categoryId = req.body?.categoryId != null ? Number(req.body.categoryId) : null;
  if (categoryId != null && !Number.isFinite(categoryId)) return res.status(400).json({ error: 'invalid categoryId' });
  if (categoryId != null) {
    const c = db.prepare('SELECT id FROM video_categories WHERE id = ?').get(categoryId);
    if (!c) return res.status(404).json({ error: 'Selected category not found' });
  }
  db.prepare(
    'UPDATE video_library SET title = COALESCE(?, title), description = COALESCE(?, description), category_id = COALESCE(?, category_id), updated_at = datetime(\'now\') WHERE id = ?'
  ).run(title || null, description || null, categoryId, id);
  const updated = db.prepare('SELECT * FROM video_library WHERE id = ?').get(id);
  res.json(stripCreatorFields(req.user, updated));
});

router.delete('/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM video_library WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Video not found' });
  if (!canMutateLibraryByCreatedBy(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM video_library WHERE id = ?').run(id);
  res.status(204).end();
});

router.post('/:id/assignments', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const videoId = Number(req.params.id);
  const video = db.prepare('SELECT * FROM video_library WHERE id = ?').get(videoId);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  if (!canMutateLibraryByCreatedBy(req.user, video)) return res.status(403).json({ error: 'Forbidden' });
  const scopeType = String(req.body?.scopeType || '');
  const scopeId = Number(req.body?.scopeId);
  if (!['course', 'lesson'].includes(scopeType)) return res.status(400).json({ error: 'scopeType must be course or lesson' });
  if (!Number.isFinite(scopeId)) return res.status(400).json({ error: 'scopeId is required' });

  if (scopeType === 'course') {
    const c = db.prepare('SELECT id FROM courses WHERE id = ?').get(scopeId);
    if (!c) return res.status(404).json({ error: 'Course not found' });
  } else {
    const l = db.prepare('SELECT id FROM lesson_library WHERE id = ?').get(scopeId)
      || db.prepare('SELECT id FROM lessons WHERE id = ?').get(scopeId);
    if (!l) return res.status(404).json({ error: 'Lesson not found' });
  }

  const result = db.prepare(
    `INSERT INTO video_assignments (video_id, scope_type, scope_id, order_index, is_required, created_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(videoId, scopeType, scopeId, Number(req.body?.orderIndex || 0), req.body?.isRequired ? 1 : 0, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM video_assignments WHERE id = ?').get(result.lastInsertRowid));
});

router.get('/:id/assignments', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const videoId = Number(req.params.id);
  const video = db.prepare('SELECT * FROM video_library WHERE id = ?').get(videoId);
  if (!video) return res.status(404).json({ error: 'Video not found' });
  const rows = db.prepare('SELECT * FROM video_assignments WHERE video_id = ? ORDER BY created_at DESC').all(videoId);
  res.json(rows);
});

router.delete('/assignments/:assignmentId', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const row = db.prepare(`
    SELECT v.created_by
    FROM video_assignments a
    JOIN video_library v ON v.id = a.video_id
    WHERE a.id = ?
  `).get(assignmentId);
  if (!row) return res.status(404).end();
  if (!canMutateLibraryByCreatedBy(req.user, { created_by: row.created_by })) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM video_assignments WHERE id = ?').run(assignmentId);
  res.status(204).end();
});

module.exports = router;
