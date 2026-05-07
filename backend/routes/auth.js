const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireClient, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

function upsertSession(userId, jti, deviceName) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  db.prepare('INSERT INTO sessions (user_id, token_jti, device_name) VALUES (?, ?, ?)').run(userId, jti, deviceName);
}

router.post('/login', (req, res) => {
  const { email, password, role, client, deviceName: rawDevice } = req.body;
  const deviceName = typeof rawDevice === 'string' && rawDevice.trim() ? rawDevice.trim() : 'Unknown device';
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = role
    ? db.prepare('SELECT id, email, name, role, password_hash, status FROM users WHERE email = ? AND role = ?').get(email, role)
    : db.prepare('SELECT id, email, name, role, password_hash, status FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.status === 'rejected') {
    return res.status(403).json({
      error: `Account is ${user.status}`,
      status: user.status,
    });
  }
  if (user.role === 'Lab' && client !== 'tv') {
    return res.status(403).json({ error: 'Lab login is only allowed from Android TV app' });
  }
  if (user.role !== 'Lab' && client === 'tv') {
    return res.status(403).json({ error: 'Only Lab role can use the TV app' });
  }
  const existing = db.prepare('SELECT device_name FROM sessions WHERE user_id = ?').get(user.id);
  if (existing && !req.body.replaceSession) {
    return res.json({
      alreadyLoggedIn: true,
      deviceName: existing.device_name,
    });
  }
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { userId: user.id, role: user.role, jti },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  upsertSession(user.id, jti, deviceName);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status || 'approved' },
  });
});

router.post('/replace-session', (req, res) => {
  const { email, password, role, client, deviceName: rawDevice } = req.body;
  const deviceName = typeof rawDevice === 'string' && rawDevice.trim() ? rawDevice.trim() : 'Unknown device';
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  const user = role
    ? db.prepare('SELECT id, email, name, role, password_hash, status FROM users WHERE email = ? AND role = ?').get(email, role)
    : db.prepare('SELECT id, email, name, role, password_hash, status FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (user.status === 'rejected') {
    return res.status(403).json({
      error: `Account is ${user.status}`,
      status: user.status,
    });
  }
  if (user.role === 'Lab' && client !== 'tv') {
    return res.status(403).json({ error: 'Lab login is only allowed from Android TV app' });
  }
  if (user.role !== 'Lab' && client === 'tv') {
    return res.status(403).json({ error: 'Only Lab role can use the TV app' });
  }
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { userId: user.id, role: user.role, jti },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  upsertSession(user.id, jti, deviceName);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status || 'approved' },
  });
});

router.post('/signup', (req, res) => {
  const {
    name,
    email,
    password,
    mobileNumber,
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
    deviceName: rawDevice,
  } = req.body;
  const deviceName = typeof rawDevice === 'string' && rawDevice.trim() ? rawDevice.trim() : 'Unknown device';
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  if (!policiesAgreed) {
    return res.status(400).json({ error: 'You must agree to policies' });
  }

  const existing = db.prepare('SELECT id, status FROM users WHERE email = ?').get(email.trim().toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Email already exists' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const emailNorm = email.trim().toLowerCase();
  const nameNorm = String(name).trim();
  const inserted = db
    .prepare(
      'INSERT INTO users (email, password_hash, name, role, status, mobile_number) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(emailNorm, hash, nameNorm, 'Student', 'approved', mobileNumber || null);
  const userId = inserted.lastInsertRowid;

  db.prepare(`
    INSERT INTO user_profiles (user_id, full_name, email, role, profile_photo_url, mobile_number)
    VALUES (?, ?, ?, 'Student', NULL, ?)
  `).run(userId, nameNorm, emailNorm, mobileNumber || null);

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
    cityDistrict || 'Madurai',
    stateProvince || 'Tamil Nadu',
    country || 'India',
    countryCode || '+91',
    occupation || 'Student',
    1
  );

  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { userId, role: 'Student', jti },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  upsertSession(userId, jti, deviceName);

  res.status(201).json({
    ok: true,
    message: 'Signup successful.',
    token,
    user: { id: userId, email: emailNorm, name: nameNorm, role: 'Student', status: 'approved' },
  });
});

router.post('/logout', (req, res) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(204).end();
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(payload.userId);
  } catch (_) {}
  res.status(204).end();
});

module.exports = router;
