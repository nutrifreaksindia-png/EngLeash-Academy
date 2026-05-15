const express = require('express');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const upload = require('../upload');
const { syncCourseLessonSlots } = require('../lib/syncCourseLessonSlots');
const { learnerHasCourseAccess } = require('../lib/courseAccess');
const { myCourseScheduleHint } = require('../lib/dayWiseProgress');
const { isSpacesConfigured, deleteObjectsUnderPrefix } = require('../services/spaces');

const router = express.Router();

function numberOrDefault(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function netCourseFeeInr(feeInr, discountInr) {
  return Math.max(0, numberOrDefault(feeInr, 0) - numberOrDefault(discountInr, 0));
}

function splitEvenlyInr(totalInr, count) {
  const totalPaise = Math.round(Math.max(0, numberOrDefault(totalInr, 0)) * 100);
  const n = Math.max(1, Math.trunc(numberOrDefault(count, 1)));
  const base = Math.floor(totalPaise / n);
  let remainder = totalPaise - base * n;
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder -= 1;
    out.push((base + extra) / 100);
  }
  return out;
}

function normalizeApplyInstallmentAmounts(raw, count, netFeeInr) {
  const n = Math.max(1, Math.trunc(numberOrDefault(count, 1)));
  const values = Array.isArray(raw) ? raw : [];
  const manualCount = Math.max(0, n - 1);
  if (values.length < manualCount) {
    return { ok: false, error: `Enter the first ${manualCount} installment amount${manualCount === 1 ? '' : 's'}.` };
  }
  const netPaise = Math.round(Math.max(0, numberOrDefault(netFeeInr, 0)) * 100);
  const manualAmounts = values.slice(0, manualCount).map((x) => numberOrDefault(x, NaN));
  if (manualAmounts.some((x) => !Number.isFinite(x) || x < 0)) {
    return { ok: false, error: 'Installment amounts must be valid non-negative numbers.' };
  }
  const manualPaise = manualAmounts.map((amount) => Math.round(amount * 100));
  const manualTotalPaise = manualPaise.reduce((sum, amount) => sum + amount, 0);
  if (manualTotalPaise > netPaise) {
    return { ok: false, error: 'Installments before the final one cannot exceed the net course fee.' };
  }
  const amounts = [...manualPaise, netPaise - manualTotalPaise].map((paise) => paise / 100);
  return { ok: true, json: JSON.stringify(amounts) };
}

router.get('/', auth, (req, res) => {
  const { role } = req.user;
  if (role === 'Admin' || role === 'Creator') {
    const courses = db.prepare(
      `SELECT id, name, description, image_url, sort_order, is_published, created_at,
              highlights, specifications_html, duration_days, lesson_schedule_json, modes_json, languages_json,
              fee_inr, discount_inr, course_status, enrollment_type, progression_type,
              apply_registration_fee_inr, apply_single_payment_discount_inr,
              apply_installment_count, apply_installment_amounts_json, apply_installment_gap_days, apply_grace_days, apply_enquiry_enabled
       FROM courses ORDER BY sort_order, id`
    ).all();
    return res.json(courses);
  }
  const uid = req.user.id;
  const allCourses = db
    .prepare(
      `
    SELECT c.id, c.name, c.description, c.image_url, c.sort_order, c.is_published, c.created_at,
           c.highlights, c.specifications_html, c.duration_days, c.lesson_schedule_json, c.modes_json, c.languages_json,
           c.fee_inr, c.discount_inr, c.course_status, c.enrollment_type, c.progression_type,
           c.apply_registration_fee_inr, c.apply_single_payment_discount_inr,
           c.apply_installment_count, c.apply_installment_amounts_json, c.apply_installment_gap_days, c.apply_grace_days, c.apply_enquiry_enabled
    FROM courses c
    WHERE c.is_published = 1 AND COALESCE(c.course_status, 'Active') = 'Active'
    ORDER BY c.sort_order, c.id
  `,
    )
    .all();

  let courses = allCourses;
  if (role !== 'Admin' && role !== 'Creator') {
    courses = allCourses.filter((c) => learnerHasCourseAccess(uid, c.id));
  }

  const learner =
    req.user.role === 'Student' || req.user.role === 'Lab'
      ? (c) => ({
          ...c,
          my_schedule_hint: myCourseScheduleHint(req.user.id, c),
        })
      : (c) => c;
  res.json(courses.map(learner));
});

