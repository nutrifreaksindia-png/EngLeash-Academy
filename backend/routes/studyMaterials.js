const express = require('express');
const multer = require('multer');
const db = require('../db');
const uploadMemory = require('../uploadMemory');
const { auth, requireRole } = require('../middleware/auth');
const { isSpacesConfigured, uploadToSpaces } = require('../services/spaces');
const {
  canMutateLibraryByCreatedBy,
  canViewStudyMaterial,
  stripCreatorFields,
  stripRows,
} = require('../lib/libraryScope');

const router = express.Router();

function sanitizeName(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function truthyDraft(val) {
  if (val === true || val === 1 || val === '1') return true;
  if (String(val).toLowerCase() === 'true') return true;
  return false;
}

function parseContentJson(raw) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('contentJson must be valid JSON');
    }
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.blocks)) {
    throw new Error('contentJson must contain blocks array');
  }
  const schemaVersion = Number(parsed.schema_version || 1);
  return {
    schema_version: Number.isFinite(schemaVersion) ? schemaVersion : 1,
    blocks: parsed.blocks,
  };
}

function uploadSingle(req, res, next) {
  uploadMemory.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File is too large (max 1GB).' });
      return res.status(400).json({ error: `Upload failed: ${err.message}` });
    }
    return res.status(400).json({ error: err.message || 'Upload failed' });
  });
}

router.get('/', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  let rows = db.prepare(`
    SELECT m.*, MAX(cu.name) AS creator_name,
      COUNT(DISTINCT a.id) AS assignment_count,
      COUNT(DISTINCT s.id) AS asset_count
    FROM study_material_library m
    LEFT JOIN users cu ON cu.id = m.created_by
    LEFT JOIN study_material_assignments a ON a.material_id = m.id
    LEFT JOIN study_material_assets s ON s.material_id = m.id
    GROUP BY m.id
    ORDER BY m.updated_at DESC, m.id DESC
  `).all();
  if (req.user.role === 'Creator') {
    rows = rows.filter((m) => Number(m.is_draft) !== 1 || Number(m.created_by) === Number(req.user.id));
  }
  res.json(stripRows(req.user, rows));
});

router.post('/', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  try {
    let title = String(req.body?.title || '').trim();
    let isDraft = truthyDraft(req.body?.isDraft ?? req.body?.is_draft);
    if (!title) {
      const explicitNonDraft =
        req.body?.isDraft === false ||
        req.body?.is_draft === false ||
        String(req.body?.isDraft || '').toLowerCase() === 'false' ||
        String(req.body?.is_draft || '').toLowerCase() === 'false';
      if (explicitNonDraft) {
        return res.status(400).json({ error: 'title is required' });
      }
      isDraft = true;
      title = 'Untitled draft';
    }
    const description = String(req.body?.description || '').trim();
    const content = parseContentJson(req.body?.contentJson || { schema_version: 1, blocks: [] });
    const draftFlag = isDraft ? 1 : 0;
    const r = db.prepare(`
      INSERT INTO study_material_library (title, description, content_json, created_by, is_draft)
      VALUES (?, ?, ?, ?, ?)
    `).run(title, description || null, JSON.stringify(content), req.user.id, draftFlag);
    const created = db.prepare('SELECT * FROM study_material_library WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json(stripCreatorFields(req.user, created));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid payload' });
  }
});

router.get('/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare(
    'SELECT m.*, cu.name AS creator_name FROM study_material_library m LEFT JOIN users cu ON cu.id = m.created_by WHERE m.id = ?'
  ).get(id);
  if (!row) return res.status(404).json({ error: 'Study material not found' });
  if (!canViewStudyMaterial(req.user, row)) {
    return res.status(404).json({ error: 'Study material not found' });
  }
  const assets = db.prepare('SELECT * FROM study_material_assets WHERE material_id = ? ORDER BY sort_order, id').all(id);
  const assignments = db.prepare('SELECT * FROM study_material_assignments WHERE material_id = ? ORDER BY created_at DESC').all(id);
  const base = stripCreatorFields(req.user, row);
  res.json({ ...base, assets, assignments });
});

