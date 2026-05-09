const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

function getRazorpayClient() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return null;
  // eslint-disable-next-line global-require
  const Razorpay = require('razorpay');
  return { instance: new Razorpay({ key_id: keyId, key_secret: keySecret }), keyId };
}

function amountPaiseFromCourse(course) {
  const fee = Number(course.fee_inr || 0);
  const disc = Number(course.discount_inr || 0);
  const inr = Math.max(0, fee - disc);
  return Math.round(inr * 100);
}

/** Approve purchase and sync legacy enrollments table. Idempotent. */
function fulfillCoursePurchase(userId, courseId) {
  const ts = new Date().toISOString();
  const existing = db.prepare('SELECT id, status FROM course_enrollments WHERE user_id = ? AND course_id = ?').get(userId, courseId);
  if (!existing) {
    db.prepare(`
      INSERT INTO course_enrollments (user_id, course_id, enrollment_type, status, requested_at, approved_at, approved_by)
      VALUES (?, ?, 'purchase', 'approved', ?, ?, NULL)
    `).run(userId, courseId, ts, ts);
  } else if (existing.status !== 'approved') {
    db.prepare(`
      UPDATE course_enrollments
      SET enrollment_type = 'purchase', status = 'approved', approved_at = ?, approved_by = NULL, notes = NULL
      WHERE id = ?
    `).run(ts, existing.id);
  }
  db.prepare('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)').run(userId, courseId);
}

function tryMarkOrderPaidAndFulfill(razorpayOrderId, paymentId, amountPaiseFromPayment) {
  const row = db.prepare('SELECT * FROM razorpay_course_orders WHERE razorpay_order_id = ?').get(razorpayOrderId);
  if (!row) return { ok: false, reason: 'unknown_order' };
  if (row.status === 'paid') return { ok: true, duplicate: true, user_id: row.user_id, course_id: row.course_id };
  if (Number(row.amount_paise) !== Number(amountPaiseFromPayment)) return { ok: false, reason: 'amount_mismatch' };

  const tx = db.transaction(() => {
    const u = db.prepare(`
      UPDATE razorpay_course_orders
      SET status = 'paid', payment_id = ?, updated_at = datetime('now')
      WHERE razorpay_order_id = ? AND status = 'created'
    `).run(paymentId, razorpayOrderId);
    if (u.changes === 0) return false;
    fulfillCoursePurchase(row.user_id, row.course_id);
    return true;
  });

  try {
    const applied = tx();
    return applied ? { ok: true, user_id: row.user_id, course_id: row.course_id } : { ok: true, duplicate: true };
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      return { ok: true, duplicate: true };
    }
    throw e;
  }
}

