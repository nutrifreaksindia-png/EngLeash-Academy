const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const {
  canMutateLibraryByCreatedBy,
  canViewAssignment,
  stripCreatorFields,
  stripRows,
} = require('../lib/libraryScope');

const router = express.Router();

function truthyDraft(val) {
  if (val === true || val === 1 || val === '1') return true;
  if (String(val).toLowerCase() === 'true') return true;
  return false;
}

function normalizeContentHtml(val) {
  if (val == null) return '';
  return String(val);
}

router.get('/', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  let rows = db.prepare(`
    SELECT m.id, m.title, m.description, m.is_draft, m.created_by, m.created_at, m.updated_at,
      MAX(cu.name) AS creator_name
    FROM assignment_library m
    LEFT JOIN users cu ON cu.id = m.created_by
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
    const contentHtml = normalizeContentHtml(req.body?.contentHtml);
    const draftFlag = isDraft ? 1 : 0;
    const r = db
      .prepare(
        `INSERT INTO assignment_library (title, description, content_html, created_by, is_draft)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(title, description || null, contentHtml, req.user.id, draftFlag);
    const created = db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(r.lastInsertRowid);
    res.status(201).json(stripCreatorFields(req.user, created));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid payload' });
  }
});

router.get('/:id', auth, (req, res) => {
  const id = Number(req.params.id);
  const row = db
    .prepare('SELECT m.*, cu.name AS creator_name FROM assignment_library m LEFT JOIN users cu ON cu.id = m.created_by WHERE m.id = ?')
    .get(id);
  if (!row) return res.status(404).json({ error: 'Assignment not found' });
  if (!canViewAssignment(req.user, row)) {
    return res.status(404).json({ error: 'Assignment not found' });
  }
  res.json(stripCreatorFields(req.user, row));
});

router.put('/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Assignment not found' });
  if (!canMutateLibraryByCreatedBy(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  try {
    const isDraftReq = req.body?.isDraft !== undefined || req.body?.is_draft !== undefined;
    const nextIsDraft = isDraftReq ? (truthyDraft(req.body?.isDraft ?? req.body?.is_draft) ? 1 : 0) : null;

    let title = req.body?.title != null ? String(req.body.title).trim() : null;
    const draftEffective = nextIsDraft !== null ? nextIsDraft : Number(row.is_draft || 0);
    if (title === '' && draftEffective === 1) title = 'Untitled draft';
    else if (title === '') title = null;

    const description = req.body?.description != null ? String(req.body.description).trim() : null;
    let contentHtml = null;
    if (req.body?.contentHtml != null) {
      contentHtml = normalizeContentHtml(req.body.contentHtml);
    }

    db.prepare(
      `UPDATE assignment_library SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        content_html = COALESCE(?, content_html),
        is_draft = COALESCE(?, is_draft),
        updated_at = datetime('now')
      WHERE id = ?`,
    ).run(title, description, contentHtml, nextIsDraft, id);
    const updated = db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(id);
    res.json(stripCreatorFields(req.user, updated));
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid payload' });
  }
});

router.delete('/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM assignment_library WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Assignment not found' });
  if (!canMutateLibraryByCreatedBy(req.user, row)) return res.status(403).json({ error: 'Forbidden' });
  db.prepare('DELETE FROM assignment_library WHERE id = ?').run(id);
  res.status(204).end();
});

module.exports = router;