router.put('/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM study_material_library WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Study material not found' });
  if (!canMutateLibraryByCreatedBy(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const isDraftReq = req.body?.isDraft !== undefined || req.body?.is_draft !== undefined;
    const nextIsDraft = isDraftReq ? (truthyDraft(req.body?.isDraft ?? req.body?.is_draft) ? 1 : 0) : null;

    let title = req.body?.title != null ? String(req.body.title).trim() : null;
    const draftEffective = nextIsDraft !== null ? nextIsDraft : Number(row.is_draft || 0);
    if (title === '' && draftEffective === 1) title = 'Untitled draft';
    else if (title === '') title = null;

    const description = req.body?.description != null ? String(req.body.description).trim() : null;
    let contentJson = null;
    if (req.body?.contentJson != null) {
      contentJson = JSON.stringify(parseContentJson(req.body.contentJson));
    }

    db.prepare(`
      UPDATE study_material_library SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        content_json = COALESCE(?, content_json),
        is_draft = COALESCE(?, is_draft),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(title, description, contentJson, nextIsDraft, id);
    const updated = db.prepare('SELECT * FROM study_material_library WHERE id = ?').get(id);
    res.json(stripCreatorFields(req.user, updated));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid payload' });
  }
});

router.delete('/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM study_material_library WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Study material not found' });
  if (!canMutateLibraryByCreatedBy(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM study_material_library WHERE id = ?').run(id);
  res.status(204).end();
});

router.post('/:id/assets', auth, requireRole('Admin', 'Trainer', 'Creator'), uploadSingle, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const material = db.prepare('SELECT * FROM study_material_library WHERE id = ?').get(id);
    if (!material) return res.status(404).json({ error: 'Study material not found' });
    if (!canMutateLibraryByCreatedBy(req.user, material)) return res.status(403).json({ error: 'Forbidden' });
    if (!req.file) return res.status(400).json({ error: 'file is required' });
    if (!isSpacesConfigured()) return res.status(503).json({ error: 'DigitalOcean Spaces is not configured' });

    const assetType = String(req.body?.assetType || '').trim();
    if (!['image', 'gif', 'pdf', 'audio'].includes(assetType)) {
      return res.status(400).json({ error: 'assetType must be image, gif, pdf, or audio' });
    }
    const ext = (req.file.originalname || '').split('.').pop() || 'bin';
    const base = sanitizeName(req.file.originalname?.replace(/\.[^.]+$/, '') || `${assetType}-asset`) || `${assetType}-asset`;
    const key = `pre-recorded/study-materials/material-${id}/${assetType}/${Date.now()}-${base}.${ext}`;
    const uploaded = await uploadToSpaces({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      key,
    });
    const sortOrder = Number(req.body?.sortOrder || 0);
    const metaJson = req.body?.metaJson ? JSON.stringify(req.body.metaJson) : null;
    const r = db.prepare(`
      INSERT INTO study_material_assets (material_id, asset_type, url, storage_key, meta_json, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, assetType, uploaded.publicUrl, uploaded.key, metaJson, Number.isFinite(sortOrder) ? sortOrder : 0);
    res.status(201).json(db.prepare('SELECT * FROM study_material_assets WHERE id = ?').get(r.lastInsertRowid));
  } catch (error) {
    res.status(500).json({ error: error.message || 'Asset upload failed' });
  }
});

router.delete('/:id/assets/:assetId', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const assetId = Number(req.params.assetId);
  const material = db.prepare('SELECT * FROM study_material_library WHERE id = ?').get(id);
  if (!material) return res.status(404).json({ error: 'Study material not found' });
  if (!canMutateLibraryByCreatedBy(req.user, material)) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM study_material_assets WHERE id = ? AND material_id = ?').run(assetId, id);
  res.status(204).end();
});

router.post('/:id/assignments', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const material = db.prepare('SELECT * FROM study_material_library WHERE id = ?').get(id);
  if (!material) return res.status(404).json({ error: 'Study material not found' });
  if (!canMutateLibraryByCreatedBy(req.user, material)) return res.status(403).json({ error: 'Forbidden' });
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
  const r = db.prepare(`
    INSERT INTO study_material_assignments (material_id, scope_type, scope_id, order_index, is_required, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, scopeType, scopeId, Number(req.body?.orderIndex || 0), req.body?.isRequired ? 1 : 0, req.user.id);
  res.status(201).json(db.prepare('SELECT * FROM study_material_assignments WHERE id = ?').get(r.lastInsertRowid));
});

router.get('/:id/assignments', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const material = db.prepare('SELECT * FROM study_material_library WHERE id = ?').get(id);
  if (!material) return res.status(404).json({ error: 'Study material not found' });
  if (!canViewStudyMaterial(req.user, material)) return res.status(404).json({ error: 'Study material not found' });
  const rows = db.prepare('SELECT * FROM study_material_assignments WHERE material_id = ? ORDER BY created_at DESC').all(id);
  res.json(rows);
});

router.delete('/assignments/:assignmentId', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const assignmentId = Number(req.params.assignmentId);
  const ass = db.prepare(`
    SELECT m.created_by
    FROM study_material_assignments a
    JOIN study_material_library m ON m.id = a.material_id
    WHERE a.id = ?
  `).get(assignmentId);
  if (!ass) return res.status(404).end();
  if (!canMutateLibraryByCreatedBy(req.user, { created_by: ass.created_by })) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM study_material_assignments WHERE id = ?').run(assignmentId);
  res.status(204).end();
});

module.exports = router;
