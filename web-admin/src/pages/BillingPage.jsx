import React, { useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';

function formatRupee(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return `₹${Math.round(x).toLocaleString('en-IN')}`;
}

function packageKindLabel(k) {
  const v = String(k || '').toLowerCase();
  if (v === 'renewal') return 'Renewal';
  return 'Subscription';
}

function durationLabel(unit, count) {
  const u = String(unit || '').toLowerCase();
  const c = Number(count);
  const n = Number.isFinite(c) ? c : 1;
  if (u === 'day') return `${n} day${n === 1 ? '' : 's'}`;
  if (u === 'year') return `${n} year${n === 1 ? '' : 's'}`;
  return `${n} month${n === 1 ? '' : 's'}`;
}

function activeBadge(isActive) {
  return isActive ? (
    <span className="badge active">Active</span>
  ) : (
    <span className="badge inactive">Off</span>
  );
}

function toastErrMessage(err, fallback) {
  const m = err && typeof err.message === 'string' ? err.message.trim() : '';
  return m || fallback;
}

/** Empty <select> value is ''; Number('') is 0 and would load id 0 from the API. */
function selectedEntityId(raw) {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

const emptyPackageForm = {
  packageKind: 'subscription',
  durationUnit: 'month',
  durationCount: 1,
  feeInr: 0,
  discountInr: 0,
  sortOrder: 0,
  isActive: true,
};

export default function BillingPage({
  courses = [],
  loadCombos,
  saveCombo,
  loadCoursePackages,
  createCoursePackage,
  loadComboPackages,
  createComboPackage,
  updatePackage,
  deletePackage,
  deleteCombo,
  pushToast = () => {},
}) {
  const [combos, setCombos] = useState([]);
  const [busy, setBusy] = useState(false);

  const [courseBillingId, setCourseBillingId] = useState('');
  const [coursePkgs, setCoursePkgs] = useState([]);

  const [comboBillingId, setComboBillingId] = useState('');
  const [comboPkgs, setComboPkgs] = useState([]);

  const [comboModalOpen, setComboModalOpen] = useState(false);
  const [comboEditing, setComboEditing] = useState(null);
  const [comboForm, setComboForm] = useState({ name: '', description: '', isActive: true, courseIds: [] });

  const [pkgModal, setPkgModal] = useState(null);
  /** { scope: 'course'|'combo', targetId } */
  const [pkgModalTarget, setPkgModalTarget] = useState(null);
  const [pkgForm, setPkgForm] = useState(emptyPackageForm);

  const loadCombosRef = React.useRef(loadCombos);
  const pushToastRef = React.useRef(pushToast);
  React.useEffect(() => {
    loadCombosRef.current = loadCombos;
    pushToastRef.current = pushToast;
  });

  async function refreshCombos() {
    try {
      setBusy(true);
      const rows = await loadCombosRef.current();
      setCombos(Array.isArray(rows) ? rows : []);
    } catch (e) {
      pushToastRef.current(toastErrMessage(e, 'Could not load combos'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // Mount once: unstable loadCombos/pushToast from App would otherwise change every toast and retrigger a deps-based effect.
  React.useEffect(() => {
    void refreshCombos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const courseOptions = useMemo(
    () =>
      (courses || [])
        .slice()
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })),
    [courses]
  );

  const selectedCourse = useMemo(() => {
    if (!courseBillingId) return null;
    return courseOptions.find((c) => String(c.id) === String(courseBillingId)) || null;
  }, [courseBillingId, courseOptions]);

  async function reloadCoursePackages() {
    const id = selectedEntityId(courseBillingId);
    if (id == null) {
      setCoursePkgs([]);
      return;
    }
    try {
      setBusy(true);
      const rows = await loadCoursePackages(id);
      setCoursePkgs(Array.isArray(rows) ? rows : []);
    } catch (e) {
      pushToast(toastErrMessage(e, 'Could not load packages'), 'error');
      setCoursePkgs([]);
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    void reloadCoursePackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when selected course changes
  }, [courseBillingId]);

  async function reloadComboPackages() {
    const id = selectedEntityId(comboBillingId);
    if (id == null) {
      setComboPkgs([]);
      return;
    }
    try {
      setBusy(true);
      const rows = await loadComboPackages(id);
      setComboPkgs(Array.isArray(rows) ? rows : []);
    } catch (e) {
      pushToast(toastErrMessage(e, 'Could not load combo packages'), 'error');
      setComboPkgs([]);
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => {
    void reloadComboPackages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comboBillingId]);

  function openNewCombo() {
    setComboEditing(null);
    setComboForm({ name: '', description: '', isActive: true, courseIds: [] });
    setComboModalOpen(true);
  }

  function openEditCombo(row) {
    setComboEditing(row);
    setComboForm({
      name: row.name || '',
      description: row.description || '',
      isActive: row.is_active !== false && row.isActive !== false,
      courseIds: Array.isArray(row.courseIds) ? row.courseIds.map(Number) : [],
    });
    setComboModalOpen(true);
  }

  async function submitComboModal(e) {
    e.preventDefault();
    try {
      setBusy(true);
      await saveCombo(
        comboEditing ? comboEditing.id : null,
        {
          name: comboForm.name.trim(),
          description: comboForm.description.trim() || null,
          isActive: comboForm.isActive,
          courseIds: comboForm.courseIds,
        }
      );
      pushToast(comboEditing ? 'Combo updated' : 'Combo created', 'success');
      setComboModalOpen(false);
      await refreshCombos();
    } catch (err) {
      pushToast(err.message || 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  function toggleComboCourse(cid) {
    const n = Number(cid);
    setComboForm((prev) => {
      const set = new Set(prev.courseIds);
      if (set.has(n)) set.delete(n);
      else set.add(n);
      return { ...prev, courseIds: [...set].sort((a, b) => a - b) };
    });
  }

  function openNewPackage(scope, targetId) {
    setPkgModal('create');
    setPkgModalTarget({ scope, targetId });
    setPkgForm({ ...emptyPackageForm });
  }

  function openEditPackage(row, scope, targetId) {
    setPkgModal('edit');
    setPkgModalTarget({ scope, targetId });
    setPkgForm({
      packageKind: row.package_kind || 'subscription',
      durationUnit: row.duration_unit || 'month',
      durationCount: row.duration_count || 1,
      feeInr: row.fee_inr ?? 0,
      discountInr: row.discount_inr ?? 0,
      sortOrder: row.sort_order ?? 0,
      isActive: row.is_active !== false && row.isActive !== false,
      _id: row.id,
    });
  }

  async function submitPackage(e) {
    e.preventDefault();
    if (!pkgModalTarget) return;
    const target = pkgModalTarget;
    const body = {
      packageKind: pkgForm.packageKind,
      durationUnit: pkgForm.durationUnit,
      durationCount: Number(pkgForm.durationCount),
      feeInr: Number(pkgForm.feeInr || 0),
      discountInr: Number(pkgForm.discountInr || 0),
      sortOrder: Number(pkgForm.sortOrder || 0),
      isActive: pkgForm.isActive,
    };
    try {
      setBusy(true);
      if (pkgModal === 'create') {
        if (target.scope === 'course') {
          await createCoursePackage(target.targetId, body);
        } else {
          await createComboPackage(target.targetId, body);
        }
        pushToast('Package created', 'success');
      } else {
        await updatePackage(pkgForm._id, body);
        pushToast('Package updated', 'success');
      }
      setPkgModal(null);
      setPkgModalTarget(null);
      if (target.scope === 'course') await reloadCoursePackages();
      else await reloadComboPackages();
    } catch (err) {
      pushToast(err.message || 'Save failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePackage(row) {
    if (!window.confirm(`Delete this package (#${row.id})?`)) return;
    try {
      setBusy(true);
      await deletePackage(row.id);
      pushToast('Package deleted', 'success');
      if (String(row.scope) === 'combo') await reloadComboPackages();
      else await reloadCoursePackages();
    } catch (err) {
      pushToast(err.message || 'Delete failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteCombo(row) {
    if (!deleteCombo) return;
    if (
      !window.confirm(
        `Delete combo "${row.name}"? Billing orders, combo packages, course access grants, and member links will be cleared. This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      setBusy(true);
      await deleteCombo(row.id);
      if (String(comboBillingId) === String(row.id)) {
        setComboBillingId('');
        setComboPkgs([]);
      }
      await refreshCombos();
    } catch (_err) {
      /* toast from parent */
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <SectionCard
        title="Course packages"
        subtitle="Subscription and renewal prices for a single course. Used in the app checkout and for batch access when you attach a subscription package to a batch."
        actions={
          <button type="button" className="secondaryBtn" disabled={busy} onClick={() => void reloadCoursePackages()}>
            Reload
          </button>
        }
      >
        <label className="batchCreateLabel" style={{ maxWidth: 420 }}>
          Course
          <select value={courseBillingId} onChange={(e) => setCourseBillingId(e.target.value)}>
            <option value="">Select a course…</option>
            {courseOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {String(c.enrollment_type || '').toLowerCase() === 'subscribe' ? ' (Subscribe)' : ''}
              </option>
            ))}
          </select>
        </label>
        {selectedCourse && String(selectedCourse.enrollment_type || '').toLowerCase() !== 'subscribe' ? (
          <p className="muted fieldHint">
            This course is not set to Subscribe enrollment. Packages still save for when you switch it, but students will not see subscribe checkout until the course enrollment type is Subscribe.
          </p>
        ) : null}

        <div className="row" style={{ marginTop: 12 }}>
          <button
            type="button"
            disabled={!courseBillingId || busy}
            onClick={() => openNewPackage('course', Number(courseBillingId))}
          >
            Add package
          </button>
        </div>

        <div className="tableWrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Duration</th>
                <th>Fee</th>
                <th>Discount</th>
                <th>Sort</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(coursePkgs || []).map((p) => (
                <tr key={p.id}>
                  <td>{packageKindLabel(p.package_kind)}</td>
                  <td>{durationLabel(p.duration_unit, p.duration_count)}</td>
                  <td>{formatRupee(p.fee_inr)}</td>
                  <td>{formatRupee(p.discount_inr)}</td>
                  <td>{p.sort_order ?? 0}</td>
                  <td>{activeBadge(!!p.is_active)}</td>
                  <td>
                    <button
                      type="button"
                      className="secondaryBtn"
                      disabled={busy}
                      onClick={() => openEditPackage(p, 'course', Number(courseBillingId))}
                    >
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="dangerBtn"
                      disabled={busy}
                      onClick={() => handleDeletePackage(p)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {(!coursePkgs || coursePkgs.length === 0) && (
                <tr>
                  <td colSpan={7} className="muted">
                    {courseBillingId ? 'No packages yet.' : 'Pick a course to manage packages.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Combos"
        subtitle="Bundles of courses that share one subscription or renewal checkout. Activate combo billing packages below."
        actions={
          <>
            <button type="button" className="secondaryBtn" disabled={busy} onClick={() => void refreshCombos()}>
              Reload
            </button>
            <button type="button" disabled={busy} onClick={openNewCombo}>
              New combo
            </button>
          </>
        }
      >
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Courses</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(combos || []).map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="muted">{Array.isArray(c.courseIds) ? c.courseIds.length : 0} linked</td>
                  <td>{activeBadge(!!c.is_active)}</td>
                  <td>
                    <button type="button" className="secondaryBtn" disabled={busy} onClick={() => openEditCombo(c)}>
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="secondaryBtn"
                      disabled={busy}
                      onClick={() => {
                        setComboBillingId(String(c.id));
                      }}
                    >
                      Manage packages
                    </button>{' '}
                    {deleteCombo ? (
                      <button
                        type="button"
                        className="dangerBtn"
                        disabled={busy}
                        onClick={() => void handleDeleteCombo(c)}
                      >
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {(!combos || combos.length === 0) && (
                <tr>
                  <td colSpan={4} className="muted">
                    No combos yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard
        title="Combo packages"
        subtitle="Subscription and renewal offers for a combo (one payment grants all member courses for the same access window)."
        actions={
          <button type="button" className="secondaryBtn" disabled={busy} onClick={() => void reloadComboPackages()}>
            Reload
          </button>
        }
      >
        <label className="batchCreateLabel" style={{ maxWidth: 420 }}>
          Combo
          <select value={comboBillingId} onChange={(e) => setComboBillingId(e.target.value)}>
            <option value="">Select a combo…</option>
            {(combos || []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="row" style={{ marginTop: 12 }}>
          <button
            type="button"
            disabled={!comboBillingId || busy}
            onClick={() => openNewPackage('combo', Number(comboBillingId))}
          >
            Add package
          </button>
        </div>

        <div className="tableWrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Kind</th>
                <th>Duration</th>
                <th>Fee</th>
                <th>Discount</th>
                <th>Sort</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(comboPkgs || []).map((p) => (
                <tr key={p.id}>
                  <td>{packageKindLabel(p.package_kind)}</td>
                  <td>{durationLabel(p.duration_unit, p.duration_count)}</td>
                  <td>{formatRupee(p.fee_inr)}</td>
                  <td>{formatRupee(p.discount_inr)}</td>
                  <td>{p.sort_order ?? 0}</td>
                  <td>{activeBadge(!!p.is_active)}</td>
                  <td>
                    <button
                      type="button"
                      className="secondaryBtn"
                      disabled={busy}
                      onClick={() => openEditPackage(p, 'combo', Number(comboBillingId))}
                    >
                      Edit
                    </button>{' '}
                    <button
                      type="button"
                      className="dangerBtn"
                      disabled={busy}
                      onClick={() => handleDeletePackage(p)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {(!comboPkgs || comboPkgs.length === 0) && (
                <tr>
                  <td colSpan={7} className="muted">
                    {comboBillingId ? 'No packages for this combo.' : 'Pick a combo or create one above.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <Modal open={comboModalOpen} title={comboEditing ? 'Edit combo' : 'New combo'} onClose={() => setComboModalOpen(false)} variant="modal">
        <form onSubmit={submitComboModal} className="stack batchModalBody">
          <label className="batchCreateLabel">
            Name *
            <input value={comboForm.name} onChange={(e) => setComboForm({ ...comboForm, name: e.target.value })} required />
          </label>
          <label className="batchCreateLabel">
            Description
            <textarea value={comboForm.description} onChange={(e) => setComboForm({ ...comboForm, description: e.target.value })} rows={2} />
          </label>
          <label className="batchCreateLabel" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={comboForm.isActive}
              onChange={(e) => setComboForm({ ...comboForm, isActive: e.target.checked })}
            />
            Active (visible for public combo checkout when packages exist)
          </label>
          <p className="batchModalSubhead">Member courses</p>
          <div className="stack" style={{ maxHeight: 220, overflow: 'auto', border: '1px solid var(--border, #ddd)', padding: 8, borderRadius: 6 }}>
            {courseOptions.map((c) => (
              <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={comboForm.courseIds.includes(Number(c.id))}
                  onChange={() => toggleComboCourse(c.id)}
                />
                <span>{c.name}</span>
              </label>
            ))}
          </div>
          <div className="row">
            <button type="submit" disabled={busy}>
              Save
            </button>
            <button type="button" className="secondaryBtn" onClick={() => setComboModalOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={!!pkgModal} title={pkgModal === 'create' ? 'Add package' : 'Edit package'} onClose={() => setPkgModal(null)} variant="modal">
        <form onSubmit={submitPackage} className="formGrid batchCreateForm batchModalBody">
          <label className="batchCreateLabel">
            Kind *
            <select
              value={pkgForm.packageKind}
              onChange={(e) => setPkgForm({ ...pkgForm, packageKind: e.target.value })}
              disabled={pkgModal === 'edit'}
            >
              <option value="subscription">Subscription (new access)</option>
              <option value="renewal">Renewal (extend existing)</option>
            </select>
          </label>
          <label className="batchCreateLabel">
            Duration unit *
            <select
              value={pkgForm.durationUnit}
              onChange={(e) => setPkgForm({ ...pkgForm, durationUnit: e.target.value })}
            >
              <option value="day">Day</option>
              <option value="month">Month (30 days)</option>
              <option value="year">Year (365 days)</option>
            </select>
          </label>
          <label className="batchCreateLabel">
            Count *
            <input
              type="number"
              min={1}
              required
              value={pkgForm.durationCount}
              onChange={(e) => setPkgForm({ ...pkgForm, durationCount: e.target.value })}
            />
          </label>
          <label className="batchCreateLabel">
            Fee (INR)
            <input
              type="number"
              min={0}
              value={pkgForm.feeInr}
              onChange={(e) => setPkgForm({ ...pkgForm, feeInr: e.target.value })}
            />
          </label>
          <label className="batchCreateLabel">
            Discount (INR)
            <input
              type="number"
              min={0}
              value={pkgForm.discountInr}
              onChange={(e) => setPkgForm({ ...pkgForm, discountInr: e.target.value })}
            />
          </label>
          <label className="batchCreateLabel">
            Sort order
            <input
              type="number"
              value={pkgForm.sortOrder}
              onChange={(e) => setPkgForm({ ...pkgForm, sortOrder: e.target.value })}
            />
          </label>
          <label className="batchCreateLabel batchCreateSpan2" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={pkgForm.isActive}
              onChange={(e) => setPkgForm({ ...pkgForm, isActive: e.target.checked })}
            />
            Active
          </label>
          <div className="row batchCreateSpan2">
            <button type="submit" disabled={busy}>
              Save
            </button>
            <button type="button" className="secondaryBtn" onClick={() => setPkgModal(null)}>
              Cancel
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
