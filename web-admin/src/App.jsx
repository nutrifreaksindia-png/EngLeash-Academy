import React, { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import LiveClassroomPage from './pages/LiveClassroomPage';
import LoginCard from './components/LoginCard';
import StatusBanner from './components/StatusBanner';
import AdminShell from './components/AdminShell';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import ApprovalsPage from './pages/ApprovalsPage';
import LeadsPage from './pages/LeadsPage';
import CoursesPage from './pages/CoursesPage';
import LessonsPage from './pages/LessonsPage';
import BatchesPage from './pages/BatchesPage';
import ToastStack from './components/ToastStack';
import QuizBankPage from './pages/QuizBankPage';
import VideosPage from './pages/VideosPage';
import SettingsPage from './pages/SettingsPage';
import StudyMaterialsPage from './pages/StudyMaterialsPage';
import WorksheetsPage from './pages/WorksheetsPage';
import AssignmentsPage from './pages/AssignmentsPage';
import BillingPage from './pages/BillingPage';
import PaymentsPage from './pages/PaymentsPage';
import SubscriptionsPage from './pages/SubscriptionsPage';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

const WEB_ADMIN_ROLES = ['Admin', 'Creator', 'Trainer'];

const WEB_ADMIN_TOKEN_KEY = 'engleash_web_admin_token';

function persistWebAdminToken(t) {
  try {
    if (t) localStorage.setItem(WEB_ADMIN_TOKEN_KEY, t);
    else localStorage.removeItem(WEB_ADMIN_TOKEN_KEY);
  } catch {
    /* ignore private mode / quota */
  }
}
const CREATOR_ALLOWED_PAGES = new Set([
  'videos',
  'study-materials',
  'worksheets',
  'quizzes',
  'assignments',
  'courses',
  'lessons',
]);

function readableHttpError(raw, fallbackStatus) {
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (raw != null && typeof raw !== 'object' && String(raw).trim()) return String(raw).trim();
  if (raw != null && typeof raw === 'object') {
    const inner = raw.detail ?? raw.reason ?? raw.title ?? raw.err;
    if (typeof inner === 'string' && inner.trim()) return inner.trim();
  }
  if (fallbackStatus != null) return `Request failed (HTTP ${fallbackStatus})`;
  return 'Request failed';
}

async function apiFetch(path, token, options = {}) {
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const fromBody = readableHttpError(data?.error ?? data?.message, res.status);
    throw new Error(fromBody);
  }
  return data;
}

async function apiFetchSafe(path, token, options = {}) {
  try {
    const data = await apiFetch(path, token, options);
    return { ok: true, data };
  } catch (error) {
    const msg =
      typeof error?.message === 'string' && error.message.trim()
        ? error.message.trim()
        : 'Request failed';
    return { ok: false, error: msg };
  }
}

/** Persist course highlights as a JSON array of single-line bullet strings (may be []). */
function serializeHighlightPoints(points) {
  if (!points || !Array.isArray(points)) return '[]';
  const cleaned = points.map((s) => String(s).trim()).filter(Boolean);
  return JSON.stringify(cleaned);
}

function SaveLiveIntentRedirect() {
  const loc = useLocation();
  React.useLayoutEffect(() => {
    sessionStorage.setItem('postLoginLive', loc.pathname);
  }, [loc.pathname]);
  return <Navigate to="/" replace />;
}

