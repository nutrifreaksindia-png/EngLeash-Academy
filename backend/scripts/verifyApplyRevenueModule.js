const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const { ensureV1Tables } = require('../migrations/v1');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

async function main() {
  const sourceDbPath = path.join(__dirname, '..', 'data', 'academy.db');
  const tempDbPath = path.join(os.tmpdir(), `engleash-apply-revenue-verify-${Date.now()}.db`);
  fs.copyFileSync(sourceDbPath, tempDbPath);

  const tempDb = new Database(tempDbPath);
  tempDb.pragma('foreign_keys = ON');
  ensureV1Tables(tempDb);

  const dbModulePath = path.resolve(__dirname, '..', 'db.js');
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: tempDb,
  };

  process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'test_key';
  process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'test_secret';

  const applyCourseId = 9301;
  const adminId = 9302;
  const studentRegistrationId = 9303;
  const studentSingleId = 9304;
  const studentInstallmentId = 9305;
  const studentLateId = 9306;
  const batchFarId = 9311;
  const batchNearId = 9312;
  const adminJti = 'apply-admin-session';
  const regJti = 'apply-reg-session';
  const singleJti = 'apply-single-session';
  const instJti = 'apply-installment-session';
  const lateJti = 'apply-late-session';

  function addUser(id, email, name, role, jti) {
    tempDb.prepare(
      `INSERT OR REPLACE INTO users (id, email, password_hash, name, role, created_at, status, mobile_number)
       VALUES (?, ?, 'x', ?, ?, datetime('now'), 'approved', '9876543210')`,
    ).run(id, email, name, role);
    tempDb.prepare(
      `INSERT OR REPLACE INTO sessions (user_id, token_jti, device_name, created_at)
       VALUES (?, ?, 'Verify Device', datetime('now'))`,
    ).run(id, jti);
  }

  addUser(adminId, 'apply.admin@example.com', 'Apply Admin', 'Admin', adminJti);
  addUser(studentRegistrationId, 'apply.registration@example.com', 'Registration Learner', 'Student', regJti);
  addUser(studentSingleId, 'apply.single@example.com', 'Single Learner', 'Student', singleJti);
  addUser(studentInstallmentId, 'apply.installment@example.com', 'Installment Learner', 'Student', instJti);
  addUser(studentLateId, 'apply.late@example.com', 'Late Learner', 'Student', lateJti);

  tempDb.prepare(
    `INSERT OR REPLACE INTO courses (
      id, name, description, is_published, fee_inr, discount_inr, course_status, enrollment_type,
      duration_days, apply_registration_fee_inr, apply_single_payment_discount_inr,
      apply_installment_count, apply_installment_amounts_json, apply_installment_gap_days, apply_grace_days, apply_enquiry_enabled, created_at
    ) VALUES (?, ?, ?, 1, 12000, 2000, 'Active', 'apply', 30, 999, 1000, 2, ?, 10, 3, 1, datetime('now'))`,
  ).run(applyCourseId, 'Career English Intensive', 'Apply revenue validation course', JSON.stringify([3000]));

  const today = new Date();
  const todayYmd = today.toISOString().slice(0, 10);
  const farYmd = new Date(today.getTime() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const nearYmd = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const scheduleJson = JSON.stringify({ daysOfWeek: ['Mon', 'Wed', 'Fri'], startTime: '18:00', endTime: '19:00' });

  tempDb.prepare(
    `INSERT OR REPLACE INTO batches (
      id, name, title, session_type, trainer_id, created_by, course_id, training_schedule_json,
      planned_start_date, notes, batch_status, batch_number, duration_days, enrollment_open_status, created_at
    ) VALUES (?, ?, ?, 'group', ?, ?, ?, ?, ?, '', 'draft', 1, 30, 'open', datetime('now'))`,
  ).run(batchFarId, 'Far Batch', 'Far Batch', adminId, adminId, applyCourseId, scheduleJson, farYmd);
  tempDb.prepare(
    `INSERT OR REPLACE INTO batches (
      id, name, title, session_type, trainer_id, created_by, course_id, training_schedule_json,
      planned_start_date, notes, batch_status, batch_number, duration_days, enrollment_open_status, created_at
    ) VALUES (?, ?, ?, 'group', ?, ?, ?, ?, ?, '', 'draft', 2, 30, 'open', datetime('now'))`,
  ).run(batchNearId, 'Near Batch', 'Near Batch', adminId, adminId, applyCourseId, scheduleJson, nearYmd);

  tempDb.prepare(
    `INSERT OR IGNORE INTO batch_courses (batch_id, course_id, billing_package_id, sort_order)
     VALUES (?, ?, NULL, 0)`,
  ).run(batchFarId, applyCourseId);
  tempDb.prepare(
    `INSERT OR IGNORE INTO batch_courses (batch_id, course_id, billing_package_id, sort_order)
     VALUES (?, ?, NULL, 0)`,
  ).run(batchNearId, applyCourseId);

  const enrollmentRoutes = require('../routes/enrollments');
  const { router: paymentRoutes } = require('../routes/payments');
  const batchManagerRoutes = require('../routes/batchManager');
  const { learnerHasCourseAccess } = require('../lib/courseAccess');
  const { runApplyOverdueEnforcementSweep } = require('../services/applyDueEnforcement');

  const app = express();
  app.use(express.json());
  app.use('/api/enrollments', enrollmentRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/batch-manager', batchManagerRoutes);

  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const adminToken = jwt.sign({ userId: adminId, jti: adminJti }, JWT_SECRET);
  const regToken = jwt.sign({ userId: studentRegistrationId, jti: regJti }, JWT_SECRET);
  const singleToken = jwt.sign({ userId: studentSingleId, jti: singleJti }, JWT_SECRET);
  const installmentToken = jwt.sign({ userId: studentInstallmentId, jti: instJti }, JWT_SECRET);
  const lateToken = jwt.sign({ userId: studentLateId, jti: lateJti }, JWT_SECRET);

  function sign(orderId, paymentId) {
    return crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  }

  function addDaysYmd(ymd, days) {
    const [y, m, d] = String(ymd).split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + Number(days || 0));
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  }

  async function jsonRequest(url, token, method = 'GET', body, expectedStatus) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (expectedStatus != null) {
      if (res.status !== expectedStatus) {
        throw new Error(`${method} ${url} expected ${expectedStatus} but got ${res.status}: ${data.error || res.statusText}`);
      }
      return data;
    }
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${data.error || res.statusText}`);
    return data;
  }

  const regPrepared = await jsonRequest(`${base}/api/enrollments/apply-batch`, regToken, 'POST', {
    course_id: applyCourseId,
    batch_id: batchFarId,
    selected_plan: 'registration',
  });
  await jsonRequest(
    `${base}/api/enrollments/apply-batch`,
    singleToken,
    'POST',
    { course_id: applyCourseId, batch_id: batchFarId, selected_plan: 'single_payment' },
  );
  const installmentPrepared = await jsonRequest(`${base}/api/enrollments/apply-batch`, installmentToken, 'POST', {
    course_id: applyCourseId,
    batch_id: batchFarId,
    selected_plan: 'first_installment',
  });
  await jsonRequest(
    `${base}/api/enrollments/apply-batch`,
    lateToken,
    'POST',
    { course_id: applyCourseId, batch_id: batchNearId, selected_plan: 'registration' },
    400,
  );
  const latePrepared = await jsonRequest(`${base}/api/enrollments/apply-batch`, lateToken, 'POST', {
    course_id: applyCourseId,
    batch_id: batchNearId,
    selected_plan: 'first_installment',
  });

  const installmentDueCount = tempDb.prepare(
    'SELECT COUNT(*) AS count FROM apply_course_due_items WHERE billing_profile_id = ?',
  ).get(installmentPrepared.billingProfileId).count;
  if (installmentDueCount !== 2) {
    throw new Error('Installment schedule was not generated with the configured count');
  }
  const installmentAmounts = tempDb.prepare(
    'SELECT amount_paise FROM apply_course_due_items WHERE billing_profile_id = ? ORDER BY sequence_no',
  ).all(installmentPrepared.billingProfileId).map((r) => Number(r.amount_paise));
  if (JSON.stringify(installmentAmounts) !== JSON.stringify([300000, 700000])) {
    throw new Error(`Installment schedule did not use configured amounts: ${JSON.stringify(installmentAmounts)}`);
  }
  const installmentDueDates = tempDb.prepare(
    'SELECT due_date FROM apply_course_due_items WHERE billing_profile_id = ? ORDER BY sequence_no',
  ).all(installmentPrepared.billingProfileId).map((r) => r.due_date);
  if (installmentDueDates[0] !== farYmd || installmentDueDates[1] != null) {
    throw new Error(`Future-batch part due dates should only set the first part date: ${JSON.stringify(installmentDueDates)}`);
  }
  const registrationBalanceStartDue = tempDb.prepare(
    `SELECT due_date FROM apply_course_due_items WHERE billing_profile_id = ? AND due_kind = 'registration_balance'`,
  ).get(regPrepared.billingProfileId);
  if (registrationBalanceStartDue?.due_date !== farYmd) {
    throw new Error(`Registration balance due date was not the batch start date: ${registrationBalanceStartDue?.due_date}`);
  }
  const singleDue = tempDb.prepare(
    'SELECT amount_paise FROM apply_course_due_items WHERE billing_profile_id = ? AND due_kind = ?',
  ).get(
    tempDb.prepare('SELECT id FROM apply_course_billing_profiles WHERE user_id = ?').get(studentSingleId).id,
    'single_payment',
  );
  if (Number(singleDue?.amount_paise || 0) !== 900000) {
    throw new Error('Single payment did not use net fee minus single-payment discount');
  }

  tempDb.prepare(
    `INSERT INTO razorpay_apply_due_orders (
      id, razorpay_order_id, user_id, billing_profile_id, due_item_id, amount_paise, currency, status, payment_id, created_at, updated_at
    ) VALUES (1, 'apply_reg_order', ?, ?, ?, 99900, 'INR', 'created', NULL, datetime('now'), datetime('now'))`,
  ).run(studentRegistrationId, regPrepared.billingProfileId, regPrepared.dueItemId);

  const regPaymentId = 'apply_reg_payment';
  await jsonRequest(`${base}/api/payments/razorpay/verify`, regToken, 'POST', {
    razorpay_order_id: 'apply_reg_order',
    razorpay_payment_id: regPaymentId,
    razorpay_signature: sign('apply_reg_order', regPaymentId),
  });

  const regEnrollment = tempDb.prepare(
    'SELECT * FROM course_enrollments WHERE user_id = ? AND course_id = ?',
  ).get(studentRegistrationId, applyCourseId);
  if (!regEnrollment || regEnrollment.status !== 'approved') {
    throw new Error('Initial apply payment did not auto-approve the course application');
  }
  const regMembershipBeforeStart = tempDb.prepare(
    'SELECT 1 FROM batch_members WHERE batch_id = ? AND student_id = ?',
  ).get(batchFarId, studentRegistrationId);
  if (!regMembershipBeforeStart) {
    throw new Error('Initial apply payment did not add the learner to the batch');
  }

  tempDb.prepare(
    `INSERT INTO razorpay_apply_due_orders (
      id, razorpay_order_id, user_id, billing_profile_id, due_item_id, amount_paise, currency, status, payment_id, created_at, updated_at
    ) VALUES (3, 'apply_first_part_order', ?, ?, ?, 300000, 'INR', 'created', NULL, datetime('now'), datetime('now'))`,
  ).run(studentInstallmentId, installmentPrepared.billingProfileId, installmentPrepared.dueItemId);
  const firstPartPaymentId = 'apply_first_part_payment';
  await jsonRequest(`${base}/api/payments/razorpay/verify`, installmentToken, 'POST', {
    razorpay_order_id: 'apply_first_part_order',
    razorpay_payment_id: firstPartPaymentId,
    razorpay_signature: sign('apply_first_part_order', firstPartPaymentId),
  });
  await jsonRequest(`${base}/api/payments/apply/${installmentPrepared.billingProfileId}/pay-remaining-full`, installmentToken, 'POST', {});
  const postFirstPartFullDue = tempDb.prepare(
    `SELECT discount_paise
     FROM apply_course_due_items
     WHERE billing_profile_id = ? AND due_kind = 'registration_balance' AND due_status != 'cancelled'
     ORDER BY id DESC
     LIMIT 1`,
  ).get(installmentPrepared.billingProfileId);
  if (Number(postFirstPartFullDue?.discount_paise || 0) !== 0) {
    throw new Error('Single-payment discount was applied after the first part had been paid');
  }

  await jsonRequest(`${base}/api/batch-manager/${batchFarId}/start`, adminToken, 'POST', { startDate: todayYmd });
  if (!learnerHasCourseAccess(studentRegistrationId, applyCourseId)) {
    throw new Error('Approved learner did not receive access when the batch started');
  }

  await jsonRequest(`${base}/api/payments/apply/${regPrepared.billingProfileId}/pay-remaining-full`, regToken, 'POST', {});
  const registrationBalanceDue = tempDb.prepare(
    `SELECT id, discount_paise
     FROM apply_course_due_items
     WHERE billing_profile_id = ? AND due_kind = 'registration_balance' AND due_status != 'cancelled'
     ORDER BY id DESC
     LIMIT 1`,
  ).get(regPrepared.billingProfileId);
  if (Number(registrationBalanceDue?.discount_paise || 0) !== 100000) {
    throw new Error('Full remaining payment did not preserve the single-payment discount after registration');
  }
  const partialManualPayment = await jsonRequest(
    `${base}/api/payments/admin/apply-due/${registrationBalanceDue.id}/manual`,
    adminToken,
    'POST',
    { amountInr: 1000, referenceText: 'CASH-PARTIAL-001' },
  );
  if (!partialManualPayment?.payment?.id) {
    throw new Error('Partial manual apply payment did not create a payment record');
  }
  const partiallyPaidDue = tempDb.prepare('SELECT due_status, paid_amount_paise FROM apply_course_due_items WHERE id = ?').get(registrationBalanceDue.id);
  if (partiallyPaidDue.due_status === 'paid' || Number(partiallyPaidDue.paid_amount_paise || 0) !== 100000) {
    throw new Error('Partial manual payment did not leave the due open with a reduced balance');
  }
  const manualPayment = await jsonRequest(
    `${base}/api/payments/admin/apply-due/${registrationBalanceDue.id}/manual`,
    adminToken,
    'POST',
    { referenceText: 'CASH-001' },
  );
  if (!manualPayment?.payment?.id) {
    throw new Error('Manual apply payment did not create a payment record');
  }

  tempDb.prepare(
    `INSERT INTO razorpay_apply_due_orders (
      id, razorpay_order_id, user_id, billing_profile_id, due_item_id, amount_paise, currency, status, payment_id, created_at, updated_at
    ) VALUES (2, 'apply_late_order', ?, ?, ?, 300000, 'INR', 'created', NULL, datetime('now'), datetime('now'))`,
  ).run(studentLateId, latePrepared.billingProfileId, latePrepared.dueItemId);
  const latePaymentId = 'apply_late_payment';
  await jsonRequest(`${base}/api/payments/razorpay/verify`, lateToken, 'POST', {
    razorpay_order_id: 'apply_late_order',
    razorpay_payment_id: latePaymentId,
    razorpay_signature: sign('apply_late_order', latePaymentId),
  });

  const lateEnrollment = tempDb.prepare(
    'SELECT * FROM course_enrollments WHERE user_id = ? AND course_id = ?',
  ).get(studentLateId, applyCourseId);
  await jsonRequest(`${base}/api/batch-manager/${batchNearId}/start`, adminToken, 'POST', { startDate: todayYmd });
  if (!learnerHasCourseAccess(studentLateId, applyCourseId)) {
    throw new Error('Late learner did not receive access before overdue enforcement');
  }

  const lateSecondDue = tempDb.prepare(
    `SELECT id
     FROM apply_course_due_items
     WHERE billing_profile_id = ? AND sequence_no = 2`,
  ).get(latePrepared.billingProfileId);
  tempDb.prepare(
    `UPDATE apply_course_due_items
     SET due_date = ?, grace_end_date = ?, due_status = 'scheduled'
     WHERE id = ?`,
  ).run('2000-01-02', '2000-01-05', lateSecondDue.id);

  const sweepSummary = runApplyOverdueEnforcementSweep();
  if ((sweepSummary.removedLearners || 0) < 1) {
    throw new Error('Overdue sweep did not remove any learners');
  }
  const lateMembership = tempDb.prepare(
    'SELECT 1 FROM batch_members WHERE batch_id = ? AND student_id = ?',
  ).get(batchNearId, studentLateId);
  if (lateMembership) {
    throw new Error('Overdue learner was not removed from the batch');
  }
  if (learnerHasCourseAccess(studentLateId, applyCourseId)) {
    throw new Error('Overdue learner still has course access after removal');
  }

  const studentPayments = await jsonRequest(`${base}/api/payments/my`, regToken);
  const adminPayments = await jsonRequest(`${base}/api/payments/admin`, adminToken);
  const applyBillingMy = await jsonRequest(`${base}/api/payments/apply/my`, regToken);
  const applyBillingAdmin = await jsonRequest(`${base}/api/payments/admin/apply-billing`, adminToken);

  if (!Array.isArray(studentPayments) || studentPayments.length < 2) {
    throw new Error('Student payment history did not include apply Razorpay and manual payments');
  }
  if (!Array.isArray(adminPayments) || adminPayments.length < 2) {
    throw new Error('Admin payment history did not include apply payments');
  }
  if (!Array.isArray(applyBillingMy) || applyBillingMy.length < 1) {
    throw new Error('Learner apply billing history did not load');
  }
  if (!Array.isArray(applyBillingAdmin) || applyBillingAdmin.length < 1) {
    throw new Error('Admin apply billing history did not load');
  }

  const invoiceLink = await jsonRequest(
    `${base}/api/payments/my/${studentPayments[0].id}/invoice-link`,
    regToken,
  );
  const pdfRes = await fetch(invoiceLink.url);
  const pdfBytes = await pdfRes.arrayBuffer();
  if (!pdfRes.ok || pdfRes.headers.get('content-type') !== 'application/pdf' || pdfBytes.byteLength < 2500) {
    throw new Error('Apply payment invoice PDF could not be fetched correctly');
  }

  const applyPaymentKinds = tempDb.prepare(
    `SELECT payment_kind, payment_source
     FROM payment_records
     WHERE payment_kind LIKE 'apply_%'
     ORDER BY id`,
  ).all();
  const overdueProfile = tempDb.prepare(
    'SELECT status FROM apply_course_billing_profiles WHERE id = ?',
  ).get(latePrepared.billingProfileId);

  server.close();
  tempDb.close();
  fs.unlinkSync(tempDbPath);

  console.log(
    JSON.stringify(
      {
        ok: true,
        installmentDueCount,
        applyPaymentKinds,
        learnerPayments: studentPayments.length,
        adminPayments: adminPayments.length,
        applyBillingMyCount: applyBillingMy.length,
        applyBillingAdminCount: applyBillingAdmin.length,
        overdueProfileStatus: overdueProfile?.status || null,
        pdfBytes: pdfBytes.byteLength,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
