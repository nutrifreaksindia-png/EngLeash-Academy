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
  ensureApplyDuePaymentRecord,
  getInvoiceBundleByPaymentId,
  getPaymentRecordById,
  getPaymentRecordForUser,
  listPaymentRecordsForAdmin,
  listPaymentRecordsForUser,
} = require('../lib/paymentRecords');
const {
  allowedInitialApplyPlans,
  createApplyEnquiry,
  createOrReuseInitialProfile,
  dueAmountToCollectNow,
  loadApplyBatch,
  loadApplyCourse,
  loadDueItemWithProfile,
  listApplyBillingProfilesForAdmin,
  listApplyBillingProfilesForUser,
  listApplyEnquiriesForAdmin,
  prepareFullRemainingDue,
  preparePartSchedule,
  settleDueItem,
  updateApplyEnquiryStatus,
} = require('../lib/applyBilling');
const {
  CALLBACK_TIME_SLOTS,
  normalizeCountryDialCode,
  normalizePhoneLocal,
  validateCallbackDate,
  validateCallbackSlotForDate,
} = require('../lib/callbackBookingRules');
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

function batchContainsCourse(batchId, courseId) {
  const batch = db.prepare('SELECT id, course_id, enrollment_open_status FROM batches WHERE id = ?').get(batchId);
  if (!batch) return null;
  const matches =
    Number(batch.course_id) === Number(courseId) ||
    db
      .prepare('SELECT 1 FROM batch_courses WHERE batch_id = ? AND course_id = ?')
      .get(batchId, courseId);
  if (!matches) return null;
  return batch;
}

function loadHolidayDateSet() {
  const rows = db.prepare('SELECT holiday_date FROM holidays').all();
  return new Set(rows.map((r) => String(r.holiday_date || '').trim()).filter(Boolean));
}

function createRazorpayApplyDueOrder({ clientPkg, userId, billingProfileId, dueItemId, amountPaise }) {
  const receipt = `ad${dueItemId}_u${userId}_${Date.now()}`.slice(0, 40);
  return clientPkg.instance.orders.create({
    amount: amountPaise,
    currency: 'INR',
    receipt,
    notes: {
      user_id: String(userId),
      billing_profile_id: String(billingProfileId),
      due_item_id: String(dueItemId),
    },
  });
}

function tryMarkApplyDueOrderPaid(razorpayOrderId, paymentId, amountPaiseFromPayment, paidAtIso = new Date().toISOString()) {
  const row = db.prepare('SELECT * FROM razorpay_apply_due_orders WHERE razorpay_order_id = ?').get(razorpayOrderId);
  if (!row) return { ok: false, reason: 'unknown_order' };
  const dueRow = loadDueItemWithProfile(row.due_item_id);
  if (!dueRow) return { ok: false, reason: 'missing_due' };
  const expectedAmountPaise = dueAmountToCollectNow(dueRow, paidAtIso);
  if (row.status === 'paid') {
    const payment = ensureApplyDuePaymentRecord({
      dueRow: loadDueItemWithProfile(row.due_item_id) || dueRow,
      amountPaise: expectedAmountPaise,
      paymentSource: 'razorpay',
      gateway: 'razorpay',
      gatewayOrderId: row.razorpay_order_id,
      gatewayPaymentId: row.payment_id || paymentId,
      sourceOrderTable: 'razorpay_apply_due_orders',
      sourceOrderRowId: Number(row.id),
      paidAtIso,
    });
    return { ok: true, duplicate: true, payment };
  }

  if (Number(expectedAmountPaise) !== Number(amountPaiseFromPayment)) {
    return { ok: false, reason: 'amount_mismatch' };
  }

  const tx = db.transaction(() => {
    const updated = db.prepare(
      `UPDATE razorpay_apply_due_orders
       SET status = 'paid', payment_id = ?, updated_at = datetime('now')
       WHERE razorpay_order_id = ? AND status = 'created'`,
    ).run(paymentId, razorpayOrderId);
    if (updated.changes === 0) return false;

    settleDueItem({
      dueItemId: Number(row.due_item_id),
      amountPaise: Number(expectedAmountPaise),
      paidAtIso,
      sourceMeta: {
        gateway: 'razorpay',
        razorpayOrderId,
        paymentId,
      },
    });

    return ensureApplyDuePaymentRecord({
      dueRow: loadDueItemWithProfile(row.due_item_id),
      amountPaise: expectedAmountPaise,
      paymentSource: 'razorpay',
      gateway: 'razorpay',
      gatewayOrderId: row.razorpay_order_id,
      gatewayPaymentId: paymentId,
      sourceOrderTable: 'razorpay_apply_due_orders',
      sourceOrderRowId: Number(row.id),
      paidAtIso,
    });
  });

  try {
    const payment = tx();
    return payment ? { ok: true, payment } : { ok: true, duplicate: true };
  } catch (error) {
    if (String(error?.message || '').includes('UNIQUE')) {
      return { ok: true, duplicate: true };
    }
    throw error;
  }
}

