/**
 * Admin-recorded offline payments (cash, bank transfer, UPI, other).
 * Recording a payment never grants, changes or revokes course access.
 * Apply-course students with an open billing plan are paid through that plan's dues, not through here.
 */
const db = require('../db');
const { addDaysYmd, academyToday } = require('./academyDate');
const { dueAmountToCollectNow } = require('./applyBilling');
const { ensurePaymentLedgerForManualEntry, listPaymentRecordsForUser } = require('./paymentRecords');

const PAYMENT_METHODS = ['cash', 'bank_transfer', 'upi', 'other'];
const OPEN_PLAN_STATUSES = ['awaiting_initial_payment', 'pending_approval', 'approved_pending_access', 'active'];

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function loadStudent(userId) {
  const user = db
    .prepare("SELECT id, name, email, role FROM users WHERE id = ? AND role IN ('Student','Lab')")
    .get(userId);
  if (!user) throw fail('Student not found', 404);
  return user;
}

function loadCourse(courseId) {
  const course = db.prepare('SELECT id, name, enrollment_type, fee_inr, discount_inr FROM courses WHERE id = ?').get(courseId);
  if (!course) throw fail('Course not found', 404);
  return course;
}

function latestPlan(userId, courseId) {
  return db
    .prepare(
      `SELECT * FROM apply_course_billing_profiles
       WHERE user_id = ? AND course_id = ? AND status != 'cancelled'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(userId, courseId);
}

function planOutstandingPaise(profileId) {
  return db
    .prepare(
      `SELECT * FROM apply_course_due_items
       WHERE billing_profile_id = ? AND due_status NOT IN ('paid','cancelled')`,
    )
    .all(profileId)
    .reduce((sum, due) => sum + dueAmountToCollectNow(due), 0);
}

function getAccount(userId, courseId) {
  const course = loadCourse(courseId);
  const paidPaise = Number(
    db
      .prepare('SELECT COALESCE(SUM(amount_paise), 0) AS total FROM payment_records WHERE user_id = ? AND course_id = ?')
      .get(userId, courseId).total,
  );
  const plan = latestPlan(userId, courseId);
  const openPlan = plan && OPEN_PLAN_STATUSES.includes(plan.status) && planOutstandingPaise(plan.id) > 0 ? plan : null;
  const agreed = db
    .prepare('SELECT agreed_fee_paise FROM student_course_fees WHERE user_id = ? AND course_id = ?')
    .get(userId, courseId);

  let feePaise;
  let feeSource;
  if (openPlan) {
    feePaise = Number(openPlan.total_course_fee_paise);
    feeSource = 'apply_plan';
  } else if (agreed) {
    feePaise = Number(agreed.agreed_fee_paise);
    feeSource = 'agreed';
  } else if (plan) {
    feePaise = Number(plan.total_course_fee_paise);
    feeSource = 'apply_plan';
  } else {
    feePaise = Math.max(0, Math.round((Number(course.fee_inr || 0) - Number(course.discount_inr || 0)) * 100));
    feeSource = 'course';
  }

  // An open plan's dues are authoritative (they include any plan discount).
  const outstandingPaise = openPlan ? planOutstandingPaise(openPlan.id) : Math.max(0, feePaise - paidPaise);
  let status;
  if (feePaise <= 0) status = 'no_fee';
  else if (outstandingPaise <= 0) status = 'paid';
  else if (paidPaise > 0) status = 'partial';
  else status = 'pending';

  return {
    courseId: course.id,
    courseName: course.name,
    enrollmentType: course.enrollment_type,
    feePaise,
    feeSource,
    paidPaise,
    outstandingPaise,
    status,
    applyPlanId: openPlan ? openPlan.id : null,
  };
}

function getStudentStatement(userId) {
  const student = loadStudent(userId);
  const courseIds = db
    .prepare(
      `SELECT course_id AS id FROM payment_records WHERE user_id = @uid AND course_id IS NOT NULL
       UNION SELECT course_id FROM student_course_fees WHERE user_id = @uid
       UNION SELECT course_id FROM apply_course_billing_profiles WHERE user_id = @uid AND status != 'cancelled'
       UNION SELECT course_id FROM course_access_grants WHERE user_id = @uid AND revoked_at_ms IS NULL
       UNION SELECT bc.course_id FROM batch_members bm JOIN batch_courses bc ON bc.batch_id = bm.batch_id WHERE bm.student_id = @uid
       UNION SELECT b.course_id FROM batch_members bm JOIN batches b ON b.id = bm.batch_id
             WHERE bm.student_id = @uid AND b.course_id IS NOT NULL`,
    )
    .all({ uid: student.id })
    .map((row) => Number(row.id));

  const details = new Map(
    db
      .prepare(
        `SELECT 'manual_payment_entries' AS source, id, payment_method, reference_text, note_text
           FROM manual_payment_entries WHERE user_id = @uid
         UNION ALL
         SELECT 'manual_apply_due_entries', id, payment_method, reference_text, note_text
           FROM manual_apply_due_entries WHERE user_id = @uid`,
      )
      .all({ uid: student.id })
      .map((row) => [`${row.source}:${row.id}`, row]),
  );

  const payments = listPaymentRecordsForUser(student.id).map((payment) => {
    const detail = details.get(`${payment.sourceOrderTable}:${payment.sourceOrderRowId}`);
    return {
      ...payment,
      paymentMethod: detail ? detail.payment_method || 'cash' : 'razorpay',
      reference: detail ? detail.reference_text || '' : payment.gatewayPaymentId,
      remarks: detail ? detail.note_text || '' : '',
    };
  });

  return {
    student: { id: student.id, name: student.name, email: student.email },
    accounts: courseIds.map((courseId) => getAccount(student.id, courseId)),
    payments,
  };
}

function setAgreedFee({ userId, courseId, agreedFeeInr, adminId }) {
  loadStudent(userId);
  loadCourse(courseId);
  const paise = Math.round(Number(agreedFeeInr) * 100);
  if (agreedFeeInr === '' || agreedFeeInr == null || !Number.isFinite(paise) || paise < 0) {
    throw fail('agreedFeeInr must be a number of 0 or more');
  }
  const account = getAccount(userId, courseId);
  if (account.applyPlanId) {
    throw fail('This student has an apply payment plan for the course; change it under Apply course dues.', 409);
  }
  if (paise < account.paidPaise) throw fail('Agreed fee cannot be less than the amount already paid');
  db.prepare(
    `INSERT INTO student_course_fees (user_id, course_id, agreed_fee_paise, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, course_id) DO UPDATE SET
       agreed_fee_paise = excluded.agreed_fee_paise, updated_by = excluded.updated_by, updated_at = datetime('now')`,
  ).run(userId, courseId, paise, adminId);
  return getAccount(userId, courseId);
}

function normalizePaymentDate(value) {
  const ymd = String(value || '').trim() || academyToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd) || addDaysYmd(ymd, 0) !== ymd) throw fail('Payment date must be a valid YYYY-MM-DD date');
  if (ymd > academyToday()) throw fail('Payment date cannot be in the future');
  return new Date(`${ymd}T00:00:00.000Z`).toISOString();
}

function recordOfflinePayment(body, adminId) {
  const userId = Number(body?.userId);
  const courseId = Number(body?.courseId);
  const batchId = body?.batchId == null || body.batchId === '' ? null : Number(body.batchId);
  const amountPaise = Math.round(Number(body?.amountInr) * 100);
  const method = String(body?.method || '').trim().toLowerCase();
  const requestKey = String(body?.requestKey || '').trim();
  const reference = String(body?.referenceText || '').trim().slice(0, 200) || null;
  const note = String(body?.noteText || '').trim().slice(0, 2000) || null;

  if (requestKey.length < 8 || requestKey.length > 100) throw fail('requestKey (8-100 characters) is required');
  loadStudent(userId);
  loadCourse(courseId);
  if (!PAYMENT_METHODS.includes(method)) throw fail(`method must be one of: ${PAYMENT_METHODS.join(', ')}`);
  if (!Number.isFinite(amountPaise) || amountPaise < 1) throw fail('Enter an amount greater than zero');
  const paidAt = normalizePaymentDate(body?.paidAt);

  return db.transaction(() => {
    const previous = db.prepare('SELECT * FROM manual_payment_entries WHERE request_key = ?').get(requestKey);
    if (previous) {
      if (previous.user_id !== userId || previous.course_id !== courseId || previous.amount_paise !== amountPaise) {
        throw fail('requestKey was already used for a different payment', 409);
      }
      return { duplicate: true, payment: ensurePaymentLedgerForManualEntry(previous), account: getAccount(userId, courseId) };
    }

    if (batchId != null) {
      const linked = db
        .prepare(
          `SELECT 1 FROM batches b WHERE b.id = ?
             AND (b.course_id = ? OR EXISTS (SELECT 1 FROM batch_courses bc WHERE bc.batch_id = b.id AND bc.course_id = ?))`,
        )
        .get(batchId, courseId, courseId);
      if (!linked) throw fail('That batch does not include this course');
    }
    if (
      reference &&
      db
        .prepare(
          `SELECT 1 FROM manual_payment_entries
           WHERE user_id = ? AND course_id = ? AND amount_paise = ? AND LOWER(reference_text) = LOWER(?)`,
        )
        .get(userId, courseId, amountPaise, reference)
    ) {
      throw fail('A payment with this reference and amount is already recorded', 409);
    }

    const account = getAccount(userId, courseId);
    if (account.applyPlanId) {
      throw fail('This student has an apply payment plan for the course; record it under Apply course dues.', 409);
    }
    if (account.feePaise <= 0) throw fail('Set the agreed course fee for this student before recording a payment', 409);
    if (amountPaise > account.outstandingPaise) {
      throw fail(`Amount is more than the outstanding balance of ₹${(account.outstandingPaise / 100).toLocaleString('en-IN')}`);
    }

    const inserted = db
      .prepare(
        `INSERT INTO manual_payment_entries (
          user_id, course_id, batch_id, amount_paise, payment_method, reference_text, note_text, paid_at, request_key, recorded_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(userId, courseId, batchId, amountPaise, method, reference, note, paidAt, requestKey, adminId);
    const entry = db.prepare('SELECT * FROM manual_payment_entries WHERE id = ?').get(Number(inserted.lastInsertRowid));
    return { duplicate: false, payment: ensurePaymentLedgerForManualEntry(entry), account: getAccount(userId, courseId) };
  })();
}

module.exports = { PAYMENT_METHODS, getAccount, getStudentStatement, recordOfflinePayment, setAgreedFee };
