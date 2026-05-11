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
  const tempDbPath = path.join(os.tmpdir(), `engleash-revenue-verify-${Date.now()}.db`);
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

  const purchaseCourseId = 9101;
  const subscribeCourseId = 9102;
  const billingPackageId = 9201;
  const studentId = 9001;
  const adminId = 9002;
  const studentJti = 'revenue-student-session';
  const adminJti = 'revenue-admin-session';

  tempDb.prepare(
    `INSERT OR REPLACE INTO users (id, email, password_hash, name, role, created_at, status, mobile_number)
     VALUES (?, ?, 'x', ?, 'Student', datetime('now'), 'approved', ?)`,
  ).run(studentId, 'revenue.student@example.com', 'Revenue Student', '9876543210');
  tempDb.prepare(
    `INSERT OR REPLACE INTO users (id, email, password_hash, name, role, created_at, status, mobile_number)
     VALUES (?, ?, 'x', ?, 'Admin', datetime('now'), 'approved', ?)`,
  ).run(adminId, 'revenue.admin@example.com', 'Revenue Admin', '9876500000');
  tempDb.prepare(
    `INSERT OR REPLACE INTO student_profiles (
      user_id, gender, birth_date, address_line_1, address_line_2, city_district, state_province, country, country_code, occupation, policies_agreed
    ) VALUES (?, 'Other', '2000-01-01', '24 Example Street', 'Suite 5', 'Madurai', 'Tamil Nadu', 'India', '+91', 'Student', 1)`,
  ).run(studentId);
  tempDb.prepare(
    `INSERT OR REPLACE INTO sessions (user_id, token_jti, device_name, created_at)
     VALUES (?, ?, 'Verify Device', datetime('now'))`,
  ).run(studentId, studentJti);
  tempDb.prepare(
    `INSERT OR REPLACE INTO sessions (user_id, token_jti, device_name, created_at)
     VALUES (?, ?, 'Verify Device', datetime('now'))`,
  ).run(adminId, adminJti);

  tempDb.prepare(
    `INSERT OR REPLACE INTO courses (
      id, name, description, is_published, fee_inr, discount_inr, course_status, enrollment_type, created_at
    ) VALUES (?, ?, ?, 1, 1500, 100, 'Active', 'purchase', datetime('now'))`,
  ).run(purchaseCourseId, 'English Interview Mastery', 'Purchase validation course');
  tempDb.prepare(
    `INSERT OR REPLACE INTO courses (
      id, name, description, is_published, fee_inr, discount_inr, course_status, enrollment_type, created_at
    ) VALUES (?, ?, ?, 1, 0, 0, 'Active', 'subscribe', datetime('now'))`,
  ).run(
    subscribeCourseId,
    'Advanced Business English Communication for Leadership and Career Growth',
    'Subscribe validation course with a long title',
  );
  tempDb.prepare(
    `INSERT OR REPLACE INTO billing_packages (
      id, scope, course_id, combo_id, package_kind, duration_unit, duration_count, fee_inr, discount_inr, is_active, sort_order, created_at
    ) VALUES (?, 'course', ?, NULL, 'subscription', 'month', 4, 3200, 200, 1, 0, datetime('now'))`,
  ).run(billingPackageId, subscribeCourseId);

  tempDb.prepare(
    `INSERT OR REPLACE INTO razorpay_course_orders (
      id, razorpay_order_id, user_id, course_id, amount_paise, currency, status, payment_id, created_at, updated_at
    ) VALUES (1, 'order_purchase_verify', ?, ?, 140000, 'INR', 'created', NULL, datetime('now'), datetime('now'))`,
  ).run(studentId, purchaseCourseId);
  tempDb.prepare(
    `INSERT OR REPLACE INTO razorpay_billing_orders (
      id, razorpay_order_id, user_id, order_kind, billing_package_id, course_id, combo_id, amount_paise, currency, status, payment_id, created_at, updated_at
    ) VALUES (1, 'order_subscribe_verify', ?, 'subscribe', ?, ?, NULL, 300000, 'INR', 'created', NULL, datetime('now'), datetime('now'))`,
  ).run(studentId, billingPackageId, subscribeCourseId);

  const { router } = require('../routes/payments');
  const app = express();
  app.use(express.json());
  app.use('/api/payments', router);

  const server = await new Promise((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const studentToken = jwt.sign({ userId: studentId, jti: studentJti }, JWT_SECRET);
  const adminToken = jwt.sign({ userId: adminId, jti: adminJti }, JWT_SECRET);

  function sign(orderId, paymentId) {
    return crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  }

  async function jsonRequest(url, token, method = 'GET', body) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${data.error || res.statusText}`);
    return data;
  }

  const purchasePaymentId = 'pay_purchase_verify';
  const subscribePaymentId = 'pay_subscribe_verify';

  await jsonRequest(`${base}/api/payments/razorpay/verify`, studentToken, 'POST', {
    razorpay_order_id: 'order_purchase_verify',
    razorpay_payment_id: purchasePaymentId,
    razorpay_signature: sign('order_purchase_verify', purchasePaymentId),
  });
  await jsonRequest(`${base}/api/payments/razorpay/verify`, studentToken, 'POST', {
    razorpay_order_id: 'order_subscribe_verify',
    razorpay_payment_id: subscribePaymentId,
    razorpay_signature: sign('order_subscribe_verify', subscribePaymentId),
  });

  const studentPayments = await jsonRequest(`${base}/api/payments/my`, studentToken);
  if (!Array.isArray(studentPayments) || studentPayments.length < 2) {
    throw new Error('Student payment history did not return both payment records');
  }
  const adminPayments = await jsonRequest(`${base}/api/payments/admin`, adminToken);
  if (!Array.isArray(adminPayments) || adminPayments.length < 2) {
    throw new Error('Admin payment history did not return both payment records');
  }

  const invoiceLink = await jsonRequest(
    `${base}/api/payments/my/${studentPayments[0].id}/invoice-link`,
    studentToken,
  );
  const pdfRes = await fetch(invoiceLink.url);
  const pdfBytes = await pdfRes.arrayBuffer();
  if (!pdfRes.ok) throw new Error(`Invoice PDF request failed with status ${pdfRes.status}`);
  if (pdfRes.headers.get('content-type') !== 'application/pdf') {
    throw new Error('Invoice PDF endpoint did not return application/pdf');
  }
  if (pdfBytes.byteLength < 2500) {
    throw new Error('Invoice PDF output was unexpectedly small');
  }

  const purchaseLedgerCount = tempDb.prepare('SELECT COUNT(*) AS count FROM payment_records WHERE payment_kind = ?').get('purchase').count;
  const subscribeLedgerCount = tempDb.prepare('SELECT COUNT(*) AS count FROM payment_records WHERE payment_kind = ?').get('subscribe').count;
  const invoiceCount = tempDb.prepare('SELECT COUNT(*) AS count FROM invoice_records').get().count;
  const grantLink = tempDb
    .prepare('SELECT COUNT(*) AS count FROM course_access_grants WHERE source = ? AND payment_id = ?')
    .get('purchase', purchasePaymentId).count;

  if (purchaseLedgerCount < 1 || subscribeLedgerCount < 1) {
    throw new Error('Payment records were not created for both purchase and subscribe flows');
  }
  if (invoiceCount < 2) {
    throw new Error('Invoice records were not created for both flows');
  }
  if (grantLink < 1) {
    throw new Error('Purchase access grant did not retain payment linkage');
  }

  server.close();
  tempDb.close();
  fs.unlinkSync(tempDbPath);

  console.log(
    JSON.stringify(
      {
        ok: true,
        purchaseLedgerCount,
        subscribeLedgerCount,
        invoiceCount,
        pdfBytes: pdfBytes.byteLength,
        verifiedStudentPayments: studentPayments.length,
        verifiedAdminPayments: adminPayments.length,
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
