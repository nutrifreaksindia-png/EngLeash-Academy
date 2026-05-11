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
 * Access from non-revoked grants only.
 * Batch membership/start-state may cause grant creation, but never bypasses grant-based entitlement.
 * Does not use course_enrollments / enrollments tables — use to decide if approved enrollment is still justified.
 */
function entitlementFromGrantsOrBatchMembership(userId, courseId, nowMs = Date.now()) {
  const uid = Number(userId);
  const cid = Number(courseId);
  if (!Number.isFinite(uid) || !Number.isFinite(cid)) return false;
  return userHasCourseAccess(uid, cid, nowMs);
}

/**
 * If the user no longer has grant/batch-based entitlement, clear approved enrollment so My Courses and APIs stay consistent.
 */
function clearStaleEnrollmentIfNoAccess(userId, courseId, nowMs = Date.now()) {
  const uid = Number(userId);
  const cid = Number(courseId);
  if (!Number.isFinite(uid) || !Number.isFinite(cid)) return;
  if (entitlementFromGrantsOrBatchMembership(uid, cid, nowMs)) return;
  db.prepare(
    `UPDATE course_enrollments
     SET status = 'rejected', approved_at = NULL, approved_by = NULL
     WHERE user_id = ? AND course_id = ? AND status = 'approved'`,
  ).run(uid, cid);
  db.prepare('DELETE FROM enrollments WHERE user_id = ? AND course_id = ?').run(uid, cid);
}

/**
 * Revoke one grant row by id and sync enrollments when nothing else grants access.
 * @returns {{ ok: boolean, error?: string }}
 */
function revokeAccessGrantById(grantId) {
  const gid = Number(grantId);
  if (!Number.isFinite(gid)) return { ok: false, error: 'Invalid grant id' };
  const row = db
    .prepare('SELECT id, user_id, course_id FROM course_access_grants WHERE id = ? AND revoked_at_ms IS NULL')
    .get(gid);
  if (!row) return { ok: false, error: 'Grant not found or already revoked' };
  const now = Date.now();
  db.prepare('UPDATE course_access_grants SET revoked_at_ms = ? WHERE id = ?').run(now, row.id);
  clearStaleEnrollmentIfNoAccess(row.user_id, row.course_id, now);
  return { ok: true };
}

/**
 * True if the student is on another batch (not excludeBatchId) that includes this course.
 */
function batchMemberElsewhereForCourse(userId, courseId, excludeBatchId) {
  const uid = Number(userId);
  const cid = Number(courseId);
  const xbid = Number(excludeBatchId);
  if (!Number.isFinite(uid) || !Number.isFinite(cid) || !Number.isFinite(xbid)) return false;
  const o = db
    .prepare(
      `SELECT 1 FROM batch_members bm
       INNER JOIN batches b ON b.id = bm.batch_id
       WHERE bm.student_id = ?
         AND b.id != ?
         AND (
           EXISTS (SELECT 1 FROM batch_courses bc WHERE bc.batch_id = b.id AND bc.course_id = ?)
           OR (
             NOT EXISTS (SELECT 1 FROM batch_courses bx WHERE bx.batch_id = b.id)
             AND b.course_id IS NOT NULL
             AND b.course_id = ?
           )
         )
       LIMIT 1`,
    )
    .get(uid, xbid, cid, cid);
  return !!o;
}

/**
 * After removing a student from a batch: revoke grants from this batch and batch_course rows when they have no other batch for that course; sync enrollments.
 * Call before deleting the batch_members row (membership elsewhere is still visible in SQL).
 */
function removeBatchStudentAccess(batchId, studentId) {
  const bid = Number(batchId);
  const uid = Number(studentId);
  if (!Number.isFinite(bid) || !Number.isFinite(uid)) return;

  const now = Date.now();
  db.prepare(
    `UPDATE course_access_grants SET revoked_at_ms = ?
     WHERE batch_id = ? AND user_id = ? AND revoked_at_ms IS NULL`,
  ).run(now, bid, uid);

  let courseIds = db.prepare('SELECT course_id FROM batch_courses WHERE batch_id = ? ORDER BY sort_order, id').all(bid).map((r) => Number(r.course_id));

  const bRow = db.prepare('SELECT course_id FROM batches WHERE id = ?').get(bid);
  const primaryCid = bRow?.course_id != null ? Number(bRow.course_id) : null;
  if (Number.isFinite(primaryCid) && !courseIds.includes(primaryCid)) {
    courseIds.push(primaryCid);
  }
  courseIds = [...new Set(courseIds.filter((x) => Number.isFinite(x)))];

  for (const cid of courseIds) {
    if (!batchMemberElsewhereForCourse(uid, cid, bid)) {
      db.prepare(
        `UPDATE course_access_grants SET revoked_at_ms = ?
         WHERE user_id = ? AND course_id = ? AND source = 'batch_course' AND revoked_at_ms IS NULL`,
      ).run(now, uid, cid);
    }
    clearStaleEnrollmentIfNoAccess(uid, cid, now);
  }
}

