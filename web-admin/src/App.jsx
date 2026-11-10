import React, { useEffect, useMemo, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import LiveClassroomPage from './pages/LiveClassroomPage';
import LoginCard from './components/LoginCard';
import AdminShell from './components/AdminShell';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
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
import TrainerAssignmentsPage from './pages/TrainerAssignmentsPage';
import BillingPage from './pages/BillingPage';
import PaymentsPage from './pages/PaymentsPage';
import SubscriptionsPage from './pages/SubscriptionsPage';
import TrainerTodayPage from './pages/TrainerTodayPage';
import TrainerCalendarPage from './pages/TrainerCalendarPage';
import TrainerBatchPage from './pages/TrainerBatchPage';
import ReviewInboxPage from './pages/ReviewInboxPage';

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

const TRAINER_ALLOWED_PAGES = new Set([
  'today',
  'batches',
  'calendar',
  'review',
  'videos',
  'study-materials',
  'worksheets',
  'quizzes',
  'assignments',
  'courses',
  'lessons',
]);

function allowedPagesForRole(role) {
  if (role === 'Creator') return CREATOR_ALLOWED_PAGES;
  if (role === 'Trainer') return TRAINER_ALLOWED_PAGES;
  return null;
}

function landingPageForRole(role) {
  if (role === 'Creator') return 'study-materials';
  if (role === 'Trainer') return 'today';
  return 'dashboard';
}

const LIBRARY_DATA_KEYS = [
  'courses',
  'library',
  'quizBank',
  'videos',
  'videoCategories',
  'studyMaterials',
  'worksheets',
  'assignments',
];

/** Which App data sets each role loads; roles not listed load everything. */
const DATA_KEYS_BY_ROLE = {
  Creator: LIBRARY_DATA_KEYS,
  Trainer: [...LIBRARY_DATA_KEYS, 'batches', 'holidays'],
};

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

function isSessionReplacedError(err) {
  if (!err) return false;
  if (err.code === 'SESSION_REPLACED') return true;
  return /session replaced by another device/i.test(String(err.message || ''));
}

function webAdminDeviceName() {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  let browser = 'Browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  return `Web admin (${browser})`;
}

function friendlyDeviceName(name) {
  const n = String(name || '').trim();
  if (!n || /^unknown device$/i.test(n)) return 'another device';
  return n;
}

let sessionReplacedListener = null;

function notifySessionReplaced() {
  sessionReplacedListener?.();
}

function makeApiError(message, { status, code } = {}) {
  const err = new Error(message);
  err.status = status ?? null;
  err.code = code || null;
  return err;
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
    const err = makeApiError(fromBody, { status: res.status, code: data?.code });
    if (data?.code === 'SESSION_REPLACED') notifySessionReplaced();
    throw err;
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
  if (!res.ok) {
    const err = makeApiError(data.error || 'Cover upload failed', { status: res.status, code: data?.code });
    if (data?.code === 'SESSION_REPLACED') notifySessionReplaced();
    throw err;
  }
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
  if (!res.ok) {
    const err = makeApiError(data.error || 'Profile photo upload failed', { status: res.status, code: data?.code });
    if (data?.code === 'SESSION_REPLACED') notifySessionReplaced();
    throw err;
  }
  return data.photoUrl || null;
}

/** Returns { promise, abort }. Caller must keep abort for Stop/Discard. */
function uploadVideoLibraryAsset(token, payload, onProgress) {
  const body = new FormData();
  body.append('title', payload.title || '');
  body.append('description', payload.description || '');
  body.append('categoryId', String(payload.categoryId || ''));
  body.append('file', payload.file);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', `${API_BASE}/api/videos`);
  if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

  const promise = new Promise((resolve, reject) => {
    xhr.upload.onprogress = (evt) => {
      if (!evt.lengthComputable) return;
      const pct = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
      onProgress?.(pct);
    };

    xhr.onerror = () => reject(new Error('Network error while uploading video'));
    xhr.onabort = () => {
      const err = new Error('Upload stopped');
      err.code = 'UPLOAD_ABORTED';
      reject(err);
    };
    xhr.onload = () => {
      const data = (() => {
        try {
          return JSON.parse(xhr.responseText || '{}');
        } catch {
          return {};
        }
      })();
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
      const err = makeApiError(data.error || xhr.statusText || `Video upload failed (HTTP ${xhr.status})`, {
        status: xhr.status,
        code: data?.code,
      });
      if (data?.code === 'SESSION_REPLACED') notifySessionReplaced();
      reject(err);
    };
    xhr.send(body);
  });

  return {
    promise,
    abort: () => {
      try {
        xhr.abort();
      } catch {
        /* ignore */
      }
    },
  };
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
  const [sessionConflict, setSessionConflict] = useState(null);
  const sessionReplacedLock = React.useRef(false);
  const endReplacedSessionRef = React.useRef(() => {});
  const videoUploadAbortRef = React.useRef(null);
  const videoUploadJobIdRef = React.useRef(0);
  const [videoUploadJob, setVideoUploadJob] = useState(null);
  // { id, phase, progress, message, error, title, fileName, videoId }

  const authReady = useMemo(() => Boolean(token), [token]);

  function pushToast(text, type = 'info') {
    let label = text == null ? '' : String(text).trim();
    if (isSessionReplacedError({ message: label })) {
      endReplacedSession();
      return;
    }
    if (!label && type === 'error') label = 'Something went wrong. Check your connection or try again.';
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => {
      if (prev.some((t) => t.text === label && t.type === type)) return prev;
      return [...prev, { id, text: label, type }];
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2600);
  }

  function resetClientSession({ loginError } = {}) {
    persistWebAdminToken('');
    setToken('');
    navigate('/');
    setCurrentPage('dashboard');
    setUsers([]);
    setPendingUsers([]);
    setApplyLeads([]);
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
    setToasts([]);
    setLoadErrors([]);
    if (loginError) {
      setError(loginError);
      setMessage('');
    } else {
      setError('');
      setMessage('Logged out');
    }
  }

  function endReplacedSession() {
    if (sessionReplacedLock.current) return;
    sessionReplacedLock.current = true;
    resetClientSession({
      loginError: 'This account signed in on another device. Sign in again to continue.',
    });
  }
  endReplacedSessionRef.current = endReplacedSession;

  React.useEffect(() => {
    sessionReplacedListener = () => endReplacedSessionRef.current();
    return () => {
      sessionReplacedListener = null;
    };
  }, []);

  async function finishAuthenticatedSession(authData, toastText) {
    if (!authData?.token) {
      throw new Error('Login did not return a token');
    }
    sessionReplacedLock.current = false;
    setSessionConflict(null);
    setToken(authData.token);
    persistWebAdminToken(authData.token);
    const me = await apiFetch('/users/me', authData.token);
    setCurrentUser(me);
    if (!WEB_ADMIN_ROLES.includes(me?.role)) {
      persistWebAdminToken('');
      setToken('');
      throw new Error(`Web admin access is not available for this account. Logged in as ${me?.role || 'Unknown'}`);
    }
    setCurrentPage(landingPageForRole(me?.role));
    const hd = me?.role === 'Admin' ? await apiFetch('/health/details', authData.token).catch(() => null) : null;
    setHealth(hd);
    setMessage('');
    pushToast(toastText, 'success');
    setTimeout(() => {
      void loadAllWithToken(authData.token).then(() => {
        const pend = sessionStorage.getItem('postLoginLive');
        if (pend?.startsWith('/live/')) {
          sessionStorage.removeItem('postLoginLive');
          navigate(pend, { replace: true });
        }
      });
    }, 0);
  }

  async function doLogin() {
    setError('');
    setBusyLogin(true);
    try {
      const data = await apiFetch('/auth/login', null, {
        method: 'POST',
        body: JSON.stringify({ email, password, client: 'mobile', deviceName: webAdminDeviceName() }),
      });
      if (data?.alreadyLoggedIn) {
        setSessionConflict({ deviceName: friendlyDeviceName(data.deviceName) });
        return;
      }
      await finishAuthenticatedSession(data, 'Logged in');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyLogin(false);
    }
  }

  async function doReplaceSession() {
    setError('');
    setBusyLogin(true);
    try {
      const replaced = await apiFetch('/auth/replace-session', null, {
        method: 'POST',
        body: JSON.stringify({ email, password, client: 'mobile', deviceName: webAdminDeviceName() }),
      });
      await finishAuthenticatedSession(replaced, 'Logged in (previous session replaced)');
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

      const sources = {
        users: { path: '/users', set: setUsers },
        pendingUsers: { path: '/users/pending', set: setPendingUsers },
        applyLeads: { path: '/payments/admin/apply-enquiries', set: setApplyLeads },
        courses: { path: '/courses', set: setCourses },
        library: { path: '/lessons/admin/all', set: setLibrary },
        batches: { path: '/batch-manager', set: setBatches },
        holidays: { path: '/batch-manager/holidays/list', set: setHolidays },
        quizBank: { path: '/quizzes/v2', set: setQuizBank },
        videos: { path: '/videos', set: setVideos },
        videoCategories: { path: '/videos/categories', set: setVideoCategories },
        studyMaterials: { path: '/study-materials', set: setStudyMaterials },
        worksheets: { path: '/worksheets', set: setWorksheets },
        assignments: { path: '/assignments', set: setAssignments },
      };
      const keys = DATA_KEYS_BY_ROLE[me.role] || Object.keys(sources);
      const results = await Promise.all(keys.map((k) => apiFetchSafe(sources[k].path, nextToken)));

      Object.keys(sources).forEach((k) => {
        if (!keys.includes(k)) sources[k].set([]);
      });
      keys.forEach((k, i) => {
        const r = results[i];
        if (r.ok) sources[k].set(Array.isArray(r.data) ? r.data : []);
        else if (k === 'applyLeads') sources[k].set([]);
      });
      if (me.role !== 'Admin') setHealth(null);
      setLoadErrors(
        keys.map((k, i) => (results[i].ok ? null : `${sources[k].path}: ${results[i].error}`)).filter(Boolean),
      );
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
        setCurrentPage(landingPageForRole(me?.role));
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
    sessionReplacedLock.current = false;
    setSessionConflict(null);
    resetClientSession();
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
          feeInr: payload.enrollmentType === 'subscribe' ? 0 : Number(payload.feeInr || 0),
          discountInr: payload.enrollmentType === 'subscribe' ? 0 : Number(payload.discountInr || 0),
          courseStatus: payload.courseStatus,
          enrollmentType: payload.enrollmentType,
          progressionType: payload.progressionType === 'day_wise' ? 'day_wise' : 'unlock_all',
          applyRegistrationFeeInr: Number(payload.applyRegistrationFeeInr ?? 999),
          applySinglePaymentDiscountInr: Number(payload.applySinglePaymentDiscountInr ?? 0),
          applyInstallmentCount: Number(payload.applyInstallmentCount ?? 2),
          applyInstallmentAmounts: Array.isArray(payload.applyInstallmentAmounts)
            ? payload.applyInstallmentAmounts.map((x) => Number(x || 0))
            : [],
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
          feeInr: payload.enrollmentType === 'subscribe' ? 0 : Number(payload.feeInr || 0),
          discountInr: payload.enrollmentType === 'subscribe' ? 0 : Number(payload.discountInr || 0),
          courseStatus: payload.courseStatus,
          enrollmentType: payload.enrollmentType,
          progressionType: payload.progressionType === 'day_wise' ? 'day_wise' : 'unlock_all',
          applyRegistrationFeeInr: Number(payload.applyRegistrationFeeInr ?? 999),
          applySinglePaymentDiscountInr: Number(payload.applySinglePaymentDiscountInr ?? 0),
          applyInstallmentCount: Number(payload.applyInstallmentCount ?? 2),
          applyInstallmentAmounts: Array.isArray(payload.applyInstallmentAmounts)
            ? payload.applyInstallmentAmounts.map((x) => Number(x || 0))
            : [],
          applyInstallmentGapDays: Number(payload.applyInstallmentGapDays ?? 30),
          applyGraceDays: Number(payload.applyGraceDays ?? 7),
          applyEnquiryEnabled: payload.applyEnquiryEnabled !== false,
          is_published: payload.isPublished === false ? 0 : 1,
          removeCover: payload.coverRemoved === true,
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

  async function loadLessonAccess(lessonId) {
    return apiFetch(`/lessons/library/${lessonId}/access`, token);
  }

  async function denyLessonAccess(lessonId, userId) {
    return apiFetch(`/lessons/library/${lessonId}/access`, token, {
      method: 'POST',
      body: JSON.stringify({ userId, effect: 'deny' }),
    });
  }

  async function restoreLessonAccess(lessonId, overrideId) {
    return apiFetch(`/lessons/library/${lessonId}/access/${overrideId}`, token, {
      method: 'DELETE',
    });
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
    return {
      url,
      invoiceNumber: data?.invoiceNumber || null,
      title: data?.invoiceNumber ? `Invoice ${data.invoiceNumber}` : 'Invoice',
    };
  }

  async function recordAdminApplyManualPayment(dueItemId, payload = {}) {
    const data = await apiFetch(`/payments/admin/apply-due/${dueItemId}/manual`, token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data?.payment || null;
  }

  async function updateAdminApplyPartSchedule(profileId, payload = {}) {
    const data = await apiFetch(`/payments/admin/apply-billing/${profileId}/parts`, token, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    return data?.profile || null;
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

  async function completeBatch(batchId) {
    try {
      await apiFetch(`/batch-manager/${batchId}/complete`, token, { method: 'POST' });
      await loadAll();
      pushToast('Batch marked complete', 'success');
      return true;
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
      return false;
    }
  }

  async function reopenBatch(batchId) {
    try {
      await apiFetch(`/batch-manager/${batchId}/reopen`, token, { method: 'POST' });
      await loadAll();
      pushToast('Batch reopened', 'success');
      return true;
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
      return false;
    }
  }

  async function transferLibraryOwner({ itemType, itemId, toUserId }) {
    await apiFetch('/library/ownership/transfer', token, {
      method: 'POST',
      body: JSON.stringify({ itemType, itemId, toUserId }),
    });
    await loadAll();
    pushToast('Ownership transferred', 'success');
  }

  async function transferAllLibraryContent(fromUserId, toUserId) {
    const data = await apiFetch('/library/ownership/transfer-all', token, {
      method: 'POST',
      body: JSON.stringify({ fromUserId, toUserId }),
    });
    await loadAll();
    pushToast(`Transferred ${data?.count ?? 0} item(s)`, 'success');
    return data;
  }

  async function loadTrainerToday() {
    return apiFetch('/batch-manager/my/today', token);
  }

  const loadShellNotifications = React.useCallback(async () => {
    if (!token) return [];
    const items = [];
    if (currentUser?.role === 'Trainer' || currentUser?.role === 'Admin') {
      try {
        const queue = await apiFetch('/batch-manager/my/review-queue?status=pending', token);
        const count = Array.isArray(queue) ? queue.length : 0;
        if (count > 0) {
          items.push({
            id: 'review-queue',
            title: `${count} submission${count === 1 ? '' : 's'} waiting for review`,
            body: 'Open Review to grade student work.',
            page: currentUser?.role === 'Trainer' ? 'review' : 'batches',
          });
        }
      } catch {
        /* live API may not expose the queue yet */
      }
    }
    return items;
  }, [token, currentUser?.role]);

  async function loadTrainerSessions(from, to) {
    return apiFetch(`/batch-manager/my/sessions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, token);
  }

  async function loadReviewQueue(status = 'pending') {
    const suffix = status ? `?status=${encodeURIComponent(status)}` : '';
    return apiFetch(`/batch-manager/my/review-queue${suffix}`, token);
  }

  async function submitAssignmentReview(batchId, assignmentId, submissionId, payload) {
    return apiFetch(
      `/batch-manager/${batchId}/assignments/${assignmentId}/submissions/${submissionId}/review`,
      token,
      { method: 'PUT', body: JSON.stringify(payload) },
    );
  }

  async function loadStudentProgress(batchId, studentId) {
    return apiFetch(`/batch-manager/${batchId}/students/${studentId}/progress`, token);
  }

  async function addStudentNote(batchId, studentId, note) {
    return apiFetch(`/batch-manager/${batchId}/students/${studentId}/notes`, token, {
      method: 'POST',
      body: JSON.stringify({ note }),
    });
  }

  async function deleteStudentNote(batchId, noteId) {
    await apiFetch(`/batch-manager/${batchId}/notes/${noteId}`, token, { method: 'DELETE' });
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

  async function updateApplyLeadStatus(id, status) {
    await apiFetch(`/payments/admin/apply-enquiries/${id}`, token, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    const data = await apiFetch('/payments/admin/apply-enquiries', token);
    setApplyLeads(Array.isArray(data) ? data : []);
    pushToast('Lead updated', 'success');
  }

  async function deleteApplyLead(id) {
    await apiFetch(`/payments/admin/apply-enquiries/${id}`, token, {
      method: 'DELETE',
    });
    const data = await apiFetch('/payments/admin/apply-enquiries', token);
    setApplyLeads(Array.isArray(data) ? data : []);
    pushToast('Lead deleted', 'success');
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
    if (!token || !currentUser) return;
    const allowed = allowedPagesForRole(currentUser.role);
    if (allowed && !allowed.has(currentPage)) {
      setCurrentPage(landingPageForRole(currentUser.role));
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
      if (role === 'Admin') return true;
      if (role === 'Trainer' || role === 'Creator') return Number(row.created_by) === Number(currentUser.id);
      return false;
    },
    [currentUser],
  );

  const libraryCanSharePublic = useMemo(
    () => (row) => {
      if (!currentUser?.id) return false;
      if (currentUser.role === 'Admin') return true;
      if (currentUser.role === 'Trainer') {
        if (!row) return true; // new assignment owned by this trainer
        return Number(row.created_by) === Number(currentUser.id);
      }
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

  function patchVideoUploadJob(jobId, patch) {
    setVideoUploadJob((prev) => {
      if (!prev || prev.id !== jobId) return prev;
      return { ...prev, ...patch };
    });
  }

  function startVideoUpload(payload) {
    if (videoUploadJob && ['uploading', 'processing'].includes(videoUploadJob.phase)) {
      pushToast('A video is already uploading. Stop or discard it first.', 'error');
      return;
    }
    if (!payload?.file) {
      pushToast('Choose a video file first', 'error');
      return;
    }
    if (!payload?.categoryId) {
      pushToast('Please select a category', 'error');
      return;
    }

    videoUploadAbortRef.current?.();
    videoUploadAbortRef.current = null;
    const jobId = videoUploadJobIdRef.current + 1;
    videoUploadJobIdRef.current = jobId;
    const fileName = payload.file?.name || 'video';
    const title = String(payload.title || '').trim() || fileName;

    setVideoUploadJob({
      id: jobId,
      phase: 'uploading',
      progress: 0,
      message: 'Uploading to secure cloud storage…',
      error: '',
      title,
      fileName,
      videoId: null,
      formResetToken: 0,
    });

    const { promise, abort } = uploadVideoLibraryAsset(token, payload, (pct) => {
      patchVideoUploadJob(jobId, {
        progress: pct,
        ...(pct >= 100
          ? { phase: 'processing', message: 'Optimizing and preparing your video…' }
          : { phase: 'uploading', message: 'Uploading to secure cloud storage…' }),
      });
    });
    videoUploadAbortRef.current = abort;

    promise
      .then(async (created) => {
        videoUploadAbortRef.current = null;
        const videoId = created?.id != null ? Number(created.id) : null;
        patchVideoUploadJob(jobId, {
          phase: 'done',
          progress: 100,
          message: 'Upload completed successfully.',
          error: '',
          videoId: Number.isFinite(videoId) ? videoId : null,
          formResetToken: Date.now(),
        });
        await loadAll();
        pushToast(`Video “${title}” uploaded`, 'success');
        window.setTimeout(() => {
          setVideoUploadJob((prev) => (prev?.id === jobId && prev.phase === 'done' ? null : prev));
        }, 1600);
      })
      .catch((err) => {
        videoUploadAbortRef.current = null;
        if (err?.code === 'UPLOAD_ABORTED') {
          patchVideoUploadJob(jobId, {
            phase: 'aborted',
            message: 'Upload stopped.',
            error: '',
          });
          return;
        }
        patchVideoUploadJob(jobId, {
          phase: 'failed',
          message: 'Upload failed.',
          error: err?.message || 'Video upload failed',
        });
        pushToast(err?.message || 'Video upload failed', 'error');
      });
  }

  function stopVideoUpload() {
    const job = videoUploadJob;
    if (!job || !['uploading', 'processing'].includes(job.phase)) return;
    videoUploadAbortRef.current?.();
    videoUploadAbortRef.current = null;
    patchVideoUploadJob(job.id, {
      phase: 'aborted',
      message: 'Upload stopped.',
      error: '',
    });
  }

  function discardVideoUpload() {
    const job = videoUploadJob;
    if (job && ['uploading', 'processing'].includes(job.phase)) {
      videoUploadAbortRef.current?.();
      videoUploadAbortRef.current = null;
    }
    const videoId = job?.videoId != null ? Number(job.videoId) : null;
    setVideoUploadJob(null);
    if (Number.isFinite(videoId) && videoId > 0) {
      void deleteVideo(videoId).catch(() => {});
    }
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
    const created = await apiFetch('/assignments', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadAll();
    return created;
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

  async function uploadAssignmentAsset(id, file, assetType, onProgress) {
    return new Promise((resolve, reject) => {
      const body = new FormData();
      body.append('file', file);
      body.append('assetType', assetType);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE}/api/assignments/${id}/assets`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.upload.onprogress = (evt) => {
        if (!evt.lengthComputable) return;
        const pct = Math.max(0, Math.min(100, Math.round((evt.loaded / evt.total) * 100)));
        onProgress?.(pct);
      };

      xhr.onerror = () => reject(new Error('Network error while uploading assignment asset'));
      xhr.onload = () => {
        const data = (() => {
          try {
            return JSON.parse(xhr.responseText || '{}');
          } catch {
            return {};
          }
        })();
        if (xhr.status >= 200 && xhr.status < 300) return resolve(data);
        reject(new Error(data.error || xhr.statusText || 'Assignment asset upload failed'));
      };
      xhr.send(body);
    });
  }

  async function deleteAssignmentAsset(id, assetId) {
    await apiFetch(`/assignments/${id}/assets/${assetId}`, token, { method: 'DELETE' });
  }

  async function loadTrainerOccurrences({ batchId } = {}) {
    const q = batchId != null ? `?batchId=${encodeURIComponent(batchId)}` : '';
    return apiFetch(`/assignments/trainer${q}`, token);
  }

  async function loadTrainerResponses({ batchId } = {}) {
    const q = batchId != null ? `?batchId=${encodeURIComponent(batchId)}` : '';
    return apiFetch(`/assignments/trainer/responses${q}`, token);
  }

  async function setAssignment(payload) {
    return apiFetch('/assignments/set', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async function reviewOccurrenceSubmission(occurrenceId, submissionId, payload = {}) {
    const hasVoice = payload?.voiceBlob instanceof Blob;
    if (hasVoice) {
      const body = new FormData();
      if (payload.feedback != null) body.append('feedback', String(payload.feedback));
      if (payload.clearFeedbackAudio) body.append('clearFeedbackAudio', '1');
      if (payload.score != null && payload.score !== '') body.append('score', String(payload.score));
      body.append('file', payload.voiceBlob, `feedback-${Date.now()}.webm`);
      const res = await fetch(
        `${API_BASE}/api/assignments/occurrences/${occurrenceId}/submissions/${submissionId}/review`,
        {
          method: 'PUT',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body,
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Review failed');
      return data;
    }
    return apiFetch(`/assignments/occurrences/${occurrenceId}/submissions/${submissionId}/review`, token, {
      method: 'PUT',
      body: JSON.stringify({
        feedback: payload.feedback,
        clearFeedbackAudio: payload.clearFeedbackAudio || undefined,
        score: payload.score,
      }),
    });
  }

  async function updateOccurrence(occurrenceId, payload) {
    return apiFetch(`/assignments/occurrences/${occurrenceId}`, token, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async function cancelOccurrence(occurrenceId) {
    return apiFetch(`/assignments/occurrences/${occurrenceId}`, token, {
      method: 'DELETE',
    });
  }

  async function loadBatchMembersForSet(batchId) {
    return apiFetch(`/batch-manager/${batchId}/members`, token);
  }

  async function loadBatchSessionsForSet(batchId) {
    return apiFetch(`/batch-manager/${batchId}/sessions`, token);
  }

  let page = null;
  /** Classroom learners only — excludes trainers/admins mistakenly grouped here. */
  const studentAccounts = users.filter((u) => u.role === 'Student');
  /** Trainers, admins, creators, Lab — everything that is not a classroom Student row. */
  const otherUserAccounts = users.filter((u) =>
    ['Trainer', 'Admin', 'Creator', 'Lab'].includes(u.role)
  );
  const showCreatedBy = currentUser?.role === 'Admin';
  const isTrainer = currentUser?.role === 'Trainer';
  const isAdmin = currentUser?.role === 'Admin';
  const staffUsers = users.filter((u) => ['Trainer', 'Admin'].includes(u.role));
  const onTransferOwner = isAdmin ? transferLibraryOwner : null;

  if (currentPage === 'dashboard') {
    page = <DashboardPage users={users} courses={courses} batches={batches} holidays={holidays} applyLeads={applyLeads} />;
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
        staffUsers={staffUsers}
        onTransferAllContent={isAdmin ? transferAllLibraryContent : null}
      />
    );
  } else if (currentPage === 'leads') {
    page = <LeadsPage leads={applyLeads} onUpdateStatus={updateApplyLeadStatus} onDeleteLead={deleteApplyLead} />;
  } else if (currentPage === 'courses') {
    page = (
      <CoursesPage
        courses={courses}
        library={library}
        readOnly={isTrainer}
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
        readOnly={isTrainer}
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
        canManageAccess={isAdmin}
        loadLessonAccess={isAdmin ? loadLessonAccess : null}
        denyLessonAccess={isAdmin ? denyLessonAccess : null}
        restoreLessonAccess={isAdmin ? restoreLessonAccess : null}
      />
    );
  } else if (currentPage === 'today' && isTrainer) {
    page = (
      <TrainerTodayPage
        loadToday={loadTrainerToday}
        loadReviewQueue={loadReviewQueue}
        loadLessonComposition={loadLessonComposition}
        onOpenBatch={(id) => {
          setSelectedBatchId(String(id));
          setCurrentPage('batches');
        }}
      />
    );
  } else if (currentPage === 'calendar' && isTrainer) {
    page = (
      <TrainerCalendarPage
        loadSessions={loadTrainerSessions}
        holidays={holidays}
        onOpenBatch={(id) => {
          setSelectedBatchId(String(id));
          setCurrentPage('batches');
        }}
      />
    );
  } else if (currentPage === 'review' && isTrainer) {
    page = (
      <ReviewInboxPage
        loadReviewQueue={loadReviewQueue}
        submitReview={submitAssignmentReview}
        loadStudentProgress={loadStudentProgress}
        addStudentNote={addStudentNote}
        deleteStudentNote={deleteStudentNote}
      />
    );
  } else if (currentPage === 'subscriptions' && currentUser?.role === 'Admin') {
    page = (
      <SubscriptionsPage loadSubscriptions={fetchAdminSubscriptions} onDeleteGrant={deleteSubscriptionGrant} />
    );
  } else if (currentPage === 'batches') {
    page = isTrainer ? (
      <TrainerBatchPage
        batches={batches}
        selectedBatchId={selectedBatchId}
        setSelectedBatchId={setSelectedBatchId}
        onLoadSessions={loadSessions}
        onCancelSession={cancelSession}
        cancelAuditRows={cancelAuditRows}
        batchMembers={batchMembers}
        batchTrainers={batchTrainers}
        batchSessions={batchSessions}
        fetchBatchAssignments={fetchBatchAssignments}
        fetchAssignmentSubmissions={fetchAssignmentSubmissions}
        fetchBatchAttendance={fetchBatchAttendance}
        fetchBatchLiveRecordings={fetchBatchLiveRecordings}
        saveSessionAttendance={saveSessionAttendance}
        loadStudentProgress={loadStudentProgress}
        addStudentNote={addStudentNote}
        deleteStudentNote={deleteStudentNote}
      />
    ) : (
      <BatchesPage
        trainerMode={false}
        onCreateBatch={createBatch}
        onUpdateBatch={updateBatch}
        courses={courses}
        batches={batches}
        fetchSubscribePackagesForCourse={fetchSubscribePackagesForCourse}
        selectedBatchId={selectedBatchId}
        setSelectedBatchId={setSelectedBatchId}
        onStartBatch={startBatch}
        onCompleteBatch={completeBatch}
        onReopenBatch={reopenBatch}
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
        updateApplyPartSchedule={updateAdminApplyPartSchedule}
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
        canMapToCourse={!isTrainer}
        onCreateQuiz={createQuizBank}
        onGetQuiz={getQuizBankDetails}
        onUpdateQuiz={updateQuizBank}
        onPublishVersion={publishQuizVersion}
        onAssignQuiz={assignQuiz}
        onDeleteQuiz={deleteQuizBank}
        staffUsers={staffUsers}
        onTransferOwner={onTransferOwner}
      />
    );
  } else if (currentPage === 'videos') {
    page = (
      <VideosPage
        videos={videos}
        categories={videoCategories}
        showCreatedBy={showCreatedBy}
        libraryCanMutate={libraryCanMutate}
        videoUploadJob={videoUploadJob}
        onStartVideoUpload={startVideoUpload}
        onStopVideoUpload={stopVideoUpload}
        onDiscardVideoUpload={discardVideoUpload}
        onUpdateVideo={updateVideo}
        onDeleteVideo={deleteVideo}
        staffUsers={staffUsers}
        onTransferOwner={onTransferOwner}
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
        staffUsers={staffUsers}
        onTransferOwner={onTransferOwner}
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
        staffUsers={staffUsers}
        onTransferOwner={onTransferOwner}
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
        loadAssignmentRetention={
          isAdmin
            ? () => apiFetch('/settings/assignment-response-retention', token)
            : null
        }
        saveAssignmentRetention={
          isAdmin
            ? (days) =>
                apiFetch('/settings/assignment-response-retention', token, {
                  method: 'PUT',
                  body: JSON.stringify({ days }),
                })
            : null
        }
      />
    );
  } else if (currentPage === 'assignments') {
    const libraryProps = {
      assignments,
      showCreatedBy,
      libraryCanMutate,
      libraryCanSharePublic,
      loadAssignment,
      createAssignment,
      updateAssignment,
      deleteAssignment,
      uploadAssignmentAsset,
      deleteAssignmentAsset,
      staffUsers,
      onTransferOwner,
    };
    page = isTrainer || isAdmin ? (
      <TrainerAssignmentsPage
        batches={batches}
        assignmentsLibrary={assignments}
        loadTrainerOccurrences={loadTrainerOccurrences}
        loadTrainerResponses={loadTrainerResponses}
        setAssignment={setAssignment}
        reviewSubmission={reviewOccurrenceSubmission}
        loadBatchMembers={loadBatchMembersForSet}
        loadBatchSessions={loadBatchSessionsForSet}
        cancelOccurrence={cancelOccurrence}
        loadAssignment={loadAssignment}
        showLibraryTab
        {...libraryProps}
      />
    ) : (
      <AssignmentsPage {...libraryProps} />
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
                sessionConflict={sessionConflict}
                onConfirmReplace={doReplaceSession}
                onCancelReplace={() => setSessionConflict(null)}
              />
            </div>
          ) : (
            <div className="app">
              <ToastStack toasts={toasts} />
              {videoUploadJob &&
              ['uploading', 'processing', 'failed', 'aborted'].includes(videoUploadJob.phase) ? (
                <div className="globalVideoUploadBar" role="status">
                  <div className="globalVideoUploadBarMain">
                    <strong>
                      {videoUploadJob.phase === 'processing'
                        ? 'Processing video'
                        : videoUploadJob.phase === 'failed'
                          ? 'Video upload failed'
                          : videoUploadJob.phase === 'aborted'
                            ? 'Video upload stopped'
                            : 'Uploading video'}
                    </strong>
                    <span className="globalVideoUploadBarMeta">
                      {videoUploadJob.title || videoUploadJob.fileName}
                      {['uploading', 'processing'].includes(videoUploadJob.phase)
                        ? ` · ${videoUploadJob.progress}%`
                        : ''}
                    </span>
                    {['uploading', 'processing'].includes(videoUploadJob.phase) ? (
                      <div className="uploadProgressTrack globalVideoUploadTrack">
                        <div
                          className={`uploadProgressBar ${videoUploadJob.phase}`}
                          style={{ width: `${videoUploadJob.progress}%` }}
                        />
                      </div>
                    ) : null}
                    {videoUploadJob.error ? (
                      <span className="uploadErrorText">{videoUploadJob.error}</span>
                    ) : null}
                  </div>
                  <div className="globalVideoUploadBarActions">
                    {currentPage !== 'videos' ? (
                      <button type="button" className="secondaryBtn" onClick={() => setCurrentPage('videos')}>
                        Open Videos
                      </button>
                    ) : null}
                    {['uploading', 'processing'].includes(videoUploadJob.phase) ? (
                      <button type="button" className="secondaryBtn" onClick={stopVideoUpload}>
                        Stop uploading
                      </button>
                    ) : null}
                    <button type="button" className="dangerBtn" onClick={discardVideoUpload}>
                      Discard
                    </button>
                  </div>
                </div>
              ) : null}
              <AdminShell
                currentPage={currentPage}
                onNavigate={setCurrentPage}
                onRefresh={loadAll}
                onLogout={logout}
                currentUser={currentUser}
                loadNotifications={loadShellNotifications}
                creatorMode={currentUser?.role === 'Creator'}
                trainerMode={isTrainer}
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
