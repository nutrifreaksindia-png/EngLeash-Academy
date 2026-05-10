import React, { useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';
import RichTextField from '../components/RichTextField';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3001';
const MODE_OPTIONS = ['Regular', 'Online', 'Self-paced'];
const LANGUAGE_OPTIONS = ['Tamil', 'English', 'Bilingual (Tamil & English)'];

const emptyForm = {
  id: null,
  name: '',
  description: '',
  highlightPoints: [''],
  specificationsHtml: '',
  durationDays: 30,
  /** Stored as modes_json (multiselect). */
  modes: ['Regular'],
  /** Stored as languages_json (multiselect). */
  languages: ['English'],
  feeInr: 0,
  discountInr: 0,
  courseStatus: 'Active',
  enrollmentType: 'free',
  isPublished: true,
  coverBlob: null,
  coverPreviewUrl: '',
};

function enrollmentLabel(value) {
  const v = (value || 'free').toLowerCase();
  if (v === 'apply') return 'Apply';
  if (v === 'purchase') return 'Purchase';
  if (v === 'subscribe') return 'Subscribe';
  return 'Join Free';
}

/** Load stored highlights into editable lines (JSON array, plain lines, or legacy HTML). */
function parseHighlightPoints(highlightsText) {
  if (!highlightsText || !String(highlightsText).trim()) return [''];
  const t = String(highlightsText).trim();
  try {
    const j = JSON.parse(t);
    if (Array.isArray(j)) {
      const lines = j.map((x) => String(x).trim()).filter(Boolean);
      return lines.length ? lines : [''];
    }
  } catch (_) {
    /* fall through */
  }
  if (t.includes('<')) {
    const stripped = t.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    return stripped ? [stripped] : [''];
  }
  const lines = t.split(/\n/).map((s) => s.trim()).filter(Boolean);
  return lines.length ? lines : [''];
}

/** Values from JSON that match known options, in canonical order (for multiselect). */
function selectedOptionsFromJson(json, orderedOptions) {
  if (!json) return [];
  let raw = [];
  try {
    const a = JSON.parse(json);
    if (Array.isArray(a)) raw = a.map((x) => String(x).trim()).filter(Boolean);
  } catch (_) {
    raw = String(json)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return orderedOptions.filter((o) => raw.includes(o));
}

function resolveCoverPreviewUrl(url) {
  if (!url) return '';
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  const base = String(API_BASE || '').replace(/\/+$/, '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

async function optimizeCoverImage(file) {
  const srcUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = srcUrl;
    });

    // Mobile-friendly standard wide cover ratio.
    const targetRatio = 16 / 9;
    const srcW = img.width;
    const srcH = img.height;
    const srcRatio = srcW / srcH;
    let cropW = srcW;
    let cropH = srcH;
    if (srcRatio > targetRatio) {
      cropW = Math.round(srcH * targetRatio);
    } else {
      cropH = Math.round(srcW / targetRatio);
    }
    const sx = Math.max(0, Math.floor((srcW - cropW) / 2));
    const sy = Math.max(0, Math.floor((srcH - cropH) / 2));

    const outW = 1280;
    const outH = 720;
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not process image');
    ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, outW, outH);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (!b) reject(new Error('Could not encode image'));
          else resolve(b);
        },
        'image/jpeg',
        0.84
      );
    });
    const previewUrl = URL.createObjectURL(blob);
    return { blob, previewUrl };
  } finally {
    URL.revokeObjectURL(srcUrl);
  }
}

