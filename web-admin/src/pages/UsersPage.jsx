import React, { useState } from 'react';
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

export default function UsersPage({
  onCreateUser,
  onUpdateUser,
  onGetUserDetails,
  users,
  title = 'Users',
  subtitle = 'Recently created users',
  createTitle = 'Create User',
  createSubtitle = 'Create Admin, Trainer, Student, Lab, or Creator users',
  defaultRole = 'Trainer',
}) {
  const [open, setOpen] = useState(false);
  const [editForm, setEditForm] = useState(emptyEdit);

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
      <SectionCard title={createTitle} subtitle={createSubtitle}>
        <form onSubmit={onCreateUser} className="formGrid">
          <input name="name" placeholder="Name" required />
          <input name="email" placeholder="Email" required />
          <input name="password" placeholder="Password" required />
          <select name="role" defaultValue={defaultRole}>
            <option>Admin</option>
            <option>Trainer</option>
            <option>Student</option>
            <option>Lab</option>
            <option>Creator</option>
          </select>
          <input name="mobileNumber" placeholder="Mobile number" />
          <input name="profilePhotoUrl" placeholder="Profile photo URL" />
          <button type="submit">Create User</button>
        </form>
      </SectionCard>
      <SectionCard title={title} subtitle={subtitle}>
        <div className="tableWrap">
          <table>
            <thead>
              <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {users.slice(0, 50).map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td>{u.email}</td>
                  <td>{u.role}</td>
                  <td><span className={`badge ${u.status || 'approved'}`}>{u.status || 'approved'}</span></td>
                  <td>
                    <ActionMenu>
                      <button className="secondaryBtn" onClick={() => openEdit(u)}>Edit profile</button>
                    </ActionMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    </div>
  );
}
