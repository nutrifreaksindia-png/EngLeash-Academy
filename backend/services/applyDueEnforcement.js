const db = require('../db');
const { removeBatchStudentAccess } = require('../lib/courseAccess');
const { listOverdueDueItems, markBillingRemovedOverdue } = require('../lib/applyBilling');

function runApplyOverdueEnforcementSweep(nowMs = Date.now()) {
  const overdueItems = listOverdueDueItems(nowMs);
  let removedLearners = 0;
  let markedOverdue = 0;

  for (const due of overdueItems) {
    const tx = db.transaction(() => {
      db.prepare(
        `UPDATE apply_course_due_items
         SET due_status = 'overdue', updated_at = datetime('now')
         WHERE id = ? AND due_status != 'paid'`,
      ).run(due.id);
      markedOverdue += 1;

      const membership = db.prepare(
        'SELECT 1 FROM batch_members WHERE batch_id = ? AND student_id = ?',
      ).get(due.batch_id, due.user_id);
      if (membership) {
        try {
          removeBatchStudentAccess(due.batch_id, due.user_id);
        } catch (error) {
          console.error('[apply-overdue] removeBatchStudentAccess', due.batch_id, due.user_id, error);
        }
        db.prepare('DELETE FROM batch_members WHERE batch_id = ? AND student_id = ?').run(due.batch_id, due.user_id);
        removedLearners += 1;
      }

      if (due.enrollment_id) {
        db.prepare(
          `UPDATE course_enrollments
           SET status = 'rejected', approved_at = NULL, approved_by = NULL, notes = COALESCE(notes, 'Removed after overdue apply payment')
           WHERE id = ?`,
        ).run(due.enrollment_id);
      }
      markBillingRemovedOverdue(due.billing_profile_id);
    });

    try {
      tx();
    } catch (error) {
      console.error('[apply-overdue] sweep item failed', due.id, error);
    }
  }

  return {
    scanned: overdueItems.length,
    markedOverdue,
    removedLearners,
  };
}

module.exports = { runApplyOverdueEnforcementSweep };
