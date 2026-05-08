import React, { useState, useRef, useMemo } from 'react';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';
import ActionMenu from '../components/ActionMenu';

const emptyEdit = {
  id: null,
  role: '',
  name: '',
  email: '',
  mobileNumber: '',
  profilePhotoUrl: '',
  status: 'approved',
  gender: '',
  birthDate: '',
  addressLine1: '',
  addressLine2: '',
  cityDistrict: '',
  stateProvince: '',
  country: '',
  countryCode: '',
  occupation: '',
};

/** @typedef {'students' | 'other-users'} UsersPageVariant */

export default function UsersPage({
  onCreateUser,
  onUpdateUser,
  onGetUserDetails,
  users,
  variant = 'other-users',
  title = 'Users',
  subtitle = 'Recently created users',
  createTitle,
  createSubtitle,
  defaultRole = 'Trainer',
}) {
  const resolvedCreateTitle =
    createTitle ?? (variant === 'students' ? 'Add student' : 'Add user');
  const resolvedCreateSubtitle =
    createSubtitle ??
    (variant === 'students'
      ? 'Creates a Student login (role is fixed).'
      : 'Pick role: Trainer, Admin, Creator, or Lab (TV).');
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editForm, setEditForm] = useState(emptyEdit);
  const [listQuery, setListQuery] = useState('');
  const createFormRef = useRef(null);
  const [createPhotoPreviewUrl, setCreatePhotoPreviewUrl] = useState('');
  const [createPhotoBlob, setCreatePhotoBlob] = useState(null);

  const listRows = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    const base = [...(users || [])].sort((a, b) => Number(b.id) - Number(a.id));
    if (!q) return base;
    return base.filter(
      (u) =>
        String(u.name || '')
          .toLowerCase()
          .includes(q) ||
        String(u.email || '')
          .toLowerCase()
          .includes(q) ||
        String(u.role || '')
          .toLowerCase()
          .includes(q) ||
        String(u.status || '')
          .toLowerCase()
          .includes(q)
    );
  }, [users, listQuery]);

  async function handleCreateSubmit(e) {
    e.preventDefault();
    const formEl = createFormRef.current;
    if (!formEl || !onCreateUser) return;
    const form = new FormData(formEl);
    await onCreateUser({
      name: String(form.get('name') || '').trim(),
      email: String(form.get('email') || '').trim(),
      password: String(form.get('password') || ''),
      role: String(form.get('role') || '').trim(),
      mobileNumber: String(form.get('mobileNumber') || '').trim(),
      gender: String(form.get('gender') || '').trim(),
      birthDate: String(form.get('birthDate') || '').trim(),
      addressLine1: String(form.get('addressLine1') || '').trim(),
      addressLine2: String(form.get('addressLine2') || '').trim(),
      cityDistrict: String(form.get('cityDistrict') || '').trim(),
      stateProvince: String(form.get('stateProvince') || '').trim(),
      country: String(form.get('country') || '').trim(),
      countryCode: String(form.get('countryCode') || '').trim(),
      occupation: String(form.get('occupation') || '').trim(),
      policiesAgreed: form.get('policiesAgreed') === 'on',
      profilePhotoBlob: createPhotoBlob,
      profilePhotoUrl: '',
    });
    formEl.reset();
    setCreatePhotoBlob(null);
    setCreatePhotoPreviewUrl('');
    setCreateOpen(false);
  }

  async function optimizeSquareImage(file) {
    const src = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      });
      const size = Math.min(image.naturalWidth, image.naturalHeight);
      const sx = Math.floor((image.naturalWidth - size) / 2);
      const sy = Math.floor((image.naturalHeight - size) / 2);
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, sx, sy, size, size, 0, 0, 512, 512);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      return blob || file;
    } finally {
      URL.revokeObjectURL(src);
    }
  }

  async function onCreatePhotoPicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const optimized = await optimizeSquareImage(file);
    setCreatePhotoBlob(optimized);
    setCreatePhotoPreviewUrl(URL.createObjectURL(optimized));
  }

  async function openEdit(u) {
    const details = onGetUserDetails ? await onGetUserDetails(u.id) : u;
    setEditForm({
      id: details.id,
      role: details.role || '',
      name: details.name || '',
      email: details.email || '',
      mobileNumber: details.mobile_number || '',
      profilePhotoUrl: details.profile_photo_url || details.profile?.profile_photo_url || '',
      status: details.status || 'approved',
      gender: details.studentProfile?.gender || '',
      birthDate: details.studentProfile?.birth_date || '',
      addressLine1: details.studentProfile?.address_line_1 || '',
      addressLine2: details.studentProfile?.address_line_2 || '',
      cityDistrict: details.studentProfile?.city_district || '',
      stateProvince: details.studentProfile?.state_province || '',
      country: details.studentProfile?.country || '',
      countryCode: details.studentProfile?.country_code || '',
      occupation: details.studentProfile?.occupation || '',
    });
    setOpen(true);
  }

  async function submitEdit(e) {
    e.preventDefault();
    await onUpdateUser(editForm);
    setOpen(false);
    setEditForm(emptyEdit);
  }

  return (
    <div className="stack">
      {variant === 'students' ? (
        <SectionCard title={resolvedCreateTitle} subtitle={resolvedCreateSubtitle}>
          <button onClick={() => setCreateOpen(true)}>Create student</button>
        </SectionCard>
      ) : (
        <SectionCard title={resolvedCreateTitle} subtitle={resolvedCreateSubtitle}>
          <form ref={createFormRef} onSubmit={handleCreateSubmit} className="formGrid" autoComplete="off">
            <input name="name" placeholder="Name" required autoComplete="name" />
            <input name="email" placeholder="Email" type="email" required autoComplete="off" />
            <input name="password" placeholder="Password" type="password" required autoComplete="new-password" />
            <select name="role" defaultValue={defaultRole} aria-label="Account type">
              <option value="Trainer">Trainer</option>
              <option value="Admin">Admin</option>
              <option value="Creator">Creator</option>
              <option value="Lab">Lab (TV app)</option>
            </select>
            <input name="mobileNumber" placeholder="Mobile number" />
            <button type="submit">Create user</button>
          </form>
        </SectionCard>
      )}
      <SectionCard
        title={title}
        subtitle={
          listQuery.trim()
            ? `${listRows.length} match(es) · ${subtitle}`
            : `${(users || []).length} account(s) · Newest first · ${subtitle}`
        }
      >
        <label className="usersListSearch">
          <span className="muted">Filter list</span>
          <input
            type="search"
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder={variant === 'students' ? 'Name, email, or status' : 'Name, email, role, or status'}
            className="usersListSearchInput"
          />
        </label>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Email</th>
                {variant === 'other-users' ? <th>Role</th> : null}
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {listRows.map((u) => (
                <tr key={u.id}>
                  <td className="muted">{u.id}</td>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  {variant === 'other-users' ? <td>{u.role}</td> : null}
                  <td>
                    <span className={`badge ${u.status || 'approved'}`}>{u.status || 'approved'}</span>
                  </td>
                  <td>
                    <ActionMenu>
                      <button className="secondaryBtn" onClick={() => openEdit(u)}>
                        Edit profile
                      </button>
                    </ActionMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {listRows.length === 0 ? (
          <p className="muted">
            {(users || []).length === 0 ? 'No accounts in this view yet.' : 'No users match this filter.'}
          </p>
        ) : null}
      </SectionCard>
      <Modal open={open} title="Edit User Profile" onClose={() => setOpen(false)} variant="drawer">
        <form onSubmit={submitEdit} className="formGrid">
          <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} placeholder="Name" required />
          <input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} placeholder="Email" required />
          <input value={editForm.mobileNumber} onChange={(e) => setEditForm({ ...editForm, mobileNumber: e.target.value })} placeholder="Mobile number" />
          <input value={editForm.profilePhotoUrl} onChange={(e) => setEditForm({ ...editForm, profilePhotoUrl: e.target.value })} placeholder="Profile photo URL" />
          <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
            <option value="approved">approved</option>
            <option value="pending">pending</option>
            <option value="rejected">rejected</option>
          </select>
          {(editForm.role === 'Student' || editForm.role === 'Lab') ? (
            <>
              <input value={editForm.gender} onChange={(e) => setEditForm({ ...editForm, gender: e.target.value })} placeholder="Gender" />
              <input value={editForm.birthDate} onChange={(e) => setEditForm({ ...editForm, birthDate: e.target.value })} placeholder="Birth date YYYY-MM-DD" />
              <input value={editForm.addressLine1} onChange={(e) => setEditForm({ ...editForm, addressLine1: e.target.value })} placeholder="Address line 1" />
              <input value={editForm.addressLine2} onChange={(e) => setEditForm({ ...editForm, addressLine2: e.target.value })} placeholder="Address line 2" />
              <input value={editForm.cityDistrict} onChange={(e) => setEditForm({ ...editForm, cityDistrict: e.target.value })} placeholder="City / District" />
              <input value={editForm.stateProvince} onChange={(e) => setEditForm({ ...editForm, stateProvince: e.target.value })} placeholder="State / Province" />
              <input value={editForm.country} onChange={(e) => setEditForm({ ...editForm, country: e.target.value })} placeholder="Country" />
              <input value={editForm.countryCode} onChange={(e) => setEditForm({ ...editForm, countryCode: e.target.value })} placeholder="Country Code" />
              <input value={editForm.occupation} onChange={(e) => setEditForm({ ...editForm, occupation: e.target.value })} placeholder="Occupation" />
            </>
          ) : null}
          <button type="submit">Save Profile</button>
        </form>
      </Modal>
      <Modal open={createOpen} title="Create Student" onClose={() => setCreateOpen(false)} variant="drawer">
        <form ref={createFormRef} onSubmit={handleCreateSubmit} className="formGrid" autoComplete="off">
          <input name="name" placeholder="Name" required autoComplete="name" />
          <input name="email" placeholder="Email" type="email" required autoComplete="off" />
          <input name="password" placeholder="Password" type="password" required autoComplete="new-password" />
          <input type="hidden" name="role" value="Student" />
          <input name="mobileNumber" placeholder="Mobile number" />
          <input name="gender" placeholder="Gender (optional)" />
          <input name="birthDate" placeholder="Birth date YYYY-MM-DD (optional)" />
          <input name="addressLine1" placeholder="Address line 1 (optional)" />
          <input name="addressLine2" placeholder="Address line 2 (optional)" />
          <input name="cityDistrict" placeholder="City / District (optional)" />
          <input name="stateProvince" placeholder="State / Province (optional)" />
          <input name="country" placeholder="Country (optional)" />
          <input name="countryCode" placeholder="Country code (optional)" />
          <input name="occupation" placeholder="Occupation (optional)" />
          <label className="fieldLabel">
            <span className="muted">Profile photo (1:1 crop optimized)</span>
            <input type="file" accept="image/*" onChange={onCreatePhotoPicked} />
          </label>
          {createPhotoPreviewUrl ? <img src={createPhotoPreviewUrl} alt="Profile preview" style={{ width: 96, height: 96, borderRadius: 999, objectFit: 'cover' }} /> : null}
          <label className="checkboxLine">
            <input type="checkbox" name="policiesAgreed" />
            <span>Policies agreed (optional)</span>
          </label>
          <button type="submit">Create student</button>
        </form>
      </Modal>
    </div>
  );
}
