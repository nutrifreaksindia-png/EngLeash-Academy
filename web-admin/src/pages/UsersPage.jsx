import React, { useEffect, useMemo, useRef, useState } from 'react';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';
import { City, Country, State } from 'country-state-city';
import Cropper from 'react-easy-crop';

const ALL_COUNTRIES = Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name));
const DEFAULT_COUNTRY_ISO = ALL_COUNTRIES.find((c) => c.isoCode === 'IN')?.isoCode || ALL_COUNTRIES[0]?.isoCode || '';
const OCCUPATIONS = ['Student', 'Working Professional', 'Homemaker', 'Business', 'Freelancer', 'Other'];
const GENDERS = ['Male', 'Female', 'Other'];

const emptyEdit = {
  id: null,
  role: 'Student',
  name: '',
  email: '',
  mobileNumber: '',
  gender: 'Other',
  birthDate: '',
  addressLine1: '',
  addressLine2: '',
  cityDistrict: '',
  stateProvince: '',
  country: '',
  countryCode: '',
  countryIso: DEFAULT_COUNTRY_ISO,
  stateIso: '',
  occupation: 'Student',
};

/** @typedef {'students' | 'other-users'} UsersPageVariant */
export default function UsersPage({
  onCreateUser,
  onUpdateUser,
  onGetUserDetails,
  onDeleteUser,
  canDangerDelete = false,
  users,
  variant = 'other-users',
  title = 'Users',
  subtitle = 'Recently created users',
  createTitle,
  createSubtitle,
  defaultRole = 'Trainer',
}) {
  const resolvedCreateTitle = createTitle ?? (variant === 'students' ? 'Add student' : 'Add user');
  const resolvedCreateSubtitle =
    createSubtitle ??
    (variant === 'students'
      ? 'Create and manage classroom students'
      : 'Pick role: Trainer, Admin, Creator, or Lab (TV).');
  const isStudents = variant === 'students';

  const [createOpen, setCreateOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewStudent, setViewStudent] = useState(null);

  const [listQuery, setListQuery] = useState('');
  const createFormRef = useRef(null);
  const [createPhotoPreviewUrl, setCreatePhotoPreviewUrl] = useState('');
  const [createPhotoBlob, setCreatePhotoBlob] = useState(null);
  const [rawPhotoUrl, setRawPhotoUrl] = useState('');
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [createError, setCreateError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [confirmPasswordFocused, setConfirmPasswordFocused] = useState(false);
  const [studentCreate, setStudentCreate] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    mobileNumber: '',
    gender: 'Other',
    birthDate: '',
    addressLine1: '',
    addressLine2: '',
    cityDistrict: '',
    stateProvince: '',
    country: '',
    countryCode: '',
    countryIso: DEFAULT_COUNTRY_ISO,
    stateIso: '',
    occupation: 'Student',
  });

  const [editForm, setEditForm] = useState(emptyEdit);

  const createStates = useMemo(
    () => State.getStatesOfCountry(studentCreate.countryIso).sort((a, b) => a.name.localeCompare(b.name)),
    [studentCreate.countryIso]
  );
  const createCities = useMemo(() => {
    if (studentCreate.stateIso) {
      return City.getCitiesOfState(studentCreate.countryIso, studentCreate.stateIso).sort((a, b) => a.name.localeCompare(b.name));
    }
    return City.getCitiesOfCountry(studentCreate.countryIso).sort((a, b) => a.name.localeCompare(b.name));
  }, [studentCreate.countryIso, studentCreate.stateIso]);

  const editStates = useMemo(
    () => State.getStatesOfCountry(editForm.countryIso || DEFAULT_COUNTRY_ISO).sort((a, b) => a.name.localeCompare(b.name)),
    [editForm.countryIso]
  );
  const editCities = useMemo(() => {
    if (editForm.stateIso) {
      return City.getCitiesOfState(editForm.countryIso || DEFAULT_COUNTRY_ISO, editForm.stateIso).sort((a, b) => a.name.localeCompare(b.name));
    }
    return City.getCitiesOfCountry(editForm.countryIso || DEFAULT_COUNTRY_ISO).sort((a, b) => a.name.localeCompare(b.name));
  }, [editForm.countryIso, editForm.stateIso]);

  const passwordChecks = useMemo(() => {
    const v = studentCreate.password || '';
    return {
      minLength: v.length >= 8,
      uppercase: /[A-Z]/.test(v),
      number: /[0-9]/.test(v),
      symbol: /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(v),
    };
  }, [studentCreate.password]);
  const passwordsMatch = useMemo(
    () => (studentCreate.confirmPassword.length > 0 ? studentCreate.password === studentCreate.confirmPassword : false),
    [studentCreate.password, studentCreate.confirmPassword]
  );

  const listRows = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    const base = [...(users || [])].sort((a, b) => Number(b.id) - Number(a.id));
    if (!q) return base;
    return base.filter((u) => {
      const batchText = `${u.connected_batch_number || ''} ${u.connected_batch_title || ''} ${u.connected_batch_type || ''}`.toLowerCase();
      return (
        String(u.name || '')
          .toLowerCase()
          .includes(q) ||
        String(u.email || '')
          .toLowerCase()
          .includes(q) ||
        String(u.city_district || '')
          .toLowerCase()
          .includes(q) ||
        batchText.includes(q)
      );
    });
  }, [users, listQuery]);

  function normalizeCountryIsoByName(countryName) {
    const name = String(countryName || '').trim().toLowerCase();
    const found = ALL_COUNTRIES.find((c) => c.name.toLowerCase() === name);
    return found?.isoCode || DEFAULT_COUNTRY_ISO;
  }

  function normalizeStateIsoByName(countryIso, stateName) {
    const states = State.getStatesOfCountry(countryIso || DEFAULT_COUNTRY_ISO);
    const name = String(stateName || '').trim().toLowerCase();
    const found = states.find((s) => s.name.toLowerCase() === name);
    return found?.isoCode || '';
  }

  async function handleCreateSubmit(e) {
    e.preventDefault();
    const formEl = createFormRef.current;
    if (!formEl || !onCreateUser) return;
    setCreateError('');
    if (isStudents) {
      const selectedCountry = ALL_COUNTRIES.find((c) => c.isoCode === studentCreate.countryIso);
      const selectedState = createStates.find((s) => s.isoCode === studentCreate.stateIso);
      const payload = {
        ...studentCreate,
        name: studentCreate.name.trim(),
        email: studentCreate.email.trim().toLowerCase(),
        mobileNumber: studentCreate.mobileNumber.trim(),
        addressLine1: studentCreate.addressLine1.trim(),
        addressLine2: studentCreate.addressLine2.trim(),
        occupation: studentCreate.occupation.trim(),
        country: selectedCountry?.name || studentCreate.country || '',
        countryCode: studentCreate.countryCode || `+${selectedCountry?.phonecode || ''}`,
        stateProvince: selectedState?.name || studentCreate.stateProvince || '',
      };
      if (!payload.name || !payload.email || !payload.password || !payload.confirmPassword) {
        setCreateError('Please fill name, email, password and confirm password.');
        return;
      }
      if (!passwordChecks.minLength || !passwordChecks.uppercase || !passwordChecks.number || !passwordChecks.symbol) {
        setCreateError('Password does not meet all required rules.');
        return;
      }
      if (payload.password !== payload.confirmPassword) {
        setCreateError('Password and confirm password must match.');
        return;
      }
      if (!/^\S+@\S+\.\S+$/.test(payload.email)) {
        setCreateError('Please enter a valid email address.');
        return;
      }
      if (payload.mobileNumber && !/^\d{10}$/.test(payload.mobileNumber.replace(/\D/g, ''))) {
        setCreateError('Mobile number must be a valid 10 digit number.');
        return;
      }
      await onCreateUser({
        name: payload.name,
        email: payload.email,
        password: payload.password,
        role: 'Student',
        mobileNumber: payload.mobileNumber,
        gender: payload.gender,
        birthDate: payload.birthDate,
        addressLine1: payload.addressLine1,
        addressLine2: payload.addressLine2,
        cityDistrict: payload.cityDistrict,
        stateProvince: payload.stateProvince,
        country: payload.country,
        countryCode: payload.countryCode,
        occupation: payload.occupation,
        profilePhotoBlob: createPhotoBlob,
        profilePhotoUrl: '',
      });
      setStudentCreate({
        name: '',
        email: '',
        password: '',
        confirmPassword: '',
        mobileNumber: '',
        gender: 'Other',
        birthDate: '',
        addressLine1: '',
        addressLine2: '',
        cityDistrict: '',
        stateProvince: '',
        country: '',
        countryCode: '',
        countryIso: DEFAULT_COUNTRY_ISO,
        stateIso: '',
        occupation: 'Student',
      });
      setCreatePhotoBlob(null);
      setCreatePhotoPreviewUrl('');
      setCreateOpen(false);
      return;
    }
    const form = new FormData(formEl);
    await onCreateUser({
      name: String(form.get('name') || '').trim(),
      email: String(form.get('email') || '').trim(),
      password: String(form.get('password') || ''),
      role: String(form.get('role') || '').trim(),
      mobileNumber: String(form.get('mobileNumber') || '').trim(),
      profilePhotoBlob: null,
      profilePhotoUrl: '',
    });
    formEl.reset();
  }

  async function onCreatePhotoPicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (rawPhotoUrl) URL.revokeObjectURL(rawPhotoUrl);
    const nextRawUrl = URL.createObjectURL(file);
    setRawPhotoUrl(nextRawUrl);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
    setCropOpen(true);
  }

  async function applyCrop() {
    if (!rawPhotoUrl || !croppedAreaPixels) return;
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = rawPhotoUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    const px = croppedAreaPixels;
    ctx.drawImage(image, px.x, px.y, px.width, px.height, 0, 0, 512, 512);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    const outBlob = blob || null;
    if (!outBlob) return;
    if (createPhotoPreviewUrl) URL.revokeObjectURL(createPhotoPreviewUrl);
    setCreatePhotoBlob(outBlob);
    setCreatePhotoPreviewUrl(URL.createObjectURL(outBlob));
    setCropOpen(false);
  }

  function setStudentCreateField(key, value) {
    setStudentCreate((prev) => ({ ...prev, [key]: value }));
  }

  function setCreateCountry(countryIso) {
    const selectedCountry = ALL_COUNTRIES.find((c) => c.isoCode === countryIso);
    const nextStates = State.getStatesOfCountry(countryIso);
    const defaultState = nextStates.find((s) => s.name === 'Tamil Nadu') || nextStates[0] || null;
    const nextCities = defaultState ? City.getCitiesOfState(countryIso, defaultState.isoCode) : City.getCitiesOfCountry(countryIso);
    const defaultCity = nextCities.find((c) => c.name === 'Madurai') || nextCities[0] || null;
    setStudentCreate((prev) => ({
      ...prev,
      countryIso,
      country: selectedCountry?.name || '',
      countryCode: `+${selectedCountry?.phonecode || ''}`,
      stateIso: defaultState?.isoCode || '',
      stateProvince: defaultState?.name || '',
      cityDistrict: defaultCity?.name || '',
    }));
  }

  function setCreateState(stateIso) {
    const selectedState = createStates.find((s) => s.isoCode === stateIso);
    const nextCities = stateIso ? City.getCitiesOfState(studentCreate.countryIso, stateIso) : City.getCitiesOfCountry(studentCreate.countryIso);
    const defaultCity = nextCities[0] || null;
    setStudentCreate((prev) => ({
      ...prev,
      stateIso,
      stateProvince: selectedState?.name || '',
      cityDistrict: defaultCity?.name || '',
    }));
  }

  function setEditField(key, value) {
    setEditForm((prev) => ({ ...prev, [key]: value }));
  }

  function setEditCountry(countryIso) {
    const selectedCountry = ALL_COUNTRIES.find((c) => c.isoCode === countryIso);
    const nextStates = State.getStatesOfCountry(countryIso);
    const defaultState = nextStates[0] || null;
    setEditForm((prev) => ({
      ...prev,
      countryIso,
      country: selectedCountry?.name || '',
      countryCode: `+${selectedCountry?.phonecode || ''}`,
      stateIso: defaultState?.isoCode || '',
      stateProvince: defaultState?.name || '',
      cityDistrict: '',
    }));
  }

  function setEditState(stateIso) {
    const selectedState = editStates.find((s) => s.isoCode === stateIso);
    setEditForm((prev) => ({
      ...prev,
      stateIso,
      stateProvince: selectedState?.name || '',
      cityDistrict: '',
    }));
  }

  async function openStudentView(student) {
    const details = onGetUserDetails ? await onGetUserDetails(student.id) : student;
    setViewStudent(details);
    setViewOpen(true);
  }

  async function openEdit(student) {
    const details = onGetUserDetails ? await onGetUserDetails(student.id) : student;
    const countryIso = normalizeCountryIsoByName(details.studentProfile?.country);
    const stateIso = normalizeStateIsoByName(countryIso, details.studentProfile?.state_province);
    setEditForm({
      id: details.id,
      role: details.role || 'Student',
      name: details.name || '',
      email: details.email || '',
      mobileNumber: details.mobile_number || '',
      gender: details.studentProfile?.gender || 'Other',
      birthDate: details.studentProfile?.birth_date || '',
      addressLine1: details.studentProfile?.address_line_1 || '',
      addressLine2: details.studentProfile?.address_line_2 || '',
      cityDistrict: details.studentProfile?.city_district || '',
      stateProvince: details.studentProfile?.state_province || '',
      country: details.studentProfile?.country || '',
      countryCode: details.studentProfile?.country_code || '',
      countryIso,
      stateIso,
      occupation: details.studentProfile?.occupation || 'Student',
    });
    setEditOpen(true);
    setViewOpen(false);
  }

  async function submitEdit(e) {
    e.preventDefault();
    await onUpdateUser({
      id: editForm.id,
      name: editForm.name,
      email: editForm.email,
      mobileNumber: editForm.mobileNumber,
      gender: editForm.gender,
      birthDate: editForm.birthDate,
      addressLine1: editForm.addressLine1,
      addressLine2: editForm.addressLine2,
      cityDistrict: editForm.cityDistrict,
      stateProvince: editForm.stateProvince,
      country: editForm.country,
      countryCode: editForm.countryCode,
      occupation: editForm.occupation,
    });
    setEditOpen(false);
    setEditForm(emptyEdit);
  }

  useEffect(() => {
    if (!isStudents) return;
    if (!studentCreate.countryIso) return;
    if (!studentCreate.countryCode || !studentCreate.country || !studentCreate.stateProvince || !studentCreate.cityDistrict) {
      setCreateCountry(studentCreate.countryIso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStudents, createOpen]);

  const studentsTable = (
    <SectionCard
      title={title}
      subtitle={listQuery.trim() ? `${listRows.length} match(es) · ${subtitle}` : `${(users || []).length} student(s) · ${subtitle}`}
      actions={isStudents ? <button onClick={() => setCreateOpen(true)}>+ Add</button> : null}
    >
      <label className="usersListSearch">
        <span className="muted">Filter list</span>
        <input
          type="search"
          value={listQuery}
          onChange={(e) => setListQuery(e.target.value)}
          placeholder={isStudents ? 'Name, email, batch, or city' : 'Name, email, role, or status'}
          className="usersListSearchInput"
        />
      </label>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Connected Batch</th>
              <th>City</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {listRows.map((u) => {
              const batchText = [u.connected_batch_number, u.connected_batch_title, u.connected_batch_type].filter(Boolean).join(' • ') || '-';
              return (
                <tr key={u.id} onClick={() => openStudentView(u)} style={{ cursor: 'pointer' }}>
                  <td>{u.name || '-'}</td>
                  <td>{u.email || '-'}</td>
                  <td>{batchText}</td>
                  <td>{u.city_district || '-'}</td>
                  <td>
                    <button
                      type="button"
                      className="secondaryBtn"
                      onClick={(e) => {
                        e.stopPropagation();
                        openEdit(u);
                      }}
                    >
                      Edit
                    </button>
                    {canDangerDelete && onDeleteUser ? (
                      <button
                        type="button"
                        className="dangerBtn"
                        style={{ marginLeft: 8 }}
                        title="Permanently remove this account"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            !window.confirm(
                              `DELETE user ${u.email || u.id} (${u.role || '?'}).\nThis cannot be undone.`,
                            )
                          ) {
                            return;
                          }
                          void onDeleteUser(u.id).catch(() => {});
                        }}
                      >
                        Delete
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {listRows.length === 0 ? <p className="muted">No students match this filter.</p> : null}
    </SectionCard>
  );

  if (!isStudents) {
    return (
      <div className="stack">
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
        {studentsTable}
      </div>
    );
  }

  const viewAddress = [
    viewStudent?.studentProfile?.address_line_1,
    viewStudent?.studentProfile?.address_line_2,
    viewStudent?.studentProfile?.city_district,
    viewStudent?.studentProfile?.state_province,
    viewStudent?.studentProfile?.country,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div className="stack">
      {studentsTable}

      <Modal open={viewOpen} title="Student Profile" onClose={() => setViewOpen(false)}>
        {viewStudent ? (
          <div className="stack">
            <div className="studentProfileHero">
              {viewStudent.profile_photo_url ? (
                <img src={viewStudent.profile_photo_url} alt={viewStudent.name || 'Student'} className="studentProfileHeroAvatar" />
              ) : (
                <div className="studentProfileHeroAvatar studentProfileHeroAvatarFallback">
                  {String(viewStudent.name || 'S').slice(0, 1).toUpperCase()}
                </div>
              )}
              <div>
                <h3 style={{ margin: 0 }}>{viewStudent.name || 'Student'}</h3>
                <p className="muted" style={{ marginTop: 4 }}>{viewStudent.email || '-'}</p>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <button className="secondaryBtn" type="button" onClick={() => openEdit(viewStudent)}>
                  Edit profile
                </button>
                {canDangerDelete && onDeleteUser ? (
                  <button
                    className="dangerBtn"
                    type="button"
                    onClick={() => {
                      if (
                        !window.confirm(
                          `DELETE ${viewStudent.email} permanently? This removes enrollments and session data for this account.`,
                        )
                      ) {
                        return;
                      }
                      void onDeleteUser(viewStudent.id)
                        .then(() => {
                          setViewOpen(false);
                          setViewStudent(null);
                        })
                        .catch(() => {});
                    }}
                  >
                    Delete user
                  </button>
                ) : null}
              </div>
            </div>
            <div className="formGrid">
              <div><strong>Mobile</strong><p className="muted">{viewStudent.mobile_number || '-'}</p></div>
              <div><strong>Gender</strong><p className="muted">{viewStudent.studentProfile?.gender || '-'}</p></div>
              <div><strong>Birth date</strong><p className="muted">{viewStudent.studentProfile?.birth_date || '-'}</p></div>
              <div><strong>Occupation</strong><p className="muted">{viewStudent.studentProfile?.occupation || '-'}</p></div>
              <div style={{ gridColumn: '1 / -1' }}><strong>Address</strong><p className="muted">{viewAddress || '-'}</p></div>
              <div style={{ gridColumn: '1 / -1' }}>
                <strong>Connected Batches</strong>
                <p className="muted">
                  {(viewStudent.connectedBatches || [])
                    .map((b) => [b.batch_number, b.batch_title, b.batch_type].filter(Boolean).join(' • '))
                    .join(' | ') || '-'}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal open={editOpen} title="Edit Student" onClose={() => setEditOpen(false)} variant="drawer">
        <form onSubmit={submitEdit} className="formGrid">
          <input value={editForm.name} onChange={(e) => setEditField('name', e.target.value)} placeholder="Name" required />
          <input value={editForm.email} onChange={(e) => setEditField('email', e.target.value)} placeholder="Email" type="email" required />
          <input value={editForm.mobileNumber} onChange={(e) => setEditField('mobileNumber', String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 10))} placeholder="10 digit mobile number" />
          <select value={editForm.countryIso} onChange={(e) => setEditCountry(e.target.value)}>
            {ALL_COUNTRIES.map((country) => (
              <option key={`edit-code-${country.isoCode}`} value={country.isoCode}>{`+${country.phonecode} - ${country.name}`}</option>
            ))}
          </select>
          <select value={editForm.gender} onChange={(e) => setEditField('gender', e.target.value)}>
            {GENDERS.map((g) => (
              <option key={`edit-${g}`} value={g}>{g}</option>
            ))}
          </select>
          <input type="date" value={editForm.birthDate} onChange={(e) => setEditField('birthDate', e.target.value)} />
          <input value={editForm.addressLine1} onChange={(e) => setEditField('addressLine1', e.target.value)} placeholder="Address line 1" />
          <input value={editForm.addressLine2} onChange={(e) => setEditField('addressLine2', e.target.value)} placeholder="Address line 2 (optional)" />
          <select value={editForm.countryIso} onChange={(e) => setEditCountry(e.target.value)}>
            {ALL_COUNTRIES.map((country) => (
              <option key={`edit-country-${country.isoCode}`} value={country.isoCode}>{country.name}</option>
            ))}
          </select>
          <select value={editForm.stateIso} onChange={(e) => setEditState(e.target.value)}>
            {editStates.length ? editStates.map((state) => (
              <option key={`edit-state-${state.isoCode}`} value={state.isoCode}>{state.name}</option>
            )) : <option value="">No states available</option>}
          </select>
          <select value={editForm.cityDistrict} onChange={(e) => setEditField('cityDistrict', e.target.value)}>
            {editCities.length ? editCities.map((city) => (
              <option key={`edit-city-${city.name}`} value={city.name}>{city.name}</option>
            )) : <option value="">No city data</option>}
          </select>
          <select value={editForm.occupation} onChange={(e) => setEditField('occupation', e.target.value)}>
            {OCCUPATIONS.map((opt) => (
              <option key={`edit-occ-${opt}`} value={opt}>{opt}</option>
            ))}
          </select>
          <button type="submit">Save Profile</button>
        </form>
      </Modal>

      <Modal open={createOpen} title="Create Student" onClose={() => setCreateOpen(false)} variant="drawer">
        <form ref={createFormRef} onSubmit={handleCreateSubmit} className="formGrid" autoComplete="off">
          {createError ? <p className="error" style={{ gridColumn: '1 / -1', margin: 0 }}>{createError}</p> : null}
          <input name="name" placeholder="Name" required autoComplete="name" value={studentCreate.name} onChange={(e) => setStudentCreateField('name', e.target.value)} />
          <input name="email" placeholder="Email" type="email" required autoComplete="off" value={studentCreate.email} onChange={(e) => setStudentCreateField('email', e.target.value)} />
          <div className="passwordFieldWrap">
            <input
              name="password"
              placeholder="Password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={studentCreate.password}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              onChange={(e) => setStudentCreateField('password', e.target.value)}
            />
            <button type="button" className="passwordToggleInlineBtn" onClick={() => setShowPassword((v) => !v)}>
              {showPassword ? 'Hide' : 'View'}
            </button>
          </div>
          <div className="passwordFieldWrap">
            <input
              name="confirmPassword"
              placeholder="Confirm password"
              type={showConfirmPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={studentCreate.confirmPassword}
              onFocus={() => setConfirmPasswordFocused(true)}
              onBlur={() => setConfirmPasswordFocused(false)}
              onChange={(e) => setStudentCreateField('confirmPassword', e.target.value)}
            />
            <button type="button" className="passwordToggleInlineBtn" onClick={() => setShowConfirmPassword((v) => !v)}>
              {showConfirmPassword ? 'Hide' : 'View'}
            </button>
          </div>
          {passwordFocused ? (
            <div className="passwordRuleList">
              <span className={passwordChecks.minLength ? 'passwordRuleOk' : 'passwordRuleBad'}>Minimum 8 characters</span>
              <span className={passwordChecks.uppercase ? 'passwordRuleOk' : 'passwordRuleBad'}>At least one capital letter (A-Z)</span>
              <span className={passwordChecks.number ? 'passwordRuleOk' : 'passwordRuleBad'}>At least one number (0-9)</span>
              <span className={passwordChecks.symbol ? 'passwordRuleOk' : 'passwordRuleBad'}>At least one symbol</span>
            </div>
          ) : null}
          {confirmPasswordFocused && studentCreate.confirmPassword.length > 0 ? (
            <span className={passwordsMatch ? 'passwordRuleOk' : 'passwordRuleBad'} style={{ gridColumn: '1 / -1' }}>
              {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
            </span>
          ) : null}
          <input type="hidden" name="role" value="Student" />
          <input
            name="mobileNumber"
            placeholder="10 digit mobile number"
            value={studentCreate.mobileNumber}
            onChange={(e) => setStudentCreateField('mobileNumber', String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 10))}
          />
          <select name="countryCode" value={studentCreate.countryIso} onChange={(e) => setCreateCountry(e.target.value)}>
            {ALL_COUNTRIES.map((country) => (
              <option key={`code-${country.isoCode}`} value={country.isoCode}>{`+${country.phonecode} - ${country.name}`}</option>
            ))}
          </select>
          <select name="gender" value={studentCreate.gender} onChange={(e) => setStudentCreateField('gender', e.target.value)}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <input name="birthDate" type="date" value={studentCreate.birthDate} onChange={(e) => setStudentCreateField('birthDate', e.target.value)} />
          <input name="addressLine1" placeholder="Address line 1" value={studentCreate.addressLine1} onChange={(e) => setStudentCreateField('addressLine1', e.target.value)} />
          <input name="addressLine2" placeholder="Address line 2 (optional)" value={studentCreate.addressLine2} onChange={(e) => setStudentCreateField('addressLine2', e.target.value)} />
          <select name="country" value={studentCreate.countryIso} onChange={(e) => setCreateCountry(e.target.value)}>
            {ALL_COUNTRIES.map((country) => (
              <option key={country.isoCode} value={country.isoCode}>{country.name}</option>
            ))}
          </select>
          <select name="stateProvince" value={studentCreate.stateIso} onChange={(e) => setCreateState(e.target.value)}>
            {createStates.length ? createStates.map((state) => (
              <option key={state.isoCode} value={state.isoCode}>{state.name}</option>
            )) : <option value="">No states available</option>}
          </select>
          <select name="cityDistrict" value={studentCreate.cityDistrict} onChange={(e) => setStudentCreateField('cityDistrict', e.target.value)}>
            {createCities.length ? createCities.map((city) => (
              <option key={city.name} value={city.name}>{city.name}</option>
            )) : <option value="">No city data</option>}
          </select>
          <select name="occupation" value={studentCreate.occupation} onChange={(e) => setStudentCreateField('occupation', e.target.value)}>
            {OCCUPATIONS.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
          <label className="fieldLabel">
            <span className="muted">Profile photo (1:1 crop optimized)</span>
            <input type="file" accept="image/*" onChange={onCreatePhotoPicked} />
          </label>
          {createPhotoPreviewUrl ? <img src={createPhotoPreviewUrl} alt="Profile preview" style={{ width: 96, height: 96, borderRadius: 999, objectFit: 'cover' }} /> : null}
          <button type="submit">Create student</button>
        </form>
      </Modal>

      <Modal open={cropOpen} title="Crop Profile Photo" onClose={() => setCropOpen(false)}>
        <div className="profileCropWrap">
          <div className="profileCropViewport">
            {rawPhotoUrl ? (
              <Cropper
                image={rawPhotoUrl}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, croppedPixels) => setCroppedAreaPixels(croppedPixels)}
              />
            ) : null}
          </div>
          <label className="profileCropZoom">
            <span>Zoom</span>
            <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
          </label>
          <div className="row">
            <button type="button" className="secondaryBtn" onClick={() => setCropOpen(false)}>Cancel</button>
            <button type="button" onClick={applyCrop}>Apply crop</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
