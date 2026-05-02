import React, { useMemo, useState } from 'react';
import LoginCard from './components/LoginCard';
import StatusBanner from './components/StatusBanner';
import AdminShell from './components/AdminShell';
import DashboardPage from './pages/DashboardPage';
import UsersPage from './pages/UsersPage';
import ApprovalsPage from './pages/ApprovalsPage';
import CoursesPage from './pages/CoursesPage';
import LessonsPage from './pages/LessonsPage';
import BatchesPage from './pages/BatchesPage';
import ToastStack from './components/ToastStack';
import QuizBankPage from './pages/QuizBankPage';
import VideosPage from './pages/VideosPage';
import SettingsPage from './pages/SettingsPage';
import StudyMaterialsPage from './pages/StudyMaterialsPage';
import SectionCard from './components/SectionCard';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';

const WEB_ADMIN_ROLES = ['Admin', 'Creator'];
const CREATOR_ALLOWED_PAGES = new Set(['videos', 'study-materials', 'quizzes', 'assignments']);

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
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function apiFetchSafe(path, token, options = {}) {
  try {
    const data = await apiFetch(path, token, options);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message || 'Request failed' };
  }
}

/** Persist course highlights as a JSON array of single-line bullet strings (may be []). */
function serializeHighlightPoints(points) {
  if (!points || !Array.isArray(points)) return '[]';
  const cleaned = points.map((s) => String(s).trim()).filter(Boolean);
  return JSON.stringify(cleaned);
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
  const [token, setToken] = useState('');
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [busyLogin, setBusyLogin] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [users, setUsers] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [courses, setCourses] = useState([]);
  const [library, setLibrary] = useState([]);
  const [batches, setBatches] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [quizBank, setQuizBank] = useState([]);
  const [videos, setVideos] = useState([]);
  const [videoCategories, setVideoCategories] = useState([]);
  const [studyMaterials, setStudyMaterials] = useState([]);
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

  const authReady = useMemo(() => Boolean(token), [token]);

  function pushToast(text, type = 'info') {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((prev) => [...prev, { id, text, type }]);
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
        const me = await apiFetch('/users/me', replaced.token);
        setCurrentUser(me);
        if (!WEB_ADMIN_ROLES.includes(me?.role)) {
          setToken('');
          throw new Error(`Web admin access is not available for this account. Logged in as ${me?.role || 'Unknown'}`);
        }
        if (me?.role === 'Creator') setCurrentPage('study-materials');
        const hd = me?.role === 'Admin' ? await apiFetch('/health/details', replaced.token).catch(() => null) : null;
        setHealth(hd);
        setMessage('Logged in (previous session replaced)');
        setTimeout(() => {
          loadAllWithToken(replaced.token);
        }, 0);
        return;
      }
      if (!data?.token) {
        throw new Error('Login did not return a token');
      }
      setToken(data.token);
      const me = await apiFetch('/users/me', data.token);
      setCurrentUser(me);
      if (!WEB_ADMIN_ROLES.includes(me?.role)) {
        setToken('');
        throw new Error(`Web admin access is not available for this account. Logged in as ${me?.role || 'Unknown'}`);
      }
      if (me?.role === 'Creator') setCurrentPage('study-materials');
      const hd = me?.role === 'Admin' ? await apiFetch('/health/details', data.token).catch(() => null) : null;
      setHealth(hd);
      setMessage('Logged in');
      setTimeout(() => {
        loadAllWithToken(data.token);
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
        const [c, l, q, v, vc, sm] = await Promise.all([
          apiFetchSafe('/courses', nextToken),
          apiFetchSafe('/lessons/admin/all', nextToken),
          apiFetchSafe('/quizzes/v2', nextToken),
          apiFetchSafe('/videos', nextToken),
          apiFetchSafe('/videos/categories', nextToken),
          apiFetchSafe('/study-materials', nextToken),
        ]);
        setUsers([]);
        setPendingUsers([]);
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
        setHealth(null);
        setLoadErrors([
          !c.ok ? `/courses: ${c.error}` : null,
          !l.ok ? `/lessons/admin/all: ${l.error}` : null,
          !q.ok ? `/quizzes/v2: ${q.error}` : null,
          !v.ok ? `/videos: ${v.error}` : null,
          !vc.ok ? `/videos/categories: ${vc.error}` : null,
          !sm.ok ? `/study-materials: ${sm.error}` : null,
        ].filter(Boolean));
        return;
      }

      const [u, pu, c, l, b, h, q, v, vc, sm] = await Promise.all([
        apiFetchSafe('/users', nextToken),
        apiFetchSafe('/users/pending', nextToken),
        apiFetchSafe('/courses', nextToken),
        apiFetchSafe('/lessons/admin/all', nextToken),
        apiFetchSafe('/batch-manager', nextToken),
        apiFetchSafe('/batch-manager/holidays/list', nextToken),
        apiFetchSafe('/quizzes/v2', nextToken),
        apiFetchSafe('/videos', nextToken),
        apiFetchSafe('/videos/categories', nextToken),
        apiFetchSafe('/study-materials', nextToken),
      ]);

      if (u.ok) setUsers(Array.isArray(u.data) ? u.data : []);
      if (pu.ok) setPendingUsers(Array.isArray(pu.data) ? pu.data : []);
      if (c.ok) setCourses(Array.isArray(c.data) ? c.data : []);
      if (l.ok) setLibrary(Array.isArray(l.data) ? l.data : []);
      if (b.ok) setBatches(Array.isArray(b.data) ? b.data : []);
      if (h.ok) setHolidays(Array.isArray(h.data) ? h.data : []);
      if (q.ok) setQuizBank(Array.isArray(q.data) ? q.data : []);
      if (v.ok) setVideos(Array.isArray(v.data) ? v.data : []);
      if (vc.ok) setVideoCategories(Array.isArray(vc.data) ? vc.data : []);
      if (sm.ok) setStudyMaterials(Array.isArray(sm.data) ? sm.data : []);

      const errs = [
        !u.ok ? `/users: ${u.error}` : null,
        !pu.ok ? `/users/pending: ${pu.error}` : null,
        !c.ok ? `/courses: ${c.error}` : null,
        !l.ok ? `/lessons/admin/all: ${l.error}` : null,
        !b.ok ? `/batch-manager: ${b.error}` : null,
        !h.ok ? `/batch-manager/holidays/list: ${h.error}` : null,
        !q.ok ? `/quizzes/v2: ${q.error}` : null,
        !v.ok ? `/videos: ${v.error}` : null,
        !vc.ok ? `/videos/categories: ${vc.error}` : null,
        !sm.ok ? `/study-materials: ${sm.error}` : null,
      ].filter(Boolean);
      setLoadErrors(errs);
    } catch (e) {
      setError(e.message);
    }
  }

  async function loadAll() {
    await loadAllWithToken(token);
  }

  function logout() {
    setToken('');
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
    setBatchSessions([]);
    setCancelAuditRows([]);
    setBatchMembers([]);
    setBatchTrainers([]);
    setCurrentUser(null);
    setHealth(null);
    setMessage('Logged out');
  }

  async function createUser(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await apiFetch('/users', token, {
        method: 'POST',
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
          role: form.get('role'),
          mobileNumber: form.get('mobileNumber'),
          profilePhotoUrl: form.get('profilePhotoUrl'),
        }),
      });
      e.currentTarget.reset();
      await loadAll();
      setMessage('User created');
    } catch (err) {
      setError(err.message);
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
    try {
      const created = await apiFetch('/lessons/library', token, {
        method: 'POST',
        body: JSON.stringify({
          title: payload.title,
          description: payload.description,
          studyMaterialHtml: payload.studyMaterialHtml,
          worksheetHtml: payload.worksheetHtml,
          worksheetAnswerKeyHtml: payload.worksheetAnswerKeyHtml,
          assignmentTitle: payload.assignmentTitle,
        }),
      });
      await loadAll();
      setMessage('Lesson template created');
      pushToast('Lesson template created', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function updateLessonLibrary(payload) {
    try {
      await apiFetch(`/lessons/library/${payload.id}`, token, {
        method: 'PUT',
        body: JSON.stringify({
          title: payload.title,
          description: payload.description,
          studyMaterialHtml: payload.studyMaterialHtml,
          worksheetHtml: payload.worksheetHtml,
          worksheetAnswerKeyHtml: payload.worksheetAnswerKeyHtml,
          assignmentTitle: payload.assignmentTitle,
        }),
      });
      await loadAll();
      setMessage('Lesson template updated');
      pushToast('Lesson template updated', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
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

  async function createBatch(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await apiFetch('/batch-manager', token, {
        method: 'POST',
        body: JSON.stringify({
          title: form.get('title'),
          batchType: form.get('batchType'),
          courseId: Number(form.get('courseId')),
          plannedStartDate: form.get('plannedStartDate'),
          notes: form.get('notes'),
          trainingSchedule: {
            startTime: form.get('startTime'),
            endTime: form.get('endTime'),
            daysOfWeek: String(form.get('daysOfWeek') || '').split(',').map((s) => s.trim()).filter(Boolean),
          },
        }),
      });
      e.currentTarget.reset();
      await loadAll();
      setMessage('Batch created');
    } catch (err) {
      setError(err.message);
    }
  }

  async function addHoliday(e) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      await apiFetch('/batch-manager/holidays', token, {
        method: 'POST',
        body: JSON.stringify({
          holidayDate: form.get('holidayDate'),
          reason: form.get('reason'),
        }),
      });
      e.currentTarget.reset();
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

  async function startBatch() {
    if (!selectedBatchId) return;
    try {
      await apiFetch(`/batch-manager/${selectedBatchId}/start`, token, {
        method: 'POST',
        body: JSON.stringify({ startDate: new Date().toISOString().slice(0, 10) }),
      });
      const sessions = await apiFetch(`/batch-manager/${selectedBatchId}/sessions`, token);
      setBatchSessions(sessions);
      setMessage('Batch started and sessions generated');
      await loadAll();
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadSessions() {
    if (!selectedBatchId) return;
    try {
      const [sessions, audit, members, trainers] = await Promise.all([
        apiFetch(`/batch-manager/${selectedBatchId}/sessions`, token),
        apiFetch(`/batch-manager/${selectedBatchId}/sessions/audit`, token),
        apiFetch(`/batch-manager/${selectedBatchId}/members`, token),
        apiFetch(`/batch-manager/${selectedBatchId}/trainers`, token),
      ]);
      setBatchSessions(sessions);
      setCancelAuditRows(Array.isArray(audit) ? audit : []);
      setBatchMembers(Array.isArray(members) ? members : []);
      setBatchTrainers(Array.isArray(trainers) ? trainers : []);
      pushToast('Sessions loaded', 'info');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function cancelSession(sessionId, reason) {
    if (!selectedBatchId) return;
    try {
      await apiFetch(`/batch-manager/${selectedBatchId}/sessions/${sessionId}/cancel`, token, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      await loadSessions();
      setMessage('Session cancelled and schedule adjusted');
      pushToast('Session cancelled', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  React.useEffect(() => {
    if (selectedBatchId) {
      loadSessions();
    } else {
      setBatchSessions([]);
      setCancelAuditRows([]);
      setBatchMembers([]);
      setBatchTrainers([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedBatchId]);

  React.useEffect(() => {
    if (!token || !currentUser || currentUser.role !== 'Creator') return;
    if (!CREATOR_ALLOWED_PAGES.has(currentPage)) {
      setCurrentPage('study-materials');
    }
  }, [token, currentUser, currentPage]);

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

  async function addBatchMember(studentId) {
    if (!selectedBatchId || !studentId) return;
    try {
      await apiFetch(`/batch-manager/${selectedBatchId}/members`, token, {
        method: 'POST',
        body: JSON.stringify({ studentId: Number(studentId) }),
      });
      await loadSessions();
      pushToast('Student added to batch', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function removeBatchMember(studentId) {
    if (!selectedBatchId || !studentId) return;
    try {
      await apiFetch(`/batch-manager/${selectedBatchId}/members/${studentId}`, token, { method: 'DELETE' });
      await loadSessions();
      pushToast('Student removed from batch', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function addBatchTrainer(trainerId) {
    if (!selectedBatchId || !trainerId) return;
    try {
      await apiFetch(`/batch-manager/${selectedBatchId}/trainers`, token, {
        method: 'POST',
        body: JSON.stringify({ trainerId: Number(trainerId) }),
      });
      await loadSessions();
      pushToast('Trainer assigned to batch', 'success');
    } catch (err) {
      setError(err.message);
      pushToast(err.message, 'error');
    }
  }

  async function removeBatchTrainer(trainerId) {
    if (!selectedBatchId || !trainerId) return;
    try {
      await apiFetch(`/batch-manager/${selectedBatchId}/trainers/${trainerId}`, token, { method: 'DELETE' });
      await loadSessions();
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

  async function createQuizBank(payload) {
    await apiFetch('/quizzes/v2', token, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await loadAll();
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

  if (!authReady) {
    return (
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
    );
  }

  let page = null;
  const students = users.filter((u) => u.role === 'Student' || u.role === 'Lab');
  const trainers = users.filter((u) => u.role === 'Trainer');
  const admins = users.filter((u) => u.role === 'Admin');
  const creators = users.filter((u) => u.role === 'Creator');
  const showCreatedBy = currentUser?.role === 'Admin';

  if (currentPage === 'dashboard') {
    page = <DashboardPage users={users} pendingUsers={pendingUsers} courses={courses} batches={batches} holidays={holidays} />;
  } else if (currentPage === 'users' || currentPage === 'students') {
    page = (
      <UsersPage
        users={students}
        title="Students"
        subtitle="Students and lab users"
        onCreateUser={createUser}
        onUpdateUser={updateUser}
        onGetUserDetails={getUserDetails}
      />
    );
  } else if (currentPage === 'trainers') {
    page = (
      <UsersPage
        users={trainers}
        title="Trainers"
        subtitle="Trainer accounts"
        onCreateUser={createUser}
        onUpdateUser={updateUser}
        onGetUserDetails={getUserDetails}
      />
    );
  } else if (currentPage === 'admins') {
    page = (
      <UsersPage
        users={admins}
        title="Admins"
        subtitle="Administrator accounts"
        onCreateUser={createUser}
        onUpdateUser={updateUser}
        onGetUserDetails={getUserDetails}
      />
    );
  } else if (currentPage === 'creators') {
    page = (
      <UsersPage
        users={creators}
        title="Creators"
        subtitle="Library-only authors — add name, email, mobile, password, and profile photo"
        createTitle="Add creator"
        createSubtitle="Name, email, password, mobile number, profile photo URL"
        defaultRole="Creator"
        onCreateUser={createUser}
        onUpdateUser={updateUser}
        onGetUserDetails={getUserDetails}
      />
    );
  } else if (currentPage === 'approvals') {
    page = <ApprovalsPage pendingUsers={pendingUsers} onApproveUser={approveUser} />;
  } else if (currentPage === 'courses') {
    page = <CoursesPage courses={courses} onCreateCourse={createCourse} onUpdateCourse={updateCourse} onDeleteCourse={deleteCourse} />;
  } else if (currentPage === 'lessons') {
    page = <LessonsPage library={library} onCreateLessonLibrary={createLessonLibrary} onUpdateLessonLibrary={updateLessonLibrary} onDeleteLessonLibrary={deleteLessonLibrary} />;
  } else if (currentPage === 'batches') {
    page = (
      <BatchesPage
        onCreateBatch={createBatch}
        batches={batches}
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
      />
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
  } else if (currentPage === 'settings') {
    page = (
      <SettingsPage
        holidays={holidays}
        categories={videoCategories}
        onAddHoliday={addHoliday}
        onCreateCategory={createVideoCategory}
        onDeleteCategory={deleteVideoCategory}
      />
    );
  } else if (currentPage === 'assignments') {
    page = (
      <SectionCard title="Assignments" subtitle="Homework and learner submissions">
        <p className="muted" style={{ margin: 0 }}>
          This area will be available in a future release.
        </p>
      </SectionCard>
    );
  }

  return (
    <div className="app">
      <ToastStack toasts={toasts} />
      <StatusBanner error={error} message={message} />
      <AdminShell
        currentPage={currentPage}
        onNavigate={setCurrentPage}
        onRefresh={loadAll}
        onLogout={logout}
        creatorMode={currentUser?.role === 'Creator'}
      >
        {page}
      </AdminShell>
    </div>
  );
}
