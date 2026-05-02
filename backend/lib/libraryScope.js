function isAdmin(user) {
  return user?.role === 'Admin';
}

function canMutateLibraryByCreatedBy(user, row) {
  if (!row) return false;
  if (user.role === 'Admin') return true;
  if (user.role === 'Trainer') return true;
  if (user.role === 'Creator') return Number(row.created_by) === Number(user.id);
  return false;
}

/** Draft study materials: visible to Admin/Trainer or owning Creator; published to all authorized readers. */
function canViewStudyMaterial(user, row) {
  if (!row) return false;
  if (Number(row.is_draft) !== 1) return true;
  if (user.role === 'Admin' || user.role === 'Trainer') return true;
  if (user.role === 'Creator') return Number(row.created_by) === Number(user.id);
  return false;
}

/** Draft quiz bank rows: others' drafts hidden from Creators (Admin/Trainer see all). */
function canViewQuizBank(user, bank) {
  if (!bank) return false;
  if (bank.status !== 'draft') return true;
  if (user.role === 'Admin' || user.role === 'Trainer') return true;
  if (user.role === 'Creator') return Number(bank.created_by) === Number(user.id);
  return false;
}

/**
 * Admins see creator_name + created_by.
 * Trainers/Creators keep created_by (for permissions UI); creator_name stripped.
 * Others: strip both.
 */
function stripCreatorFields(user, row) {
  if (!row || isAdmin(user)) return row;
  const o = { ...row };
  delete o.creator_name;
  if (user.role !== 'Trainer' && user.role !== 'Creator') {
    delete o.created_by;
  }
  return o;
}

function stripRows(user, rows) {
  if (!Array.isArray(rows) || isAdmin(user)) return rows;
  return rows.map((r) => stripCreatorFields(user, r));
}

module.exports = {
  isAdmin,
  canMutateLibraryByCreatedBy,
  canViewStudyMaterial,
  canViewQuizBank,
  stripCreatorFields,
  stripRows,
};