router.get('/apply/callback-meta', auth, requireRole('Student', 'Lab'), (req, res) => {
  const holidayDates = db.prepare('SELECT holiday_date FROM holidays ORDER BY holiday_date').all();
  res.json({
    holidays: holidayDates.map((r) => String(r.holiday_date || '').trim()).filter(Boolean),
    time_slots: CALLBACK_TIME_SLOTS,
  });
});

router.get('/apply/my', auth, requireRole('Student', 'Lab', 'Trainer', 'Admin'), (req, res) => {
  res.json(listApplyBillingProfilesForUser(req.user.id));
});

router.get('/admin/apply-billing', auth, requireRole('Admin', 'Creator', 'Trainer'), (req, res) => {
  res.json(
    listApplyBillingProfilesForAdmin({
      search: req.query?.search || '',
      status: req.query?.status || '',
    }),
  );
});

router.post('/apply/enquiries', auth, requireRole('Student', 'Lab'), (req, res) => {
  const courseId = Number(req.body?.course_id);
  const rawBatch = req.body?.batch_id;
  const batchId =
    rawBatch === null || rawBatch === undefined || rawBatch === '' ? null : Number(rawBatch);
  if (!Number.isFinite(courseId)) {
    return res.status(400).json({ error: 'course_id is required' });
  }
  if (batchId != null && !Number.isFinite(batchId)) {
    return res.status(400).json({ error: 'batch_id is invalid' });
  }
  const course = loadApplyCourse(courseId);
  if (!course || String(course.enrollment_type || '').toLowerCase() !== 'apply') {
    return res.status(400).json({ error: 'This course does not use the apply revenue flow' });
  }
  if (!course.apply_enquiry_enabled) {
    return res.status(409).json({ error: 'Enquiries are disabled for this course' });
  }
  if (!course.is_published || String(course.course_status || 'Active') !== 'Active') {
    return res.status(400).json({ error: 'Course is not available' });
  }
  if (batchId != null) {
    const batch = batchContainsCourse(batchId, courseId);
    if (!batch) return res.status(404).json({ error: 'Batch not found for course' });
  }

  const displayName = String(req.body?.display_name || '').trim();
  const phoneCountryCode = normalizeCountryDialCode(req.body?.phone_country_code);
  const phoneLocal = normalizePhoneLocal(req.body?.phone_local ?? req.body?.phone_number);
  const callbackDate = String(req.body?.callback_date || '').trim();
  const callbackSlot = String(req.body?.callback_slot || '').trim();

  if (displayName.length < 2) {
    return res.status(400).json({ error: 'Please enter your name' });
  }
  if (!phoneCountryCode || phoneCountryCode.length > 14) {
    return res.status(400).json({ error: 'Please select a valid country code' });
  }
  if (phoneLocal.length < 6 || phoneLocal.length > 15) {
    return res.status(400).json({ error: 'Please enter a valid phone number' });
  }

  const holidaySet = loadHolidayDateSet();
  const dateCheck = validateCallbackDate(callbackDate, holidaySet);
  if (!dateCheck.ok) {
    return res.status(400).json({ error: dateCheck.reason || 'Invalid callback date' });
  }
  const slotCheck = validateCallbackSlotForDate(callbackSlot, callbackDate);
  if (!slotCheck.ok) {
    return res.status(400).json({ error: slotCheck.reason || 'Invalid time slot' });
  }

  const enquiryId = createApplyEnquiry({
    userId: req.user.id,
    courseId,
    batchId,
    noteText: req.body?.note || null,
    displayName,
    phoneCountryCode,
    phoneLocal,
    callbackDate,
    callbackSlot,
  });
  res.status(201).json({ ok: true, enquiryId });
});

