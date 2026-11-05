const db = require('../db');
const { academyToday } = require('../lib/academyDate');

/**
 * Marks `started` batches `completed` once their last non-cancelled session date is before today
 * (academy time) and closes their applications. After an admin reopen, a batch auto-completes again
 * only when it has a session on or after the reopen date and that session has passed.
 */
function runBatchCompletionSweep(today = academyToday()) {
  const result = db
    .prepare(
      `
    UPDATE batches
    SET batch_status = 'completed', completed_at = datetime('now'), enrollment_open_status = 'closed'
    WHERE batch_status = 'started'
      AND id IN (
        SELECT s.batch_id FROM batch_sessions s
        WHERE s.status <> 'cancelled'
        GROUP BY s.batch_id
        HAVING MAX(s.session_date) < @today
           AND (
             (SELECT b2.reopened_on FROM batches b2 WHERE b2.id = s.batch_id) IS NULL
             OR MAX(s.session_date) >= (SELECT b2.reopened_on FROM batches b2 WHERE b2.id = s.batch_id)
           )
      )
  `,
    )
    .run({ today });
  return { completed: result.changes };
}

function markBatchCompleted(batchId) {
  db.prepare(
    `UPDATE batches
     SET batch_status = 'completed', completed_at = datetime('now'), enrollment_open_status = 'closed'
     WHERE id = ?`,
  ).run(batchId);
}

function reopenBatch(batchId, today = academyToday()) {
  db.prepare(
    `UPDATE batches SET batch_status = 'started', completed_at = NULL, reopened_on = ? WHERE id = ?`,
  ).run(today, batchId);
}

module.exports = { runBatchCompletionSweep, markBatchCompleted, reopenBatch };
