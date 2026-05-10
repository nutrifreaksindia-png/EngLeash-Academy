const db = require('../db');

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_MS = 7 * DAY_MS;

/** @type {Record<string, number>} */
const UNIT_MS = {
  day: DAY_MS,
  month: 30 * DAY_MS,
  year: 365 * DAY_MS,
};

function packageDurationMs(pkg) {
  const u = String(pkg.duration_unit || '').toLowerCase();
  const mult = Number(pkg.duration_count) || 0;
  const base = UNIT_MS[u];
  if (!base || mult < 1) return 0;
  return base * mult;
}

function packageAmountPaise(pkg) {
  const fee = Number(pkg.fee_inr || 0);
  const disc = Number(pkg.discount_inr || 0);
  const inr = Math.max(0, fee - disc);
  return Math.round(inr * 100);
}

/** Start of local calendar day for YYYY-MM-DD in server local TZ; fallback now. */
function startOfDayFromYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return Date.now();
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(y, mo, d, 0, 0, 0, 0).getTime();
}

/**
 * Effective access includes lifetime (ends_at_ms null) OR now in [starts_at_ms, grace_ends_at_ms].
 */
/**
 * Primary learner entitlement: formal enrollment rows, timed/lifetime grants, or membership in any batch tied to this course.
 * Used across courses list, lesson access, quizzes, etc.
 */
function learnerHasCourseAccess(userId, courseId, nowMs = Date.now()) {
  const uid = Number(userId);
  const cid = Number(courseId);
  if (!Number.isFinite(uid) || !Number.isFinite(cid)) return false;

  const enrolled =
    db
      .prepare("SELECT 1 FROM course_enrollments WHERE user_id = ? AND course_id = ? AND status = 'approved'")
      .get(uid, cid)
    || db.prepare('SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?').get(uid, cid);
  if (enrolled) return true;

  if (userHasCourseAccess(uid, cid, nowMs)) return true;

  const batchRow = db
    .prepare(
      `SELECT 1 FROM batch_members bm
       INNER JOIN batches b ON b.id = bm.batch_id AND b.course_id = ?
       WHERE bm.student_id = ?`,
    )
    .get(cid, uid);
  return !!batchRow;
}

function userHasCourseAccess(userId, courseId, nowMs = Date.now()) {
  const rows = db
    .prepare(
      `SELECT ends_at_ms, grace_ends_at_ms FROM course_access_grants
       WHERE user_id = ? AND course_id = ? AND revoked_at_ms IS NULL`
    )
    .all(userId, courseId);

  for (const r of rows) {
    if (r.ends_at_ms == null) return true;
    const ge = Number(r.grace_ends_at_ms);
    const st = Number(r.starts_at_ms);
    if (!Number.isFinite(ge) || !Number.isFinite(st)) continue;
    if (nowMs >= st && nowMs <= ge) return true;
  }
  return false;
}

/** Latest grant window end (subscription end only, not grace) for stacking renewals; null if none. */
function latestSubscriptionEndMs(userId, courseId) {
  const row = db
    .prepare(
      `SELECT ends_at_ms FROM course_access_grants
       WHERE user_id = ? AND course_id = ? AND revoked_at_ms IS NULL AND ends_at_ms IS NOT NULL
       ORDER BY ends_at_ms DESC LIMIT 1`
    )
    .get(userId, courseId);
  return row && row.ends_at_ms != null ? Number(row.ends_at_ms) : null;
}

/** True if user can buy renewal packages (still within grace or active sub period). */
function userEligibleForRenewal(userId, courseId, nowMs = Date.now()) {
  const row = db
    .prepare(
      `SELECT MAX(grace_ends_at_ms) AS g FROM course_access_grants
       WHERE user_id = ? AND course_id = ? AND revoked_at_ms IS NULL AND ends_at_ms IS NOT NULL`
    )
    .get(userId, courseId);
  if (!row || row.g == null) return false;
  return nowMs <= Number(row.g);
}

/** Active paid subscription window (timed), not lifetime purchase/free. */
function hasActiveSubscribeWindow(userId, courseId, nowMs = Date.now()) {
  return (
    db
      .prepare(
        `SELECT 1 FROM course_access_grants
         WHERE user_id = ? AND course_id = ? AND revoked_at_ms IS NULL
           AND ends_at_ms IS NOT NULL
           AND source IN ('subscribe_direct','subscribe_batch','renewal','combo_subscribe','combo_renewal')
           AND ? >= starts_at_ms AND ? <= grace_ends_at_ms`,
      )
      .get(userId, courseId, nowMs, nowMs) != null
  );
}

