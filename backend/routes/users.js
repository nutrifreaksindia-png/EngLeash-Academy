const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { auth, requireRole } = require('../middleware/auth');

const router = express.Router();

router.get('/me', auth, (req, res) => {
  res.json(req.user);
});

router.get('/', auth, requireRole('Admin'), (req, res) => {
  const users = db.prepare('SELECT id, email, name, role, created_at FROM users ORDER BY id').all();
  res.json(users);
});

router.post('/', auth, requireRole('Admin'), (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password and role are required' });
  }
  const allowed = ['Admin', 'Trainer', 'Student', 'Lab'];
  if (!allowed.includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    db.prepare('INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)').run(email, hash, name || '', role);
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Email already exists' });
    throw e;
  }
  const row = db.prepare('SELECT id, email, name, role, created_at FROM users WHERE id = last_insert_rowid()').get();
  res.status(201).json(row);
});

module.exports = router;