router.get('/admin/apply-enquiries', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  res.json(listApplyEnquiriesForAdmin({ search: req.query?.search || '' }));
});

router.patch('/admin/apply-enquiries/:id', auth, requireRole('Admin', 'Trainer', 'Creator'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const result = updateApplyEnquiryStatus(id, req.body?.status);
  if (!result.ok) return res.status(result.error === 'Not found' ? 404 : 400).json({ error: result.error });
  res.json({ ok: true });
});

router.post('/razorpay/create-apply-order', auth, requireRole('Student', 'Lab'), async (req, res) => {
  const clientPkg = getRazorpayClient();
  if (!clientPkg) return res.status(503).json({ error: 'Payments are not configured on the server' });

  const dueItemId = req.body?.due_item_id == null || req.body.due_item_id === '' ? null : Number(req.body.due_item_id);
  let dueRow = null;

  if (Number.isFinite(dueItemId)) {
    dueRow = loadDueItemWithProfile(dueItemId);
    if (!dueRow) return res.status(404).json({ error: 'Due item not found' });
    if (Number(dueRow.user_id) !== Number(req.user.id)) {
      return res.status(403).json({ error: 'This due item does not belong to your account' });
    }
    if (String(dueRow.due_status || '').toLowerCase() === 'paid') {
      return res.status(409).json({ error: 'This due item is already settled' });
    }
  } else {
    const courseId = Number(req.body?.course_id);
    const batchId = Number(req.body?.batch_id);
    const selectedPlan = String(req.body?.selected_plan || '').trim().toLowerCase();
    if (!Number.isFinite(courseId) || !Number.isFinite(batchId) || !selectedPlan) {
      return res.status(400).json({ error: 'course_id, batch_id and selected_plan are required' });
    }

    const course = loadApplyCourse(courseId);
    if (!course) return res.status(404).json({ error: 'Course not found' });
    if (!course.is_published || String(course.course_status || 'Active') !== 'Active') {
      return res.status(400).json({ error: 'Course is not available' });
    }
    if (String(course.enrollment_type || '').toLowerCase() !== 'apply') {
      return res.status(400).json({ error: 'This course does not use batch applications' });
    }
    if (userHasCourseAccess(req.user.id, courseId)) {
      return res.status(409).json({ error: 'You already have active access to this course' });
    }

    const batchMeta = batchContainsCourse(batchId, courseId);
    if (!batchMeta) return res.status(404).json({ error: 'Batch not found for course' });
    if ((batchMeta.enrollment_open_status || 'closed') !== 'open') {
      return res.status(409).json({ error: 'Batch is currently closed for applications' });
    }
    const batch = loadApplyBatch(batchId) || batchMeta;
    const allowedPlans = allowedInitialApplyPlans(batch);
    if (!allowedPlans.includes(selectedPlan)) {
      return res.status(400).json({ error: 'Selected payment option is not available for this batch timing' });
    }

    try {
      const prepared = createOrReuseInitialProfile({
        userId: req.user.id,
        course,
        batch,
        selectedPlan,
      });
      dueRow = loadDueItemWithProfile(prepared.initialDue.id);
    } catch (error) {
      return res.status(409).json({ error: error.message || 'Could not prepare apply billing' });
    }
  }

  const amountPaise = dueAmountToCollectNow(dueRow);
  if (amountPaise < 100) {
    return res.status(400).json({ error: 'Payable amount must be at least Rs. 1' });
  }

  try {
    const order = await createRazorpayApplyDueOrder({
      clientPkg,
      userId: req.user.id,
      billingProfileId: Number(dueRow.billing_profile_id),
      dueItemId: Number(dueRow.id),
      amountPaise,
    });
    db.prepare(
      `INSERT INTO razorpay_apply_due_orders (
        razorpay_order_id, user_id, billing_profile_id, due_item_id, amount_paise, currency, status, payment_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'INR', 'created', NULL, datetime('now'), datetime('now'))`,
    ).run(order.id, req.user.id, Number(dueRow.billing_profile_id), Number(dueRow.id), amountPaise);
    res.status(201).json({
      orderId: order.id,
      amount: amountPaise,
      currency: 'INR',
      keyId: clientPkg.keyId,
      courseName: dueRow.course_name || 'EngLeash Academy',
      paymentLabel: dueRow.label_text || 'Apply course payment',
      dueItemId: Number(dueRow.id),
      billingProfileId: Number(dueRow.billing_profile_id),
    });
  } catch (error) {
    res.status(502).json({ error: error?.message || 'Could not create apply payment order' });
  }
});