function verifyPaymentSignature(orderId, paymentId, signature) {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret || !orderId || !paymentId || !signature) return false;
  const generated = crypto.createHmac('sha256', keySecret).update(`${orderId}|${paymentId}`).digest('hex');
  const a = Buffer.from(generated, 'utf8');
  const b = Buffer.from(String(signature), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** POST JSON body — mounted after express.json() */
router.post('/razorpay/create-order', auth, requireRole('Student', 'Lab', 'Trainer', 'Admin'), (req, res) => {
  const clientPkg = getRazorpayClient();
  if (!clientPkg) return res.status(503).json({ error: 'Payments are not configured on the server' });

  const courseId = Number(req.body?.course_id);
  if (!Number.isFinite(courseId)) return res.status(400).json({ error: 'course_id is required' });

  const course = db
    .prepare(
      `SELECT id, name, enrollment_type, course_status, fee_inr, discount_inr, is_published
       FROM courses WHERE id = ? AND is_published = 1`
    )
    .get(courseId);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  if (course.course_status && course.course_status !== 'Active') {
    return res.status(400).json({ error: 'Course is not active' });
  }
  const ent = String(course.enrollment_type || '').toLowerCase();
  if (ent !== 'purchase') {
    return res.status(400).json({ error: 'This course is not sold as a purchase' });
  }

  const amount = amountPaiseFromCourse(course);
  if (amount < 100) {
    return res.status(400).json({ error: 'Course price must be at least ₹1 to pay online' });
  }

  const enrolled = db
    .prepare("SELECT status FROM course_enrollments WHERE user_id = ? AND course_id = ? AND status = 'approved'")
    .get(req.user.id, courseId);
  if (enrolled) return res.status(409).json({ error: 'You already have access to this course' });

  const receipt = `ce${courseId}_u${req.user.id}_${Date.now()}`.slice(0, 40);
  clientPkg.instance.orders
    .create({
      amount,
      currency: 'INR',
      receipt,
      notes: { user_id: String(req.user.id), course_id: String(courseId) },
    })
    .then((order) => {
      try {
        db.prepare(`
          INSERT INTO razorpay_course_orders (razorpay_order_id, user_id, course_id, amount_paise, currency, status)
          VALUES (?, ?, ?, ?, 'INR', 'created')
        `).run(order.id, req.user.id, courseId, amount);
      } catch (e) {
        if (!String(e.message || '').includes('UNIQUE')) throw e;
      }
      res.status(201).json({
        orderId: order.id,
        amount,
        currency: 'INR',
        keyId: clientPkg.keyId,
        courseName: course.name || 'Course',
      });
    })
    .catch((err) => {
      res.status(502).json({ error: err?.message || 'Could not create payment order' });
    });
});

router.post('/razorpay/verify', auth, requireRole('Student', 'Lab', 'Trainer', 'Admin'), async (req, res) => {
  const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id and razorpay_signature are required' });
  }
  if (!verifyPaymentSignature(orderId, paymentId, signature)) {
    return res.status(400).json({ error: 'Invalid payment signature' });
  }

  const row = db.prepare('SELECT * FROM razorpay_course_orders WHERE razorpay_order_id = ?').get(orderId);
  if (!row) return res.status(404).json({ error: 'Order not found' });
  if (Number(row.user_id) !== Number(req.user.id)) return res.status(403).json({ error: 'Order does not belong to this account' });

  const clientPkg = getRazorpayClient();
  let amountFromGateway = row.amount_paise;
  if (clientPkg) {
    try {
      const pay = await clientPkg.instance.payments.fetch(paymentId);
      amountFromGateway = Number(pay.amount);
    } catch (_) {
      /* use stored order amount */
    }
  }

  const result = tryMarkOrderPaidAndFulfill(orderId, paymentId, amountFromGateway);
  if (!result.ok && result.reason === 'amount_mismatch') {
    return res.status(400).json({ error: 'Paid amount did not match the order' });
  }
  res.json({ ok: true, duplicate: !!result.duplicate });
});

/** Raw JSON body — use express.raw only for this handler (see server.js). */
function razorpayWebhookHandler(req, res) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    return res.status(503).type('text/plain').send('Webhook secret not configured');
  }
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : '');
  const raw = buf.toString('utf8');
  const sigHeader = req.headers['x-razorpay-signature'];
  if (!raw || !sigHeader) return res.status(400).type('text/plain').send('Bad request');

  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  try {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(sigHeader), 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).type('text/plain').send('Bad signature');
    }
  } catch {
    return res.status(400).type('text/plain').send('Bad signature');
  }

  try {
    const event = JSON.parse(raw);
    if (event.event === 'payment.captured') {
      const payEntity = event.payload?.payment?.entity;
      if (payEntity?.order_id && payEntity.id != null && payEntity.amount != null) {
        tryMarkOrderPaidAndFulfill(payEntity.order_id, payEntity.id, Number(payEntity.amount));
      }
    }
  } catch (_) {
    /* Respond 200 to avoid Razorpay disabling the endpoint on parse noise; investigate via logs */
  }

  res.status(200).json({ ok: true });
}

module.exports = { router, razorpayWebhookHandler };
