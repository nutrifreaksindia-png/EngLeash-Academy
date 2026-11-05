const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

const ITEM_TABLES = {
  video: 'video_library',
  study_material: 'study_material_library',
  worksheet: 'worksheet_library',
  quiz: 'quiz_bank',
  assignment: 'assignment_library',
  lesson: 'lesson_library',
};

function itemTable(itemType) {
  return ITEM_TABLES[String(itemType || '')];
}

function staffUser(userId) {
  return db
    .prepare("SELECT id, role, name, email FROM users WHERE id = ? AND role IN ('Admin', 'Trainer')")
    .get(Number(userId));
}

function transferOne(itemType, itemId, toUser, transferredBy) {
  const table = itemTable(itemType);
  if (!table) {
    const e = new Error('Unknown itemType');
    e.statusCode = 400;
    throw e;
  }
  const row = db.prepare(`SELECT id, created_by FROM ${table} WHERE id = ?`).get(Number(itemId));
  if (!row) {
    const e = new Error('Item not found');
    e.statusCode = 404;
    throw e;
  }
  const fromUserId = row.created_by != null ? Number(row.created_by) : null;
  db.prepare(`UPDATE ${table} SET created_by = ? WHERE id = ?`).run(toUser.id, row.id);
  try {
    db.prepare(`UPDATE ${table} SET updated_at = datetime('now') WHERE id = ?`).run(row.id);
  } catch (_) {
    /* some library tables have no updated_at */
  }
  db.prepare(
    `INSERT INTO library_ownership_transfers (item_type, item_id, from_user_id, to_user_id, transferred_by)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(itemType, row.id, fromUserId, toUser.id, transferredBy);
  return { itemType, itemId: row.id, fromUserId, toUserId: toUser.id };
}

router.post('/transfer', auth, requireRole('Admin'), (req, res) => {
  const itemType = String(req.body?.itemType || '').trim();
  const itemId = Number(req.body?.itemId);
  const toUserId = Number(req.body?.toUserId);
  if (!itemTable(itemType)) return res.status(400).json({ error: 'Unknown itemType' });
  if (!Number.isFinite(itemId)) return res.status(400).json({ error: 'itemId is required' });
  const toUser = staffUser(toUserId);
  if (!toUser) return res.status(404).json({ error: 'Target must be a Trainer or Admin' });
  try {
    const result = transferOne(itemType, itemId, toUser, req.user.id);
    res.json(result);
  } catch (e) {
    res.status(e.statusCode || 500).json({ error: e.message || 'Transfer failed' });
  }
});

router.post('/transfer-all', auth, requireRole('Admin'), (req, res) => {
  const fromUserId = Number(req.body?.fromUserId);
  const toUserId = Number(req.body?.toUserId);
  if (!Number.isFinite(fromUserId)) return res.status(400).json({ error: 'fromUserId is required' });
  const toUser = staffUser(toUserId);
  if (!toUser) return res.status(404).json({ error: 'Target must be a Trainer or Admin' });
  const fromUser = db.prepare('SELECT id FROM users WHERE id = ?').get(fromUserId);
  if (!fromUser) return res.status(404).json({ error: 'Source user not found' });
  if (fromUserId === toUser.id) return res.status(400).json({ error: 'fromUserId and toUserId must differ' });

  const requested = Array.isArray(req.body?.itemTypes) ? req.body.itemTypes : Object.keys(ITEM_TABLES);
  const types = requested.filter((t) => itemTable(t));
  if (!types.length) return res.status(400).json({ error: 'No valid itemTypes' });

  const transferred = [];
  const tx = db.transaction(() => {
    types.forEach((itemType) => {
      const table = itemTable(itemType);
      const rows = db.prepare(`SELECT id FROM ${table} WHERE created_by = ?`).all(fromUserId);
      rows.forEach((row) => {
        transferred.push(transferOne(itemType, row.id, toUser, req.user.id));
      });
    });
  });
  tx();
  res.json({ count: transferred.length, transferred });
});

router.get('/log', auth, requireRole('Admin'), (req, res) => {
  const itemType = String(req.query.itemType || '').trim();
  const itemId = Number(req.query.itemId);
  const fromUserId = Number(req.query.fromUserId);
  const clauses = [];
  const params = [];
  if (itemTable(itemType)) {
    clauses.push('t.item_type = ?');
    params.push(itemType);
  }
  if (Number.isFinite(itemId)) {
    clauses.push('t.item_id = ?');
    params.push(itemId);
  }
  if (Number.isFinite(fromUserId)) {
    clauses.push('t.from_user_id = ?');
    params.push(fromUserId);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT t.*, fu.name AS from_name, tu.name AS to_name, bu.name AS transferred_by_name
       FROM library_ownership_transfers t
       LEFT JOIN users fu ON fu.id = t.from_user_id
       LEFT JOIN users tu ON tu.id = t.to_user_id
       LEFT JOIN users bu ON bu.id = t.transferred_by
       ${where}
       ORDER BY t.id DESC
       LIMIT 200`,
    )
    .all(...params);
  res.json(rows);
});

module.exports = router;
module.exports.ITEM_TABLES = ITEM_TABLES;
