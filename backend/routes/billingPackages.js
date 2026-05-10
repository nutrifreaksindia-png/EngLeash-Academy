const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

function rowToPkg(r) {
  if (!r) return null;
  return { ...r, is_active: !!r.is_active };
}

router.get('/combos', auth, requireRole('Admin'), (req, res) => {
  const combos = db.prepare('SELECT * FROM course_combos ORDER BY id DESC').all();
  const membersStmt = db.prepare('SELECT course_id FROM course_combo_members WHERE combo_id = ? ORDER BY id');
  res.json(
    combos.map((c) => ({
      ...c,
      is_active: !!c.is_active,
      courseIds: membersStmt.all(c.id).map((m) => m.course_id),
    }))
  );
});

router.post('/combos', auth, requireRole('Admin'), (req, res) => {
  const { name, description, isActive, courseIds } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  const tx = db.transaction(() => {
    const r = db
      .prepare('INSERT INTO course_combos (name, description, is_active) VALUES (?, ?, ?)')
      .run(name.trim(), description || null, isActive === false ? 0 : 1);
    const id = r.lastInsertRowid;
    const ins = db.prepare('INSERT OR IGNORE INTO course_combo_members (combo_id, course_id) VALUES (?, ?)');
    (Array.isArray(courseIds) ? courseIds : []).forEach((cid) => {
      const n = Number(cid);
      if (Number.isFinite(n)) ins.run(id, n);
    });
    return id;
  });
  const id = tx();
  const row = db.prepare('SELECT * FROM course_combos WHERE id = ?').get(id);
  res.status(201).json(row);
});

router.put('/combos/:id', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  const { name, description, isActive, courseIds } = req.body || {};
  const existing = db.prepare('SELECT * FROM course_combos WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Combo not found' });
  db.prepare('UPDATE course_combos SET name = COALESCE(?, name), description = COALESCE(?, description), is_active = COALESCE(?, is_active) WHERE id = ?').run(
    name != null ? String(name).trim() : null,
    description !== undefined ? description : null,
    isActive === undefined ? null : isActive ? 1 : 0,
    id
  );
  if (Array.isArray(courseIds)) {
    db.prepare('DELETE FROM course_combo_members WHERE combo_id = ?').run(id);
    const ins = db.prepare('INSERT OR IGNORE INTO course_combo_members (combo_id, course_id) VALUES (?, ?)');
    courseIds.forEach((cid) => {
      const n = Number(cid);
      if (Number.isFinite(n)) ins.run(id, n);
    });
  }
  res.json(db.prepare('SELECT * FROM course_combos WHERE id = ?').get(id));
});

router.delete('/combos/:id', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid combo id' });
  const row = db.prepare('SELECT id FROM course_combos WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Combo not found' });
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM razorpay_billing_orders WHERE combo_id = ?').run(id);
    db.prepare('DELETE FROM course_access_grants WHERE combo_id = ?').run(id);
    db.prepare("DELETE FROM billing_packages WHERE scope = 'combo' AND combo_id = ?").run(id);
    db.prepare('DELETE FROM course_combo_members WHERE combo_id = ?').run(id);
    db.prepare('DELETE FROM course_combos WHERE id = ?').run(id);
  });
  tx();
  res.status(204).end();
});

router.get('/admin/course/:courseId/packages', auth, requireRole('Admin'), (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course id' });
  const rows = db
    .prepare(
      `SELECT * FROM billing_packages WHERE scope = 'course' AND course_id = ?
       ORDER BY package_kind ASC, sort_order ASC, id ASC`,
    )
    .all(courseId);
  res.json(rows.map(rowToPkg));
});