export default function CoursesPage({
  onCreateCourse,
  onUpdateCourse,
  onDeleteCourse,
  courses,
  library = [],
  fetchCourseSchedule,
  updateCourseScheduleSlot,
  pushToast = () => {},
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [q, setQ] = useState('');

  const [viewOpen, setViewOpen] = useState(false);
  const [viewCourse, setViewCourse] = useState(null);

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleCourse, setScheduleCourse] = useState(null);
  const [scheduleRows, setScheduleRows] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleSavingMapId, setScheduleSavingMapId] = useState(null);

  const libraryLessons = useMemo(
    () => (library || []).filter((l) => l.source !== 'legacy_lessons' && Number.isFinite(Number(l.id))),
    [library]
  );

  const viewHighlightLines = useMemo(() => {
    if (!viewCourse) return [];
    return parseHighlightPoints(viewCourse.highlights)
      .map((x) => String(x).trim())
      .filter(Boolean);
  }, [viewCourse]);
  const filtered = useMemo(
    () => (courses || []).filter((c) => c.name?.toLowerCase().includes(q.toLowerCase())),
    [courses, q]
  );
  function editCourse(c) {
    setForm({
      id: c.id,
      name: c.name || '',
      description: c.description || '',
      highlightPoints: parseHighlightPoints(c.highlights),
      specificationsHtml: c.specifications_html || '',
      durationDays: c.duration_days || 30,
      modes: (() => {
        const m = selectedOptionsFromJson(c.modes_json, MODE_OPTIONS);
        return m.length ? m : ['Regular'];
      })(),
      languages: (() => {
        const l = selectedOptionsFromJson(c.languages_json, LANGUAGE_OPTIONS);
        return l.length ? l : ['English'];
      })(),
      feeInr: c.fee_inr || 0,
      discountInr: c.discount_inr || 0,
      courseStatus: c.course_status || 'Active',
      enrollmentType: c.enrollment_type || 'free',
      isPublished: c.is_published !== 0 && c.is_published !== false,
      coverBlob: null,
      coverPreviewUrl: resolveCoverPreviewUrl(c.image_url),
    });
    setOpen(true);
  }

  function newCourse() {
    setForm({ ...emptyForm });
    setOpen(true);
  }

  async function submit(e) {
    e.preventDefault();
    if (form.id) {
      await onUpdateCourse(form);
    } else {
      await onCreateCourse(form);
    }
    setOpen(false);
    setForm({ ...emptyForm });
  }

  async function duplicateCourse(c) {
    await onCreateCourse({
      name: `${c.name || 'Untitled'} (Copy)`,
      description: c.description || '',
      highlightPoints: parseHighlightPoints(c.highlights),
      specificationsHtml: c.specifications_html || '',
      durationDays: c.duration_days || 30,
      modes: (() => {
        const m = selectedOptionsFromJson(c.modes_json, MODE_OPTIONS);
        return m.length ? m : ['Regular'];
      })(),
      languages: (() => {
        const l = selectedOptionsFromJson(c.languages_json, LANGUAGE_OPTIONS);
        return l.length ? l : ['English'];
      })(),
      feeInr: c.fee_inr || 0,
      discountInr: c.discount_inr || 0,
      courseStatus: c.course_status || 'Active',
      enrollmentType: c.enrollment_type || 'free',
      isPublished: c.is_published !== 0 && c.is_published !== false,
      coverBlob: null,
      coverPreviewUrl: resolveCoverPreviewUrl(c.image_url),
    });
  }

  function setHighlightLine(index, value) {
    setForm((prev) => {
      const next = [...prev.highlightPoints];
      next[index] = value;
      return { ...prev, highlightPoints: next };
    });
  }

  function addHighlightLine() {
    setForm((prev) => ({ ...prev, highlightPoints: [...prev.highlightPoints, ''] }));
  }

  function removeHighlightLine(index) {
    setForm((prev) => {
      if (prev.highlightPoints.length <= 1) return { ...prev, highlightPoints: [''] };
      const next = prev.highlightPoints.filter((_, i) => i !== index);
      return { ...prev, highlightPoints: next.length ? next : [''] };
    });
  }

  async function onCoverFileChange(file) {
    if (!file) return;
    const { blob, previewUrl } = await optimizeCoverImage(file);
    setForm((prev) => ({ ...prev, coverBlob: blob, coverPreviewUrl: previewUrl }));
  }

  async function reloadScheduleForCourse(courseId) {
    if (!courseId || !fetchCourseSchedule) return;
    try {
      const rows = await fetchCourseSchedule(courseId);
      setScheduleRows(Array.isArray(rows) ? rows : []);
    } catch (e) {
      pushToast(e.message || 'Could not load schedule', 'error');
    }
  }

  async function openLessonSchedule(c) {
    setScheduleCourse(c);
    setScheduleOpen(true);
    setScheduleLoading(true);
    try {
      await reloadScheduleForCourse(c.id);
    } finally {
      setScheduleLoading(false);
    }
  }

  function handleViewEdit() {
    if (!viewCourse) return;
    const c = viewCourse;
    setViewOpen(false);
    editCourse(c);
  }

  async function handleViewDuplicate() {
    if (!viewCourse) return;
    await duplicateCourse(viewCourse);
    setViewOpen(false);
    setViewCourse(null);
  }

  async function handleViewDelete() {
    if (!viewCourse) return;
    if (!window.confirm('Delete this course? This cannot be undone.')) return;
    await onDeleteCourse(viewCourse.id);
    setViewOpen(false);
    setViewCourse(null);
  }

  async function onScheduleLessonChange(row, event) {
    if (!scheduleCourse) return;
    const raw = event.target.value;
    const lessonId = raw === '' ? null : Number(raw);
    if (lessonId !== null && (!Number.isFinite(lessonId) || lessonId < 1)) return;
    setScheduleSavingMapId(row.mapId);
    try {
      await updateCourseScheduleSlot(row.mapId, { lessonId });
      await reloadScheduleForCourse(scheduleCourse.id);
    } catch (err) {
      pushToast(err.message || 'Could not save lesson', 'error');
      await reloadScheduleForCourse(scheduleCourse.id);
    } finally {
      setScheduleSavingMapId(null);
    }
  }

  return (
    <div className="stack">
      <SectionCard
        title="Courses"
        subtitle="Lesson schedule has one slot per day from the course duration; assign a lesson template per day."
        actions={
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search courses" />
            <button onClick={newCourse}>+ New Course</button>
          </>
        }
      >
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Enrollment</th>
                <th>Duration</th>
                <th>Fee</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    <span className={`badge ${(c.course_status || 'Active').toLowerCase()}`}>
                      {c.course_status || 'Active'}
                    </span>
                  </td>
                  <td>{enrollmentLabel(c.enrollment_type)}</td>
                  <td>{c.duration_days || 1} days</td>
                  <td>INR {c.fee_inr || 0}</td>
                  <td className="courseActionsCell">
                    <div className="courseActionsRow">
                      <button
                        className="secondaryBtn courseQuickAction"
                        type="button"
                        onClick={() => {
                          setViewCourse(c);
                          setViewOpen(true);
                        }}
                      >
                        View
                      </button>
                      <button className="secondaryBtn courseQuickAction" type="button" onClick={() => openLessonSchedule(c)}>
                        Lesson schedule
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <Modal
        open={viewOpen}
        title={viewCourse?.name || 'Course details'}
        onClose={() => {
          setViewOpen(false);
          setViewCourse(null);
        }}
        variant="modal"
      >
        {viewCourse ? (
          <div className="courseViewReadonly">
            <header className="courseViewHeader">
              <div className="courseViewActions">
                <button className="secondaryBtn" type="button" onClick={handleViewEdit}>
                  Edit
                </button>
                <button className="secondaryBtn" type="button" onClick={() => void handleViewDuplicate()}>
                  Duplicate
                </button>
                <button className="dangerBtn" type="button" onClick={() => void handleViewDelete()}>
                  Delete
                </button>
              </div>
            </header>

            <section className="courseViewBlock">
              <h3 className="courseViewLabel">Description</h3>
              <p className="courseViewText">{viewCourse.description?.trim() || 'No description provided.'}</p>
            </section>

            <section className="courseViewBlock">
              <h3 className="courseViewLabel">Highlights</h3>
              <ul className="courseViewList">
                {viewHighlightLines.length ? (
                  viewHighlightLines.map((line, i) => <li key={i}>{line}</li>)
                ) : (
                  <li className="courseViewEmpty muted">None listed.</li>
                )}
              </ul>
            </section>

            {viewCourse.specifications_html ? (
              <section className="courseViewBlock">
                <h3 className="courseViewLabel">Specifications</h3>
                <div
                  className="courseViewSpecs richPreview"
                  dangerouslySetInnerHTML={{ __html: viewCourse.specifications_html }}
                />
              </section>
            ) : null}

            <section className="courseViewBlock courseViewBlockMeta">
              <h3 className="courseViewLabel">Course details</h3>
              <dl className="courseViewMetaGrid">
                <dt>Duration</dt>
                <dd>{viewCourse.duration_days || 1} days</dd>
                <dt>Fee</dt>
                <dd>INR {viewCourse.fee_inr ?? 0}</dd>
                <dt>Discount</dt>
                <dd>INR {viewCourse.discount_inr ?? 0}</dd>
                <dt>Enrollment</dt>
                <dd>{enrollmentLabel(viewCourse.enrollment_type)}</dd>
                <dt>Status</dt>
                <dd>{viewCourse.course_status || 'Active'}</dd>
                <dt>Visibility</dt>
                <dd>{viewCourse.is_published !== 0 && viewCourse.is_published !== false ? 'Published on home' : 'Hidden from home'}</dd>
              </dl>
            </section>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={scheduleOpen}
        title={scheduleCourse ? `Lesson schedule — ${scheduleCourse.name || ''}` : 'Lesson schedule'}
        onClose={() => {
          setScheduleOpen(false);
          setScheduleCourse(null);
          setScheduleRows([]);
        }}
        variant="modal"
      >
        <div className="lessonSchedulePanel">
          <p className="lessonScheduleHint muted">
            Slots match <strong>Duration (days)</strong> on the course ({scheduleCourse?.duration_days || 1} days). Change
            duration in course edit to add or remove days.
          </p>
          {!libraryLessons.length ? (
            <p className="muted">Create lesson templates under Lessons to assign them here.</p>
          ) : null}
          {scheduleLoading ? (
            <p className="muted">Loading…</p>
          ) : (
            <div className="tableWrap lessonScheduleTableWrap">
              <table className="lessonScheduleTable">
                <thead>
                  <tr>
                    <th className="lessonScheduleDayCol">Day no.</th>
                    <th className="lessonScheduleLessonCol">Lesson</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleRows.length === 0 ? (
                    <tr>
                      <td colSpan={2} className="muted">
                        No slots yet. Save the course with a duration, then reopen this schedule.
                      </td>
                    </tr>
                  ) : (
                    scheduleRows.map((row) => {
                      const selectValue =
                        row.lessonId != null && row.lessonId !== '' ? String(row.lessonId) : '';
                      const busy = scheduleSavingMapId === row.mapId;
                      const lid = row.lessonId != null ? Number(row.lessonId) : null;
                      const rowLessonOptions =
                        lid != null && !libraryLessons.some((l) => Number(l.id) === lid)
                          ? [...libraryLessons, { id: lid, title: row.lessonTitle || `Lesson #${lid}` }]
                          : libraryLessons;
                      return (
                        <tr key={row.mapId}>
                          <td className="lessonScheduleDayCol">{row.dayNumber}</td>
                          <td className="lessonScheduleLessonCol">
                            {!rowLessonOptions.length ? (
                              <span className="muted">{row.lessonTitle || 'Not assigned — add lessons under Lessons first.'}</span>
                            ) : (
                              <select
                                className="courseSelect lessonScheduleInlineSelect"
                                aria-label={`Lesson for day ${row.dayNumber}`}
                                value={selectValue}
                                disabled={busy}
                                onChange={(e) => onScheduleLessonChange(row, e)}
                              >
                                <option value="">— Not assigned —</option>
                                {rowLessonOptions.map((l) => (
                                  <option key={l.id} value={l.id}>
                                    {l.title}
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <Modal open={open} title={form.id ? 'Edit course' : 'Create course'} onClose={() => setOpen(false)} variant="drawer">
        <form onSubmit={submit} className="courseForm">
          <div className="courseFormField">
            <label className="fieldLabel" htmlFor="course-name">
              Course title
            </label>
            <input
              id="course-name"
              className="courseInput"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Spoken English — Level 1"
              required
            />
          </div>

          <div className="courseFormField">
            <label className="fieldLabel" htmlFor="course-description">
              Description
            </label>
            <p className="fieldHint">Short overview shown in listings.</p>
            <textarea
              id="course-description"
              className="courseTextarea courseTextareaMd"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="What learners get from this course"
              rows={5}
            />
          </div>

          <div className="courseFormField">
            <label className="fieldLabel" htmlFor="course-cover">
              Cover photo (16:9)
            </label>
            <p className="fieldHint">Image is auto-cropped and optimized to 1280x720 during upload.</p>
            <input
              id="course-cover"
              className="courseInput"
              type="file"
              accept="image/*"
              onChange={(e) => onCoverFileChange(e.target.files?.[0])}
            />
            {form.coverPreviewUrl ? (
              <img src={form.coverPreviewUrl} alt="Course cover preview" className="coverPreviewImg" />
            ) : null}
          </div>

          <div className="courseFormField">
            <span className="fieldLabel">Course highlights</span>
            <p className="fieldHint">One short bullet per line. Add as many points as you need.</p>
            {form.highlightPoints.map((line, i) => (
              <div key={i} className="highlightLineRow">
                <input
                  id={i === 0 ? 'course-highlight-0' : undefined}
                  className="courseInput"
                  value={line}
                  onChange={(e) => setHighlightLine(i, e.target.value)}
                  placeholder={`Point ${i + 1}`}
                  aria-label={`Highlight ${i + 1}`}
                />
                <button
                  type="button"
                  className="secondaryBtn highlightRemoveBtn"
                  onClick={() => removeHighlightLine(i)}
                  disabled={form.highlightPoints.length <= 1}
                >
                  Remove
                </button>
              </div>
            ))}
            <button type="button" className="secondaryBtn" onClick={addHighlightLine}>
              + Add point
            </button>
          </div>

          <div className="courseFormField">
            <span className="fieldLabel">Course specifications</span>
            <p className="fieldHint">Rich text for detailed syllabus, prerequisites, etc.</p>
            <RichTextField value={form.specificationsHtml} onChange={(v) => setForm({ ...form, specificationsHtml: v })} />
          </div>

          <div className="courseFormField">
            <label className="fieldLabel" htmlFor="course-duration">
              Duration (days)
            </label>
            <input
              id="course-duration"
              className="courseInput courseInputNarrow"
              value={form.durationDays}
              onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value || 1) })}
              type="number"
              min={1}
            />
          </div>

          <div className="courseFormField">
            <label className="fieldLabel" htmlFor="course-mode">
              Mode
            </label>
            <p className="fieldHint">Multiselect: hold Ctrl (Windows) or ⌘ (Mac) and click to choose more than one.</p>
            <select
              id="course-mode"
              className="courseSelect courseSelectMulti"
              multiple
              size={MODE_OPTIONS.length}
              value={form.modes}
              onChange={(e) =>
                setForm({
                  ...form,
                  modes: Array.from(e.target.selectedOptions, (opt) => opt.value),
                })
              }
            >
              {MODE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="courseFormField">
            <label className="fieldLabel" htmlFor="course-language">
              Language medium
            </label>
            <p className="fieldHint">Multiselect: hold Ctrl (Windows) or ⌘ (Mac) and click to choose more than one.</p>
            <select
              id="course-language"
              className="courseSelect courseSelectMulti"
              multiple
              size={LANGUAGE_OPTIONS.length}
              value={form.languages}
              onChange={(e) =>
                setForm({
                  ...form,
                  languages: Array.from(e.target.selectedOptions, (opt) => opt.value),
                })
              }
            >
              {LANGUAGE_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          <div className="courseFormField">
            <label className="fieldLabel" htmlFor="course-fee">
              Fee (INR)
            </label>
            <input
              id="course-fee"
              className="courseInput courseInputNarrow"
              value={form.feeInr}
              onChange={(e) => setForm({ ...form, feeInr: Number(e.target.value || 0) })}
              type="number"
              min={0}
            />
          </div>

          <div className="courseFormField">
            <label className="fieldLabel" htmlFor="course-discount">
              Discount (INR)
            </label>
            <input
              id="course-discount"
              className="courseInput courseInputNarrow"
              value={form.discountInr}
              onChange={(e) => setForm({ ...form, discountInr: Number(e.target.value || 0) })}
              type="number"
              min={0}
            />
          </div>

          <div className="courseFormField">
            <span className="fieldLabel" id="course-enroll-label">
              How students enroll
            </span>
            <p className="fieldHint">Subscribe uses billing packages (web admin → Billing & combos). Apply and purchase use their own flows in the app.</p>
            <select
              id="course-enrollment"
              className="courseSelect"
              aria-labelledby="course-enroll-label"
              value={form.enrollmentType}
              onChange={(e) => setForm({ ...form, enrollmentType: e.target.value })}
            >
              <option value="free">Join Free</option>
              <option value="apply">Apply</option>
              <option value="purchase">Purchase</option>
              <option value="subscribe">Subscribe</option>
            </select>
          </div>

          <div className="courseFormField">
            <span className="fieldLabel">Status</span>
            <p className="fieldHint">Inactive courses are hidden from enrolled learners.</p>
            <div className="togglePair" role="group" aria-label="Course status">
              <button
                type="button"
                className={form.courseStatus === 'Active' ? 'toggleBtn toggleBtnOn' : 'toggleBtn toggleBtnOff'}
                onClick={() => setForm({ ...form, courseStatus: 'Active' })}
              >
                Active
              </button>
              <button
                type="button"
                className={form.courseStatus === 'Inactive' ? 'toggleBtn toggleBtnOn' : 'toggleBtn toggleBtnOff'}
                onClick={() => setForm({ ...form, courseStatus: 'Inactive' })}
              >
                Inactive
              </button>
            </div>
          </div>

          <div className="courseFormField">
            <span className="fieldLabel">Visibility</span>
            <p className="fieldHint">Public home lists published courses for signed-out and signed-in users.</p>
            <div className="togglePair" role="group" aria-label="Public visibility">
              <button
                type="button"
                className={form.isPublished ? 'toggleBtn toggleBtnOn' : 'toggleBtn toggleBtnOff'}
                onClick={() => setForm({ ...form, isPublished: true })}
              >
                Show on public home
              </button>
              <button
                type="button"
                className={!form.isPublished ? 'toggleBtn toggleBtnOn' : 'toggleBtn toggleBtnOff'}
                onClick={() => setForm({ ...form, isPublished: false })}
              >
                Hide from public
              </button>
            </div>
          </div>

          <div className="courseFormActions">
            <button type="submit">{form.id ? 'Save course' : 'Create course'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
