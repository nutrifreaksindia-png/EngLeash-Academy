const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');
const uploadMemory = require('../uploadMemory');
const { uploadToSpaces, isSpacesConfigured, deleteObjectsUnderPrefix } = require('../services/spaces');

const router = express.Router();

function hasColumn(tableName, columnName) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
    return cols.some((c) => String(c.name || '').toLowerCase() === String(columnName || '').toLowerCase());
  } catch {
    return false;
  }
}

function tableExists(name) {
  try {
    return !!db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND lower(name) = lower(?) LIMIT 1")
      .get(String(name || ''));
  } catch {
    return false;
  }
}

/**
 * Rows that references users(id) without ON DELETE CASCADE will block deletes.
 * Reassign FKs onto the deleting admin where NOT NULL required; nullable FKs cleared.
 */
function reassignUserOutboundReferences(deleteUserId, reassignUserId) {
  if (!Number.isFinite(deleteUserId) || !Number.isFinite(reassignUserId) || deleteUserId === reassignUserId)
    return;

  db.prepare('UPDATE batches SET trainer_id = ? WHERE trainer_id = ?').run(reassignUserId, deleteUserId);
  db.prepare('UPDATE batches SET created_by = ? WHERE created_by = ?').run(reassignUserId, deleteUserId);
  db.prepare('UPDATE live_sessions SET created_by = ? WHERE created_by = ?').run(reassignUserId, deleteUserId);
  db.prepare('UPDATE live_session_speakers SET promoted_by = ? WHERE promoted_by = ?').run(
    reassignUserId,
    deleteUserId,
  );
  db.prepare('UPDATE batch_session_attendance SET marked_by = ? WHERE marked_by = ?').run(
    reassignUserId,
    deleteUserId,
  );
  db.prepare('UPDATE quiz_bank SET created_by = ? WHERE created_by = ?').run(reassignUserId, deleteUserId);
  db.prepare('UPDATE quiz_assignments SET created_by = ? WHERE created_by = ?').run(reassignUserId, deleteUserId);

  db.prepare('UPDATE quiz_versions SET published_by = NULL WHERE published_by = ?').run(deleteUserId);
  db.prepare('UPDATE batch_sessions SET cancelled_by = NULL WHERE cancelled_by = ?').run(deleteUserId);
  db.prepare('UPDATE course_enrollments SET approved_by = NULL WHERE approved_by = ?').run(deleteUserId);
  db.prepare('UPDATE holidays SET created_by = NULL WHERE created_by = ?').run(deleteUserId);
  db.prepare('UPDATE lesson_library SET created_by = NULL WHERE created_by = ?').run(deleteUserId);
  db.prepare('UPDATE batch_assignments SET created_by = NULL WHERE created_by = ?').run(deleteUserId);
  db.prepare('UPDATE video_library SET created_by = NULL WHERE created_by = ?').run(deleteUserId);
  db.prepare('UPDATE video_assignments SET created_by = NULL WHERE created_by = ?').run(deleteUserId);
  db.prepare('UPDATE study_material_library SET created_by = NULL WHERE created_by = ?').run(deleteUserId);
  db.prepare('UPDATE study_material_assignments SET created_by = NULL WHERE created_by = ?').run(deleteUserId);
  db.prepare('UPDATE worksheet_library SET created_by = NULL WHERE created_by = ?').run(deleteUserId);
  db.prepare('UPDATE worksheet_assignments SET created_by = NULL WHERE created_by = ?').run(deleteUserId);
  db.prepare('UPDATE assignment_library SET created_by = NULL WHERE created_by = ?').run(deleteUserId);

  try {
    db.prepare('UPDATE live_session_logs SET user_id = NULL WHERE user_id = ?').run(deleteUserId);
  } catch (_) {
    /* column may vary in legacy DB */
  }

  if (tableExists('quiz_attempts')) {
    try {
      db.prepare('DELETE FROM quiz_attempts WHERE user_id = ?').run(deleteUserId);
    } catch (_) {
      /* ignore */
    }
  }
}

function extractSpacesKeyFromUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return decodeURIComponent(parsed.pathname || '').replace(/^\/+/, '');
  } catch {
    return '';
  }
}

