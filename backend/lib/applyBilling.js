const db = require('../db');
const { syncBatchMemberCourseAccess } = require('./courseAccess');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REGISTRATION_FEE_INR = 999;

function toPaise(inr) {
  return Math.max(0, Math.round(Number(inr || 0) * 100));
}

function formatYmd(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function ymdStartMs(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || '').trim());
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0).getTime();
}

function ymdEndMs(ymd) {
  const start = ymdStartMs(ymd);
  if (!Number.isFinite(start)) return NaN;
  return start + DAY_MS - 1;
}

function addDaysYmd(ymd, days) {
  const start = ymdStartMs(ymd);
  if (!Number.isFinite(start)) return null;
  const next = new Date(start);
  next.setDate(next.getDate() + Number(days || 0));
  return formatYmd(next);
}

function parseJson(raw, fallback) {
  try {
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function stringifyJson(value, fallback = {}) {
  try {
    return JSON.stringify(value == null ? fallback : value);
  } catch {
    return JSON.stringify(fallback);
  }
}

function splitEvenlyPaise(totalPaise, count) {
  const total = Math.max(0, Number(totalPaise || 0));
  const n = Math.max(1, Number(count || 1));
  const base = Math.floor(total / n);
  let remainder = total - (base * n);
  const pieces = [];
  for (let i = 0; i < n; i += 1) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    pieces.push(base + extra);
  }
  return pieces;
}

function parseInstallmentAmountsPaise(raw, expectedCount, totalPaise) {
  const parsed = parseJson(raw, []);
  if (!Array.isArray(parsed)) return null;
  const count = Math.max(1, Number(expectedCount || 1));
  const manualCount = Math.max(0, count - 1);
  if (parsed.length < manualCount) return null;
  const manualAmounts = parsed.slice(0, manualCount).map((x) => toPaise(x));
  const manualTotal = manualAmounts.reduce((acc, amount) => acc + amount, 0);
  const total = Math.max(0, Number(totalPaise || 0));
  if (manualTotal > total) return null;
  return [...manualAmounts, total - manualTotal];
}

function loadApplyCourse(courseId) {
  const row = db.prepare(
    `SELECT
       id, name, enrollment_type, fee_inr, discount_inr, course_status, is_published,
       apply_registration_fee_inr, apply_single_payment_discount_inr,
       apply_installment_count, apply_installment_amounts_json, apply_installment_gap_days,
       apply_grace_days, apply_enquiry_enabled
     FROM courses
     WHERE id = ?`,
  ).get(courseId);
  if (!row) return null;
  return {
    ...row,
    apply_registration_fee_inr:
      row.apply_registration_fee_inr == null ? DEFAULT_REGISTRATION_FEE_INR : Number(row.apply_registration_fee_inr || 0),
    apply_single_payment_discount_inr: Number(row.apply_single_payment_discount_inr || 0),
    apply_installment_count: Math.max(1, Number(row.apply_installment_count || 1)),
    apply_installment_gap_days: Math.max(0, Number(row.apply_installment_gap_days || 0)),
    apply_grace_days: Math.max(0, Number(row.apply_grace_days || 0)),
    apply_enquiry_enabled: Number(row.apply_enquiry_enabled ?? 1) !== 0,
  };
}

function loadApplyBatch(batchId) {
  return db.prepare(
    `SELECT id, title, name, batch_number, planned_start_date, actual_start_date, batch_status, enrollment_open_status
     FROM batches
     WHERE id = ?`,
  ).get(batchId);
}

function batchStartDateForBilling(batch) {
  const actual = String(batch?.actual_start_date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(actual)) return actual;
  const planned = String(batch?.planned_start_date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(planned)) return planned;
  return null;
}

function startedBatchStartDateForBilling(batch) {
  const actual = String(batch?.actual_start_date || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(actual)) return actual;
  if (String(batch?.batch_status || '').toLowerCase() === 'started') {
    const planned = String(batch?.planned_start_date || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(planned)) return planned;
  }
  return batchStartDateForBilling(batch);
}

function batchHasStarted(batch, nowMs = Date.now()) {
  const actual = String(batch?.actual_start_date || '').trim();
  if (actual) return true;
  if (String(batch?.batch_status || '').toLowerCase() === 'started') return true;
  const startDate = batchStartDateForBilling(batch);
  if (!startDate) return false;
  return ymdStartMs(startDate) <= nowMs;
}

function daysUntilBatchStart(batch, nowMs = Date.now()) {
  const startYmd = batchStartDateForBilling(batch);
  if (!startYmd) return null;
  const todayYmd = formatYmd(nowMs);
  const startMs = ymdStartMs(startYmd);
  const todayMs = ymdStartMs(todayYmd);
  if (!Number.isFinite(startMs) || !Number.isFinite(todayMs)) return null;
  return Math.floor((startMs - todayMs) / DAY_MS);
}

function allowedInitialApplyPlans(batch, nowMs = Date.now()) {
  const days = daysUntilBatchStart(batch, nowMs);
  if (days == null || days <= 7) return ['single_payment', 'first_installment'];
  return ['registration', 'single_payment', 'first_installment'];
}

function selectedPlanLabel(plan) {
  const raw = String(plan || '').toLowerCase();
  if (raw === 'registration') return 'Registration fee';
  if (raw === 'single_payment') return 'Single payment';
  if (raw === 'first_installment') return 'First part';
  return raw || 'Apply payment';
}

function dueKindLabel(kind) {
  const raw = String(kind || '').toLowerCase();
  if (raw === 'registration') return 'Registration fee';
  if (raw === 'registration_balance') return 'Remaining balance';
  if (raw === 'single_payment') return 'Single payment';
  if (raw === 'installment') return 'Part payment';
  return raw || 'Due';
}

function partDueDate({ batchStartDate, todayYmd, installmentGapDays, index, batchStarted }) {
  if (!batchStarted) {
    return index === 0 ? batchStartDate || todayYmd : null;
  }
  const base = batchStartDate || todayYmd;
  return addDaysYmd(base, installmentGapDays * index) || base || todayYmd;
}

function computeInitialBillingPlan({ course, batch, selectedPlan, nowMs = Date.now() }) {
  const grossCourseFeePaise = toPaise(course.fee_inr);
  const courseDiscountPaise = Math.min(grossCourseFeePaise, toPaise(course.discount_inr));
  const totalCourseFeePaise = Math.max(0, grossCourseFeePaise - courseDiscountPaise);
  const registrationFeePaise = Math.min(totalCourseFeePaise, toPaise(course.apply_registration_fee_inr));
  const singlePaymentDiscountPaise = Math.min(totalCourseFeePaise, toPaise(course.apply_single_payment_discount_inr));
  const installmentCount = Math.max(1, Number(course.apply_installment_count || 1));
  const installmentGapDays = Math.max(0, Number(course.apply_installment_gap_days || 0));
  const graceDays = Math.max(0, Number(course.apply_grace_days || 0));
  const batchStartDate = startedBatchStartDateForBilling(batch);
  const batchStarted = batchHasStarted(batch, nowMs);
  const todayYmd = formatYmd(nowMs);

  const plan = String(selectedPlan || '').toLowerCase();
  const dues = [];
  let upfrontPaidPaise = 0;

  if (plan === 'registration') {
    const remainingPaise = Math.max(0, totalCourseFeePaise - registrationFeePaise);
    dues.push({
      sequenceNo: 1,
      dueKind: 'registration',
      labelText: 'Registration fee',
      dueDate: todayYmd,
      graceEndDate: addDaysYmd(todayYmd, graceDays),
      amountPaise: registrationFeePaise,
      discountPaise: 0,
      isInitialDue: 1,
      metaJson: stringifyJson({ selectedPlan: plan, grossCourseFeePaise, courseDiscountPaise }),
    });
    dues.push({
      sequenceNo: 2,
      dueKind: 'registration_balance',
      labelText: 'Remaining balance',
      dueDate: batchStartDate || todayYmd,
      graceEndDate: addDaysYmd(batchStartDate || todayYmd, graceDays),
      amountPaise: remainingPaise,
      discountPaise: Math.min(singlePaymentDiscountPaise, remainingPaise),
      isInitialDue: 0,
      metaJson: stringifyJson({ selectedPlan: plan, batchStartDate, grossCourseFeePaise, courseDiscountPaise }),
    });
    upfrontPaidPaise = registrationFeePaise;
  } else if (plan === 'single_payment') {
    const discountedTotal = Math.max(0, totalCourseFeePaise - singlePaymentDiscountPaise);
    dues.push({
      sequenceNo: 1,
      dueKind: 'single_payment',
      labelText: 'Single payment',
      dueDate: todayYmd,
      graceEndDate: addDaysYmd(todayYmd, graceDays),
      amountPaise: discountedTotal,
      discountPaise: 0,
      isInitialDue: 1,
      metaJson: stringifyJson({
        selectedPlan: plan,
        grossCourseFeePaise,
        courseDiscountPaise,
        netCourseFeePaise: totalCourseFeePaise,
      }),
    });
    upfrontPaidPaise = discountedTotal;
  } else if (plan === 'first_installment') {
    const pieces =
      parseInstallmentAmountsPaise(course.apply_installment_amounts_json, installmentCount, totalCourseFeePaise) ||
      splitEvenlyPaise(totalCourseFeePaise, installmentCount);
    for (let index = 0; index < pieces.length; index += 1) {
      const dueDate = partDueDate({ batchStartDate, todayYmd, installmentGapDays, index, batchStarted });
      const dueOffsetDays = installmentGapDays * index;
      dues.push({
        sequenceNo: index + 1,
        dueKind: 'installment',
        labelText: `Part ${index + 1}`,
        dueDate,
        graceEndDate: dueDate ? addDaysYmd(dueDate, graceDays) : null,
        amountPaise: pieces[index],
        discountPaise: 0,
        isInitialDue: index === 0 ? 1 : 0,
        metaJson: stringifyJson({
          selectedPlan: plan,
          installmentIndex: index + 1,
          installmentCount: pieces.length,
          grossCourseFeePaise,
          courseDiscountPaise,
          netCourseFeePaise: totalCourseFeePaise,
          batchStarted,
          batchStartDate,
          dueOffsetDays,
        }),
      });
    }
    upfrontPaidPaise = dues[0]?.amountPaise || 0;
  } else {
    throw new Error('Invalid apply payment plan');
  }

  const remainingBalancePaise = dues
    .filter((due) => !due.isInitialDue)
    .reduce((sum, due) => sum + Number(due.amountPaise || 0), 0);

  return {
    totalCourseFeePaise,
    registrationFeePaise,
    singlePaymentDiscountPaise,
    installmentCount,
    installmentGapDays,
    graceDays,
    batchStartDate,
    upfrontPaidPaise,
    remainingBalancePaise,
    dues,
  };
}

function dueAmountToCollectNow(dueRow, paidAtIso = new Date().toISOString()) {
  if (!dueRow) return 0;
  if (String(dueRow.due_status || '').toLowerCase() === 'paid') return 0;
  const baseAmount = Math.max(0, Number(dueRow.amount_paise || dueRow.amountPaise || 0));
  const discountPaise = Math.max(0, Number(dueRow.discount_paise || dueRow.discountPaise || 0));
  const paidAmount = Math.max(0, Number(dueRow.paid_amount_paise || dueRow.paidAmountPaise || 0));
  const dueKind = String(dueRow.due_kind || dueRow.dueKind || '').toLowerCase();
  const dueDate = String(dueRow.due_date || dueRow.dueDate || '').trim();
  let collectiblePaise = baseAmount;
  if (dueKind === 'registration_balance' && discountPaise > 0 && dueDate) {
    const dueEnd = ymdEndMs(dueDate);
    const paidAtMs = new Date(paidAtIso).getTime();
    if (Number.isFinite(dueEnd) && Number.isFinite(paidAtMs) && paidAtMs <= dueEnd) {
      collectiblePaise = Math.max(0, baseAmount - discountPaise);
    }
  }
  return Math.max(0, collectiblePaise - paidAmount);
}

function dueCollectionState(row, nowMs = Date.now()) {
  const stored = String(row.due_status || '').toLowerCase();
  if (stored === 'paid' || stored === 'cancelled') return stored;
  const graceEnd = String(row.grace_end_date || '').trim();
  const dueDate = String(row.due_date || '').trim();
  const graceEndMs = ymdEndMs(graceEnd);
  const dueEndMs = ymdEndMs(dueDate);
  if (Number.isFinite(graceEndMs) && nowMs > graceEndMs) return 'overdue';
  if (Number.isFinite(dueEndMs) && nowMs > dueEndMs) return 'grace';
  return 'scheduled';
}

function serializeDueItem(row, nowMs = Date.now()) {
  const amountDueNowPaise = dueAmountToCollectNow(row);
  return {
    id: row.id,
    billingProfileId: row.billing_profile_id,
    sequenceNo: Number(row.sequence_no || 0),
    dueKind: row.due_kind,
    dueLabel: row.label_text || dueKindLabel(row.due_kind),
    dueDate: row.due_date || null,
    graceEndDate: row.grace_end_date || null,
    amountPaise: Number(row.amount_paise || 0),
    amountInr: Number(row.amount_paise || 0) / 100,
    discountPaise: Number(row.discount_paise || 0),
    discountInr: Number(row.discount_paise || 0) / 100,
    amountDueNowPaise,
    amountDueNowInr: amountDueNowPaise / 100,
    paidAmountPaise: Number(row.paid_amount_paise || 0),
    paidAmountInr: Number(row.paid_amount_paise || 0) / 100,
    dueStatus: dueCollectionState(row, nowMs),
    storedDueStatus: row.due_status,
    satisfiedAt: row.satisfied_at || null,
    isInitialDue: Number(row.is_initial_due || 0) === 1,
    meta: parseJson(row.meta_json, {}),
  };
}

function blockingApplyProfile(userId, courseId) {
  return db.prepare(
    `SELECT *
     FROM apply_course_billing_profiles
     WHERE user_id = ? AND course_id = ?
       AND status IN ('awaiting_initial_payment','pending_approval','approved_pending_access','active')
     ORDER BY id DESC
     LIMIT 1`,
  ).get(userId, courseId);
}

function cancelPendingDraftProfiles(userId, courseId) {
  db.prepare(
    `UPDATE apply_course_billing_profiles
     SET status = 'cancelled', updated_at = datetime('now')
     WHERE user_id = ? AND course_id = ? AND status = 'awaiting_initial_payment'
       AND id NOT IN (
         SELECT ap.id
         FROM apply_course_billing_profiles ap
         JOIN apply_course_due_items di ON di.billing_profile_id = ap.id
         WHERE ap.user_id = ? AND ap.course_id = ? AND COALESCE(di.paid_amount_paise, 0) > 0
       )`,
  ).run(userId, courseId, userId, courseId);
}

function dueRowsForProfile(profileId) {
  return db.prepare(
    `SELECT *
     FROM apply_course_due_items
     WHERE billing_profile_id = ?
     ORDER BY sequence_no ASC, id ASC`,
  ).all(profileId);
}

function initialDueRowForProfile(profileId) {
  return db.prepare(
    `SELECT *
     FROM apply_course_due_items
     WHERE billing_profile_id = ? AND is_initial_due = 1
     ORDER BY id ASC
     LIMIT 1`,
  ).get(profileId);
}

function loadProfileById(profileId) {
  return db.prepare(
    `SELECT ap.*,
            c.name AS course_name,
            ce.status AS enrollment_status,
            b.title AS batch_title,
            b.name AS batch_name,
            b.batch_number,
            b.planned_start_date,
            b.actual_start_date,
            b.batch_status
     FROM apply_course_billing_profiles ap
     JOIN courses c ON c.id = ap.course_id
     JOIN batches b ON b.id = ap.batch_id
     LEFT JOIN course_enrollments ce ON ce.id = ap.enrollment_id
     WHERE ap.id = ?`,
  ).get(profileId);
}

function recomputeProfileStatus(profileId) {
  const profile = loadProfileById(profileId);
  if (!profile) return null;
  if (String(profile.status || '') === 'removed_overdue') return profile;
  if (String(profile.status || '') === 'cancelled') return profile;

  const dues = dueRowsForProfile(profileId);
  const initialPaid = dues.some((due) => Number(due.is_initial_due || 0) === 1 && String(due.due_status || '').toLowerCase() === 'paid');
  const remainingBalancePaise = dues
    .filter((due) => String(due.due_status || '').toLowerCase() !== 'paid' && String(due.due_status || '').toLowerCase() !== 'cancelled')
    .reduce((sum, due) => sum + dueAmountToCollectNow(due), 0);
  const initialPaidAmountPaise = dues
    .filter((due) => Number(due.is_initial_due || 0) === 1 && String(due.due_status || '').toLowerCase() === 'paid')
    .reduce((sum, due) => sum + Number(due.paid_amount_paise || 0), 0);

  let nextStatus = profile.status;
  if (!initialPaid) {
    nextStatus = 'awaiting_initial_payment';
  } else if (String(profile.enrollment_status || '').toLowerCase() === 'rejected') {
    nextStatus = 'rejected';
  } else if (String(profile.enrollment_status || '').toLowerCase() === 'approved') {
    nextStatus = batchHasStarted(profile) ? 'active' : 'approved_pending_access';
  } else {
    nextStatus = 'pending_approval';
  }

  db.prepare(
    `UPDATE apply_course_billing_profiles
     SET status = ?, upfront_paid_paise = ?, remaining_balance_paise = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(nextStatus, initialPaidAmountPaise, remainingBalancePaise, profileId);
  return loadProfileById(profileId);
}

function ensurePendingApplyEnrollment({ userId, courseId, batchId }) {
  const nowIso = new Date().toISOString();
  const existing = db.prepare(
    'SELECT id FROM course_enrollments WHERE user_id = ? AND course_id = ?',
  ).get(userId, courseId);
  if (!existing) {
    const result = db.prepare(
      `INSERT INTO course_enrollments (user_id, course_id, enrollment_type, status, requested_at, approved_at, approved_by, notes, batch_id)
       VALUES (?, ?, 'apply', 'approved', ?, ?, NULL, NULL, ?)`,
    ).run(userId, courseId, nowIso, nowIso, batchId);
    db.prepare('INSERT OR IGNORE INTO batch_members (batch_id, student_id) VALUES (?, ?)').run(batchId, userId);
    try {
      syncBatchMemberCourseAccess(batchId, userId);
    } catch (error) {
      console.error('[apply-billing] sync batch access after initial payment', batchId, userId, error);
    }
    return Number(result.lastInsertRowid);
  }
  db.prepare(
    `UPDATE course_enrollments
     SET enrollment_type = 'apply', status = 'approved', requested_at = ?, approved_at = ?, approved_by = NULL, notes = NULL, batch_id = ?
     WHERE id = ?`,
  ).run(nowIso, nowIso, batchId, existing.id);
  db.prepare('INSERT OR IGNORE INTO batch_members (batch_id, student_id) VALUES (?, ?)').run(batchId, userId);
  try {
    syncBatchMemberCourseAccess(batchId, userId);
  } catch (error) {
    console.error('[apply-billing] sync batch access after initial payment', batchId, userId, error);
  }
  return Number(existing.id);
}

function createOrReuseInitialProfile({ userId, course, batch, selectedPlan, nowMs = Date.now() }) {
  const blocking = blockingApplyProfile(userId, course.id);
  if (blocking) {
    if (
      blocking.status === 'awaiting_initial_payment' &&
      Number(blocking.batch_id) === Number(batch.id) &&
      String(blocking.selected_plan || '') === String(selectedPlan || '')
    ) {
      return {
        profile: loadProfileById(blocking.id),
        initialDue: initialDueRowForProfile(blocking.id),
        reused: true,
      };
    }
    throw new Error('An apply payment flow is already active for this course.');
  }

  cancelPendingDraftProfiles(userId, course.id);

  const plan = computeInitialBillingPlan({ course, batch, selectedPlan, nowMs });
  const tx = db.transaction(() => {
    const inserted = db.prepare(
      `INSERT INTO apply_course_billing_profiles (
        user_id, course_id, batch_id, enrollment_id, selected_plan, status,
        total_course_fee_paise, registration_fee_paise, single_payment_discount_paise,
        upfront_paid_paise, remaining_balance_paise,
        installment_count, installment_gap_days, grace_days, batch_start_date,
        initial_due_item_id, created_at, updated_at
      ) VALUES (?, ?, ?, NULL, ?, 'awaiting_initial_payment', ?, ?, ?, 0, ?, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'))`,
    ).run(
      userId,
      course.id,
      batch.id,
      selectedPlan,
      plan.totalCourseFeePaise,
      plan.registrationFeePaise,
      plan.singlePaymentDiscountPaise,
      plan.remainingBalancePaise,
      plan.installmentCount,
      plan.installmentGapDays,
      plan.graceDays,
      plan.batchStartDate,
    );
    const profileId = Number(inserted.lastInsertRowid);
    const insertDue = db.prepare(
      `INSERT INTO apply_course_due_items (
        billing_profile_id, sequence_no, due_kind, label_text, due_date, grace_end_date,
        amount_paise, discount_paise, paid_amount_paise, due_status, satisfied_at,
        is_initial_due, meta_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'scheduled', NULL, ?, ?, datetime('now'), datetime('now'))`,
    );
    let initialDueId = null;
    for (const due of plan.dues) {
      const result = insertDue.run(
        profileId,
        due.sequenceNo,
        due.dueKind,
        due.labelText,
        due.dueDate,
        due.graceEndDate,
        due.amountPaise,
        due.discountPaise,
        due.isInitialDue,
        due.metaJson,
      );
      if (due.isInitialDue && initialDueId == null) {
        initialDueId = Number(result.lastInsertRowid);
      }
    }
    if (initialDueId != null) {
      db.prepare(
        'UPDATE apply_course_billing_profiles SET initial_due_item_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
      ).run(initialDueId, profileId);
    }
    return {
      profile: loadProfileById(profileId),
      initialDue: initialDueRowForProfile(profileId),
      reused: false,
    };
  });
  return tx();
}