router.get('/catalog', auth, requireRole('Admin', 'Trainer', 'Student', 'Lab'), (req, res) => {
  const courses = db.prepare(
    `SELECT id, name, description, image_url, sort_order, highlights, duration_days, modes_json, languages_json,
            fee_inr, discount_inr, course_status, enrollment_type, progression_type,
            apply_registration_fee_inr, apply_single_payment_discount_inr,
            apply_installment_count, apply_installment_amounts_json, apply_installment_gap_days, apply_grace_days, apply_enquiry_enabled
     FROM courses WHERE is_published = 1 AND COALESCE(course_status, 'Active') = 'Active' ORDER BY sort_order, id`
  ).all();
  const uid = req.user.id;
  let enrolledRows = db.prepare('SELECT course_id, status FROM course_enrollments WHERE user_id = ?').all(uid);
  if (enrolledRows.length === 0) {
    enrolledRows = db.prepare("SELECT course_id, 'approved' AS status FROM enrollments WHERE user_id = ?").all(uid);
  }
  const enrollmentByCourse = new Map(enrolledRows.map((r) => [r.course_id, r.status]));
  const batchCourseRows = db
    .prepare(
      `
    SELECT DISTINCT x.course_id AS course_id FROM (
      SELECT bc.course_id AS course_id
      FROM batch_members bm
      INNER JOIN batches b ON b.id = bm.batch_id
      INNER JOIN batch_courses bc ON bc.batch_id = b.id
      INNER JOIN courses co ON co.id = bc.course_id
      WHERE bm.student_id = ?
        AND (
          LOWER(COALESCE(co.enrollment_type, 'free')) IN ('free', 'purchase')
          OR LOWER(COALESCE(b.batch_status, '')) = 'started'
          OR (b.actual_start_date IS NOT NULL AND LENGTH(TRIM(b.actual_start_date)) > 0)
        )
      UNION
      SELECT b.course_id AS course_id
      FROM batch_members bm
      INNER JOIN batches b ON b.id = bm.batch_id
      INNER JOIN courses co ON co.id = b.course_id
      WHERE bm.student_id = ?
        AND b.course_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM batch_courses bx WHERE bx.batch_id = b.id)
        AND (
          LOWER(COALESCE(co.enrollment_type, 'free')) IN ('free', 'purchase')
          OR LOWER(COALESCE(b.batch_status, '')) = 'started'
          OR (b.actual_start_date IS NOT NULL AND LENGTH(TRIM(b.actual_start_date)) > 0)
        )
    ) x
  `,
    )
    .all(uid, uid);
  for (const r of batchCourseRows) {
    if (r.course_id == null) continue;
    const prev = enrollmentByCourse.get(r.course_id);
    if (!prev || prev !== 'approved') enrollmentByCourse.set(r.course_id, 'approved');
  }
  const now = Date.now();
  res.json(
    courses.map((c) => ({
      ...c,
      enrollmentStatus: enrollmentByCourse.get(c.id) || null,
      enrolled: learnerHasCourseAccess(uid, c.id, now),
    })),
  );
});

/** Published catalog for marketing / mobile landing (no auth). */
router.get('/public', (req, res) => {
  const courses = db.prepare(
    `SELECT id, name, description, image_url, sort_order, highlights, duration_days, modes_json, languages_json,
            fee_inr, discount_inr, course_status, enrollment_type, progression_type,
            apply_registration_fee_inr, apply_single_payment_discount_inr,
            apply_installment_count, apply_installment_amounts_json, apply_installment_gap_days, apply_grace_days, apply_enquiry_enabled
     FROM courses WHERE is_published = 1 AND COALESCE(course_status, 'Active') = 'Active' ORDER BY sort_order, id`
  ).all();
  res.json(courses);
});

