const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization' });
  }
  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, name, role, status FROM users WHERE id = ?').get(payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found', code: 'SESSION_REPLACED' });
    if (user.status && user.status !== 'approved') {
      return res.status(403).json({ error: 'Account is not active', status: user.status });
    }
    const session = db.prepare('SELECT token_jti FROM sessions WHERE user_id = ?').get(user.id);
    if (!session || session.token_jti !== (payload.jti || '')) {
      return res.status(401).json({ error: 'Session replaced by another device', code: 'SESSION_REPLACED' });
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden for your role' });
    }
    next();
  };
}

function requireClient(req, res, next) {
  const client = req.body?.client || req.query?.client;
  if (req.user.role === 'Lab' && client !== 'tv') {
    return res.status(403).json({ error: 'Lab login is only allowed from Android TV app' });
  }
  if (req.user.role !== 'Lab' && client === 'tv') {
    return res.status(403).json({ error: 'Only Lab role can use the TV app' });
  }
  next();
}

module.exports = { auth, requireRole, requireClient, JWT_SECRET };
