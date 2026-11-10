const express = require('express');
const { auth, requireRole } = require('../middleware/auth');
const {
  getAssignmentResponseRetentionDays,
  setAssignmentResponseRetentionDays,
  DEFAULT_ASSIGNMENT_RESPONSE_RETENTION_DAYS,
} = require('../lib/appSettings');

const router = express.Router();

router.get('/assignment-response-retention', auth, requireRole('Admin'), (req, res) => {
  res.json({
    days: getAssignmentResponseRetentionDays(),
    defaultDays: DEFAULT_ASSIGNMENT_RESPONSE_RETENTION_DAYS,
  });
});

router.put('/assignment-response-retention', auth, requireRole('Admin'), (req, res) => {
  const days = setAssignmentResponseRetentionDays(req.body?.days, req.user.id);
  res.json({
    days,
    defaultDays: DEFAULT_ASSIGNMENT_RESPONSE_RETENTION_DAYS,
  });
});

module.exports = router;
