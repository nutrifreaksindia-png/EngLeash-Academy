function isAdmin(user) {
  return user?.role === 'Admin';
}

function canMutateLibraryByCreatedBy(user, row) {
  if (!row) return false;
  if (user.role === 'Admin') return true;
  if (user.role === 'Trainer' || user.role === 'Creator') return Number(row.created_by) === Number(user.id);
  return false;
}

/** Admin may publicize any assignment; trainers may publicize only ones they created. */
function canSetAssignmentPublic(user, row) {
  if (!row || !user) return false;
  if (user.role === 'Admin') return true;
  if (user.role === 'Trainer' && Number(row.created_by) === Number(user.id)) return true;
  return false;
}

function isAuthorRole(user) {
  return user?.role === 'Trainer' || user?.role === 'Creator';
}

/** Draft study materials: visible to Admin or the owning Trainer/Creator; published to all authorized readers. */
function canViewStudyMaterial(user, row) {
  if (!row) return false;
  if (Number(row.is_draft) !== 1) return true;
  if (user.role === 'Admin') return true;
  if (isAuthorRole(user)) return Number(row.created_by) === Number(user.id);
  return false;
}

/** Library assignments: same draft visibility as study materials. */
function canViewAssignment(user, row) {
  if (!row) return false;
  if (Number(row.is_draft) !== 1) return true;
  if (user.role === 'Admin') return true;
  if (isAuthorRole(user)) return Number(row.created_by) === Number(user.id);
  return false;
}

/** Draft worksheets (library): same visibility rules as study materials. */
function canViewWorksheet(user, row) {
  if (!row) return false;
  if (Number(row.is_draft) !== 1) return true;
  if (user.role === 'Admin') return true;
  if (isAuthorRole(user)) return Number(row.created_by) === Number(user.id);
  return false;
}

/** Draft quiz bank rows: others' drafts hidden from Trainers and Creators. */
function canViewQuizBank(user, bank) {
  if (!bank) return false;
  if (bank.status !== 'draft') return true;
  if (user.role === 'Admin') return true;
  if (isAuthorRole(user)) return Number(bank.created_by) === Number(user.id);
  return false;
}

/** List filter matching the can-view rules above, for rows with `is_draft` (or quiz `status`). */
function hideOthersDrafts(user, rows, isDraft = (r) => Number(r.is_draft) === 1) {
  if (!Array.isArray(rows) || !isAuthorRole(user)) return rows;
  return rows.filter((r) => !isDraft(r) || Number(r.created_by) === Number(user.id));
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

/** Staff and worksheet author may read answer key; learners and other Creators may not. */
function mayViewWorksheetAnswerKey(user, row) {
  if (!row) return false;
  if (user.role === 'Admin' || user.role === 'Trainer') return true;
  if (user.role === 'Creator' && Number(row.created_by) === Number(user.id)) return true;
  return false;
}

function stripWorksheetAnswerKeyIfNeeded(user, row) {
  if (!row) return row;
  if (mayViewWorksheetAnswerKey(user, row)) return row;
  const o = { ...row };
  delete o.answer_key_json;
  return o;
}

module.exports = {
  isAdmin,
  canMutateLibraryByCreatedBy,
  canSetAssignmentPublic,
  canViewStudyMaterial,
  canViewAssignment,
  canViewWorksheet,
  canViewQuizBank,
  hideOthersDrafts,
  stripCreatorFields,
  stripRows,
  mayViewWorksheetAnswerKey,
  stripWorksheetAnswerKeyIfNeeded,
};