async function resolveProfilePhotoUrl(url) {
  const raw = String(url || '').trim();
  // Profile photos are uploaded with public-read ACL; return stable raw URL for mobile image rendering.
  // Signed URLs caused Android Image decode/load failures in RN for this flow.
  return raw;
}

router.get('/me', auth, async (req, res) => {
  const freshUser = db
    .prepare('SELECT id, email, name, role, status, mobile_number, profile_photo_url, created_at FROM users WHERE id = ?')
    .get(req.user.id);
  if (!freshUser) return res.status(404).json({ error: 'User not found' });
  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(req.user.id);
  const studentProfile = freshUser.role === 'Student'
    ? db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(req.user.id)
    : null;
  const resolvedPhoto = await resolveProfilePhotoUrl(freshUser.profile_photo_url || profile?.profile_photo_url || '');
  res.json({
    ...freshUser,
    profile_photo_url: resolvedPhoto || freshUser.profile_photo_url || null,
    profile: profile ? { ...profile, profile_photo_url: resolvedPhoto || profile.profile_photo_url || null } : null,
    studentProfile: studentProfile || null,
  });
});

router.get('/', auth, requireRole('Admin'), (req, res) => {
  const hasBatchNumber = hasColumn('batches', 'batch_number');
  const hasBatchTitle = hasColumn('batches', 'title');
  const hasBatchType = hasColumn('batches', 'batch_type');

  const batchNumberExpr = hasBatchNumber ? 'b.batch_number' : 'CAST(b.id AS TEXT)';
  const batchTitleExpr = hasBatchTitle ? 'COALESCE(b.title, b.name)' : 'b.name';
  const batchTypeExpr = hasBatchType ? 'COALESCE(b.batch_type, b.session_type)' : 'b.session_type';

  const users = db
    .prepare(
      `SELECT
        u.id,
        u.email,
        u.name,
        u.role,
        u.status,
        u.mobile_number,
        u.profile_photo_url,
        u.created_at,
        sp.city_district AS city_district,
        (
          SELECT ${batchNumberExpr}
          FROM batch_members bm
          JOIN batches b ON b.id = bm.batch_id
          WHERE bm.student_id = u.id
          ORDER BY b.id DESC
          LIMIT 1
        ) AS connected_batch_number,
        (
          SELECT ${batchTitleExpr}
          FROM batch_members bm
          JOIN batches b ON b.id = bm.batch_id
          WHERE bm.student_id = u.id
          ORDER BY b.id DESC
          LIMIT 1
        ) AS connected_batch_title,
        (
          SELECT ${batchTypeExpr}
          FROM batch_members bm
          JOIN batches b ON b.id = bm.batch_id
          WHERE bm.student_id = u.id
          ORDER BY b.id DESC
          LIMIT 1
        ) AS connected_batch_type
      FROM users u
      LEFT JOIN student_profiles sp ON sp.user_id = u.id
      ORDER BY u.id DESC`
    )
    .all();
  res.json(users);
});

router.get('/:id', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare(`
    SELECT id, email, name, role, status, mobile_number, profile_photo_url, created_at
    FROM users WHERE id = ?
  `).get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(id) || null;
  const studentProfile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(id) || null;
  const hasBatchNumber = hasColumn('batches', 'batch_number');
  const hasBatchTitle = hasColumn('batches', 'title');
  const hasBatchType = hasColumn('batches', 'batch_type');

  const batchNumberExpr = hasBatchNumber ? 'b.batch_number' : 'CAST(b.id AS TEXT)';
  const batchTitleExpr = hasBatchTitle ? 'COALESCE(b.title, b.name)' : 'b.name';
  const batchTypeExpr = hasBatchType ? 'COALESCE(b.batch_type, b.session_type)' : 'b.session_type';

  const connectedBatches = db
    .prepare(
      `SELECT
        b.id,
        ${batchNumberExpr} AS batch_number,
        ${batchTitleExpr} AS batch_title,
        ${batchTypeExpr} AS batch_type
      FROM batch_members bm
      JOIN batches b ON b.id = bm.batch_id
      WHERE bm.student_id = ?
      ORDER BY b.id DESC`
    )
    .all(id);
  res.json({ ...user, profile, studentProfile, connectedBatches });
});

