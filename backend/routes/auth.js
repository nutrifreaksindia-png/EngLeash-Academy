const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireClient, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { email, password, role, client } = req.body;
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password and role are required' });
  }
  const user = db.prepare('SELECT id, email, name, role, password_hash FROM users WHERE email = ? AND role = ?').get(email, role);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email, password or role' });
  }
  // Enforce client: Lab only on TV; others only on mobile
  if (user.role === 'Lab' && client !== 'tv') {
    return res.status(403).json({ error: 'Lab login is only allowed from Android TV app' });
  }
  if (user.role !== 'Lab' && client === 'tv') {
    return res.status(403).json({ error: 'Only Lab role can use the TV app' });
  }
  const token = jwt.sign(
    { userId: user.id, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  });
});

module.exports = router;