router.post('/apply/:profileId(\\d+)/pay-remaining-full', auth, requireRole('Student', 'Lab'), (req, res) => {
  const profileId = Number(req.params.profileId);
  const profile = db.prepare('SELECT user_id FROM apply_course_billing_profiles WHERE id = ?').get(profileId);
  if (!profile) return res.status(404).json({ error: 'Apply billing profile not found' });
  if (Number(profile.user_id) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'This billing profile does not belong to your account' });
  }
  try {
    const prepared = prepareFullRemainingDue(profileId);
    const amountPaise = dueAmountToCollectNow(prepared.due);
    const refreshed = listApplyBillingProfilesForUser(req.user.id).find((row) => Number(row.id) === profileId);
    res.json({
      ok: true,
      profile: refreshed || null,
      dueItemId: Number(prepared.due.id),
      amountPaise,
      amountInr: amountPaise / 100,
    });
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Could not prepare remaining balance payment' });
  }
});

router.post('/apply/:profileId(\\d+)/parts', auth, requireRole('Student', 'Lab'), (req, res) => {
  const profileId = Number(req.params.profileId);
  const profile = db.prepare('SELECT user_id FROM apply_course_billing_profiles WHERE id = ?').get(profileId);
  if (!profile) return res.status(404).json({ error: 'Apply billing profile not found' });
  if (Number(profile.user_id) !== Number(req.user.id)) {
    return res.status(403).json({ error: 'This billing profile does not belong to your account' });
  }
  try {
    preparePartSchedule(profileId);
    const refreshed = listApplyBillingProfilesForUser(req.user.id).find((row) => Number(row.id) === profileId);
    res.json({ ok: true, profile: refreshed || null });
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Could not prepare part payments' });
  }
});

router.patch('/admin/apply-billing/:profileId(\\d+)/parts', auth, requireRole('Admin', 'Creator', 'Trainer'), (req, res) => {
  const profileId = Number(req.params.profileId);
  try {
    preparePartSchedule(profileId, { parts: req.body?.parts, requireStartedBatch: true });
    const refreshed = listApplyBillingProfilesForAdmin({}).find((row) => Number(row.id) === profileId);
    res.json({ ok: true, profile: refreshed || null });
  } catch (error) {
    const message = error?.message || 'Could not update part schedule';
    res.status(message.includes('not found') ? 404 : 400).json({ error: message });
  }
});