router.post('/', auth, requireRole('Admin'), (req, res) => {
  const {
    email,
    password,
    name,
    role: rawRole,
    mobileNumber,
    profilePhotoUrl,
    gender,
    birthDate,
    addressLine1,
    addressLine2,
    cityDistrict,
    stateProvince,
    country,
    countryCode,
    occupation,
    policiesAgreed,
  } = req.body;
  const role = typeof rawRole === 'string' ? rawRole.trim() : rawRole;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password and role are required' });
  }
  const allowed = ['Admin', 'Trainer', 'Student', 'Lab', 'Creator'];
  if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const hash = bcrypt.hashSync(password, 10);
  let userId;
  try {
    const info = db
      .prepare(
        'INSERT INTO users (email, password_hash, name, role, status, mobile_number, profile_photo_url) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(email.trim().toLowerCase(), hash, name || '', role, 'approved', mobileNumber || null, profilePhotoUrl || null);
    userId = Number(info.lastInsertRowid);
    db.prepare(`
      INSERT INTO user_profiles (user_id, full_name, email, role, profile_photo_url, mobile_number)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, name || '', email.trim().toLowerCase(), role, profilePhotoUrl || null, mobileNumber || null);
    if (role === 'Student' || role === 'Lab') {
      db.prepare(`
        INSERT INTO student_profiles (
          user_id, gender, birth_date, address_line_1, address_line_2, city_district, state_province, country, country_code, occupation, policies_agreed
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        gender || null,
        birthDate || null,
        addressLine1 || null,
        addressLine2 || null,
        cityDistrict || null,
        stateProvince || null,
        country || null,
        countryCode || null,
        occupation || null,
        typeof policiesAgreed === 'boolean' ? (policiesAgreed ? 1 : 0) : null
      );
    }
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    throw e;
  }
  const row = db
    .prepare('SELECT id, email, name, role, status, mobile_number, profile_photo_url, created_at FROM users WHERE id = ?')
    .get(userId);
  res.status(201).json(row);
});

