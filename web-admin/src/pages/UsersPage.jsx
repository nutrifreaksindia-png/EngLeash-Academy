import React, { useEffect, useState, useRef, useMemo } from 'react';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';
import ActionMenu from '../components/ActionMenu';
import { City, Country, State } from 'country-state-city';
import Cropper from 'react-easy-crop';

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
const ALL_COUNTRIES = Country.getAllCountries().sort((a, b) => a.name.localeCompare(b.name));
const DEFAULT_COUNTRY_ISO = ALL_COUNTRIES.find((c) => c.isoCode === 'IN')?.isoCode || ALL_COUNTRIES[0]?.isoCode || '';
const OCCUPATIONS = ['Student', 'Working Professional', 'Homemaker', 'Business', 'Freelancer', 'Other'];
const GENDERS = ['Male', 'Female', 'Other'];

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

  const states = useMemo(
    () => State.getStatesOfCountry(studentCreate.countryIso).sort((a, b) => a.name.localeCompare(b.name)),
    [studentCreate.countryIso]
  );
  const cities = useMemo(() => {
    if (studentCreate.stateIso) {
      return City.getCitiesOfState(studentCreate.countryIso, studentCreate.stateIso).sort((a, b) => a.name.localeCompare(b.name));
    }
    return City.getCitiesOfCountry(studentCreate.countryIso).sort((a, b) => a.name.localeCompare(b.name));
  }, [studentCreate.countryIso, studentCreate.stateIso]);
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
    setCreateError('');
    if (variant === 'students') {
      const selectedCountry = ALL_COUNTRIES.find((c) => c.isoCode === studentCreate.countryIso);
      const selectedState = states.find((s) => s.isoCode === studentCreate.stateIso);
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
      gender: String(form.get('gender') || '').trim(),
      birthDate: String(form.get('birthDate') || '').trim(),
      addressLine1: String(form.get('addressLine1') || '').trim(),
      addressLine2: String(form.get('addressLine2') || '').trim(),
      cityDistrict: String(form.get('cityDistrict') || '').trim(),
      stateProvince: String(form.get('stateProvince') || '').trim(),
      country: String(form.get('country') || '').trim(),
      countryCode: String(form.get('countryCode') || '').trim(),
      occupation: String(form.get('occupation') || '').trim(),
      profilePhotoBlob: createPhotoBlob,
      profilePhotoUrl: '',
    });
    formEl.reset();
    setCreatePhotoBlob(null);
    setCreatePhotoPreviewUrl('');
    setCreateOpen(false);
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

  function setStudentField(key, value) {
    setStudentCreate((prev) => ({ ...prev, [key]: value }));
  }

  function setCountry(countryIso) {
    const selectedCountry = ALL_COUNTRIES.find((c) => c.isoCode === countryIso);
    const nextStates = State.getStatesOfCountry(countryIso);
    const defaultState = nextStates.find((s) => s.name === 'Tamil Nadu') || nextStates[0] || null;
    const nextCities = defaultState
      ? City.getCitiesOfState(countryIso, defaultState.isoCode)
      : City.getCitiesOfCountry(countryIso);
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

  function setStateIso(stateIso) {
    const selectedState = states.find((s) => s.isoCode === stateIso);
    const nextCities = stateIso ? City.getCitiesOfState(studentCreate.countryIso, stateIso) : City.getCitiesOfCountry(studentCreate.countryIso);
    const defaultCity = nextCities[0] || null;
    setStudentCreate((prev) => ({
      ...prev,
      stateIso,
      stateProvince: selectedState?.name || '',
      cityDistrict: defaultCity?.name || '',
    }));
  }

  useEffect(() => {
    if (variant !== 'students') return;
    if (!studentCreate.countryIso) return;
    if (!studentCreate.countryCode || !studentCreate.country || !studentCreate.stateProvince || !studentCreate.cityDistrict) {
      setCountry(studentCreate.countryIso);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, createOpen]);

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
          {createError ? <p className="error" style={{ gridColumn: '1 / -1', margin: 0 }}>{createError}</p> : null}
          <input name="name" placeholder="Name" required autoComplete="name" value={studentCreate.name} onChange={(e) => setStudentField('name', e.target.value)} />
          <input name="email" placeholder="Email" type="email" required autoComplete="off" value={studentCreate.email} onChange={(e) => setStudentField('email', e.target.value)} />
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
              onChange={(e) => setStudentField('password', e.target.value)}
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
              onChange={(e) => setStudentField('confirmPassword', e.target.value)}
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
            onChange={(e) => setStudentField('mobileNumber', String(e.target.value || '').replace(/[^\d]/g, '').slice(0, 10))}
          />
          <select name="countryCode" value={studentCreate.countryIso} onChange={(e) => setCountry(e.target.value)}>
            {ALL_COUNTRIES.map((country) => (
              <option key={`code-${country.isoCode}`} value={country.isoCode}>{`+${country.phonecode} - ${country.name}`}</option>
            ))}
          </select>
          <select name="gender" value={studentCreate.gender} onChange={(e) => setStudentField('gender', e.target.value)}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
          <input name="birthDate" type="date" value={studentCreate.birthDate} onChange={(e) => setStudentField('birthDate', e.target.value)} />
          <input name="addressLine1" placeholder="Address line 1" value={studentCreate.addressLine1} onChange={(e) => setStudentField('addressLine1', e.target.value)} />
          <input name="addressLine2" placeholder="Address line 2 (optional)" value={studentCreate.addressLine2} onChange={(e) => setStudentField('addressLine2', e.target.value)} />
          <select name="country" value={studentCreate.countryIso} onChange={(e) => setCountry(e.target.value)}>
            {ALL_COUNTRIES.map((country) => (
              <option key={country.isoCode} value={country.isoCode}>{country.name}</option>
            ))}
          </select>
          <select name="stateProvince" value={studentCreate.stateIso} onChange={(e) => setStateIso(e.target.value)}>
            {states.length ? states.map((state) => (
              <option key={state.isoCode} value={state.isoCode}>{state.name}</option>
            )) : <option value="">No states available</option>}
          </select>
          <select name="cityDistrict" value={studentCreate.cityDistrict} onChange={(e) => setStudentField('cityDistrict', e.target.value)}>
            {cities.length ? cities.map((city) => (
              <option key={city.name} value={city.name}>{city.name}</option>
            )) : <option value="">No city data</option>}
          </select>
          <select name="occupation" value={studentCreate.occupation} onChange={(e) => setStudentField('occupation', e.target.value)}>
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
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            />
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