/** New subscription checkout allowed when no overlapping subscribe window remains. */
function userCanStartNewSubscribe(userId, courseId, nowMs = Date.now()) {
  return !hasActiveSubscribeWindow(userId, courseId, nowMs);
}

function insertGrant({
  userId,
  courseId,
  source,
  startsAtMs,
  endsAtMs,
  graceEndsAtMs,
  billingPackageId = null,
  batchId = null,
  comboId = null,
  razorpayOrderId = null,
  paymentId = null,
}) {
  db.prepare(
    `INSERT INTO course_access_grants (
      user_id, course_id, source, starts_at_ms, ends_at_ms, grace_ends_at_ms,
      billing_package_id, batch_id, combo_id, razorpay_order_id, payment_id, revoked_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
  ).run(
    userId,
    courseId,
    source,
    startsAtMs,
    endsAtMs,
    graceEndsAtMs,
    billingPackageId,
    batchId,
    comboId,
    razorpayOrderId,
    paymentId
  );
}

function upsertSubscribeEnrollment(userId, courseId) {
  const ts = new Date().toISOString();
  const existing = db.prepare('SELECT id, status FROM course_enrollments WHERE user_id = ? AND course_id = ?').get(userId, courseId);
  if (!existing) {
    db.prepare(
      `INSERT INTO course_enrollments (user_id, course_id, enrollment_type, status, requested_at, approved_at, approved_by)
       VALUES (?, ?, 'subscribe', 'approved', ?, ?, NULL)`
    ).run(userId, courseId, ts, ts);
  } else if (existing.status !== 'approved' || String(existing.enrollment_type || '') !== 'subscribe') {
    db.prepare(
      `UPDATE course_enrollments
       SET enrollment_type = 'subscribe', status = 'approved', approved_at = ?, approved_by = NULL, notes = NULL
       WHERE id = ?`
    ).run(ts, existing.id);
  }
  db.prepare('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)').run(userId, courseId);
}

/** Direct subscribe or combo: create grants from package duration. startMs defaults to now. */
function applyPackageGrantsForPayment({
  userId,
  pkg,
  startMs,
  source,
  razorpayOrderId,
  paymentId,
  batchId = null,
  comboId = null,
  courseIds,
}) {
  const dur = packageDurationMs(pkg);
  if (dur <= 0) throw new Error('Invalid package duration');
  const st = startMs != null ? Number(startMs) : Date.now();
  const en = st + dur;
  const ge = en + GRACE_MS;

  for (const cid of courseIds) {
    insertGrant({
      userId,
      courseId: cid,
      source,
      startsAtMs: st,
      endsAtMs: en,
      graceEndsAtMs: ge,
      billingPackageId: pkg.id,
      batchId,
      comboId,
      razorpayOrderId,
      paymentId,
    });
    upsertSubscribeEnrollment(userId, cid);
  }
}

/** Renewal: stack from max(now, last ends_at_ms). */
function applyRenewalForPayment({ userId, courseId, pkg, razorpayOrderId, paymentId, nowMs = Date.now(), comboId = null }) {
  const lastEnd = latestSubscriptionEndMs(userId, courseId);
  const anchor = Math.max(nowMs, lastEnd != null ? lastEnd : nowMs);
  const dur = packageDurationMs(pkg);
  if (dur <= 0) throw new Error('Invalid package duration');
  const en = anchor + dur;
  const ge = en + GRACE_MS;

  insertGrant({
    userId,
    courseId,
    source: comboId != null ? 'combo_renewal' : 'renewal',
    startsAtMs: anchor,
    endsAtMs: en,
    graceEndsAtMs: ge,
    billingPackageId: pkg.id,
    razorpayOrderId,
    paymentId,
    comboId,
  });
  upsertSubscribeEnrollment(userId, courseId);
}

function loadBillingPackage(id) {
  return db.prepare('SELECT * FROM billing_packages WHERE id = ? AND is_active = 1').get(id);
}

function loadComboCourses(comboId) {
  return db.prepare('SELECT course_id FROM course_combo_members WHERE combo_id = ? ORDER BY id').all(comboId).map((r) => Number(r.course_id));
}

/** Batch path: subscription package on batch, no payment. */
/** Non-subscribe courses: batch membership implies full access; record grant + approved enrollment for My Courses / subscriptions. */
function grantNonSubscribeBatchCourseAccess(batchId, userId) {
  const batch = db.prepare('SELECT id, course_id FROM batches WHERE id = ?').get(batchId);
  if (!batch?.course_id) return;
  const course = db.prepare('SELECT enrollment_type FROM courses WHERE id = ?').get(batch.course_id);
  if (!course) return;
  if (String(course.enrollment_type || '').toLowerCase() === 'subscribe') return;

  upsertLifetimeGrant(userId, batch.course_id, 'batch_course');
  const ts = new Date().toISOString();
  const cid = Number(batch.course_id);
  const existing = db.prepare('SELECT id, status FROM course_enrollments WHERE user_id = ? AND course_id = ?').get(userId, cid);
  if (!existing) {
    db.prepare(
      `INSERT INTO course_enrollments (user_id, course_id, enrollment_type, status, requested_at, approved_at, approved_by)
       VALUES (?, ?, 'free', 'approved', ?, ?, NULL)`,
    ).run(userId, cid, ts, ts);
  } else if (existing.status !== 'approved') {
    db.prepare(
      `UPDATE course_enrollments SET enrollment_type = 'free', status = 'approved', approved_at = ?, approved_by = NULL, notes = NULL
       WHERE id = ?`,
    ).run(ts, existing.id);
  }
  db.prepare('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)').run(userId, cid);
}

function grantBatchSubscriptionAccess(batchId, userId) {
  const dup = db
    .prepare(
      `SELECT 1 FROM course_access_grants WHERE user_id = ? AND batch_id = ? AND source = 'subscribe_batch' AND revoked_at_ms IS NULL`,
    )
    .get(userId, batchId);
  if (dup) return true;

  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId);
  if (!batch || !batch.course_id) return false;
  const pkgId = batch.subscription_package_id;
  if (!pkgId) return false;
  const course = db.prepare('SELECT id, enrollment_type FROM courses WHERE id = ?').get(batch.course_id);
  if (!course || String(course.enrollment_type || '').toLowerCase() !== 'subscribe') return false;

  const pkg = db
    .prepare(
      `SELECT * FROM billing_packages WHERE id = ? AND is_active = 1 AND scope = 'course' AND package_kind = 'subscription' AND course_id = ?`
    )
    .get(pkgId, batch.course_id);
  if (!pkg) return false;

  const startMs = batch.planned_start_date ? startOfDayFromYmd(batch.planned_start_date) : Date.now();
  db.transaction(() => {
    applyPackageGrantsForPayment({
      userId,
      pkg,
      startMs,
      source: 'subscribe_batch',
      razorpayOrderId: null,
      paymentId: null,
      batchId,
      comboId: null,
      courseIds: [batch.course_id],
    });
  })();
  return true;
}

function upsertLifetimeGrant(userId, courseId, source) {
  const now = Date.now();
  const existed = db
    .prepare(
      `SELECT id FROM course_access_grants WHERE user_id = ? AND course_id = ? AND revoked_at_ms IS NULL AND ends_at_ms IS NULL AND source = ?`,
    )
    .get(userId, courseId, source);
  if (existed) return;
  insertGrant({
    userId,
    courseId,
    source,
    startsAtMs: now,
    endsAtMs: null,
    graceEndsAtMs: null,
    billingPackageId: null,
    batchId: null,
    comboId: null,
    razorpayOrderId: null,
    paymentId: null,
  });
}

module.exports = {
  DAY_MS,
  GRACE_MS,
  packageDurationMs,
  packageAmountPaise,
  learnerHasCourseAccess,
  userHasCourseAccess,
  latestSubscriptionEndMs,
  userEligibleForRenewal,
  userCanStartNewSubscribe,
  insertGrant,
  upsertSubscribeEnrollment,
  applyPackageGrantsForPayment,
  applyRenewalForPayment,
  loadBillingPackage,
  loadComboCourses,
  grantBatchSubscriptionAccess,
  grantNonSubscribeBatchCourseAccess,
  upsertLifetimeGrant,
  startOfDayFromYmd,
  hasActiveSubscribeWindow,
};