router.get('/public/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid course id' });
  const c = db.prepare(
    `SELECT id, name, description, image_url, sort_order, highlights, duration_days, modes_json, languages_json,
            fee_inr, discount_inr, course_status, enrollment_type, progression_type, specifications_html,
            apply_registration_fee_inr, apply_single_payment_discount_inr,
            apply_installment_count, apply_installment_amounts_json, apply_installment_gap_days, apply_grace_days, apply_enquiry_enabled
     FROM courses WHERE id = ? AND is_published = 1 AND COALESCE(course_status, 'Active') = 'Active'`
  ).get(id);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  res.json(c);
});

router.get('/:id', auth, (req, res) => {
  const c = db.prepare(`
    SELECT id, name, description, image_url, sort_order, is_published, created_at,
           highlights, specifications_html, duration_days, lesson_schedule_json, modes_json, languages_json,
           fee_inr, discount_inr, course_status, enrollment_type, progression_type,
           apply_registration_fee_inr, apply_single_payment_discount_inr,
           apply_installment_count, apply_installment_amounts_json, apply_installment_gap_days, apply_grace_days, apply_enquiry_enabled
    FROM courses WHERE id = ?
  `).get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Course not found' });
  if (req.user.role !== 'Admin') {
    const access = learnerHasCourseAccess(req.user.id, c.id);
    if (!access) return res.status(403).json({ error: 'Not enrolled in this course' });
  }
  res.json(c);
});

