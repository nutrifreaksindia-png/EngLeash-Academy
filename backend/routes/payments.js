const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { auth, requireRole, JWT_SECRET } = require('../middleware/auth');
const {
  packageAmountPaise,
  userHasCourseAccess,
  userCanStartNewSubscribe,
  userEligibleForRenewal,
  applyPackageGrantsForPayment,
  applyRenewalForPayment,
  loadBillingPackage,
  loadComboCourses,
  upsertLifetimeGrant,
} = require('../lib/courseAccess');
const {
  ensurePaymentLedgerForCourseOrder,
  ensurePaymentLedgerForBillingOrder,
  getInvoiceBundleByPaymentId,
  getPaymentRecordById,
  getPaymentRecordForUser,
  listPaymentRecordsForAdmin,
  listPaymentRecordsForUser,
} = require('../lib/paymentRecords');
const { streamInvoicePdf } = require('../lib/invoicePdf');

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

function paymentPaidAtIso(gatewayPayment) {
  const createdAtSec = Number(gatewayPayment?.created_at);
  if (Number.isFinite(createdAtSec) && createdAtSec > 0) {
    return new Date(createdAtSec * 1000).toISOString();
  }
  return new Date().toISOString();
}

function signInvoiceAccessToken(payload) {
  return jwt.sign(
    {
      type: 'invoice_download',
      scope: payload.scope,
      paymentId: Number(payload.paymentId),
      userId: payload.userId != null ? Number(payload.userId) : undefined,
      role: payload.role || undefined,
    },
    JWT_SECRET,
    { expiresIn: '15m' },
  );
}

function buildInvoiceDownloadUrl(req, scope, paymentId, token) {
  const base = `${req.protocol}://${req.get('host')}`;
  return `${base}/api/payments/${scope}/${paymentId}/invoice?access_token=${encodeURIComponent(token)}`;
}

function authOrInvoiceToken(scope) {
  return (req, res, next) => {
    const signedToken = String(req.query?.access_token || '').trim();
    if (signedToken) {
      try {
        const payload = jwt.verify(signedToken, JWT_SECRET);
        if (payload?.type !== 'invoice_download') {
          return res.status(401).json({ error: 'Invalid invoice token' });
        }
        if (payload?.scope !== scope) {
          return res.status(403).json({ error: 'Invoice token scope mismatch' });
        }
        if (Number(payload?.paymentId) !== Number(req.params.paymentId)) {
          return res.status(403).json({ error: 'Invoice token does not match this payment' });
        }
        req.invoiceToken = payload;
        return next();
      } catch {
        return res.status(401).json({ error: 'Invoice token expired or invalid' });
      }
    }
    return auth(req, res, next);
  };
}

function invoiceBundleForStudent(req) {
  const paymentId = Number(req.params.paymentId);
  if (!Number.isFinite(paymentId)) return null;
  const bundle = getInvoiceBundleByPaymentId(paymentId);
  if (!bundle) return null;
  if (req.user) {
    return Number(bundle.payment.userId) === Number(req.user.id) ? bundle : null;
  }
  if (req.invoiceToken) {
    return Number(req.invoiceToken.userId) === Number(bundle.payment.userId) ? bundle : null;
  }
  return null;
}

function invoiceBundleForAdmin(req) {
  const paymentId = Number(req.params.paymentId);
  if (!Number.isFinite(paymentId)) return null;
  const bundle = getInvoiceBundleByPaymentId(paymentId);
  if (!bundle) return null;
  if (req.user) {
    return ['Admin', 'Creator', 'Trainer'].includes(String(req.user.role || '')) ? bundle : null;
  }
  if (req.invoiceToken) {
    return ['Admin', 'Creator', 'Trainer'].includes(String(req.invoiceToken.role || '')) ? bundle : null;
  }
  return null;
}

/** Approve purchase and sync legacy enrollments table. Idempotent. */
function fulfillCoursePurchase(userId, courseId, paymentContext = {}) {
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
  db.transaction(() => {
    upsertLifetimeGrant(userId, courseId, 'purchase', {
      razorpayOrderId: paymentContext.razorpayOrderId || null,
      paymentId: paymentContext.paymentId || null,
    });
  })();
}