router.post('/admin/apply-due/:dueItemId(\\d+)/manual', auth, requireRole('Admin', 'Creator', 'Trainer'), (req, res) => {
  const dueItemId = Number(req.params.dueItemId);
  const dueRow = loadDueItemWithProfile(dueItemId);
  if (!dueRow) return res.status(404).json({ error: 'Due item not found' });
  if (String(dueRow.due_status || '').toLowerCase() === 'paid') {
    return res.status(409).json({ error: 'This due item is already settled' });
  }

  const paidAtIso = req.body?.paidAt ? new Date(req.body.paidAt).toISOString() : new Date().toISOString();
  const expectedAmountPaise = dueAmountToCollectNow(dueRow, paidAtIso);
  const bodyAmountPaise =
    req.body?.amountPaise != null
      ? Number(req.body.amountPaise)
      : req.body?.amountInr != null
        ? Math.round(Number(req.body.amountInr) * 100)
        : expectedAmountPaise;
  if (!Number.isFinite(bodyAmountPaise) || bodyAmountPaise < 1 || Number(bodyAmountPaise) > Number(expectedAmountPaise)) {
    return res.status(400).json({ error: `Enter an amount up to Rs. ${(expectedAmountPaise / 100).toFixed(2)}` });
  }

  const tx = db.transaction(() => {
    const entry = db.prepare(
      `INSERT INTO manual_apply_due_entries (
        due_item_id, billing_profile_id, user_id, amount_paise, currency, reference_text, note_text, recorded_by, paid_at, created_at
      ) VALUES (?, ?, ?, ?, 'INR', ?, ?, ?, ?, datetime('now'))`,
    ).run(
      dueItemId,
      Number(dueRow.billing_profile_id),
      Number(dueRow.user_id),
      bodyAmountPaise,
      req.body?.referenceText || null,
      req.body?.noteText || null,
      req.user.id,
      paidAtIso,
    );

    settleDueItem({
      dueItemId,
      amountPaise: bodyAmountPaise,
      paidAtIso,
      sourceMeta: {
        gateway: 'manual',
        referenceText: req.body?.referenceText || null,
        noteText: req.body?.noteText || null,
        recordedBy: req.user.id,
      },
    });

    return ensureApplyDuePaymentRecord({
      dueRow: loadDueItemWithProfile(dueItemId),
      amountPaise: bodyAmountPaise,
      paymentSource: 'cash_manual',
      gateway: 'manual',
      gatewayOrderId: `manual_order_${entry.lastInsertRowid}`,
      gatewayPaymentId: `manual_payment_${entry.lastInsertRowid}`,
      manualReference: req.body?.referenceText || null,
      manualRecordedBy: req.user.id,
      sourceOrderTable: 'manual_apply_due_entries',
      sourceOrderRowId: Number(entry.lastInsertRowid),
      paidAtIso,
    });
  });

  try {
    const payment = tx();
    res.status(201).json({ ok: true, payment });
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Could not record manual payment' });
  }
});

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
    const enrollmentType = String(course?.enrollment_type || '').toLowerCase();
    if (!course || (enrollmentType !== 'subscribe' && enrollmentType !== 'apply')) {
      return res.status(400).json({ error: 'Invalid course for billing package' });
    }
    if (enrollmentType === 'apply' && kind !== 'renewal') {
      return res.status(400).json({ error: 'Apply courses can only use renewal packages' });
    }
    if (enrollmentType !== 'subscribe' && kind === 'subscription') {
      return res.status(400).json({ error: 'Subscription packages are only for Subscribe courses' });
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
  const applyRow = db.prepare('SELECT * FROM razorpay_apply_due_orders WHERE razorpay_order_id = ?').get(orderId);

  if (!courseRow && !billRow && !applyRow) return res.status(404).json({ error: 'Order not found' });

  const row = courseRow || billRow || applyRow;
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

  if (applyRow) {
    const result = tryMarkApplyDueOrderPaid(orderId, paymentId, amountFromGateway, paidAtIso);
    if (!result.ok && result.reason === 'amount_mismatch') {
      return res.status(400).json({ error: 'Paid amount did not match the order' });
    }
    if (!result.ok && result.reason === 'missing_due') {
      return res.status(404).json({ error: 'Due item no longer exists for this payment order' });
    }
    return res.json({ ok: true, duplicate: !!result.duplicate, kind: 'apply_due', payment: result.payment || null });
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
          const r2 = tryMarkBillingOrderPaid(oid, payEntity.id, amt, paidAtIso);
          if (!r2.ok && r2.reason === 'unknown_order') {
            tryMarkApplyDueOrderPaid(oid, payEntity.id, amt, paidAtIso);
          }
        }
      }
    }
  } catch (_) {
    /* Respond 200 to avoid Razorpay disabling the endpoint on parse noise; investigate via logs */
  }

  res.status(200).json({ ok: true });
}

module.exports = { router, razorpayWebhookHandler };