router.post('/', auth, requireRole('Admin'), (req, res) => {
  const {
    name, description, image_url, sort_order,
    highlights, specificationsHtml, durationDays, lessonSchedule, modes, languages,
    feeInr, discountInr, courseStatus, enrollmentType,
    progressionType,
    applyRegistrationFeeInr,
    applySinglePaymentDiscountInr,
    applyInstallmentCount,
    applyInstallmentAmounts,
    applyInstallmentGapDays,
    applyGraceDays,
    applyEnquiryEnabled,
    is_published: isPublishedBody,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  const published =
    isPublishedBody === undefined || isPublishedBody === null
      ? 1
      : isPublishedBody === true || isPublishedBody === 1 || isPublishedBody === '1'
        ? 1
        : 0;
  const enrollmentTypeValue = enrollmentType || 'free';
  const installmentCount = Math.max(1, Math.trunc(numberOrDefault(applyInstallmentCount ?? 2, 2)));
  let installmentAmountsJson = null;
  if (String(enrollmentTypeValue).toLowerCase() === 'apply') {
    const installmentAmounts = normalizeApplyInstallmentAmounts(
      applyInstallmentAmounts,
      installmentCount,
      netCourseFeeInr(feeInr ?? 0, discountInr ?? 0),
    );
    if (!installmentAmounts.ok) return res.status(400).json({ error: installmentAmounts.error });
    installmentAmountsJson = installmentAmounts.json;
  }
  db.prepare(
    `INSERT INTO courses (
      name, description, image_url, sort_order, is_published, highlights, specifications_html, duration_days, lesson_schedule_json, modes_json, languages_json,
      fee_inr, discount_inr, course_status, enrollment_type, progression_type,
      apply_registration_fee_inr, apply_single_payment_discount_inr, apply_installment_count, apply_installment_amounts_json,
      apply_installment_gap_days, apply_grace_days, apply_enquiry_enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    name || '',
    description || '',
    image_url || null,
    sort_order ?? 0,
    published,
    highlights || null,
    specificationsHtml || null,
    durationDays ?? 1,
    lessonSchedule ? JSON.stringify(lessonSchedule) : null,
    modes ? JSON.stringify(modes) : null,
    languages ? JSON.stringify(languages) : null,
    feeInr ?? 0,
    discountInr ?? 0,
    courseStatus || 'Active',
    enrollmentTypeValue,
    progressionType === 'day_wise' ? 'day_wise' : 'unlock_all',
    applyRegistrationFeeInr ?? 999,
    applySinglePaymentDiscountInr ?? 0,
    installmentCount,
    installmentAmountsJson,
    applyInstallmentGapDays ?? 30,
    applyGraceDays ?? 7,
    applyEnquiryEnabled === false || applyEnquiryEnabled === 0 ? 0 : 1
  );
  const row = db.prepare('SELECT * FROM courses WHERE id = last_insert_rowid()').get();
  syncCourseLessonSlots(row.id);
  res.status(201).json(row);
});

router.put('/:id', auth, requireRole('Admin'), (req, res) => {
  const {
    name, description, image_url, sort_order, is_published,
    highlights, specificationsHtml, durationDays, lessonSchedule, modes, languages,
    feeInr, discountInr, courseStatus, enrollmentType,
    progressionType,
    applyRegistrationFeeInr,
    applySinglePaymentDiscountInr,
    applyInstallmentCount,
    applyInstallmentAmounts,
    applyInstallmentGapDays,
    applyGraceDays,
    applyEnquiryEnabled,
  } = req.body;

  const current = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!current) return res.status(404).json({ error: 'Course not found' });
  const nextFeeInr = feeInr === undefined ? current.fee_inr : feeInr;
  const nextDiscountInr = discountInr === undefined ? current.discount_inr : discountInr;
  const nextEnrollmentType = enrollmentType === undefined ? current.enrollment_type : enrollmentType;
  const nextInstallmentCount = Math.max(
    1,
    Math.trunc(numberOrDefault(applyInstallmentCount === undefined ? current.apply_installment_count : applyInstallmentCount, 1)),
  );
  let nextInstallmentRaw =
    applyInstallmentAmounts === undefined
      ? (() => {
          try {
            return JSON.parse(current.apply_installment_amounts_json || '[]');
          } catch (_) {
            return [];
          }
        })()
      : applyInstallmentAmounts;
  let installmentAmountsJson = current.apply_installment_amounts_json || null;
  if (String(nextEnrollmentType || 'free').toLowerCase() === 'apply') {
    if (!Array.isArray(nextInstallmentRaw) || nextInstallmentRaw.length === 0) {
      nextInstallmentRaw = splitEvenlyInr(netCourseFeeInr(nextFeeInr, nextDiscountInr), nextInstallmentCount);
    }
    const installmentAmounts = normalizeApplyInstallmentAmounts(
      nextInstallmentRaw,
      nextInstallmentCount,
      netCourseFeeInr(nextFeeInr, nextDiscountInr),
    );
    if (!installmentAmounts.ok) return res.status(400).json({ error: installmentAmounts.error });
    installmentAmountsJson = installmentAmounts.json;
  }

  db.prepare(
    `UPDATE courses SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      image_url = COALESCE(?, image_url),
      sort_order = COALESCE(?, sort_order),
      is_published = COALESCE(?, is_published),
      highlights = COALESCE(?, highlights),
      specifications_html = COALESCE(?, specifications_html),
      duration_days = COALESCE(?, duration_days),
      lesson_schedule_json = COALESCE(?, lesson_schedule_json),
      modes_json = COALESCE(?, modes_json),
      languages_json = COALESCE(?, languages_json),
      fee_inr = COALESCE(?, fee_inr),
      discount_inr = COALESCE(?, discount_inr),
      course_status = COALESCE(?, course_status),
      enrollment_type = COALESCE(?, enrollment_type),
      apply_registration_fee_inr = COALESCE(?, apply_registration_fee_inr),
      apply_single_payment_discount_inr = COALESCE(?, apply_single_payment_discount_inr),
      apply_installment_count = COALESCE(?, apply_installment_count),
      apply_installment_amounts_json = COALESCE(?, apply_installment_amounts_json),
      apply_installment_gap_days = COALESCE(?, apply_installment_gap_days),
      apply_grace_days = COALESCE(?, apply_grace_days),
      apply_enquiry_enabled = COALESCE(?, apply_enquiry_enabled)
    WHERE id = ?`
  ).run(
    name,
    description,
    image_url,
    sort_order,
    is_published,
    highlights,
    specificationsHtml,
    durationDays,
    lessonSchedule ? JSON.stringify(lessonSchedule) : null,
    modes ? JSON.stringify(modes) : null,
    languages ? JSON.stringify(languages) : null,
    feeInr,
    discountInr,
    courseStatus,
    enrollmentType,
    applyRegistrationFeeInr,
    applySinglePaymentDiscountInr,
    nextInstallmentCount,
    installmentAmountsJson,
    applyInstallmentGapDays,
    applyGraceDays,
    applyEnquiryEnabled === undefined ? undefined : (applyEnquiryEnabled ? 1 : 0),
    req.params.id
  );
  if (progressionType !== undefined) {
    const pt = progressionType === 'day_wise' ? 'day_wise' : 'unlock_all';
    db.prepare('UPDATE courses SET progression_type = ? WHERE id = ?').run(pt, req.params.id);
  }
  const c = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  syncCourseLessonSlots(Number(req.params.id));
  res.json(c);
});

router.post('/:id/cover', auth, requireRole('Admin'), upload.single('file'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid course id' });
  if (!req.file) return res.status(400).json({ error: 'Image file is required' });
  const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(id);
  if (!course) return res.status(404).json({ error: 'Course not found' });

  const rel = `/uploads/${req.file.filename}`;
  db.prepare('UPDATE courses SET image_url = ? WHERE id = ?').run(rel, id);
  const updated = db.prepare('SELECT * FROM courses WHERE id = ?').get(id);
  res.json({ ...updated, imageUrl: `${process.env.API_URL || ''}${rel}` });
});

router.delete('/:id', auth, requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  const course = db.prepare('SELECT id FROM courses WHERE id = ?').get(id);
  if (!course) return res.status(404).json({ error: 'Course not found' });

  if (isSpacesConfigured()) {
    try {
      await deleteObjectsUnderPrefix(`pre-recorded/course-${id}/`);
    } catch (e) {
      console.error('[course-delete] Spaces prerecorded', id, e);
    }
  }

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM razorpay_billing_orders WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_access_grants WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM razorpay_course_orders WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_enrollments WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM enrollments WHERE course_id = ?').run(id);
    db.prepare(
      `DELETE FROM quiz_attempts_v2 WHERE assignment_id IN (
        SELECT id FROM quiz_assignments WHERE scope_type = 'course' AND scope_id = ?
      )`,
    ).run(id);
    db.prepare("DELETE FROM quiz_assignments WHERE scope_type = 'course' AND scope_id = ?").run(id);
    db.prepare("DELETE FROM video_assignments WHERE scope_type = 'course' AND scope_id = ?").run(id);
    db.prepare("DELETE FROM study_material_assignments WHERE scope_type = 'course' AND scope_id = ?").run(id);
    db.prepare("DELETE FROM worksheet_assignments WHERE scope_type = 'course' AND scope_id = ?").run(id);
    try {
      db.prepare('UPDATE batches SET course_id = NULL, subscription_package_id = NULL WHERE course_id = ?').run(id);
    } catch (_) {
      db.prepare('UPDATE batches SET course_id = NULL WHERE course_id = ?').run(id);
    }
    db.prepare("DELETE FROM billing_packages WHERE scope = 'course' AND course_id = ?").run(id);
    db.prepare('DELETE FROM course_combo_members WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM course_lessons WHERE course_id = ?').run(id);
    db.prepare('DELETE FROM courses WHERE id = ?').run(id);
  });
  tx();
  res.status(204).send();
});

module.exports = router;
