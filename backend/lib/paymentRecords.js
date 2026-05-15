const db = require('../db');

function safeJsonStringify(value, fallback = null) {
  try {
    return JSON.stringify(value == null ? fallback : value);
  } catch {
    return JSON.stringify(fallback);
  }
}

function parseJsonArray(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((x) => String(x || '').trim()).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function compactAddressLines(parts) {
  return (parts || []).map((part) => String(part || '').trim()).filter(Boolean);
}

function formatDurationLabel(unit, count) {
  const n = Math.max(1, Number(count) || 1);
  const u = String(unit || '').toLowerCase();
  if (u === 'day') return `${n} day${n === 1 ? '' : 's'}`;
  if (u === 'year') return `${n} year${n === 1 ? '' : 's'}`;
  return `${n} month${n === 1 ? '' : 's'}`;
}

function formatPackageLabel(pkg) {
  if (!pkg) return '';
  const kind = String(pkg.package_kind || '').toLowerCase() === 'renewal' ? 'Renewal' : 'Subscription';
  return `${kind} · ${formatDurationLabel(pkg.duration_unit, pkg.duration_count)}`;
}

function loadCustomerSnapshot(userId) {
  const row = db
    .prepare(
      `SELECT u.name, u.email, u.mobile_number,
              sp.address_line_1, sp.address_line_2, sp.city_district, sp.state_province, sp.country
       FROM users u
       LEFT JOIN student_profiles sp ON sp.user_id = u.id
       WHERE u.id = ?`,
    )
    .get(userId);
  const addressLines = compactAddressLines([
    row?.address_line_1,
    row?.address_line_2,
    row?.city_district,
    row?.state_province,
    row?.country,
  ]);
  return {
    name: row?.name || '',
    email: row?.email || '',
    mobile: row?.mobile_number || '',
    addressLines,
  };
}

function loadAcademySnapshot() {
  const envLines = compactAddressLines(String(process.env.ACADEMY_INVOICE_ADDRESS_LINES || '').split('|'));
  return {
    name: String(process.env.ACADEMY_INVOICE_NAME || 'EngLeash Academy').trim() || 'EngLeash Academy',
    email: String(process.env.ACADEMY_INVOICE_EMAIL || '').trim(),
    phone: String(process.env.ACADEMY_INVOICE_PHONE || '').trim(),
    addressLines: envLines,
  };
}

function buildInvoiceNumber(invoiceId, invoiceDate) {
  const dt = new Date(invoiceDate || Date.now());
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const serial = String(invoiceId).padStart(6, '0');
  return `ELA-${year}${month}-${serial}`;
}

function loadCourseTitle(courseId) {
  if (!Number.isFinite(Number(courseId))) return '';
  return db.prepare('SELECT name FROM courses WHERE id = ?').get(courseId)?.name || '';
}

function loadComboTitle(comboId) {
  if (!Number.isFinite(Number(comboId))) return '';
  return db.prepare('SELECT name FROM course_combos WHERE id = ?').get(comboId)?.name || '';
}

function loadComboCourseTitles(comboId) {
  if (!Number.isFinite(Number(comboId))) return [];
  return db
    .prepare(
      `SELECT c.name
       FROM course_combo_members ccm
       JOIN courses c ON c.id = ccm.course_id
       WHERE ccm.combo_id = ?
       ORDER BY c.name COLLATE NOCASE ASC`,
    )
    .all(comboId)
    .map((row) => String(row.name || '').trim())
    .filter(Boolean);
}

function loadBillingPackageAny(id) {
  if (!Number.isFinite(Number(id))) return null;
  return db.prepare('SELECT * FROM billing_packages WHERE id = ?').get(id) || null;
}

function paymentKindForApplyDue(dueKind) {
  const raw = String(dueKind || '').toLowerCase();
  if (raw === 'registration') return 'apply_registration';
  if (raw === 'single_payment' || raw === 'registration_balance') return 'apply_single_payment';
  return 'apply_installment';
}

function mapPaymentRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    paymentKind: row.payment_kind,
    orderKind: row.order_kind,
    courseId: row.course_id,
    comboId: row.combo_id,
    billingPackageId: row.billing_package_id,
    courseTitle: row.course_title || '',
    comboTitle: row.combo_title || '',
    packageLabel: row.package_label || '',
    title: row.course_title || row.combo_title || 'Payment',
    gateway: row.gateway,
    paymentSource: row.payment_source || 'razorpay',
    gatewayOrderId: row.gateway_order_id,
    gatewayPaymentId: row.gateway_payment_id,
    manualReference: row.manual_reference || '',
    manualRecordedBy: row.manual_recorded_by || null,
    sourceOrderTable: row.source_order_table,
    sourceOrderRowId: row.source_order_row_id,
    applyBillingProfileId: row.apply_billing_profile_id || null,
    applyDueItemId: row.apply_due_item_id || null,
    amountPaise: Number(row.amount_paise || 0),
    amountInr: Number(row.amount_paise || 0) / 100,
    currency: row.currency || 'INR',
    status: row.status || 'paid',
    paidAtIso: row.paid_at,
    customerName: row.customer_name || '',
    customerEmail: row.customer_email || '',
    customerMobile: row.customer_mobile || '',
    customerAddressLines: parseJsonArray(row.customer_address_lines_json),
    invoiceId: row.invoice_id || null,
    invoiceNumber: row.invoice_number || '',
    invoiceDateIso: row.invoice_date || null,
    hasInvoice: Boolean(row.invoice_id),
  };
}