function settleDueItem({ dueItemId, amountPaise, paidAtIso = new Date().toISOString(), sourceMeta = {} }) {
  const due = db.prepare(
    `SELECT di.*, ap.user_id, ap.course_id, ap.batch_id, ap.enrollment_id, ap.status AS billing_status
     FROM apply_course_due_items di
     JOIN apply_course_billing_profiles ap ON ap.id = di.billing_profile_id
     WHERE di.id = ?`,
  ).get(dueItemId);
  if (!due) throw new Error('Due item not found');
  if (String(due.due_status || '').toLowerCase() === 'paid') {
    return {
      due: db.prepare('SELECT * FROM apply_course_due_items WHERE id = ?').get(dueItemId),
      profile: recomputeProfileStatus(due.billing_profile_id),
      enrollmentId: due.enrollment_id || null,
      duplicate: true,
    };
  }

  const outstandingPaise = dueAmountToCollectNow(due, paidAtIso);
  const collectedPaise = Math.max(0, Number(amountPaise || 0));
  if (collectedPaise < 1 || collectedPaise > outstandingPaise) {
    throw new Error(`Expected up to Rs. ${(outstandingPaise / 100).toFixed(2)} for this due item.`);
  }

  const tx = db.transaction(() => {
    const meta = parseJson(due.meta_json, {});
    const nextPaidAmountPaise = Math.min(
      Number(due.amount_paise || 0),
      Number(due.paid_amount_paise || 0) + collectedPaise,
    );
    const fullyPaid = collectedPaise >= outstandingPaise;
    const nextMeta = {
      ...meta,
      settledAt: paidAtIso,
      collectedAmountPaise: collectedPaise,
      sourceMeta,
    };
    db.prepare(
      `UPDATE apply_course_due_items
       SET paid_amount_paise = ?, due_status = ?, satisfied_at = ?, meta_json = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(nextPaidAmountPaise, fullyPaid ? 'paid' : 'scheduled', fullyPaid ? paidAtIso : null, stringifyJson(nextMeta), dueItemId);

    let enrollmentId = due.enrollment_id ? Number(due.enrollment_id) : null;
    if (Number(due.is_initial_due || 0) === 1 && !enrollmentId) {
      enrollmentId = ensurePendingApplyEnrollment({
        userId: due.user_id,
        courseId: due.course_id,
        batchId: due.batch_id,
      });
      db.prepare(
        'UPDATE apply_course_billing_profiles SET enrollment_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
      ).run(enrollmentId, due.billing_profile_id);
    }

    const profile = recomputeProfileStatus(due.billing_profile_id);
    return {
      due: db.prepare('SELECT * FROM apply_course_due_items WHERE id = ?').get(dueItemId),
      profile,
      enrollmentId,
      duplicate: false,
    };
  });
  return tx();
}

function markBillingApprovedForEnrollment(enrollmentId) {
  db.prepare(
    `UPDATE apply_course_billing_profiles
     SET enrollment_id = COALESCE(enrollment_id, ?), updated_at = datetime('now')
     WHERE enrollment_id = ? OR (
       enrollment_id IS NULL AND EXISTS (
         SELECT 1
         FROM course_enrollments ce
         WHERE ce.id = ?
           AND ce.user_id = apply_course_billing_profiles.user_id
           AND ce.course_id = apply_course_billing_profiles.course_id
           AND ce.batch_id = apply_course_billing_profiles.batch_id
       )
     )`,
  ).run(enrollmentId, enrollmentId, enrollmentId);
  const profile = db.prepare(
    'SELECT id FROM apply_course_billing_profiles WHERE enrollment_id = ? ORDER BY id DESC LIMIT 1',
  ).get(enrollmentId);
  if (profile?.id) recomputeProfileStatus(profile.id);
}

function markBillingRejectedForEnrollment(enrollmentId) {
  db.prepare(
    `UPDATE apply_course_billing_profiles
     SET status = 'rejected', updated_at = datetime('now')
     WHERE enrollment_id = ?`,
  ).run(enrollmentId);
}

function markBillingRemovedOverdue(profileId) {
  db.prepare(
    `UPDATE apply_course_billing_profiles
     SET status = 'removed_overdue', updated_at = datetime('now')
     WHERE id = ?`,
  ).run(profileId);
}

function loadDueItemWithProfile(dueItemId) {
  return db.prepare(
    `SELECT di.*,
            ap.user_id, ap.course_id, ap.batch_id, ap.enrollment_id, ap.selected_plan, ap.status AS billing_status,
            c.name AS course_name,
            b.title AS batch_title,
            b.name AS batch_name,
            b.batch_number,
            u.name AS user_name,
            u.email AS user_email,
            u.mobile_number AS user_mobile
     FROM apply_course_due_items di
     JOIN apply_course_billing_profiles ap ON ap.id = di.billing_profile_id
     JOIN courses c ON c.id = ap.course_id
     JOIN batches b ON b.id = ap.batch_id
     JOIN users u ON u.id = ap.user_id
     WHERE di.id = ?`,
  ).get(dueItemId);
}

function serializeProfileRow(row, nowMs = Date.now()) {
  const dues = dueRowsForProfile(row.id).map((due) => serializeDueItem(due, nowMs));
  const nextUnpaidDue = dues.find((due) => due.dueStatus !== 'paid' && due.dueStatus !== 'cancelled') || null;
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    courseName: row.course_name,
    batchId: row.batch_id,
    batchTitle: row.batch_title || row.batch_name || null,
    batchNumber: row.batch_number || null,
    enrollmentId: row.enrollment_id || null,
    enrollmentStatus: row.enrollment_status || null,
    selectedPlan: row.selected_plan,
    selectedPlanLabel: selectedPlanLabel(row.selected_plan),
    status: row.status,
    totalCourseFeePaise: Number(row.total_course_fee_paise || 0),
    totalCourseFeeInr: Number(row.total_course_fee_paise || 0) / 100,
    registrationFeePaise: Number(row.registration_fee_paise || 0),
    registrationFeeInr: Number(row.registration_fee_paise || 0) / 100,
    singlePaymentDiscountPaise: Number(row.single_payment_discount_paise || 0),
    singlePaymentDiscountInr: Number(row.single_payment_discount_paise || 0) / 100,
    upfrontPaidPaise: Number(row.upfront_paid_paise || 0),
    upfrontPaidInr: Number(row.upfront_paid_paise || 0) / 100,
    remainingBalancePaise: Number(row.remaining_balance_paise || 0),
    remainingBalanceInr: Number(row.remaining_balance_paise || 0) / 100,
    installmentCount: Number(row.installment_count || 1),
    installmentGapDays: Number(row.installment_gap_days || 0),
    graceDays: Number(row.grace_days || 0),
    batchStartDate: row.batch_start_date || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    dueItems: dues,
    nextUnpaidDue,
  };
}

function listApplyBillingProfilesForUser(userId) {
  const rows = db.prepare(
    `SELECT ap.*,
            c.name AS course_name,
            ce.status AS enrollment_status,
            b.title AS batch_title,
            b.name AS batch_name,
            b.batch_number,
            b.planned_start_date,
            b.actual_start_date,
            b.batch_status
     FROM apply_course_billing_profiles ap
     JOIN courses c ON c.id = ap.course_id
     JOIN batches b ON b.id = ap.batch_id
     LEFT JOIN course_enrollments ce ON ce.id = ap.enrollment_id
     WHERE ap.user_id = ? AND ap.status != 'cancelled'
     ORDER BY ap.id DESC`,
  ).all(userId);
  return rows.map((row) => serializeProfileRow(recomputeProfileStatus(row.id) || row));
}

function listApplyBillingProfilesForAdmin({ search = '', status = '' } = {}) {
  const like = `%${String(search || '').trim()}%`;
  const desiredStatus = String(status || '').trim().toLowerCase();
  const rows = db.prepare(
    `SELECT ap.*,
            c.name AS course_name,
            ce.status AS enrollment_status,
            b.title AS batch_title,
            b.name AS batch_name,
            b.batch_number,
            b.planned_start_date,
            b.actual_start_date,
            b.batch_status,
            u.name AS user_name,
            u.email AS user_email
     FROM apply_course_billing_profiles ap
     JOIN courses c ON c.id = ap.course_id
     JOIN batches b ON b.id = ap.batch_id
     JOIN users u ON u.id = ap.user_id
     LEFT JOIN course_enrollments ce ON ce.id = ap.enrollment_id
     WHERE ap.status != 'cancelled'
       AND (? = '' OR LOWER(ap.status) = ?)
       AND (
         ? = '%%'
         OR COALESCE(u.name, '') LIKE ?
         OR COALESCE(u.email, '') LIKE ?
         OR COALESCE(c.name, '') LIKE ?
         OR COALESCE(b.title, b.name, '') LIKE ?
       )
     ORDER BY ap.id DESC`,
  ).all(desiredStatus, desiredStatus, like, like, like, like, like);
  return rows.map((row) => ({
    ...serializeProfileRow(recomputeProfileStatus(row.id) || row),
    userName: row.user_name || '',
    userEmail: row.user_email || '',
  }));
}

function paidAmountForProfile(profileId) {
  const row = db.prepare(
    `SELECT COALESCE(SUM(paid_amount_paise), 0) AS paid
     FROM apply_course_due_items
     WHERE billing_profile_id = ? AND due_status != 'cancelled'`,
  ).get(profileId);
  return Number(row?.paid || 0);
}

function firstPartHasPayment(profileId) {
  const row = db.prepare(
    `SELECT 1
     FROM apply_course_due_items
     WHERE billing_profile_id = ?
       AND due_kind = 'installment'
       AND sequence_no = 1
       AND paid_amount_paise > 0
     LIMIT 1`,
  ).get(profileId);
  return !!row;
}

function outstandingGrossForProfile(profileId) {
  const dues = dueRowsForProfile(profileId).filter(
    (due) => String(due.due_status || '').toLowerCase() !== 'paid' && String(due.due_status || '').toLowerCase() !== 'cancelled',
  );
  return dues.reduce(
    (sum, due) => sum + Math.max(0, Number(due.amount_paise || 0) - Number(due.paid_amount_paise || 0)),
    0,
  );
}

function cancelUnpaidBalanceDues(profileId) {
  db.prepare(
    `UPDATE apply_course_due_items
     SET due_status = 'cancelled', updated_at = datetime('now')
     WHERE billing_profile_id = ?
       AND is_initial_due = 0
       AND due_status != 'paid'`,
  ).run(profileId);
}

function nextSequenceNo(profileId) {
  const row = db.prepare(
    'SELECT COALESCE(MAX(sequence_no), 0) AS max_sequence FROM apply_course_due_items WHERE billing_profile_id = ?',
  ).get(profileId);
  return Number(row?.max_sequence || 0) + 1;
}

function insertDueItem(profileId, due) {
  const result = db.prepare(
    `INSERT INTO apply_course_due_items (
      billing_profile_id, sequence_no, due_kind, label_text, due_date, grace_end_date,
      amount_paise, discount_paise, paid_amount_paise, due_status, satisfied_at,
      is_initial_due, meta_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'scheduled', NULL, ?, ?, datetime('now'), datetime('now'))`,
  ).run(
    profileId,
    due.sequenceNo,
    due.dueKind,
    due.labelText,
    due.dueDate,
    due.graceEndDate,
    due.amountPaise,
    due.discountPaise || 0,
    due.isInitialDue ? 1 : 0,
    due.metaJson || stringifyJson({}),
  );
  return Number(result.lastInsertRowid);
}

function fullPartPiecesForProfile(profile, course) {
  const count = Math.max(1, Number(profile.installment_count || course.apply_installment_count || 1));
  return (
    parseInstallmentAmountsPaise(course.apply_installment_amounts_json, count, Number(profile.total_course_fee_paise || 0)) ||
    splitEvenlyPaise(Number(profile.total_course_fee_paise || 0), count)
  );
}

function remainingPartPiecesAfterCredit(pieces, creditPaise) {
  let credit = Math.max(0, Number(creditPaise || 0));
  const remaining = [];
  for (let index = 0; index < pieces.length; index += 1) {
    const amount = pieces[index];
    const partAmount = Math.max(0, Number(amount || 0));
    const applied = Math.min(partAmount, credit);
    credit -= applied;
    const left = partAmount - applied;
    if (left > 0) remaining.push({ amountPaise: left, originalIndex: index });
  }
  return remaining;
}

function normalizeManualPartSchedule(rawParts, outstandingPaise, graceDays) {
  const parts = Array.isArray(rawParts) ? rawParts : [];
  if (parts.length < 1) throw new Error('At least one part is required');
  const normalized = parts.map((part, index) => {
    const amountPaise =
      part?.amountPaise != null
        ? Math.round(Number(part.amountPaise))
        : part?.amountInr != null
          ? toPaise(part.amountInr)
          : NaN;
    const dueDate = String(part?.dueDate || '').trim();
    if (!Number.isFinite(amountPaise) || amountPaise < 1) {
      throw new Error(`Part ${index + 1} amount is invalid`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      throw new Error(`Part ${index + 1} due date is invalid`);
    }
    return {
      sequenceNo: index + 1,
      dueKind: 'installment',
      labelText: `Part ${index + 1}`,
      dueDate,
      graceEndDate: addDaysYmd(dueDate, graceDays),
      amountPaise,
      discountPaise: 0,
      isInitialDue: 0,
      metaJson: stringifyJson({ manualSchedule: true, partIndex: index + 1, partCount: parts.length }),
    };
  });
  const total = normalized.reduce((sum, part) => sum + part.amountPaise, 0);
  if (total !== Number(outstandingPaise)) {
    throw new Error(`Parts must total Rs. ${(Number(outstandingPaise) / 100).toFixed(2)}`);
  }
  return normalized;
}

function ensureDueDatesNotBeforeStart(parts, batchStartDate) {
  if (!batchStartDate) return;
  for (const part of parts) {
    if (part.dueDate && ymdStartMs(part.dueDate) < ymdStartMs(batchStartDate)) {
      throw new Error('Part due dates cannot be before the batch start date');
    }
  }
}

function prepareFullRemainingDue(profileId) {
  const profile = loadProfileById(profileId);
  if (!profile) throw new Error('Apply billing profile not found');
  const outstandingPaise = outstandingGrossForProfile(profileId);
  if (outstandingPaise < 1) throw new Error('No remaining balance to pay');
  const batchStartDate = startedBatchStartDateForBilling(profile);
  const dueDate = batchStartDate || formatYmd(Date.now());
  const canUseSingleDiscount = !firstPartHasPayment(profileId);
  const discountPaise = canUseSingleDiscount
    ? Math.min(outstandingPaise, Number(profile.single_payment_discount_paise || 0))
    : 0;
  const tx = db.transaction(() => {
    cancelUnpaidBalanceDues(profileId);
    const dueId = insertDueItem(profileId, {
      sequenceNo: nextSequenceNo(profileId),
      dueKind: 'registration_balance',
      labelText: 'Remaining balance',
      dueDate,
      graceEndDate: addDaysYmd(dueDate, Number(profile.grace_days || 0)),
      amountPaise: outstandingPaise,
      discountPaise,
      isInitialDue: 0,
      metaJson: stringifyJson({
        convertedToFullBalance: true,
        singlePaymentDiscountApplied: discountPaise > 0,
      }),
    });
    recomputeProfileStatus(profileId);
    return {
      profile: loadProfileById(profileId),
      due: db.prepare('SELECT * FROM apply_course_due_items WHERE id = ?').get(dueId),
    };
  });
  return tx();
}

function preparePartSchedule(profileId, { parts = null, requireStartedBatch = false } = {}) {
  const profile = loadProfileById(profileId);
  if (!profile) throw new Error('Apply billing profile not found');
  if (requireStartedBatch && !batchHasStarted(profile)) {
    throw new Error('Part schedules can be edited after the batch has started');
  }
  const outstandingPaise = outstandingGrossForProfile(profileId);
  if (outstandingPaise < 1) throw new Error('No remaining balance to schedule');
  const batchStartDate = startedBatchStartDateForBilling(profile);
  const course = loadApplyCourse(profile.course_id);
  if (!course) throw new Error('Course not found');
  const graceDays = Number(profile.grace_days || course.apply_grace_days || 0);
  let nextParts;
  if (parts) {
    nextParts = normalizeManualPartSchedule(parts, outstandingPaise, graceDays);
    ensureDueDatesNotBeforeStart(nextParts, batchStartDate);
  } else {
    const paidCredit = paidAmountForProfile(profileId);
    const pieces = remainingPartPiecesAfterCredit(fullPartPiecesForProfile(profile, course), paidCredit);
    const fallbackPieces = pieces.length ? pieces : [{ amountPaise: outstandingPaise, originalIndex: 0 }];
    const startSequence = nextSequenceNo(profileId);
    nextParts = fallbackPieces.map((piece, index) => {
      const dueIndex = Number(piece.originalIndex || 0) + 1;
      const offsetDays = Number(profile.installment_gap_days || 0) * Number(piece.originalIndex || 0);
      const dueDate = batchHasStarted(profile)
        ? addDaysYmd(batchStartDate || formatYmd(Date.now()), offsetDays)
        : dueIndex === 1
          ? batchStartDate || formatYmd(Date.now())
          : null;
      return {
        sequenceNo: startSequence + index,
        dueKind: 'installment',
        labelText: `Part ${dueIndex}`,
        dueDate,
        graceEndDate: dueDate ? addDaysYmd(dueDate, graceDays) : null,
        amountPaise: Number(piece.amountPaise || 0),
        discountPaise: 0,
        isInitialDue: 0,
        metaJson: stringifyJson({
          convertedToParts: true,
          partIndex: dueIndex,
          partCount: fallbackPieces.length,
          batchStarted: batchHasStarted(profile),
          batchStartDate,
          dueOffsetDays: offsetDays,
        }),
      };
    });
  }

  const tx = db.transaction(() => {
    cancelUnpaidBalanceDues(profileId);
    const manualStartSequence = nextSequenceNo(profileId);
    const insertedIds = nextParts.map((part, index) =>
      insertDueItem(profileId, {
        ...part,
        sequenceNo: parts ? manualStartSequence + index : part.sequenceNo,
      }),
    );
    recomputeProfileStatus(profileId);
    return {
      profile: loadProfileById(profileId),
      dueItems: insertedIds.map((id) => db.prepare('SELECT * FROM apply_course_due_items WHERE id = ?').get(id)),
    };
  });
  return tx();
}

function createApplyEnquiry({
  userId,
  courseId,
  batchId,
  noteText,
  displayName,
  phoneCountryCode,
  phoneLocal,
  callbackDate,
  callbackSlot,
}) {
  const result = db.prepare(
    `INSERT INTO apply_course_enquiries (
       user_id, course_id, batch_id, note_text, status,
       display_name, phone_country_code, phone_local, callback_date, callback_slot,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
  ).run(
    userId,
    courseId,
    batchId == null ? null : batchId,
    noteText || null,
    displayName || null,
    phoneCountryCode || null,
    phoneLocal || null,
    callbackDate || null,
    callbackSlot || null,
  );
  return Number(result.lastInsertRowid);
}

function listApplyEnquiriesForAdmin({ search } = {}) {
  const q = String(search || '').trim();
  const like = `%${q}%`;
  return db
    .prepare(
      `SELECT
         e.id, e.user_id, e.course_id, e.batch_id, e.note_text, e.status,
         e.display_name, e.phone_country_code, e.phone_local, e.callback_date, e.callback_slot,
         e.created_at, e.updated_at,
         u.email AS user_email, u.name AS user_account_name, u.mobile_number AS user_mobile,
         c.name AS course_name,
         b.name AS batch_name, b.title AS batch_title, b.batch_number
       FROM apply_course_enquiries e
       JOIN users u ON u.id = e.user_id
       JOIN courses c ON c.id = e.course_id
       LEFT JOIN batches b ON b.id = e.batch_id
       WHERE ? = ''
         OR COALESCE(e.display_name, '') LIKE ?
         OR COALESCE(u.email, '') LIKE ?
         OR COALESCE(u.name, '') LIKE ?
         OR COALESCE(u.mobile_number, '') LIKE ?
         OR COALESCE(c.name, '') LIKE ?
         OR COALESCE(e.callback_date, '') LIKE ?
         OR COALESCE(e.callback_slot, '') LIKE ?
       ORDER BY e.id DESC
       LIMIT 500`,
    )
    .all(q, like, like, like, like, like, like, like);
}

function updateApplyEnquiryStatus(enquiryId, status) {
  const s = String(status || '').toLowerCase();
  if (!['open', 'contacted', 'closed'].includes(s)) return { ok: false, error: 'Invalid status' };
  const info = db.prepare('SELECT id FROM apply_course_enquiries WHERE id = ?').get(enquiryId);
  if (!info) return { ok: false, error: 'Not found' };
  db.prepare(`UPDATE apply_course_enquiries SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(s, enquiryId);
  return { ok: true };
}

function listOverdueDueItems(nowMs = Date.now()) {
  const todayYmd = formatYmd(nowMs);
  return db.prepare(
    `SELECT di.*,
            ap.user_id, ap.course_id, ap.batch_id, ap.enrollment_id, ap.status AS billing_status
     FROM apply_course_due_items di
     JOIN apply_course_billing_profiles ap ON ap.id = di.billing_profile_id
     WHERE di.due_status IN ('scheduled','overdue')
       AND di.grace_end_date IS NOT NULL
       AND di.grace_end_date < ?`,
  ).all(todayYmd);
}

module.exports = {
  DEFAULT_REGISTRATION_FEE_INR,
  addDaysYmd,
  allowedInitialApplyPlans,
  batchHasStarted,
  batchStartDateForBilling,
  blockingApplyProfile,
  computeInitialBillingPlan,
  createApplyEnquiry,
  createOrReuseInitialProfile,
  dueAmountToCollectNow,
  dueCollectionState,
  dueKindLabel,
  initialDueRowForProfile,
  listApplyBillingProfilesForAdmin,
  listApplyBillingProfilesForUser,
  listApplyEnquiriesForAdmin,
  listOverdueDueItems,
  loadApplyBatch,
  loadApplyCourse,
  loadDueItemWithProfile,
  markBillingApprovedForEnrollment,
  markBillingRejectedForEnrollment,
  markBillingRemovedOverdue,
  prepareFullRemainingDue,
  preparePartSchedule,
  recomputeProfileStatus,
  selectedPlanLabel,
  serializeDueItem,
  settleDueItem,
  toPaise,
  updateApplyEnquiryStatus,
};
