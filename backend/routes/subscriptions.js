const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

function sourceLabel(src) {
  const s = String(src || '').toLowerCase();
  if (s === 'subscribe_direct') return 'Direct purchase';
  if (s === 'subscribe_batch') return 'Batch / class';
  if (s === 'renewal') return 'Renewal';
  if (s === 'combo_subscribe') return 'Combo subscribe';
  if (s === 'combo_renewal') return 'Combo renewal';
  if (s === 'purchase_library' || s === 'purchase_direct') return 'Purchase';
  if (s === 'free_enroll') return 'Free enrollment';
  if (s === 'batch_course') return 'Batch (full access)';
  return src || '—';
}

function formatMs(ms) {
  if (ms == null) return null;
  const n = Number(ms);
  if (!Number.isFinite(n)) return null;
  return new Date(n).toISOString();
}

/** Current user — all active (non-revoked) course access grants with package / batch detail. */
router.get('/my', auth, (req, res) => {
  const uid = req.user.id;
  const rows = db
    .prepare(
      `
      SELECT g.id,
             g.user_id,
             g.course_id,
             g.source,
             g.starts_at_ms,
             g.ends_at_ms,
             g.grace_ends_at_ms,
             g.billing_package_id,
             g.batch_id,
             g.combo_id,
             g.razorpay_order_id,
             g.payment_id,
             g.created_at,
             c.name AS course_name,
             bp.package_kind AS package_kind,
             bp.duration_unit,
             bp.duration_count,
             bp.fee_inr,
             bp.discount_inr,
             b.title AS batch_title,
             b.batch_number AS batch_number
      FROM course_access_grants g
      INNER JOIN courses c ON c.id = g.course_id
      LEFT JOIN billing_packages bp ON bp.id = g.billing_package_id
      LEFT JOIN batches b ON b.id = g.batch_id
      WHERE g.user_id = ? AND g.revoked_at_ms IS NULL
      ORDER BY g.starts_at_ms DESC, g.id DESC
    `,
    )
    .all(uid);

  res.json(
    rows.map((r) => ({
      id: r.id,
      courseId: r.course_id,
      courseName: r.course_name,
      source: r.source,
      sourceLabel: sourceLabel(r.source),
      isLifetime: r.ends_at_ms == null,
      startsAtIso: formatMs(r.starts_at_ms),
      endsAtIso: formatMs(r.ends_at_ms),
      graceEndsAtIso: formatMs(r.grace_ends_at_ms),
      billingPackageId: r.billing_package_id,
      packageKind: r.package_kind,
      durationUnit: r.duration_unit,
      durationCount: r.duration_count,
      feeInr: r.fee_inr,
      discountInr: r.discount_inr,
      batchId: r.batch_id,
      batchTitle: r.batch_title,
      batchNumber: r.batch_number,
      comboId: r.combo_id,
      razorpayOrderId: r.razorpay_order_id,
      paymentId: r.payment_id,
      createdAt: r.created_at,
    })),
  );
});

/** Admin: recent subscription / access grant rows across all users */
router.get('/admin', auth, requireRole('Admin'), (req, res) => {
  const limitRaw = Number(req.query.limit || 800);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 800, 1), 2000);

  const rows = db
    .prepare(
      `
      SELECT g.*,
             u.name AS user_name,
             u.email AS user_email,
             c.name AS course_name,
             bp.package_kind,
             bp.duration_unit,
             bp.duration_count,
             b.title AS batch_title,
             b.batch_number
      FROM course_access_grants g
      INNER JOIN users u ON u.id = g.user_id
      INNER JOIN courses c ON c.id = g.course_id
      LEFT JOIN billing_packages bp ON bp.id = g.billing_package_id
      LEFT JOIN batches b ON b.id = g.batch_id
      WHERE g.revoked_at_ms IS NULL
      ORDER BY g.id DESC
      LIMIT ?
    `,
    )
    .all(limit);

  res.json({
    subscriptions: rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName: r.user_name,
      userEmail: r.user_email,
      courseId: r.course_id,
      courseName: r.course_name,
      source: r.source,
      sourceLabel: sourceLabel(r.source),
      isLifetime: r.ends_at_ms == null,
      startsAtIso: formatMs(r.starts_at_ms),
      endsAtIso: formatMs(r.ends_at_ms),
      graceEndsAtIso: formatMs(r.grace_ends_at_ms),
      billingPackageId: r.billing_package_id,
      packageKind: r.package_kind,
      durationUnit: r.duration_unit,
      durationCount: r.duration_count,
      batchId: r.batch_id,
      batchTitle: r.batch_title,
      batchNumber: r.batch_number,
      comboId: r.combo_id,
      razorpayOrderId: r.razorpay_order_id,
      paymentId: r.payment_id,
      createdAt: r.created_at,
    })),
  });
});

/** Admin: revoke a single course access grant (soft-delete; keeps audit row). */
router.delete('/admin/grants/:grantId', auth, requireRole('Admin'), (req, res) => {
  const grantId = Number(req.params.grantId);
  if (!Number.isFinite(grantId)) {
    return res.status(400).json({ error: 'Invalid grant id' });
  }
  const row = db
    .prepare('SELECT id FROM course_access_grants WHERE id = ? AND revoked_at_ms IS NULL')
    .get(grantId);
  if (!row) {
    return res.status(404).json({ error: 'Grant not found or already revoked' });
  }
  const now = Date.now();
  db.prepare('UPDATE course_access_grants SET revoked_at_ms = ? WHERE id = ?').run(now, grantId);
  res.status(204).end();
});

module.exports = router;