router.put('/me', auth, (req, res) => {
  const id = req.user.id;
  const existing = db.prepare('SELECT id, role, email, name FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'User not found' });
  const {
    name,
    mobileNumber,
    profilePhotoUrl,
    gender,
    birthDate,
    addressLine1,
    addressLine2,
    cityDistrict,
    stateProvince,
    country,
    countryCode,
    occupation,
    policiesAgreed,
  } = req.body || {};

  db.prepare(`
    UPDATE users
    SET
      name = COALESCE(?, name),
      mobile_number = COALESCE(?, mobile_number),
      profile_photo_url = COALESCE(?, profile_photo_url)
    WHERE id = ?
  `).run(
    name || null,
    mobileNumber || null,
    profilePhotoUrl || null,
    id
  );

  db.prepare(`
    INSERT INTO user_profiles (user_id, full_name, email, role, profile_photo_url, mobile_number)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      full_name = excluded.full_name,
      profile_photo_url = excluded.profile_photo_url,
      mobile_number = excluded.mobile_number,
      updated_at = datetime('now')
  `).run(
    id,
    name || existing.name || '',
    existing.email,
    existing.role,
    profilePhotoUrl || null,
    mobileNumber || null
  );

  if (existing.role === 'Student' || existing.role === 'Lab') {
    db.prepare(`
      INSERT INTO student_profiles (
        user_id, gender, birth_date, address_line_1, address_line_2, city_district, state_province, country, country_code, occupation, policies_agreed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        gender = COALESCE(excluded.gender, student_profiles.gender),
        birth_date = COALESCE(excluded.birth_date, student_profiles.birth_date),
        address_line_1 = COALESCE(excluded.address_line_1, student_profiles.address_line_1),
        address_line_2 = COALESCE(excluded.address_line_2, student_profiles.address_line_2),
        city_district = COALESCE(excluded.city_district, student_profiles.city_district),
        state_province = COALESCE(excluded.state_province, student_profiles.state_province),
        country = COALESCE(excluded.country, student_profiles.country),
        country_code = COALESCE(excluded.country_code, student_profiles.country_code),
        occupation = COALESCE(excluded.occupation, student_profiles.occupation),
        policies_agreed = COALESCE(excluded.policies_agreed, student_profiles.policies_agreed),
        updated_at = datetime('now')
    `).run(
      id,
      gender || null,
      birthDate || null,
      addressLine1 || null,
      addressLine2 || null,
      cityDistrict || null,
      stateProvince || null,
      country || null,
      countryCode || null,
      occupation || null,
      typeof policiesAgreed === 'boolean' ? (policiesAgreed ? 1 : 0) : null
    );
  }

  const user = db.prepare('SELECT id, email, name, role, status, mobile_number, profile_photo_url, created_at FROM users WHERE id = ?').get(id);
  const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id = ?').get(id) || null;
  const studentProfile = db.prepare('SELECT * FROM student_profiles WHERE user_id = ?').get(id) || null;
  res.json({ ...user, profile, studentProfile });
});

async function uploadProfilePhotoForUser(userId, file) {
  if (!isSpacesConfigured()) {
    throw new Error('DigitalOcean Spaces is not configured');
  }
  const prefix = `profiles/user-${userId}/`;
  // Keep one active profile photo per user by clearing old files first.
  const deleted = await deleteObjectsUnderPrefix(prefix);
  const extByMime = (file.mimetype || '').toLowerCase();
  let safeExt = '.jpg';
  if (extByMime.includes('png')) safeExt = '.png';
  else if (extByMime.includes('webp')) safeExt = '.webp';
  else if (extByMime.includes('jpeg') || extByMime.includes('jpg')) safeExt = '.jpg';
  else {
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (ext && ext.length <= 5) safeExt = ext;
  }
  const key = `${prefix}${Date.now()}${safeExt}`;
  const uploaded = await uploadToSpaces({
    buffer: file.buffer,
    mimeType: file.mimetype || 'image/jpeg',
    key,
  });
  db.prepare('UPDATE users SET profile_photo_url = ? WHERE id = ?').run(uploaded.publicUrl, userId);
  db.prepare(`
    INSERT INTO user_profiles (user_id, full_name, email, role, profile_photo_url, mobile_number)
    SELECT id, name, email, role, ?, mobile_number FROM users WHERE id = ?
    ON CONFLICT(user_id) DO UPDATE SET
      profile_photo_url = excluded.profile_photo_url,
      updated_at = datetime('now')
  `).run(uploaded.publicUrl, userId);
  return uploaded.publicUrl;
}

router.post('/me/photo', auth, uploadMemory.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'File required' });
    const photoUrl = await uploadProfilePhotoForUser(req.user.id, req.file);
    res.json({ ok: true, photoUrl });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Profile photo upload failed' });
  }
});

router.post('/:id/photo', auth, requireRole('Admin'), uploadMemory.single('file'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!req.file) return res.status(400).json({ error: 'File required' });
    const photoUrl = await uploadProfilePhotoForUser(id, req.file);
    res.json({ ok: true, photoUrl });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Profile photo upload failed' });
  }
});