function tryMarkBillingOrderPaid(razorpayOrderId, paymentId, amountPaiseFromPayment, paidAtIso = new Date().toISOString()) {
  const row = db.prepare('SELECT * FROM razorpay_billing_orders WHERE razorpay_order_id = ?').get(razorpayOrderId);
  if (!row) return { ok: false, reason: 'unknown_order' };
  if (row.status === 'paid') {
    const payment = ensurePaymentLedgerForBillingOrder({
      orderRow: row,
      paymentId: row.payment_id || paymentId,
      paidAtIso,
    });
    return { ok: true, duplicate: true, payment };
  }

  if (Number(row.amount_paise) !== Number(amountPaiseFromPayment)) return { ok: false, reason: 'amount_mismatch' };

  const pkg = loadBillingPackage(row.billing_package_id);
  if (!pkg) return { ok: false, reason: 'missing_package' };

  const kind = String(row.order_kind || '').toLowerCase();

  const tx = db.transaction(() => {
    const u = db.prepare(`
      UPDATE razorpay_billing_orders
      SET status = 'paid', payment_id = ?, updated_at = datetime('now')
      WHERE razorpay_order_id = ? AND status = 'created'
    `).run(paymentId, razorpayOrderId);
    if (u.changes === 0) return false;

    const userId = row.user_id;

    if (kind === 'subscribe') {
      applyPackageGrantsForPayment({
        userId,
        pkg,
        startMs: Date.now(),
        source: 'subscribe_direct',
        razorpayOrderId,
        paymentId,
        batchId: null,
        comboId: null,
        courseIds: [Number(row.course_id)],
      });
      ensurePaymentLedgerForBillingOrder({
        orderRow: { ...row, payment_id: paymentId },
        paymentId,
        paidAtIso,
      });
      return true;
    }

    if (kind === 'renewal') {
      applyRenewalForPayment({
        userId,
        courseId: Number(row.course_id),
        pkg,
        razorpayOrderId,
        paymentId,
        nowMs: Date.now(),
      });
      ensurePaymentLedgerForBillingOrder({
        orderRow: { ...row, payment_id: paymentId },
        paymentId,
        paidAtIso,
      });
      return true;
    }

    if (kind === 'combo') {
      const comboId = Number(row.combo_id);
      const courses = loadComboCourses(comboId);
      const pk = String(pkg.package_kind || '').toLowerCase();
      if (pk === 'subscription') {
        applyPackageGrantsForPayment({
          userId,
          pkg,
          startMs: Date.now(),
          source: 'combo_subscribe',
          razorpayOrderId,
          paymentId,
          batchId: null,
          comboId,
          courseIds: courses,
        });
      } else {
        for (const cid of courses) {
          applyRenewalForPayment({
            userId,
            courseId: cid,
            pkg,
            razorpayOrderId,
            paymentId,
            nowMs: Date.now(),
            comboId,
          });
        }
      }
      ensurePaymentLedgerForBillingOrder({
        orderRow: { ...row, payment_id: paymentId },
        paymentId,
        paidAtIso,
      });
      return true;
    }

    return false;
  });

  try {
    const applied = tx();
    return applied ? { ok: true } : { ok: true, duplicate: true };
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) return { ok: true, duplicate: true };
    throw e;
  }
}