async function uploadCourseCover(courseId, token, coverBlob) {
  if (!coverBlob) return;
  const body = new FormData();
  body.append('file', coverBlob, `course-${courseId}-cover.jpg`);
  const res = await fetch(`${API_BASE}/api/courses/${courseId}/cover`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Cover upload failed');
}

async function uploadUserProfilePhoto(userId, token, photoBlob) {
  if (!photoBlob) return null;
  const body = new FormData();
  body.append('file', photoBlob, `user-${userId}-profile.jpg`);
  const res = await fetch(`${API_BASE}/api/users/${userId}/photo`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Profile photo upload failed');
  return data.photoUrl || null;
}

async function uploadVideoLibraryAsset(token, payload, onProgress) {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append('title', payload.title || '');
    body.append('description', payload.description || '');
    body.append('categoryId', String(payload.categoryId || ''));
    body.append('file', payload.file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/videos`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      const pct = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
      onProgress?.(pct);
    };

    xhr.onerror = () => reject(new Error('Network error while uploading video'));
    xhr.onload = () => {
      const data = (() => {
        try {
          return JSON.parse(xhr.responseText || '{}');
        } catch {
          return {};
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      reject(new Error(data.error || xhr.statusText || `Video upload failed (HTTP ${xhr.status})`));
    };
    xhr.send(body);
  });
}

export default function App() {
  const navigate = useNavigate();
  const [token, setToken] = useState('');
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [busyLogin, setBusyLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [users, setUsers] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [pendingApplications, setPendingApplications] = useState([]);
  const [applyLeads, setApplyLeads] = useState([]);
  const [courses, setCourses] = useState([]);
  const [library, setLibrary] = useState([]);
  const [batches, setBatches] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [quizBank, setQuizBank] = useState([]);
  const [videos, setVideos] = useState([]);
  const [videoCategories, setVideoCategories] = useState([]);
  const [studyMaterials, setStudyMaterials] = useState([]);
  const [worksheets, setWorksheets] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [batchSessions, setBatchSessions] = useState([]);
  const [cancelAuditRows, setCancelAuditRows] = useState([]);
  const [batchMembers, setBatchMembers] = useState([]);
  const [batchTrainers, setBatchTrainers] = useState([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [toasts, setToasts] = useState([]);
  const [loadErrors, setLoadErrors] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [health, setHealth] = useState(null);
  const [authBootstrapping, setAuthBootstrapping] = useState(true);

  const authReady = useMemo(() => Boolean(token), [token]);

  function pushToast(text, type = 'info') {
    let label = text == null ? '' : String(text).trim();
    if (!label && type === 'error') label = 'Something went wrong. Check your connection or try again.';
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, text: label, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2600);
  }

  async function doLogin() {
    setError('');
    setBusyLogin(true);
    try {
      const data = await apiFetch('/auth/login', null, {
        method: 'POST',
        body: JSON.stringify({ email, password, client: 'mobile' }),
      });
      if (data?.alreadyLoggedIn) {
        const replaced = await apiFetch('/auth/replace-session', null, {
          method: 'POST',
          body: JSON.stringify({ email, password, client: 'mobile' }),
        });
        setToken(replaced.token);
        persistWebAdminToken(replaced.token);
        const me = await apiFetch('/users/me', replaced.token);
        setCurrentUser(me);
        if (!WEB_ADMIN_ROLES.includes(me?.role)) {
          setToken('');
          persistWebAdminToken('');
          throw new Error(`Web admin access is not available for this account. Logged in as ${me?.role || 'Unknown'}`);
        }
        if (me?.role === 'Creator') setCurrentPage('study-materials');
        const hd = me?.role === 'Admin' ? await apiFetch('/health/details', replaced.token).catch(() => null) : null;
        setHealth(hd);
        setMessage('Logged in (previous session replaced)');
        setTimeout(() => {
          void loadAllWithToken(replaced.token).then(() => {
            const pend = sessionStorage.getItem('postLoginLive');
            if (pend?.startsWith('/live/')) {
              sessionStorage.removeItem('postLoginLive');
              navigate(pend, { replace: true });
            }
          });
        }, 0);
        return;
      }
      if (!data?.token) {
        throw new Error('Login did not return a token');
      }
      setToken(data.token);
      persistWebAdminToken(data.token);
      const me = await apiFetch('/users/me', data.token);
      setCurrentUser(me);
      if (!WEB_ADMIN_ROLES.includes(me?.role)) {
        setToken('');
        persistWebAdminToken('');
        throw new Error(`Web admin access is not available for this account. Logged in as ${me?.role || 'Unknown'}`);
      }
      if (me?.role === 'Creator') setCurrentPage('study-materials');
      const hd = me?.role === 'Admin' ? await apiFetch('/health/details', data.token).catch(() => null) : null;
      setHealth(hd);
      setMessage('Logged in');
      setTimeout(() => {
        void loadAllWithToken(data.token).then(() => {
          const pend = sessionStorage.getItem('postLoginLive');
          if (pend?.startsWith('/live/')) {
            sessionStorage.removeItem('postLoginLive');
            navigate(pend, { replace: true });
          }
        });
      }, 0);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyLogin(false);
    }
  }

  async function loadAllWithToken(nextToken) {
    setError('');
    setLoadErrors([]);
    try {
      const me = await apiFetch('/users/me', nextToken);
      setCurrentUser(me);

      if (me.role === 'Creator') {
        const [c, l, q, v, vc, sm, ws, asg] = await Promise.all([
          apiFetchSafe('/courses', nextToken),
          apiFetchSafe('/lessons/admin/all', nextToken),
          apiFetchSafe('/quizzes/v2', nextToken),
          apiFetchSafe('/videos', nextToken),
          apiFetchSafe('/videos/categories', nextToken),
          apiFetchSafe('/study-materials', nextToken),
          apiFetchSafe('/worksheets', nextToken),
          apiFetchSafe('/assignments', nextToken),
        ]);
        setUsers([]);
        setPendingUsers([]);
        setPendingApplications([]);
        setApplyLeads([]);
        setBatches([]);
        setHolidays([]);
        if (c.ok) setCourses(Array.isArray(c.data) ? c.data : []);
        else setCourses([]);
        if (l.ok) setLibrary(Array.isArray(l.data) ? l.data : []);
        else setLibrary([]);
        if (q.ok) setQuizBank(Array.isArray(q.data) ? q.data : []);
        else setQuizBank([]);
        if (v.ok) setVideos(Array.isArray(v.data) ? v.data : []);
        else setVideos([]);
        if (vc.ok) setVideoCategories(Array.isArray(vc.data) ? vc.data : []);
        else setVideoCategories([]);
        if (sm.ok) setStudyMaterials(Array.isArray(sm.data) ? sm.data : []);
        else setStudyMaterials([]);
        if (ws.ok) setWorksheets(Array.isArray(ws.data) ? ws.data : []);
        else setWorksheets([]);
        if (asg.ok) setAssignments(Array.isArray(asg.data) ? asg.data : []);
        else setAssignments([]);
        setHealth(null);
        setLoadErrors([
          !c.ok ? `/courses: ${c.error}` : null,
          !l.ok ? `/lessons/admin/all: ${l.error}` : null,
          !q.ok ? `/quizzes/v2: ${q.error}` : null,
          !v.ok ? `/videos: ${v.error}` : null,
          !vc.ok ? `/videos/categories: ${vc.error}` : null,
          !sm.ok ? `/study-materials: ${sm.error}` : null,
          !ws.ok ? `/worksheets: ${ws.error}` : null,
          !asg.ok ? `/assignments: ${asg.error}` : null,
        ].filter(Boolean));
        return;
      }

      const [u, pu, pa, ae, c, l, b, h, q, v, vc, sm, ws, asg] = await Promise.all([
        apiFetchSafe('/users', nextToken),
        apiFetchSafe('/users/pending', nextToken),
        apiFetchSafe('/enrollments/pending-applications', nextToken),
        apiFetchSafe('/payments/admin/apply-enquiries', nextToken),
        apiFetchSafe('/courses', nextToken),
        apiFetchSafe('/lessons/admin/all', nextToken),
        apiFetchSafe('/batch-manager', nextToken),
        apiFetchSafe('/batch-manager/holidays/list', nextToken),
        apiFetchSafe('/quizzes/v2', nextToken),
        apiFetchSafe('/videos', nextToken),
        apiFetchSafe('/videos/categories', nextToken),
        apiFetchSafe('/study-materials', nextToken),
        apiFetchSafe('/worksheets', nextToken),
        apiFetchSafe('/assignments', nextToken),
      ]);

      if (u.ok) setUsers(Array.isArray(u.data) ? u.data : []);
      if (pu.ok) setPendingUsers(Array.isArray(pu.data) ? pu.data : []);
      if (pa.ok) setPendingApplications(Array.isArray(pa.data) ? pa.data : []);
      if (ae.ok) setApplyLeads(Array.isArray(ae.data) ? ae.data : []);
      else setApplyLeads([]);
      if (c.ok) setCourses(Array.isArray(c.data) ? c.data : []);
      if (l.ok) setLibrary(Array.isArray(l.data) ? l.data : []);
      if (b.ok) setBatches(Array.isArray(b.data) ? b.data : []);
      if (h.ok) setHolidays(Array.isArray(h.data) ? h.data : []);
      if (q.ok) setQuizBank(Array.isArray(q.data) ? q.data : []);
      if (v.ok) setVideos(Array.isArray(v.data) ? v.data : []);
      if (vc.ok) setVideoCategories(Array.isArray(vc.data) ? vc.data : []);
      if (sm.ok) setStudyMaterials(Array.isArray(sm.data) ? sm.data : []);
      if (ws.ok) setWorksheets(Array.isArray(ws.data) ? ws.data : []);
      if (asg.ok) setAssignments(Array.isArray(asg.data) ? asg.data : []);

      const errs = [
        !u.ok ? `/users: ${u.error}` : null,
        !pu.ok ? `/users/pending: ${pu.error}` : null,
        !pa.ok ? `/enrollments/pending-applications: ${pa.error}` : null,
        !ae.ok ? `/payments/admin/apply-enquiries: ${ae.error}` : null,
        !c.ok ? `/courses: ${c.error}` : null,
        !l.ok ? `/lessons/admin/all: ${l.error}` : null,
        !b.ok ? `/batch-manager: ${b.error}` : null,
        !h.ok ? `/batch-manager/holidays/list: ${h.error}` : null,
        !q.ok ? `/quizzes/v2: ${q.error}` : null,
        !v.ok ? `/videos: ${v.error}` : null,
        !vc.ok ? `/videos/categories: ${vc.error}` : null,
        !sm.ok ? `/study-materials: ${sm.error}` : null,
        !ws.ok ? `/worksheets: ${ws.error}` : null,
        !asg.ok ? `/assignments: ${asg.error}` : null,
      ].filter(Boolean);
      setLoadErrors(errs);
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadAll() {
    await loadAllWithToken(token);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = localStorage.getItem(WEB_ADMIN_TOKEN_KEY);
        if (!stored) return;
        const me = await apiFetch('/users/me', stored);
        if (cancelled) return;
        if (!WEB_ADMIN_ROLES.includes(me?.role)) {
          persistWebAdminToken('');
          return;
        }
        setToken(stored);
        setCurrentUser(me);
        if (me?.role === 'Creator') setCurrentPage('study-materials');
        const hd = me?.role === 'Admin' ? await apiFetch('/health/details', stored).catch(() => null) : null;
        if (!cancelled) setHealth(hd);
        await loadAllWithToken(stored);
      } catch {
        persistWebAdminToken('');
      } finally {
        if (!cancelled) setAuthBootstrapping(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore session once on mount
  }, []);

  function logout() {
    persistWebAdminToken('');
    setToken('');
    navigate('/');
    setCurrentPage('dashboard');
    setUsers([]);
    setPendingUsers([]);
    setCourses([]);
    setLibrary([]);
    setBatches([]);
    setHolidays([]);
    setQuizBank([]);
    setVideos([]);
    setVideoCategories([]);
    setStudyMaterials([]);
    setWorksheets([]);
    setAssignments([]);
    setBatchSessions([]);
    setCancelAuditRows([]);
    setBatchMembers([]);
    setBatchTrainers([]);
    setCurrentUser(null);
    setHealth(null);
    setMessage('Logged out');
  }

  async function createUser(payload) {
    try {
      const created = await apiFetch('/users', token, {
        method: 'POST',
        body: JSON.stringify({
          name: payload.name,
          email: payload.email,
          password: payload.password,
          role: payload.role,
          mobileNumber: payload.mobileNumber,
          profilePhotoUrl: payload.profilePhotoUrl || null,
          gender: payload.gender || null,
          birthDate: payload.birthDate || null,
          addressLine1: payload.addressLine1 || null,
          addressLine2: payload.addressLine2 || null,
          cityDistrict: payload.cityDistrict || null,
          stateProvince: payload.stateProvince || null,
          country: payload.country || null,
          countryCode: payload.countryCode || null,
          occupation: payload.occupation || null,
          policiesAgreed: payload.policiesAgreed === true,
        }),
      });
      if (payload.profilePhotoBlob && created?.id != null) {
        await uploadUserProfilePhoto(created.id, token, payload.profilePhotoBlob);
      }
      if (created && created.id != null) {
        setUsers((prev) => {
          const list = Array.isArray(prev) ? prev : [];
          const next = list.filter((u) => Number(u.id) !== Number(created.id));
          next.unshift(created);
          return next;
        });
      }
      await loadAll();
      setMessage('User created');
      pushToast('User created', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function updateUser(payload) {
    try {
      await apiFetch(`/users/${payload.id}`, token, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await loadAll();
      setMessage('User profile updated');
      pushToast('User profile updated', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function getUserDetails(id) {
    return apiFetch(`/users/${id}`, token);
  }

  async function createCourse(payload) {
    try {
      const highlightsJson = serializeHighlightPoints(payload.highlightPoints);
      const created = await apiFetch('/courses', token, {
        method: 'POST',
        body: JSON.stringify({
          name: payload.name,
          description: payload.description,
          highlights: highlightsJson,
          specificationsHtml: payload.specificationsHtml,
          durationDays: Number(payload.durationDays || 1),
          modes: Array.isArray(payload.modes) ? payload.modes.filter((x) => typeof x === 'string' && x.trim()) : [],
          languages: Array.isArray(payload.languages)
            ? payload.languages.filter((x) => typeof x === 'string' && x.trim())
            : [],
          feeInr: Number(payload.feeInr || 0),
          discountInr: Number(payload.discountInr || 0),
          courseStatus: payload.courseStatus,
          enrollmentType: payload.enrollmentType,
          progressionType: payload.progressionType === 'day_wise' ? 'day_wise' : 'unlock_all',
          applyRegistrationFeeInr: Number(payload.applyRegistrationFeeInr ?? 999),
          applySinglePaymentDiscountInr: Number(payload.applySinglePaymentDiscountInr ?? 0),
          applyInstallmentCount: Number(payload.applyInstallmentCount ?? 2),
          applyInstallmentGapDays: Number(payload.applyInstallmentGapDays ?? 30),
          applyGraceDays: Number(payload.applyGraceDays ?? 7),
          applyEnquiryEnabled: payload.applyEnquiryEnabled !== false,
          is_published: payload.isPublished === false ? 0 : 1,
        }),
      });
      await uploadCourseCover(created.id, token, payload.coverBlob);
      await loadAll();
      setMessage('Course created');
      pushToast('Course created', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function updateCourse(payload) {
    try {
      const highlightsJson = serializeHighlightPoints(payload.highlightPoints);
      await apiFetch(`/courses/${payload.id}`, token, {
        method: 'PUT',
        body: JSON.stringify({
          name: payload.name,
          description: payload.description,
          highlights: highlightsJson,
          specificationsHtml: payload.specificationsHtml,
          durationDays: Number(payload.durationDays || 1),
          modes: Array.isArray(payload.modes) ? payload.modes.filter((x) => typeof x === 'string' && x.trim()) : [],
          languages: Array.isArray(payload.languages)
            ? payload.languages.filter((x) => typeof x === 'string' && x.trim())
            : [],
          feeInr: Number(payload.feeInr || 0),
          discountInr: Number(payload.discountInr || 0),
          courseStatus: payload.courseStatus,
          enrollmentType: payload.enrollmentType,
          progressionType: payload.progressionType === 'day_wise' ? 'day_wise' : 'unlock_all',
          applyRegistrationFeeInr: Number(payload.applyRegistrationFeeInr ?? 999),
          applySinglePaymentDiscountInr: Number(payload.applySinglePaymentDiscountInr ?? 0),
          applyInstallmentCount: Number(payload.applyInstallmentCount ?? 2),
          applyInstallmentGapDays: Number(payload.applyInstallmentGapDays ?? 30),
          applyGraceDays: Number(payload.applyGraceDays ?? 7),
          applyEnquiryEnabled: payload.applyEnquiryEnabled !== false,
          is_published: payload.isPublished === false ? 0 : 1,
        }),
      });
      await uploadCourseCover(payload.id, token, payload.coverBlob);
      await loadAll();
      setMessage('Course updated');
      pushToast('Course updated', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function createLessonLibrary(payload) {
    const created = await apiFetch('/lessons/library', token, {
      method: 'POST',
      body: JSON.stringify({
        title: payload.title,
        description: payload.description ?? '',
      }),
    });
    await loadAll();
    setMessage('Lesson created');
    pushToast('Lesson created', 'success');
    return created;
  }

  async function updateLessonLibrary(payload) {
    await apiFetch(`/lessons/library/${payload.id}`, token, {
      method: 'PUT',
      body: JSON.stringify({
        title: payload.title,
        description: payload.description ?? '',
      }),
    });
    await loadAll();
    setMessage('Lesson updated');
    pushToast('Lesson updated', 'success');
  }

  async function saveLessonComposition(lessonId, items) {
    await apiFetch(`/lessons/library/${lessonId}/composition`, token, {
      method: 'PUT',
      body: JSON.stringify({ items }),
    });
    await loadAll();
  }

  async function loadLessonComposition(lessonId) {
    return apiFetch(`/lessons/library/${lessonId}/composition`, token);
  }

  async function deleteCourse(id) {
    try {
      await apiFetch(`/courses/${id}`, token, { method: 'DELETE' });
      await loadAll();
      setMessage('Course deleted');
      pushToast('Course deleted', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function fetchCourseSchedule(courseId) {
    return apiFetch(`/lessons/course/${courseId}/schedule`, token);
  }

  async function updateCourseScheduleSlot(mapId, payload) {
    await apiFetch(`/lessons/schedule/${mapId}`, token, {
      method: 'PUT',
      body: JSON.stringify({
        lessonId: payload.lessonId,
      }),
    });
  }

  async function deleteLessonLibrary(id) {
    try {
      await apiFetch(`/lessons/library/${id}`, token, { method: 'DELETE' });
      await loadAll();
      setMessage('Lesson template deleted');
      pushToast('Lesson template deleted', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function createBatch(payload) {
    try {
      await apiFetch('/batch-manager', token, {
        method: 'POST',
        body: JSON.stringify({
          title: payload.title,
          batchType: payload.batchType,
          batchNumber: Number(payload.batchNumber),
          courseId: payload.courseId,
          courses: payload.courses,
          plannedStartDate: payload.plannedStartDate,
          durationDays: payload.durationDays,
          notes: payload.notes,
          trainers: payload.trainers,
          subscriptionPackageId: payload.subscriptionPackageId,
        }),
      });
      await loadAll();
      setMessage('Batch created');
      pushToast('Batch created', 'success');
      return true;
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
      return false;
    }
  }

  async function fetchAdminSubscriptions() {
    const data = await apiFetch('/subscriptions/admin', token);
    return Array.isArray(data?.subscriptions) ? data.subscriptions : [];
  }

  async function fetchAdminPayments(filters = {}) {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', String(filters.search));
    if (filters.paymentKind) params.set('paymentKind', String(filters.paymentKind));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const data = await apiFetch(`/payments/admin${suffix}`, token);
    return Array.isArray(data) ? data : [];
  }

  async function fetchAdminApplyBilling(filters = {}) {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', String(filters.search));
    if (filters.status) params.set('status', String(filters.status));
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const data = await apiFetch(`/payments/admin/apply-billing${suffix}`, token);
    return Array.isArray(data) ? data : [];
  }

  async function openAdminInvoice(paymentId) {
    const data = await apiFetch(`/payments/admin/${paymentId}/invoice-link`, token);
    const url = String(data?.url || '').trim();
    if (!url) throw new Error('Invoice link not available');
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function recordAdminApplyManualPayment(dueItemId, payload = {}) {
    const data = await apiFetch(`/payments/admin/apply-due/${dueItemId}/manual`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data?.payment || null;
  }

  async function deleteSubscriptionGrant(grantId) {
    try {
      await apiFetch(`/subscriptions/admin/grants/${grantId}`, token, { method: 'DELETE' });
      pushToast('Access window removed', 'success');
    } catch (err) {
      const msg =
        typeof err?.message === 'string' && err.message.trim()
          ? err.message.trim()
          : 'Could not remove access';
      setError(msg);
      pushToast(msg, 'error');
      throw err;
    }
  }

  async function updateBatch(batchId, payload) {
    try {
      const updated = await apiFetch(`/batch-manager/${batchId}`, token, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      await loadAll();
      pushToast('Batch updated', 'success');
      return updated;
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
      return null;
    }
  }

  async function deleteBatch(batchId, options = {}) {
    const full = Boolean(options.full);
    try {
      const qs = full ? '?full=1' : '';
      await apiFetch(`/batch-manager/${batchId}${qs}`, token, { method: 'DELETE' });
      await loadAll();
      pushToast(full ? 'Batch and related cloud data deleted' : 'Batch deleted', 'success');
      return true;
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
      return false;
    }
  }

  async function deleteUser(userId) {
    try {
      await apiFetch(`/users/${userId}`, token, { method: 'DELETE' });
      await loadAll();
      pushToast('User deleted', 'success');
    } catch (err) {
      const msg =
        typeof err?.message === 'string' && err.message.trim()
          ? err.message.trim()
          : 'Could not delete user';
      setError(msg);
      pushToast(msg, 'error');
      throw err;
    }
  }

  async function deleteHolidayByDate(dateStr) {
    try {
      await apiFetch(`/batch-manager/holidays/${encodeURIComponent(dateStr)}`, token, {
        method: 'DELETE',
      });
      await loadAll();
      pushToast('Holiday removed', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function deleteBillingCombo(comboId) {
    try {
      await apiFetch(`/billing/combos/${comboId}`, token, { method: 'DELETE' });
      await loadAll();
      pushToast('Combo deleted', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
      throw err;
    }
  }

  async function fetchBatchAssignments(batchId) {
    return apiFetch(`/batch-manager/${batchId}/assignments`, token);
  }

  async function createBatchAssignment(batchId, payload) {
    await apiFetch(`/batch-manager/${batchId}/assignments`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadAll();
    pushToast('Assignment created', 'success');
  }

  async function fetchAssignmentSubmissions(batchId, assignmentId) {
    return apiFetch(`/batch-manager/${batchId}/assignments/${assignmentId}/submissions`, token);
  }

  async function fetchBatchAttendance(batchId) {
    return apiFetch(`/batch-manager/${batchId}/attendance`, token);
  }

  async function fetchBatchLiveRecordings(batchId) {
    return apiFetch(`/live/batches/${batchId}/recordings`, token);
  }

  async function saveSessionAttendance(batchId, sessionId, entries) {
    await apiFetch(`/batch-manager/${batchId}/sessions/${sessionId}/attendance`, token, {
      method: 'PUT',
      body: JSON.stringify({ entries }),
    });
  }

  async function addHoliday(e) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    try {
      await apiFetch('/batch-manager/holidays', token, {
        method: 'POST',
        body: JSON.stringify({
          holidayDate: form.get('holidayDate'),
          reason: form.get('reason'),
        }),
      });
      formEl.reset();
      await loadAll();
      setMessage('Holiday added');
    } catch (err) {
      setError(err.message);
    }
  }

  async function approveUser(id) {
    try {
      await apiFetch(`/users/${id}/approve`, token, { method: 'POST' });
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function fetchOpenBatchesForCourse(courseId) {
    const data = await apiFetch(`/enrollments/courses/${courseId}/open-batches`, token);
    return Array.isArray(data?.batches) ? data.batches : [];
  }

  async function fetchSubscribePackagesForCourse(courseId) {
    return apiFetch(`/batch-manager/course/${courseId}/subscribe-packages`, token);
  }

  async function fetchBillingCombos() {
    return apiFetch('/billing/combos', token);
  }

  async function saveBillingCombo(id, payload) {
    const body = {
      name: payload.name,
      description: payload.description ?? null,
      isActive: payload.isActive !== false,
      courseIds: Array.isArray(payload.courseIds) ? payload.courseIds.map(Number).filter(Number.isFinite) : [],
    };
    if (id != null && id !== '') {
      await apiFetch(`/billing/combos/${id}`, token, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      return { id };
    }
    const created = await apiFetch('/billing/combos', token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return created;
  }

  async function fetchCourseBillingPackages(courseId) {
    return apiFetch(`/billing/admin/course/${courseId}/packages`, token);
  }

  async function createCourseBillingPackage(courseId, body) {
    return apiFetch(`/billing/admin/course/${courseId}/packages`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async function fetchComboBillingPackages(comboId) {
    return apiFetch(`/billing/admin/combo/${comboId}/packages`, token);
  }

  async function createComboBillingPackage(comboId, body) {
    return apiFetch(`/billing/admin/combo/${comboId}/packages`, token, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async function updateBillingPackage(packageId, body) {
    return apiFetch(`/billing/admin/packages/${packageId}`, token, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async function deleteBillingPackage(packageId) {
    await apiFetch(`/billing/admin/packages/${packageId}`, token, {
      method: 'DELETE',
    });
  }

  async function approveApplication(applicationId, batchId) {
    await apiFetch(`/enrollments/applications/${applicationId}/approve`, token, {
      method: 'POST',
      body: JSON.stringify({ batchId }),
    });
    await loadAll();
    pushToast('Application approved', 'success');
  }

  async function disapproveApplication(applicationId) {
    await apiFetch(`/enrollments/applications/${applicationId}/disapprove`, token, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await loadAll();
    pushToast('Application disapproved', 'success');
  }

  async function updateApplyLeadStatus(id, status) {
    await apiFetch(`/payments/admin/apply-enquiries/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    const data = await apiFetch('/payments/admin/apply-enquiries', token);
    setApplyLeads(Array.isArray(data) ? data : []);
    pushToast('Lead updated', 'success');
  }

  async function startBatch(batchId, startDate) {
    const id = batchId ?? selectedBatchId;
    if (!id) return;
    const date = String(startDate || '').trim();
    if (!date) {
      const err = new Error('Select a real start date to start the batch.');
      setError(err.message);
      pushToast(err.message, 'error');
      throw err;
    }
    try {
      await apiFetch(`/batch-manager/${id}/start`, token, {
        method: 'POST',
        body: JSON.stringify({ startDate: date }),
      });
      const sessions = await apiFetch(`/batch-manager/${id}/sessions`, token);
      setSelectedBatchId(String(id));
      setBatchSessions(sessions);
      setMessage('Batch started and sessions generated');
      pushToast('Batch started and sessions generated', 'success');
      await loadAll();
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
      throw err;
    }
  }

  /** Members + trainers only — used after roster changes so one failing sessions/audit fetch cannot leave tables empty. */
  async function reloadBatchRoster(forBatchId) {
    const id = forBatchId ?? selectedBatchId;
    if (!id) return;
    try {
      setSelectedBatchId(String(id));
      const [members, trainers] = await Promise.all([
        apiFetch(`/batch-manager/${id}/members`, token),
        apiFetch(`/batch-manager/${id}/trainers`, token),
      ]);
      setBatchMembers(Array.isArray(members) ? members : []);
      setBatchTrainers(Array.isArray(trainers) ? trainers : []);
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function loadSessions(forBatchId) {
    const id = forBatchId ?? selectedBatchId;
    if (!id) return;
    try {
      setSelectedBatchId(String(id));
      const labels = ['sessions', 'sessions audit', 'members', 'trainers'];
      const settled = await Promise.allSettled([
        apiFetch(`/batch-manager/${id}/sessions`, token),
        apiFetch(`/batch-manager/${id}/sessions/audit`, token),
        apiFetch(`/batch-manager/${id}/members`, token),
        apiFetch(`/batch-manager/${id}/trainers`, token),
      ]);
      const sessions = settled[0].status === 'fulfilled' ? settled[0].value : [];
      const audit = settled[1].status === 'fulfilled' ? settled[1].value : [];
      const members = settled[2].status === 'fulfilled' ? settled[2].value : [];
      const trainers = settled[3].status === 'fulfilled' ? settled[3].value : [];
      setBatchSessions(Array.isArray(sessions) ? sessions : []);
      setCancelAuditRows(Array.isArray(audit) ? audit : []);
      setBatchMembers(Array.isArray(members) ? members : []);
      setBatchTrainers(Array.isArray(trainers) ? trainers : []);
      settled.forEach((r, i) => {
        if (r.status === 'rejected') {
          const msg = r.reason?.message || 'Request failed';
          pushToast(`Batch ${labels[i]}: ${msg}`, 'error');
        }
      });
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function cancelSession(sessionId, reason, batchId) {
    const id = batchId ?? selectedBatchId;
    if (!id) return;
    try {
      await apiFetch(`/batch-manager/${id}/sessions/${sessionId}/cancel`, token, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await loadSessions(id);
      setMessage('Session cancelled and schedule adjusted');
      pushToast('Session cancelled', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  React.useEffect(() => {
    if (!token || !currentUser || currentUser.role !== 'Creator') return;
    if (!CREATOR_ALLOWED_PAGES.has(currentPage)) {
      setCurrentPage('study-materials');
    }
  }, [token, currentUser, currentPage]);

  React.useEffect(() => {
    if (currentPage === 'users') setCurrentPage('students');
    else if (['trainers', 'admins', 'creators'].includes(currentPage)) setCurrentPage('other-users');
  }, [currentPage]);

  const libraryCanMutate = useMemo(
    () => (row) => {
      if (!row || currentUser?.id == null) return false;
      const role = currentUser.role;
      if (role === 'Admin' || role === 'Trainer') return true;
      if (role === 'Creator') return Number(row.created_by) === Number(currentUser.id);
      return false;
    },
    [currentUser],
  );

  async function addBatchMember(studentId, batchId) {
    const bid = batchId ?? selectedBatchId;
    if (!bid || !studentId) return;
    try {
      await apiFetch(`/batch-manager/${bid}/members`, token, {
        method: 'POST',
        body: JSON.stringify({ studentId: Number(studentId) }),
      });
      await reloadBatchRoster(bid);
      pushToast('Student added to batch', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function removeBatchMember(studentId, batchId) {
    const bid = batchId ?? selectedBatchId;
    if (!bid || !studentId) return;
    try {
      await apiFetch(`/batch-manager/${bid}/members/${studentId}`, token, { method: 'DELETE' });
      await reloadBatchRoster(bid);
      pushToast('Student removed from batch', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function addBatchTrainer(trainerId, batchId) {
    const bid = batchId ?? selectedBatchId;
    if (!bid || !trainerId) return;
    try {
      await apiFetch(`/batch-manager/${bid}/trainers`, token, {
        method: 'POST',
        body: JSON.stringify({ trainerId: Number(trainerId) }),
      });
      await reloadBatchRoster(bid);
      pushToast('Trainer assigned to batch', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function removeBatchTrainer(trainerId, batchId) {
    const bid = batchId ?? selectedBatchId;
    if (!bid || !trainerId) return;
    try {
      await apiFetch(`/batch-manager/${bid}/trainers/${trainerId}`, token, { method: 'DELETE' });
      await reloadBatchRoster(bid);
      pushToast('Trainer removed from batch', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function createVideo(payload, onProgress) {
    await uploadVideoLibraryAsset(token, payload, onProgress);
    await loadAll();
  }

  async function updateVideo(id, payload) {
    await apiFetch(`/videos/${id}`, token, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    await loadAll();
  }

  async function deleteVideo(id) {
    await apiFetch(`/videos/${id}`, token, { method: 'DELETE' });
    await loadAll();
  }

  async function assignVideo(videoId, payload) {
    await apiFetch(`/videos/${videoId}/assignments`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadAll();
  }

  async function createVideoCategory(name) {
    await apiFetch('/videos/categories', token, {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    await loadAll();
  }

  async function deleteVideoCategory(id) {
    await apiFetch(`/videos/categories/${id}`, token, { method: 'DELETE' });
    await loadAll();
  }

  async function createStudyMaterial(payload) {
    const created = await apiFetch('/study-materials', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadAll();
    return created;
  }

  async function updateStudyMaterial(id, payload) {
    await apiFetch(`/study-materials/${id}`, token, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    await loadAll();
  }

  async function deleteStudyMaterial(id) {
    await apiFetch(`/study-materials/${id}`, token, { method: 'DELETE' });
    await loadAll();
  }

  async function assignStudyMaterial(id, payload) {
    await apiFetch(`/study-materials/${id}/assignments`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadAll();
  }

  async function uploadStudyMaterialAsset(id, payload) {
    const body = new FormData();
    body.append('assetType', payload.assetType || 'image');
    body.append('file', payload.file);
    const res = await fetch(`${API_BASE}/api/study-materials/${id}/assets`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Study material asset upload failed');
    await loadAll();
    return data;
  }

  async function createWorksheet(payload) {
    const created = await apiFetch('/worksheets', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadAll();
    return created;
  }

  async function updateWorksheet(id, payload) {
    await apiFetch(`/worksheets/${id}`, token, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    await loadAll();
  }

  async function deleteWorksheet(id) {
    await apiFetch(`/worksheets/${id}`, token, { method: 'DELETE' });
    await loadAll();
  }

  async function uploadWorksheetAsset(id, payload) {
    const body = new FormData();
    body.append('assetType', payload.assetType || 'image');
    body.append('file', payload.file);
    const res = await fetch(`${API_BASE}/api/worksheets/${id}/assets`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Worksheet asset upload failed');
    await loadAll();
    return data;
  }

  async function createQuizBank(payload) {
    const created = await apiFetch('/quizzes/v2', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadAll();
    return created;
  }

  async function getQuizBankDetails(id) {
    return apiFetch(`/quizzes/v2/${id}`, token);
  }

  async function updateQuizBank(id, payload) {
    await apiFetch(`/quizzes/v2/${id}`, token, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    await loadAll();
  }

  async function publishQuizVersion(id, payload) {
    await apiFetch(`/quizzes/v2/${id}/versions`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadAll();
  }

  async function assignQuiz(id, payload) {
    await apiFetch(`/quizzes/v2/${id}/assignments`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadAll();
  }

  async function deleteQuizBank(id) {
    await apiFetch(`/quizzes/v2/${id}`, token, {
      method: 'DELETE',
    });
    await loadAll();
  }

  async function loadAssignment(id) {
    return apiFetch(`/assignments/${id}`, token);
  }

  async function createAssignment(payload) {
    await apiFetch('/assignments', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadAll();
  }

  async function updateAssignment(id, payload) {
    await apiFetch(`/assignments/${id}`, token, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    await loadAll();
  }

  async function deleteAssignment(id) {
    await apiFetch(`/assignments/${id}`, token, { method: 'DELETE' });
    await loadAll();
  }

  let page = null;
  /** Classroom learners only — excludes trainers/admins mistakenly grouped here. */
  const studentAccounts = users.filter((u) => u.role === 'Student');
  /** Trainers, admins, creators, Lab — everything that is not a classroom Student row. */
  const otherUserAccounts = users.filter((u) =>
    ['Trainer', 'Admin', 'Creator', 'Lab'].includes(u.role)
  );
  const showCreatedBy = currentUser?.role === 'Admin';

  if (currentPage === 'dashboard') {
    page = <DashboardPage users={users} pendingUsers={pendingUsers} pendingApplications={pendingApplications} courses={courses} batches={batches} holidays={holidays} />;
  } else if (currentPage === 'students') {
    page = (
      <UsersPage
        variant="students"
        users={studentAccounts}
        title="Students"
        subtitle="Classroom student accounts (role Student)"
        onCreateUser={createUser}
        onUpdateUser={updateUser}
        onGetUserDetails={getUserDetails}
        canDangerDelete={currentUser?.role === 'Admin'}
        onDeleteUser={deleteUser}
      />
    );
  } else if (currentPage === 'other-users') {
    page = (
      <UsersPage
        variant="other-users"
        users={otherUserAccounts}
        title="Other users"
        subtitle="Trainers, admins, creators, and Lab (TV) — newest first"
        defaultRole="Trainer"
        onCreateUser={createUser}
        onUpdateUser={updateUser}
        onGetUserDetails={getUserDetails}
        canDangerDelete={currentUser?.role === 'Admin'}
        onDeleteUser={deleteUser}
      />
    );
  } else if (currentPage === 'approvals') {
    page = (
      <ApprovalsPage
        pendingApplications={pendingApplications}
        fetchOpenBatchesForCourse={fetchOpenBatchesForCourse}
        onApproveApplication={approveApplication}
        onDisapproveApplication={disapproveApplication}
      />
    );
  } else if (currentPage === 'leads') {
    page = <LeadsPage leads={applyLeads} onUpdateStatus={updateApplyLeadStatus} />;
  } else if (currentPage === 'courses') {
    page = (
      <CoursesPage
        courses={courses}
        library={library}
        onCreateCourse={createCourse}
        onUpdateCourse={updateCourse}
        onDeleteCourse={deleteCourse}
        fetchCourseSchedule={fetchCourseSchedule}
        updateCourseScheduleSlot={updateCourseScheduleSlot}
        pushToast={pushToast}
      />
    );
  } else if (currentPage === 'lessons') {
    page = (
      <LessonsPage
        library={library}
        videos={videos}
        studyMaterials={studyMaterials}
        worksheets={worksheets}
        quizBank={quizBank}
        assignments={assignments}
        onCreateLessonLibrary={createLessonLibrary}
        onUpdateLessonLibrary={updateLessonLibrary}
        onDeleteLessonLibrary={deleteLessonLibrary}
        saveLessonComposition={saveLessonComposition}
        loadLessonComposition={loadLessonComposition}
      />
    );
  } else if (currentPage === 'subscriptions' && currentUser?.role === 'Admin') {
    page = (
      <SubscriptionsPage loadSubscriptions={fetchAdminSubscriptions} onDeleteGrant={deleteSubscriptionGrant} />
    );
  } else if (currentPage === 'batches') {
    page = (
      <BatchesPage
        onCreateBatch={createBatch}
        onUpdateBatch={updateBatch}
        courses={courses}
        batches={batches}
        fetchSubscribePackagesForCourse={fetchSubscribePackagesForCourse}
        selectedBatchId={selectedBatchId}
        setSelectedBatchId={setSelectedBatchId}
        onStartBatch={startBatch}
        onLoadSessions={loadSessions}
        onCancelSession={cancelSession}
        cancelAuditRows={cancelAuditRows}
        users={users}
        batchMembers={batchMembers}
        batchTrainers={batchTrainers}
        onAddBatchMember={addBatchMember}
        onRemoveBatchMember={removeBatchMember}
        onAddBatchTrainer={addBatchTrainer}
        onRemoveBatchTrainer={removeBatchTrainer}
        batchSessions={batchSessions}
        fetchBatchAssignments={fetchBatchAssignments}
        createBatchAssignment={createBatchAssignment}
        fetchAssignmentSubmissions={fetchAssignmentSubmissions}
        fetchBatchAttendance={fetchBatchAttendance}
        fetchBatchLiveRecordings={fetchBatchLiveRecordings}
        saveSessionAttendance={saveSessionAttendance}
        onRefreshUsers={loadAll}
        onDeleteBatch={deleteBatch}
      />
    );
  } else if (currentPage === 'billing' && currentUser?.role === 'Admin') {
    page = (
      <BillingPage
        courses={courses}
        loadCombos={fetchBillingCombos}
        saveCombo={saveBillingCombo}
        loadCoursePackages={fetchCourseBillingPackages}
        createCoursePackage={createCourseBillingPackage}
        loadComboPackages={fetchComboBillingPackages}
        createComboPackage={createComboBillingPackage}
        updatePackage={updateBillingPackage}
        deletePackage={deleteBillingPackage}
        deleteCombo={deleteBillingCombo}
        pushToast={pushToast}
      />
    );
  } else if (currentPage === 'payments' && currentUser?.role === 'Admin') {
    page = (
      <PaymentsPage
        loadPayments={fetchAdminPayments}
        loadApplyBilling={fetchAdminApplyBilling}
        openInvoice={openAdminInvoice}
        recordManualApplyPayment={recordAdminApplyManualPayment}
        pushToast={pushToast}
      />
    );
  } else if (currentPage === 'billing') {
    page = (
      <div className="stack" style={{ padding: '1rem 0' }}>
        <p className="muted">Billing and combo management is available only to administrator accounts.</p>
      </div>
    );
  } else if (currentPage === 'payments') {
    page = (
      <div className="stack" style={{ padding: '1rem 0' }}>
        <p className="muted">Payments and invoice access is available only to administrator accounts.</p>
      </div>
    );
  } else if (currentPage === 'quizzes') {
    page = (
      <QuizBankPage
        quizzes={quizBank}
        courses={courses}
        lessons={library}
        showCreatedBy={showCreatedBy}
        libraryCanMutate={libraryCanMutate}
        onCreateQuiz={createQuizBank}
        onGetQuiz={getQuizBankDetails}
        onUpdateQuiz={updateQuizBank}
        onPublishVersion={publishQuizVersion}
        onAssignQuiz={assignQuiz}
        onDeleteQuiz={deleteQuizBank}
      />
    );
  } else if (currentPage === 'videos') {
    page = (
      <VideosPage
        videos={videos}
        categories={videoCategories}
        lessons={library}
        courses={courses}
        showCreatedBy={showCreatedBy}
        libraryCanMutate={libraryCanMutate}
        onCreateVideo={createVideo}
        onUpdateVideo={updateVideo}
        onDeleteVideo={deleteVideo}
        onAssignVideo={assignVideo}
      />
    );
  } else if (currentPage === 'study-materials') {
    page = (
      <StudyMaterialsPage
        materials={studyMaterials}
        showCreatedBy={showCreatedBy}
        libraryCanMutate={libraryCanMutate}
        onCreate={createStudyMaterial}
        onUpdate={updateStudyMaterial}
        onDelete={deleteStudyMaterial}
        onUploadAsset={uploadStudyMaterialAsset}
      />
    );
  } else if (currentPage === 'worksheets') {
    page = (
      <WorksheetsPage
        worksheets={worksheets}
        showCreatedBy={showCreatedBy}
        libraryCanMutate={libraryCanMutate}
        onCreate={createWorksheet}
        onUpdate={updateWorksheet}
        onDelete={deleteWorksheet}
        onUploadAsset={uploadWorksheetAsset}
      />
    );
  } else if (currentPage === 'settings') {
    page = (
      <SettingsPage
        holidays={holidays}
        categories={videoCategories}
        onAddHoliday={addHoliday}
        onDeleteHoliday={deleteHolidayByDate}
        onCreateCategory={createVideoCategory}
        onDeleteCategory={deleteVideoCategory}
      />
    );
  } else if (currentPage === 'assignments') {
    page = (
      <AssignmentsPage
        assignments={assignments}
        showCreatedBy={showCreatedBy}
        libraryCanMutate={libraryCanMutate}
        loadAssignment={loadAssignment}
        createAssignment={createAssignment}
        updateAssignment={updateAssignment}
        deleteAssignment={deleteAssignment}
      />
    );
  }

  if (authBootstrapping) {
    return (
      <div className="loginAppRoot" style={{ alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p className="muted" style={{ fontSize: '1rem' }}>
          Loading…
        </p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/live/:liveSessionId"
        element={
          authReady ? <LiveClassroomPage token={token} /> : <SaveLiveIntentRedirect />
        }
      />
      <Route
        path="*"
        element={
          !authReady ? (
            <div className="loginAppRoot">
              <LoginCard
                email={email}
                password={password}
                setEmail={setEmail}
                setPassword={setPassword}
                onLogin={doLogin}
                busy={busyLogin}
                error={error}
              />
            </div>
          ) : (
            <div className="app">
              <ToastStack toasts={toasts} />
              <StatusBanner error={error} message={message} />
              <AdminShell
                currentPage={currentPage}
                onNavigate={setCurrentPage}
                onRefresh={loadAll}
                onLogout={logout}
                creatorMode={currentUser?.role === 'Creator'}
                showBillingNav={currentUser?.role === 'Admin'}
                showPaymentsNav={currentUser?.role === 'Admin'}
                showSubscriptionsNav={currentUser?.role === 'Admin'}
              >
                {page}
              </AdminShell>
            </div>
          )
        }
      />
    </Routes>
  );
}