router.get('/pending', auth, requireRole('Admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, u.status, u.mobile_number, u.created_at,
           sp.gender, sp.birth_date, sp.address_line_1, sp.address_line_2, sp.city_district, sp.state_province, sp.country, sp.country_code, sp.occupation
    FROM users u
    LEFT JOIN student_profiles sp ON sp.user_id = u.id
    WHERE u.status = 'pending'
    ORDER BY u.created_at ASC
  `).all();
  res.json(rows);
});

router.post('/:id/approve', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, status FROM users WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  db.prepare("UPDATE users SET status = 'approved' WHERE id = ?").run(id);
  const user = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(id);
  res.json(user);
});

router.post('/:id/reject', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT id, status FROM users WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'User not found' });
  db.prepare("UPDATE users SET status = 'rejected' WHERE id = ?").run(id);
  const user = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(id);
  res.json(user);
});

router.put('/:id', auth, requireRole('Admin'), (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id, role, email, name FROM users WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const {
    name,
    email,
    mobileNumber,
    profilePhotoUrl,
    status,
    gender,
    birthDate,
    addressLine1,
    addressLine2,
    cityDistrict,
    stateProvince,
    country,
    countryCode,
    occupation,
    policiesAgreed,
  } = req.body;

  db.prepare(`
    UPDATE users
    SET
      name = COALESCE(?, name),
      email = COALESCE(?, email),
      mobile_number = COALESCE(?, mobile_number),
      profile_photo_url = COALESCE(?, profile_photo_url),
      status = COALESCE(?, status)
    WHERE id = ?
  `).run(
    name || null,
    email ? String(email).trim().toLowerCase() : null,
    mobileNumber || null,
    profilePhotoUrl || null,
    status || null,
    id
  );

  db.prepare(`
    INSERT INTO user_profiles (user_id, full_name, email, role, profile_photo_url, mobile_number)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      full_name = excluded.full_name,
      email = excluded.email,
      profile_photo_url = excluded.profile_photo_url,
      mobile_number = excluded.mobile_number,
      updated_at = datetime('now')
  `).run(
    id,
    name || existing.name || '',
    (email ? String(email).trim().toLowerCase() : existing.email),
    existing.role,
    profilePhotoUrl || null,
    mobileNumber || null
  );

  if (existing.role === 'Student' || existing.role === 'Lab') {
    db.prepare(`
      INSERT INTO student_profiles (
        user_id, gender, birth_date, address_line_1, address_line_2, city_district, state_province, country, country_code, occupation, policies_agreed
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        gender = COALESCE(excluded.gender, student_profiles.gender),
        birth_date = COALESCE(excluded.birth_date, student_profiles.birth_date),
        address_line_1 = COALESCE(excluded.address_line_1, student_profiles.address_line_1),
        address_line_2 = COALESCE(excluded.address_line_2, student_profiles.address_line_2),
        city_district = COALESCE(excluded.city_district, student_profiles.city_district),
        state_province = COALESCE(excluded.state_province, student_profiles.state_province),
        country = COALESCE(excluded.country, student_profiles.country),
        country_code = COALESCE(excluded.country_code, student_profiles.country_code),
        occupation = COALESCE(excluded.occupation, student_profiles.occupation),
        policies_agreed = COALESCE(excluded.policies_agreed, student_profiles.policies_agreed),
        updated_at = datetime('now')
    `).run(
      id,
      gender || null,
      birthDate || null,
      addressLine1 || null,
      addressLine2 || null,
      cityDistrict || null,
      stateProvince || null,
      country || null,
      countryCode || null,
      occupation || null,
      typeof policiesAgreed === 'boolean' ? (policiesAgreed ? 1 : 0) : null
    );
  }

  const user = db.prepare('SELECT id, email, name, role, status, mobile_number, profile_photo_url, created_at FROM users WHERE id = ?').get(id);
  res.json(user);
});

router.delete('/:id', auth, requireRole('Admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot delete the account you are logged in as.' });

  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  if (target.role === 'Admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'Admin'").get()?.c ?? 0;
    if (Number(adminCount) <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last administrator account.' });
    }
  }

  const reassignedAdminId = Number(req.user.id);
  if (!Number.isFinite(reassignedAdminId)) {
    return res.status(400).json({ error: 'Invalid acting user' });
  }

  try {
    if (isSpacesConfigured()) {
      try {
        await deleteObjectsUnderPrefix(`profiles/user-${id}/`);
      } catch (_) {
        /* best-effort */
      }
    }
    const runDelete = db.transaction(() => {
      reassignUserOutboundReferences(id, reassignedAdminId);
      /* batch_trainers.trainer_id has ON DELETE CASCADE; batches.trainer_id must be rewritten first */
      db.prepare('DELETE FROM batch_trainers WHERE trainer_id = ?').run(id);
      const r = db.prepare('DELETE FROM users WHERE id = ?').run(id);
      return r.changes;
    });
    const changes = runDelete();
    if (changes === 0) return res.status(404).json({ error: 'User not found' });
    res.status(204).end();
  } catch (e) {
    if (e && String(e.code || '').includes('SQLITE_CONSTRAINT')) {
      console.error('[user-delete] constraint after cleanup', id, e);
      return res.status(409).json({
        error: `Still blocked by database rules: ${String(e.message || 'constraint')} If this persists, describe the role and recent activity for this account.`,
      });
    }
    console.error('[user-delete]', id, e);
    res.status(500).json({ error: e.message || 'Could not delete user' });
  }
});

module.exports = router;