function tryMarkOrderPaidAndFulfill(razorpayOrderId, paymentId, amountPaiseFromPayment, paidAtIso = new Date().toISOString()) {
  const row = db.prepare('SELECT * FROM razorpay_course_orders WHERE razorpay_order_id = ?').get(razorpayOrderId);
  if (!row) return { ok: false, reason: 'unknown_order' };
  if (row.status === 'paid') {
    const payment = ensurePaymentLedgerForCourseOrder({
      orderRow: row,
      paymentId: row.payment_id || paymentId,
      paidAtIso,
    });
    return { ok: true, duplicate: true, user_id: row.user_id, course_id: row.course_id, payment };
  }
  if (Number(row.amount_paise) !== Number(amountPaiseFromPayment)) return { ok: false, reason: 'amount_mismatch' };

  const tx = db.transaction(() => {
    const u = db.prepare(`
      UPDATE razorpay_course_orders
      SET status = 'paid', payment_id = ?, updated_at = datetime('now')
      WHERE razorpay_order_id = ? AND status = 'created'
    `).run(paymentId, razorpayOrderId);
    if (u.changes === 0) return false;
    fulfillCoursePurchase(row.user_id, row.course_id, {
      razorpayOrderId,
      paymentId,
    });
    const payment = ensurePaymentLedgerForCourseOrder({
      orderRow: { ...row, payment_id: paymentId },
      paymentId,
      paidAtIso,
    });
    return payment;
  });

  try {
    const payment = tx();
    return payment
      ? { ok: true, user_id: row.user_id, course_id: row.course_id, payment }
      : { ok: true, duplicate: true };
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

router.get('/my', auth, requireRole('Student', 'Lab', 'Trainer', 'Admin'), (req, res) => {
  res.json(listPaymentRecordsForUser(req.user.id));
});

router.get('/my/:paymentId(\\d+)', auth, requireRole('Student', 'Lab', 'Trainer', 'Admin'), (req, res) => {
  const payment = getPaymentRecordForUser(req.user.id, Number(req.params.paymentId));
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json(payment);
});

router.get('/my/:paymentId(\\d+)/invoice-link', auth, requireRole('Student', 'Lab', 'Trainer', 'Admin'), (req, res) => {
  const payment = getPaymentRecordForUser(req.user.id, Number(req.params.paymentId));
  if (!payment || !payment.hasInvoice) return res.status(404).json({ error: 'Invoice not found' });
  const token = signInvoiceAccessToken({
    scope: 'my',
    paymentId: payment.id,
    userId: req.user.id,
  });
  res.json({
    invoiceNumber: payment.invoiceNumber,
    url: buildInvoiceDownloadUrl(req, 'my', payment.id, token),
  });
});

router.get('/my/:paymentId(\\d+)/invoice', authOrInvoiceToken('my'), (req, res) => {
  const bundle = invoiceBundleForStudent(req);
  if (!bundle) return res.status(404).json({ error: 'Invoice not found' });
  streamInvoicePdf(res, bundle);
});

router.get('/admin', auth, requireRole('Admin', 'Creator', 'Trainer'), (req, res) => {
  res.json(
    listPaymentRecordsForAdmin({
      search: req.query?.search || '',
      paymentKind: req.query?.paymentKind || '',
    }),
  );
});

router.get('/admin/:paymentId(\\d+)', auth, requireRole('Admin', 'Creator', 'Trainer'), (req, res) => {
  const payment = getPaymentRecordById(Number(req.params.paymentId));
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json(payment);
});

router.get('/admin/:paymentId(\\d+)/invoice-link', auth, requireRole('Admin', 'Creator', 'Trainer'), (req, res) => {
  const payment = getPaymentRecordById(Number(req.params.paymentId));
  if (!payment || !payment.hasInvoice) return res.status(404).json({ error: 'Invoice not found' });
  const token = signInvoiceAccessToken({
    scope: 'admin',
    paymentId: payment.id,
    role: req.user.role,
  });
  res.json({
    invoiceNumber: payment.invoiceNumber,
    url: buildInvoiceDownloadUrl(req, 'admin', payment.id, token),
  });
});

router.get('/admin/:paymentId(\\d+)/invoice', authOrInvoiceToken('admin'), (req, res) => {
  const bundle = invoiceBundleForAdmin(req);
  if (!bundle) return res.status(404).json({ error: 'Invoice not found' });
  streamInvoicePdf(res, bundle);
});

/** POST JSON body — mounted after express.json() */
/** One-time payment for subscription / renewal / combo package (no Razorpay Subscriptions API). */
router.post('/razorpay/create-billing-order', auth, requireRole('Student', 'Lab', 'Trainer', 'Admin'), (req, res) => {
  const clientPkg = getRazorpayClient();
  if (!clientPkg) return res.status(503).json({ error: 'Payments are not configured on the server' });

  const packageId = Number(req.body?.billing_package_id);
  if (!Number.isFinite(packageId)) return res.status(400).json({ error: 'billing_package_id is required' });

  const pkg = loadBillingPackage(packageId);
  if (!pkg) return res.status(404).json({ error: 'Package not found' });

  const amount = packageAmountPaise(pkg);
  if (amount < 100) return res.status(400).json({ error: 'Payable amount must be at least ₹1' });

  const kind = String(pkg.package_kind || '').toLowerCase();
  const scope = String(pkg.scope || '').toLowerCase();
  const uid = req.user.id;
  const now = Date.now();

  let orderKind;
  let courseId = null;
  let comboId = null;

  if (scope === 'course') {
    const cid = Number(pkg.course_id);
    const course = db
      .prepare('SELECT id, enrollment_type, course_status, is_published, name FROM courses WHERE id = ?')
      .get(cid);
    if (!course || String(course.enrollment_type || '').toLowerCase() !== 'subscribe') {
      return res.status(400).json({ error: 'Invalid course for billing package' });
    }
    if (!course.is_published || (course.course_status && course.course_status !== 'Active')) {
      return res.status(400).json({ error: 'Course is not available' });
    }

    if (kind === 'subscription') {
      if (!userCanStartNewSubscribe(uid, cid, now)) {
        return res.status(409).json({ error: 'You already have an active subscription window for this course' });
      }
      orderKind = 'subscribe';
      courseId = cid;
    } else {
      if (!userEligibleForRenewal(uid, cid, now)) {
        return res.status(409).json({ error: 'Renewal packages are available only during your renewal period' });
      }
      orderKind = 'renewal';
      courseId = cid;
    }
  } else if (scope === 'combo') {
    const combId = Number(pkg.combo_id);
    const combo = db.prepare('SELECT id, is_active FROM course_combos WHERE id = ?').get(combId);
    if (!combo || !combo.is_active) return res.status(404).json({ error: 'Combo not found' });
    const courseIds = loadComboCourses(combId);

    if (kind === 'subscription') {
      for (const cid of courseIds) {
        if (!userCanStartNewSubscribe(uid, cid, now)) {
          return res.status(409).json({ error: 'You already have an active subscription for at least one course in this bundle' });
        }
      }
      orderKind = 'combo';
      comboId = combId;
    } else {
      for (const cid of courseIds) {
        if (!userEligibleForRenewal(uid, cid, now)) {
          return res.status(409).json({ error: 'Renewal is not available for all courses in this bundle yet' });
        }
      }
      orderKind = 'combo';
      comboId = combId;
    }
  } else {
    return res.status(400).json({ error: 'Invalid package scope' });
  }

  const receipt = `bp${packageId}_u${uid}_${Date.now()}`.slice(0, 40);
  clientPkg.instance.orders
    .create({
      amount,
      currency: 'INR',
      receipt,
      notes: {
        billing_package_id: String(packageId),
        user_id: String(uid),
        order_kind: orderKind,
      },
    })
    .then((order) => {
      try {
        db
          .prepare(
            `INSERT INTO razorpay_billing_orders (
            razorpay_order_id, user_id, order_kind, billing_package_id, course_id, combo_id, amount_paise, currency, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'INR', 'created')`
          )
          .run(order.id, uid, orderKind, packageId, courseId, comboId, amount);
      } catch (e) {
        if (!String(e.message || '').includes('UNIQUE')) throw e;
      }
      const courseNameRow =
        courseId != null
          ? db.prepare('SELECT name FROM courses WHERE id = ?').get(courseId)
          : db.prepare('SELECT name FROM course_combos WHERE id = ?').get(comboId);
      res.status(201).json({
        orderId: order.id,
        amount,
        currency: 'INR',
        keyId: clientPkg.keyId,
        courseName: courseNameRow?.name || 'EngLeash Academy',
        orderKind,
        billingPackageId: packageId,
      });
    })
    .catch((err) => {
      res.status(502).json({ error: err?.message || 'Could not create payment order' });
    });
});

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

  if (userHasCourseAccess(req.user.id, courseId)) {
    return res.status(409).json({ error: 'You already have access to this course' });
  }

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

  const clientPkg = getRazorpayClient();

  const courseRow = db.prepare('SELECT * FROM razorpay_course_orders WHERE razorpay_order_id = ?').get(orderId);
  const billRow = db.prepare('SELECT * FROM razorpay_billing_orders WHERE razorpay_order_id = ?').get(orderId);

  if (!courseRow && !billRow) return res.status(404).json({ error: 'Order not found' });

  const row = courseRow || billRow;
  if (Number(row.user_id) !== Number(req.user.id)) return res.status(403).json({ error: 'Order does not belong to this account' });

  let amountFromGateway = row.amount_paise;
  let paidAtIso = new Date().toISOString();
  if (clientPkg) {
    try {
      const pay = await clientPkg.instance.payments.fetch(paymentId);
      amountFromGateway = Number(pay.amount);
      paidAtIso = paymentPaidAtIso(pay);
    } catch (_) {
      /* use stored order amount */
    }
  }

  if (courseRow) {
    const result = tryMarkOrderPaidAndFulfill(orderId, paymentId, amountFromGateway, paidAtIso);
    if (!result.ok && result.reason === 'amount_mismatch') {
      return res.status(400).json({ error: 'Paid amount did not match the order' });
    }
    return res.json({ ok: true, duplicate: !!result.duplicate, kind: 'purchase', payment: result.payment || null });
  }

  const br = tryMarkBillingOrderPaid(orderId, paymentId, amountFromGateway, paidAtIso);
  if (!br.ok && br.reason === 'amount_mismatch') {
    return res.status(400).json({ error: 'Paid amount did not match the order' });
  }
  res.json({ ok: true, duplicate: !!br.duplicate, kind: 'billing', payment: br.payment || null });
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
        const oid = payEntity.order_id;
        const amt = Number(payEntity.amount);
        const paidAtIso = paymentPaidAtIso(payEntity);
        const r1 = tryMarkOrderPaidAndFulfill(oid, payEntity.id, amt, paidAtIso);
        if (!r1.ok && r1.reason === 'unknown_order') {
          tryMarkBillingOrderPaid(oid, payEntity.id, amt, paidAtIso);
        }
      }
    }
  } catch (_) {
    /* Respond 200 to avoid Razorpay disabling the endpoint on parse noise; investigate via logs */
  }

  res.status(200).json({ ok: true });
}

module.exports = { router, razorpayWebhookHandler };