router.post('/admin/course/:courseId/packages', auth, requireRole('Admin'), (req, res) => {
  const courseId = Number(req.params.courseId);
  const c = db.prepare('SELECT id FROM courses WHERE id = ?').get(courseId);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  const { packageKind, durationUnit, durationCount, feeInr, discountInr, sortOrder, isActive } = req.body || {};
  const kind = String(packageKind || '').toLowerCase();
  if (kind !== 'subscription' && kind !== 'renewal') return res.status(400).json({ error: 'packageKind must be subscription or renewal' });
  const unit = String(durationUnit || '').toLowerCase();
  if (!['day', 'month', 'year'].includes(unit)) return res.status(400).json({ error: 'durationUnit must be day, month, or year' });
  const count = Number(durationCount);
  if (!Number.isFinite(count) || count < 1) return res.status(400).json({ error: 'durationCount must be >= 1' });
  db.prepare(
    `INSERT INTO billing_packages (scope, course_id, combo_id, package_kind, duration_unit, duration_count, fee_inr, discount_inr, is_active, sort_order)
     VALUES ('course', ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    courseId,
    kind,
    unit,
    count,
    feeInr ?? 0,
    discountInr ?? 0,
    isActive === false ? 0 : 1,
    sortOrder ?? 0,
  );
  const row = db.prepare('SELECT * FROM billing_packages WHERE id = last_insert_rowid()').get();
  res.status(201).json(rowToPkg(row));
});

router.put('/admin/packages/:id', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM billing_packages WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Package not found' });
  const { durationUnit, durationCount, feeInr, discountInr, sortOrder, isActive, packageKind } = req.body || {};
  const kind = packageKind != null ? String(packageKind).toLowerCase() : null;
  if (kind != null && kind !== 'subscription' && kind !== 'renewal') {
    return res.status(400).json({ error: 'packageKind must be subscription or renewal' });
  }
  const unit = durationUnit != null ? String(durationUnit).toLowerCase() : null;
  if (unit != null && !['day', 'month', 'year'].includes(unit)) {
    return res.status(400).json({ error: 'Invalid durationUnit' });
  }
  db.prepare(
    `UPDATE billing_packages SET
      package_kind = COALESCE(?, package_kind),
      duration_unit = COALESCE(?, duration_unit),
      duration_count = COALESCE(?, duration_count),
      fee_inr = COALESCE(?, fee_inr),
      discount_inr = COALESCE(?, discount_inr),
      sort_order = COALESCE(?, sort_order),
      is_active = COALESCE(?, is_active)
    WHERE id = ?`,
  ).run(
    kind,
    unit,
    durationCount != null ? Number(durationCount) : null,
    feeInr,
    discountInr,
    sortOrder,
    isActive === undefined ? null : isActive ? 1 : 0,
    id,
  );
  res.json(rowToPkg(db.prepare('SELECT * FROM billing_packages WHERE id = ?').get(id)));
});

router.delete('/admin/packages/:id', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('DELETE FROM billing_packages WHERE id = ?').run(id);
  if (r.changes === 0) return res.status(404).json({ error: 'Package not found' });
  res.status(204).end();
});

router.get('/admin/combo/:comboId/packages', auth, requireRole('Admin'), (req, res) => {
  const comboId = Number(req.params.comboId);
  const rows = db
    .prepare(
      `SELECT * FROM billing_packages WHERE scope = 'combo' AND combo_id = ?
       ORDER BY package_kind ASC, sort_order ASC, id ASC`,
    )
    .all(comboId);
  res.json(rows.map(rowToPkg));
});

router.post('/admin/combo/:comboId/packages', auth, requireRole('Admin'), (req, res) => {
  const comboId = Number(req.params.comboId);
  const c = db.prepare('SELECT id FROM course_combos WHERE id = ?').get(comboId);
  if (!c) return res.status(404).json({ error: 'Combo not found' });
  const { packageKind, durationUnit, durationCount, feeInr, discountInr, sortOrder, isActive } = req.body || {};
  const kind = String(packageKind || '').toLowerCase();
  if (kind !== 'subscription' && kind !== 'renewal') return res.status(400).json({ error: 'packageKind must be subscription or renewal' });
  const unit = String(durationUnit || '').toLowerCase();
  if (!['day', 'month', 'year'].includes(unit)) return res.status(400).json({ error: 'durationUnit must be day, month, or year' });
  const count = Number(durationCount);
  if (!Number.isFinite(count) || count < 1) return res.status(400).json({ error: 'durationCount must be >= 1' });
  db.prepare(
    `INSERT INTO billing_packages (scope, course_id, combo_id, package_kind, duration_unit, duration_count, fee_inr, discount_inr, is_active, sort_order)
     VALUES ('combo', NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    comboId,
    kind,
    unit,
    count,
    feeInr ?? 0,
    discountInr ?? 0,
    isActive === false ? 0 : 1,
    sortOrder ?? 0,
  );
  const row = db.prepare('SELECT * FROM billing_packages WHERE id = last_insert_rowid()').get();
  res.status(201).json(rowToPkg(row));
});

/** Public packages for Subscribe / Renew UX (auth optional for listing; eligibility checked at payment). */
router.get('/public/course/:courseId', (req, res) => {
  const courseId = Number(req.params.courseId);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'Invalid course id' });
  const course = db.prepare('SELECT id, enrollment_type FROM courses WHERE id = ? AND is_published = 1').get(courseId);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  const ent = String(course.enrollment_type || '').toLowerCase();
  if (ent !== 'subscribe') return res.status(400).json({ error: 'Course does not support subscription packages' });

  const subs = db
    .prepare(
      `SELECT id, scope, package_kind, duration_unit, duration_count, fee_inr, discount_inr, sort_order
       FROM billing_packages WHERE scope='course' AND course_id=? AND package_kind='subscription' AND is_active=1 ORDER BY sort_order,id`,
    )
    .all(courseId);

  const rens = db
    .prepare(
      `SELECT id, scope, package_kind, duration_unit, duration_count, fee_inr, discount_inr, sort_order
       FROM billing_packages WHERE scope='course' AND course_id=? AND package_kind='renewal' AND is_active=1 ORDER BY sort_order,id`,
    )
    .all(courseId);

  res.json({
    subscriptionPackages: subs,
    renewalPackages: rens,
  });
});

router.get('/public/combo/:comboId', (req, res) => {
  const comboId = Number(req.params.comboId);
  if (!Number.isFinite(comboId)) return res.status(400).json({ error: 'Invalid combo id' });
  const combo = db.prepare('SELECT id, name, is_active FROM course_combos WHERE id = ?').get(comboId);
  if (!combo || !combo.is_active) return res.status(404).json({ error: 'Combo not found' });
  const members = db
    .prepare('SELECT course_id FROM course_combo_members WHERE combo_id = ? ORDER BY id')
    .all(comboId)
    .map((m) => m.course_id);

  const subs = db
    .prepare(
      `SELECT id, scope, package_kind, duration_unit, duration_count, fee_inr, discount_inr, sort_order
       FROM billing_packages WHERE scope='combo' AND combo_id=? AND package_kind='subscription' AND is_active=1 ORDER BY sort_order,id`,
    )
    .all(comboId);

  const rens = db
    .prepare(
      `SELECT id, scope, package_kind, duration_unit, duration_count, fee_inr, discount_inr, sort_order
       FROM billing_packages WHERE scope='combo' AND combo_id=? AND package_kind='renewal' AND is_active=1 ORDER BY sort_order,id`,
    )
    .all(comboId);

  res.json({
    combo: { id: combo.id, name: combo.name, courseIds: members },
    subscriptionPackages: subs,
    renewalPackages: rens,
  });
});

module.exports = router;