/** Run before deleting a batch row: revoke batch-linked access and sync enrollments for every member. */
function purgeAllMembersAccessForDeletingBatch(batchId) {
  const bid = Number(batchId);
  if (!Number.isFinite(bid)) return;
  const members = db.prepare('SELECT student_id FROM batch_members WHERE batch_id = ?').all(bid);
  for (const m of members) {
    removeBatchStudentAccess(bid, m.student_id);
  }
}

/**
 * Primary learner entitlement.
 * Access comes only from grants or qualifying batch membership/state, never from enrollment workflow rows.
 */
function learnerHasCourseAccess(userId, courseId, nowMs = Date.now()) {
  const uid = Number(userId);
  const cid = Number(courseId);
  if (!Number.isFinite(uid) || !Number.isFinite(cid)) return false;
  return entitlementFromGrantsOrBatchMembership(uid, cid, nowMs);
}

function userHasCourseAccess(userId, courseId, nowMs = Date.now()) {
  const rows = db
    .prepare(
      `SELECT ends_at_ms, grace_ends_at_ms, starts_at_ms FROM course_access_grants
       WHERE user_id = ? AND course_id = ? AND revoked_at_ms IS NULL`
    )
    .all(userId, courseId);

  for (const r of rows) {
    const st = Number(r.starts_at_ms);
    if (r.ends_at_ms == null) {
      if (Number.isFinite(st) && nowMs < st) continue;
      return true;
    }
    const ge = Number(r.grace_ends_at_ms);
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

function syncLegacyEnrollmentMirror(userId, courseId) {
  db.prepare('INSERT OR IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)').run(userId, courseId);
}

function upsertApprovedEnrollment(userId, courseId, enrollmentType, approvedAtIso = null) {
  const ts = approvedAtIso || new Date().toISOString();
  const existing = db.prepare('SELECT id, status FROM course_enrollments WHERE user_id = ? AND course_id = ?').get(userId, courseId);
  if (!existing) {
    db.prepare(
      `INSERT INTO course_enrollments (user_id, course_id, enrollment_type, status, requested_at, approved_at, approved_by)
       VALUES (?, ?, ?, 'approved', ?, ?, NULL)`
    ).run(userId, courseId, enrollmentType, ts, ts);
  } else {
    db.prepare(
      `UPDATE course_enrollments
       SET enrollment_type = ?, status = 'approved', approved_at = ?, approved_by = NULL, notes = NULL
       WHERE id = ?`
    ).run(enrollmentType, ts, existing.id);
  }
}

function upsertSubscribeEnrollment(userId, courseId) {
  upsertApprovedEnrollment(userId, courseId, 'subscribe');
  syncLegacyEnrollmentMirror(userId, courseId);
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
  workflowEnrollmentType = 'subscribe',
  mirrorLegacyEnrollment = true,
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
    upsertApprovedEnrollment(userId, cid, workflowEnrollmentType, new Date(st).toISOString());
    if (mirrorLegacyEnrollment) {
      syncLegacyEnrollmentMirror(userId, cid);
    }
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

/** True once the batch has a real cohort start (sessions generated). Subscribe/Apply access is anchored here, not at batch creation. */
function isBatchStartedForAccess(batch) {
  if (!batch) return false;
  if (String(batch.batch_status || '').toLowerCase() === 'started') return true;
  const a = String(batch.actual_start_date || '').trim();
  return a.length > 0;
}

/** Start of subscription / deferred batch_course grant window (local midnight of cohort start date). */
function batchCohortAccessStartMs(batch) {
  if (!batch) return null;
  const a = String(batch.actual_start_date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(a)) return startOfDayFromYmd(a);
  const p = String(batch.planned_start_date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return startOfDayFromYmd(p);
  return null;
}

function grantNonSubscribeBatchCourseForSingleCourse(userId, courseId, options = {}) {
  const cid = Number(courseId);
  if (!Number.isFinite(cid)) return;
  const course = db.prepare('SELECT enrollment_type FROM courses WHERE id = ?').get(cid);
  if (!course) return;
  const et = String(course.enrollment_type || '').toLowerCase();
  if (et === 'subscribe') return;

  const batchStarted = Boolean(options.batchStarted);
  const accessStartMs = options.accessStartMs != null ? Number(options.accessStartMs) : null;

  if (et === 'apply') {
    if (!batchStarted || !Number.isFinite(accessStartMs)) return;
    const existed = db
      .prepare(
        `SELECT id FROM course_access_grants
         WHERE user_id = ? AND course_id = ? AND revoked_at_ms IS NULL AND ends_at_ms IS NULL AND source = 'batch_course'`,
      )
      .get(userId, cid);
    if (existed) return;
    insertGrant({
      userId,
      courseId: cid,
      source: 'batch_course',
      startsAtMs: accessStartMs,
      endsAtMs: null,
      graceEndsAtMs: null,
      billingPackageId: null,
      batchId: null,
      comboId: null,
      razorpayOrderId: null,
      paymentId: null,
    });
    const ts = new Date(accessStartMs).toISOString();
    upsertApprovedEnrollment(userId, cid, 'apply', ts);
    syncLegacyEnrollmentMirror(userId, cid);
    return;
  }

  if (et !== 'free' && et !== 'purchase') return;

  upsertLifetimeGrant(userId, cid, 'batch_course');
  upsertApprovedEnrollment(userId, cid, et === 'purchase' ? 'purchase' : 'free');
  syncLegacyEnrollmentMirror(userId, cid);
}

/**
 * Apply batch-linked course access for one member: timed grants from per-course subscription packages,
 * or lifetime path for non-subscribe courses without a package.
 */
function syncBatchMemberCourseAccess(batchId, userId) {
  const uid = Number(userId);
  const bid = Number(batchId);
  if (!Number.isFinite(uid) || !Number.isFinite(bid)) return;

  let rows = db
    .prepare(
      `SELECT course_id, billing_package_id FROM batch_courses WHERE batch_id = ? ORDER BY sort_order ASC, id ASC`,
    )
    .all(bid);

  if (!rows.length) {
    const batch = db.prepare('SELECT course_id, subscription_package_id FROM batches WHERE id = ?').get(bid);
    if (batch?.course_id) {
      rows = [{ course_id: batch.course_id, billing_package_id: batch.subscription_package_id }];
    }
  }

  const batchMeta = db
    .prepare(
      `SELECT planned_start_date, actual_start_date, batch_status FROM batches WHERE id = ?`,
    )
    .get(bid);
  const batchStarted = isBatchStartedForAccess(batchMeta);
  const cohortStartMs = batchCohortAccessStartMs(batchMeta);

  db.transaction(() => {
    for (const row of rows) {
      const cid = Number(row.course_id);
      if (!Number.isFinite(cid)) continue;

      db.prepare(
        `DELETE FROM course_access_grants
         WHERE user_id = ? AND batch_id = ? AND course_id = ?
           AND source = 'subscribe_batch' AND revoked_at_ms IS NULL`,
      ).run(uid, bid, cid);

      const course = db.prepare('SELECT enrollment_type FROM courses WHERE id = ?').get(cid);
      if (!course) continue;
      const et = String(course.enrollment_type || '').toLowerCase();
      const isSubscribe = et === 'subscribe';
      const isApply = et === 'apply';

      const pkgId = row.billing_package_id != null ? Number(row.billing_package_id) : null;
      let appliedPkg = false;

      if (pkgId && Number.isFinite(pkgId)) {
        const pkg = db
          .prepare(
            `SELECT * FROM billing_packages WHERE id = ? AND is_active = 1 AND scope = 'course'
             AND package_kind = 'subscription' AND course_id = ?`,
          )
          .get(pkgId, cid);
        if (pkg) {
          if (isSubscribe || isApply) {
            if (batchStarted && cohortStartMs != null) {
              applyPackageGrantsForPayment({
                userId: uid,
                pkg,
                startMs: cohortStartMs,
                source: 'subscribe_batch',
                razorpayOrderId: null,
                paymentId: null,
                batchId: bid,
                comboId: null,
                courseIds: [cid],
                workflowEnrollmentType: isApply ? 'apply' : 'subscribe',
              });
              appliedPkg = true;
            }
          } else {
            applyPackageGrantsForPayment({
              userId: uid,
              pkg,
              startMs: Date.now(),
              source: 'subscribe_batch',
              razorpayOrderId: null,
              paymentId: null,
              batchId: bid,
              comboId: null,
              courseIds: [cid],
              workflowEnrollmentType: et === 'purchase' ? 'purchase' : 'free',
            });
            appliedPkg = true;
          }
        }
      }

      if (!appliedPkg && !isSubscribe) {
        grantNonSubscribeBatchCourseForSingleCourse(uid, cid, {
          batchStarted,
          accessStartMs: cohortStartMs,
        });
      }
    }
  })();
}

function syncAllBatchMembersCourseAccess(batchId) {
  const bid = Number(batchId);
  if (!Number.isFinite(bid)) return;
  const members = db.prepare('SELECT student_id FROM batch_members WHERE batch_id = ?').all(bid);
  for (const m of members) {
    try {
      syncBatchMemberCourseAccess(bid, m.student_id);
    } catch (e) {
      console.error('[syncAllBatchMembersCourseAccess]', bid, m.student_id, e);
    }
  }
}

function upsertLifetimeGrant(userId, courseId, source, options = {}) {
  const now = Date.now();
  const razorpayOrderId = options.razorpayOrderId || null;
  const paymentId = options.paymentId || null;
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
    razorpayOrderId,
    paymentId,
  });
}

module.exports = {
  DAY_MS,
  GRACE_MS,
  packageDurationMs,
  packageAmountPaise,
  learnerHasCourseAccess,
  entitlementFromGrantsOrBatchMembership,
  clearStaleEnrollmentIfNoAccess,
  revokeAccessGrantById,
  removeBatchStudentAccess,
  purgeAllMembersAccessForDeletingBatch,
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
  syncBatchMemberCourseAccess,
  syncAllBatchMembersCourseAccess,
  upsertLifetimeGrant,
  startOfDayFromYmd,
  hasActiveSubscribeWindow,
};