function ensureInvoiceForPaymentRecord(paymentRecordId, invoicePayload, lineItems) {
  let invoice = db.prepare('SELECT * FROM invoice_records WHERE payment_record_id = ?').get(paymentRecordId);
  if (!invoice) {
    const result = db
      .prepare(
        `INSERT INTO invoice_records (
          payment_record_id, invoice_number, invoice_date, currency, subtotal_paise, total_paise,
          academy_name, academy_email, academy_phone, academy_address_lines_json,
          customer_name, customer_email, customer_mobile, customer_address_lines_json, notes_text
        ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        paymentRecordId,
        invoicePayload.invoiceDate,
        invoicePayload.currency,
        invoicePayload.subtotalPaise,
        invoicePayload.totalPaise,
        invoicePayload.academy.name,
        invoicePayload.academy.email,
        invoicePayload.academy.phone,
        safeJsonStringify(invoicePayload.academy.addressLines, []),
        invoicePayload.customer.name,
        invoicePayload.customer.email,
        invoicePayload.customer.mobile,
        safeJsonStringify(invoicePayload.customer.addressLines, []),
        invoicePayload.notesText || null,
      );
    const invoiceId = Number(result.lastInsertRowid);
    const invoiceNumber = buildInvoiceNumber(invoiceId, invoicePayload.invoiceDate);
    db.prepare('UPDATE invoice_records SET invoice_number = ?, updated_at = datetime(\'now\') WHERE id = ?').run(invoiceNumber, invoiceId);
    for (const [index, item] of (lineItems || []).entries()) {
      db.prepare(
        `INSERT INTO invoice_line_items (
          invoice_record_id, line_order, item_name, description, quantity, unit_rate_paise, amount_paise, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        invoiceId,
        index,
        item.itemName,
        item.description || null,
        Number(item.quantity || 1),
        Number(item.unitRatePaise || 0),
        Number(item.amountPaise || 0),
        item.metaJson || null,
      );
    }
    invoice = db.prepare('SELECT * FROM invoice_records WHERE id = ?').get(invoiceId);
  }

  if (!invoice.invoice_number) {
    const invoiceNumber = buildInvoiceNumber(invoice.id, invoice.invoice_date);
    db.prepare('UPDATE invoice_records SET invoice_number = ?, updated_at = datetime(\'now\') WHERE id = ?').run(invoiceNumber, invoice.id);
    invoice = db.prepare('SELECT * FROM invoice_records WHERE id = ?').get(invoice.id);
  }

  const lineCount = db.prepare('SELECT COUNT(*) AS count FROM invoice_line_items WHERE invoice_record_id = ?').get(invoice.id)?.count || 0;
  if (!lineCount) {
    for (const [index, item] of (lineItems || []).entries()) {
      db.prepare(
        `INSERT INTO invoice_line_items (
          invoice_record_id, line_order, item_name, description, quantity, unit_rate_paise, amount_paise, meta_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        invoice.id,
        index,
        item.itemName,
        item.description || null,
        Number(item.quantity || 1),
        Number(item.unitRatePaise || 0),
        Number(item.amountPaise || 0),
        item.metaJson || null,
      );
    }
  }

  return invoice;
}

function ensurePaymentWithInvoice(payload) {
  const existing =
    db.prepare('SELECT * FROM payment_records WHERE gateway_payment_id = ?').get(payload.gatewayPaymentId) ||
    db.prepare('SELECT * FROM payment_records WHERE gateway_order_id = ?').get(payload.gatewayOrderId) ||
    (payload.sourceOrderTable && payload.sourceOrderRowId != null
      ? db
          .prepare('SELECT * FROM payment_records WHERE source_order_table = ? AND source_order_row_id = ?')
          .get(payload.sourceOrderTable, payload.sourceOrderRowId)
      : null);
  let paymentRow = existing;
  if (!paymentRow) {
    try {
      const result = db
        .prepare(
          `INSERT INTO payment_records (
            user_id, payment_kind, order_kind, course_id, combo_id, billing_package_id,
            apply_billing_profile_id, apply_due_item_id,
            course_title, combo_title, package_label, gateway, payment_source, gateway_order_id, gateway_payment_id,
            manual_reference, manual_recorded_by, source_order_table, source_order_row_id, amount_paise, currency, status, paid_at,
            customer_name, customer_email, customer_mobile, customer_address_lines_json, meta_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          payload.userId,
          payload.paymentKind,
          payload.orderKind,
          payload.courseId,
          payload.comboId,
          payload.billingPackageId,
          payload.applyBillingProfileId || null,
          payload.applyDueItemId || null,
          payload.courseTitle || null,
          payload.comboTitle || null,
          payload.packageLabel || null,
          payload.gateway || 'razorpay',
          payload.paymentSource || 'razorpay',
          payload.gatewayOrderId,
          payload.gatewayPaymentId,
          payload.manualReference || null,
          payload.manualRecordedBy || null,
          payload.sourceOrderTable,
          payload.sourceOrderRowId || null,
          payload.amountPaise,
          payload.currency || 'INR',
          'paid',
          payload.paidAt,
          payload.customer.name || null,
          payload.customer.email || null,
          payload.customer.mobile || null,
          safeJsonStringify(payload.customer.addressLines, []),
          payload.metaJson || null,
        );
      paymentRow = db.prepare('SELECT * FROM payment_records WHERE id = ?').get(Number(result.lastInsertRowid));
    } catch (error) {
      if (!String(error?.message || '').includes('UNIQUE')) throw error;
      paymentRow =
        db.prepare('SELECT * FROM payment_records WHERE gateway_payment_id = ?').get(payload.gatewayPaymentId) ||
        db.prepare('SELECT * FROM payment_records WHERE gateway_order_id = ?').get(payload.gatewayOrderId) ||
        (payload.sourceOrderTable && payload.sourceOrderRowId != null
          ? db
              .prepare('SELECT * FROM payment_records WHERE source_order_table = ? AND source_order_row_id = ?')
              .get(payload.sourceOrderTable, payload.sourceOrderRowId)
          : null);
    }
  }

  ensureInvoiceForPaymentRecord(
    paymentRow.id,
    {
      invoiceDate: payload.paidAt,
      currency: payload.currency || 'INR',
      subtotalPaise: payload.amountPaise,
      totalPaise: payload.amountPaise,
      academy: payload.academy,
      customer: payload.customer,
      notesText: payload.notesText,
    },
    payload.lineItems,
  );

  return getPaymentRecordById(paymentRow.id);
}

function ensurePaymentLedgerForCourseOrder({ orderRow, paymentId, paidAtIso = new Date().toISOString() }) {
  const customer = loadCustomerSnapshot(orderRow.user_id);
  const academy = loadAcademySnapshot();
  const courseTitle = loadCourseTitle(orderRow.course_id);
  return ensurePaymentWithInvoice({
    userId: Number(orderRow.user_id),
    paymentKind: 'purchase',
    orderKind: 'purchase',
    courseId: Number(orderRow.course_id),
    comboId: null,
    billingPackageId: null,
    courseTitle,
    comboTitle: '',
    packageLabel: 'One-time purchase',
    gatewayOrderId: orderRow.razorpay_order_id,
    gatewayPaymentId: paymentId,
    sourceOrderTable: 'razorpay_course_orders',
    sourceOrderRowId: Number(orderRow.id),
    amountPaise: Number(orderRow.amount_paise || 0),
    currency: orderRow.currency || 'INR',
    paidAt: paidAtIso,
    customer,
    academy,
    metaJson: safeJsonStringify({ enrollmentType: 'purchase' }, {}),
    notesText: 'Thank you for your payment.',
    lineItems: [
      {
        itemName: courseTitle || 'Course purchase',
        description: 'One-time full course access',
        quantity: 1,
        unitRatePaise: Number(orderRow.amount_paise || 0),
        amountPaise: Number(orderRow.amount_paise || 0),
        metaJson: safeJsonStringify({ orderKind: 'purchase' }, {}),
      },
    ],
  });
}

function ensurePaymentLedgerForBillingOrder({ orderRow, paymentId, paidAtIso = new Date().toISOString() }) {
  const pkg = loadBillingPackageAny(orderRow.billing_package_id);
  const customer = loadCustomerSnapshot(orderRow.user_id);
  const academy = loadAcademySnapshot();
  const courseTitle = loadCourseTitle(orderRow.course_id);
  const comboTitle = loadComboTitle(orderRow.combo_id);
  const comboCourses = loadComboCourseTitles(orderRow.combo_id);
  const packageLabel = formatPackageLabel(pkg);
  const descriptionParts = [packageLabel];
  if (comboCourses.length) descriptionParts.push(`Courses: ${comboCourses.join(', ')}`);
  return ensurePaymentWithInvoice({
    userId: Number(orderRow.user_id),
    paymentKind: String(orderRow.order_kind || '').toLowerCase() === 'renewal' ? 'renewal' : String(orderRow.order_kind || '').toLowerCase() === 'combo' ? 'combo' : 'subscribe',
    orderKind: String(orderRow.order_kind || '').toLowerCase() || 'subscribe',
    courseId: Number(orderRow.course_id) || null,
    comboId: Number(orderRow.combo_id) || null,
    billingPackageId: Number(orderRow.billing_package_id),
    courseTitle,
    comboTitle,
    packageLabel,
    gatewayOrderId: orderRow.razorpay_order_id,
    gatewayPaymentId: paymentId,
    sourceOrderTable: 'razorpay_billing_orders',
    sourceOrderRowId: Number(orderRow.id),
    amountPaise: Number(orderRow.amount_paise || 0),
    currency: orderRow.currency || 'INR',
    paidAt: paidAtIso,
    customer,
    academy,
    metaJson: safeJsonStringify(
      {
        orderKind: orderRow.order_kind,
        comboCourses,
      },
      {},
    ),
    notesText: 'Thank you for your payment.',
    lineItems: [
      {
        itemName: courseTitle || comboTitle || 'Course subscription',
        description: descriptionParts.filter(Boolean).join(' | '),
        quantity: 1,
        unitRatePaise: Number(orderRow.amount_paise || 0),
        amountPaise: Number(orderRow.amount_paise || 0),
        metaJson: safeJsonStringify({ billingPackageId: orderRow.billing_package_id }, {}),
      },
    ],
  });
}

function ensureApplyDuePaymentRecord({
  dueRow,
  amountPaise,
  paymentSource = 'razorpay',
  gateway = 'razorpay',
  gatewayOrderId,
  gatewayPaymentId,
  sourceOrderTable,
  sourceOrderRowId,
  manualReference = null,
  manualRecordedBy = null,
  paidAtIso = new Date().toISOString(),
}) {
  const customer = loadCustomerSnapshot(dueRow.user_id);
  const academy = loadAcademySnapshot();
  const courseTitle = loadCourseTitle(dueRow.course_id);
  const batchLabel = dueRow.batch_number
    ? `Batch #${dueRow.batch_number}`
    : String(dueRow.batch_title || dueRow.batch_name || '').trim();
  const dueLabel = String(dueRow.label_text || '').trim() || 'Apply course payment';
  const parts = [dueLabel];
  if (batchLabel) parts.push(batchLabel);
  return ensurePaymentWithInvoice({
    userId: Number(dueRow.user_id),
    paymentKind: paymentKindForApplyDue(dueRow.due_kind),
    orderKind: `apply_${String(dueRow.due_kind || '').toLowerCase()}`,
    courseId: Number(dueRow.course_id),
    comboId: null,
    billingPackageId: null,
    applyBillingProfileId: Number(dueRow.billing_profile_id),
    applyDueItemId: Number(dueRow.id),
    courseTitle,
    comboTitle: '',
    packageLabel: parts.filter(Boolean).join(' · '),
    gateway,
    paymentSource,
    gatewayOrderId,
    gatewayPaymentId,
    manualReference,
    manualRecordedBy,
    sourceOrderTable,
    sourceOrderRowId,
    amountPaise: Number(amountPaise || 0),
    currency: 'INR',
    paidAt: paidAtIso,
    customer,
    academy,
    metaJson: safeJsonStringify(
      {
        applyBillingProfileId: dueRow.billing_profile_id,
        applyDueItemId: dueRow.id,
        dueKind: dueRow.due_kind,
        paymentSource,
        manualReference,
      },
      {},
    ),
    notesText: 'Thank you for your payment.',
    lineItems: [
      {
        itemName: courseTitle || 'Apply course payment',
        description: parts.filter(Boolean).join(' | '),
        quantity: 1,
        unitRatePaise: Number(amountPaise || 0),
        amountPaise: Number(amountPaise || 0),
        metaJson: safeJsonStringify({ dueItemId: dueRow.id, billingProfileId: dueRow.billing_profile_id }, {}),
      },
    ],
  });
}

function getPaymentRecordById(paymentId) {
  const row = db
    .prepare(
      `SELECT p.*, i.id AS invoice_id, i.invoice_number, i.invoice_date
       FROM payment_records p
       LEFT JOIN invoice_records i ON i.payment_record_id = p.id
       WHERE p.id = ?`,
    )
    .get(paymentId);
  return mapPaymentRow(row);
}

function getPaymentRecordForUser(userId, paymentId) {
  const row = db
    .prepare(
      `SELECT p.*, i.id AS invoice_id, i.invoice_number, i.invoice_date
       FROM payment_records p
       LEFT JOIN invoice_records i ON i.payment_record_id = p.id
       WHERE p.id = ? AND p.user_id = ?`,
    )
    .get(paymentId, userId);
  return mapPaymentRow(row);
}

function listPaymentRecordsForUser(userId) {
  const rows = db
    .prepare(
      `SELECT p.*, i.id AS invoice_id, i.invoice_number, i.invoice_date
       FROM payment_records p
       LEFT JOIN invoice_records i ON i.payment_record_id = p.id
       WHERE p.user_id = ?
       ORDER BY datetime(p.paid_at) DESC, p.id DESC`,
    )
    .all(userId);
  return rows.map(mapPaymentRow);
}

function listPaymentRecordsForAdmin({ search = '', paymentKind = '' } = {}) {
  const like = `%${String(search || '').trim()}%`;
  const kind = String(paymentKind || '').trim().toLowerCase();
  const rows = db
    .prepare(
      `SELECT p.*, i.id AS invoice_id, i.invoice_number, i.invoice_date
       FROM payment_records p
       LEFT JOIN invoice_records i ON i.payment_record_id = p.id
       WHERE (? = '' OR LOWER(p.payment_kind) = ?)
         AND (
           ? = '%%'
           OR COALESCE(p.customer_name, '') LIKE ?
           OR COALESCE(p.customer_email, '') LIKE ?
           OR COALESCE(p.course_title, '') LIKE ?
           OR COALESCE(p.combo_title, '') LIKE ?
           OR COALESCE(i.invoice_number, '') LIKE ?
           OR COALESCE(p.gateway_order_id, '') LIKE ?
           OR COALESCE(p.gateway_payment_id, '') LIKE ?
           OR COALESCE(p.manual_reference, '') LIKE ?
         )
       ORDER BY datetime(p.paid_at) DESC, p.id DESC`,
    )
    .all(kind, kind, like, like, like, like, like, like, like, like, like);
  return rows.map(mapPaymentRow);
}

function getInvoiceBundleByPaymentId(paymentId) {
  const payment = getPaymentRecordById(paymentId);
  if (!payment) return null;
  const invoice = db.prepare('SELECT * FROM invoice_records WHERE payment_record_id = ?').get(paymentId);
  if (!invoice) return null;
  const lineItems = db
    .prepare('SELECT * FROM invoice_line_items WHERE invoice_record_id = ? ORDER BY line_order ASC, id ASC')
    .all(invoice.id)
    .map((row) => ({
      id: row.id,
      itemName: row.item_name || '',
      description: row.description || '',
      quantity: Number(row.quantity || 1),
      unitRatePaise: Number(row.unit_rate_paise || 0),
      amountPaise: Number(row.amount_paise || 0),
    }));
  return {
    payment,
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoice_number || '',
      invoiceDateIso: invoice.invoice_date,
      currency: invoice.currency || 'INR',
      subtotalPaise: Number(invoice.subtotal_paise || 0),
      totalPaise: Number(invoice.total_paise || 0),
      academyName: invoice.academy_name || 'EngLeash Academy',
      academyEmail: invoice.academy_email || '',
      academyPhone: invoice.academy_phone || '',
      academyAddressLines: parseJsonArray(invoice.academy_address_lines_json),
      customerName: invoice.customer_name || '',
      customerEmail: invoice.customer_email || '',
      customerMobile: invoice.customer_mobile || '',
      customerAddressLines: parseJsonArray(invoice.customer_address_lines_json),
      notesText: invoice.notes_text || '',
      lineItems,
    },
  };
}

module.exports = {
  buildInvoiceNumber,
  ensureApplyDuePaymentRecord,
  ensurePaymentLedgerForCourseOrder,
  ensurePaymentLedgerForBillingOrder,
  formatPackageLabel,
  getInvoiceBundleByPaymentId,
  getPaymentRecordById,
  getPaymentRecordForUser,
  listPaymentRecordsForAdmin,
  listPaymentRecordsForUser,
  loadAcademySnapshot,
};
