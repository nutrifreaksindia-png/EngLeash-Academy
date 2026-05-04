import React, { useEffect, useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';

const TYPE_LABEL = {
  video: 'Video',
  study_material: 'Study material',
  worksheet: 'Worksheet',
  quiz: 'Quiz',
  assignment: 'Assignment',
};

const TYPE_ORDER = ['video', 'study_material', 'worksheet', 'quiz', 'assignment'];

function typeLabel(t) {
  return TYPE_LABEL[t] || t;
}

export default function LessonsPage({
  library,
  videos = [],
  studyMaterials = [],
  worksheets = [],
  quizBank = [],
  assignments = [],
  onCreateLessonLibrary,
  onUpdateLessonLibrary,
  onDeleteLessonLibrary,
  saveLessonComposition,
  loadLessonComposition,
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  /** @type {{ type: string, id: number, title: string }[]} */
  const [items, setItems] = useState([]);
  const [loadingComposition, setLoadingComposition] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');

  const [addType, setAddType] = useState('video');
  const [addId, setAddId] = useState('');

  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [dragIndex, setDragIndex] = useState(null);

  const [viewOpen, setViewOpen] = useState(false);
  const [viewLesson, setViewLesson] = useState(null);
  /** @type {{ type: string, id: number, title: string }[]} */
  const [viewItems, setViewItems] = useState([]);
  const [viewLoading, setViewLoading] = useState(false);

  const libraryLessons = useMemo(
    () => (library || []).filter((l) => l.source !== 'legacy_lessons'),
    [library],
  );

  const legacyLessons = useMemo(
    () => (library || []).filter((l) => l.source === 'legacy_lessons'),
    [library],
  );

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return libraryLessons;
    return libraryLessons.filter((l) => String(l.title || '').toLowerCase().includes(needle));
  }, [libraryLessons, q]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page],
  );

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pickOptions = useMemo(() => {
    const used = new Set(items.map((x) => `${x.type}:${x.id}`));
    const filterUsed = (type, id) => !used.has(`${type}:${id}`);

    if (addType === 'video') {
      return (videos || [])
        .filter((v) => filterUsed('video', Number(v.id)))
        .map((v) => ({ value: String(v.id), label: v.title || `Video #${v.id}` }));
    }
    if (addType === 'study_material') {
      return (studyMaterials || [])
        .filter((m) => Number(m.is_draft) !== 1 && filterUsed('study_material', Number(m.id)))
        .map((m) => ({ value: String(m.id), label: m.title || `Material #${m.id}` }));
    }
    if (addType === 'worksheet') {
      return (worksheets || [])
        .filter((w) => Number(w.is_draft) !== 1 && filterUsed('worksheet', Number(w.id)))
        .map((w) => ({ value: String(w.id), label: w.title || `Worksheet #${w.id}` }));
    }
    if (addType === 'quiz') {
      return (quizBank || [])
        .filter((q) => q.status === 'published' && filterUsed('quiz', Number(q.id)))
        .map((q) => ({ value: String(q.id), label: q.title || `Quiz #${q.id}` }));
    }
    if (addType === 'assignment') {
      return (assignments || [])
        .filter((a) => Number(a.is_draft) !== 1 && filterUsed('assignment', Number(a.id)))
        .map((a) => ({ value: String(a.id), label: a.title || `Assignment #${a.id}` }));
    }
    return [];
  }, [addType, videos, studyMaterials, worksheets, quizBank, assignments, items]);

  useEffect(() => {
    setAddId('');
  }, [addType]);

  function resetForm() {
    setEditingId(null);
    setTitle('');
    setDescription('');
    setItems([]);
    setNotice('');
    setAddType('video');
    setAddId('');
  }

  async function startNew() {
    resetForm();
    setOpen(true);
  }

  async function startView(row) {
    if (row.source === 'legacy_lessons') return;
    setViewLesson({ title: row.title || '', description: row.description || '' });
    setViewItems([]);
    setViewOpen(true);
    setViewLoading(true);
    try {
      const data = await loadLessonComposition(row.id);
      const list = Array.isArray(data?.items) ? data.items : [];
      setViewItems(
        list.map((x) => ({
          type: x.type,
          id: Number(x.id),
          title: x.title || `${typeLabel(x.type)} #${x.id}`,
        })),
      );
    } catch {
      setViewItems([]);
    } finally {
      setViewLoading(false);
    }
  }

  function closeView() {
    setViewOpen(false);
    setViewLesson(null);
    setViewItems([]);
  }

  async function startEdit(row) {
    if (row.source === 'legacy_lessons') return;
    setNotice('');
    setEditingId(row.id);
    setTitle(row.title || '');
    setDescription(row.description || '');
    setLoadingComposition(true);
    setOpen(true);
    try {
      const data = await loadLessonComposition(row.id);
      const list = Array.isArray(data?.items) ? data.items : [];
      setItems(
        list.map((x) => ({
          type: x.type,
          id: Number(x.id),
          title: x.title || `${typeLabel(x.type)} #${x.id}`,
        })),
      );
    } catch (e) {
      setNotice(e.message || 'Could not load lesson content');
      setItems([]);
    } finally {
      setLoadingComposition(false);
    }
  }

  function closeModal() {
    if (saving) return;
    setOpen(false);
    resetForm();
  }

  function addSelectedItem() {
    const id = Number(addId);
    if (!Number.isFinite(id)) return;
    const opt = pickOptions.find((o) => o.value === String(id));
    const label = opt?.label || `${typeLabel(addType)} #${id}`;
    const key = `${addType}:${id}`;
    if (items.some((x) => `${x.type}:${x.id}` === key)) return;
    setItems((prev) => [...prev, { type: addType, id, title: label }]);
    setAddId('');
  }

  function removeItem(idx) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function onDragStart(idx) {
    setDragIndex(idx);
  }

  function onDragOver(e) {
    e.preventDefault();
  }

  function onDrop(idx) {
    if (dragIndex == null || dragIndex === idx) {
      setDragIndex(null);
      return;
    }
    setItems((prev) => {
      const next = [...prev];
      const [row] = next.splice(dragIndex, 1);
      next.splice(idx, 0, row);
      return next;
    });
    setDragIndex(null);
  }

  async function submit(e) {
    e.preventDefault();
    const t = String(title || '').trim();
    if (!t) {
      window.alert('Enter a lesson title.');
      return;
    }
    setSaving(true);
    setNotice('');
    try {
      const payloadItems = items.map((x) => ({ type: x.type, id: x.id }));
      if (editingId == null) {
        const created = await onCreateLessonLibrary({ title: t, description });
        const newId = created?.id;
        if (!newId) throw new Error('Lesson was not created');
        await saveLessonComposition(newId, payloadItems);
      } else {
        await onUpdateLessonLibrary({ id: editingId, title: t, description });
        await saveLessonComposition(editingId, payloadItems);
      }
      setOpen(false);
      resetForm();
    } catch (err) {
      setNotice(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteLesson(id) {
    if (!window.confirm('Delete this lesson? Mapped course links and content order will be removed.')) return;
    try {
      await onDeleteLessonLibrary(id);
    } catch (e) {
      window.alert(e.message || 'Delete failed');
    }
  }

  return (
    <div className="stack">
      <SectionCard
        title="Lessons"
        subtitle="Compose lessons from library items — order matches what learners see"
        actions={
          <div className="lessonPageToolbar">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search lessons"
              className="lessonPageSearch"
              aria-label="Search lessons"
            />
            <button type="button" className="uploadPrimaryBtn" onClick={startNew}>
              + Create lesson
            </button>
          </div>
        }
      >
        <div className="tableWrap lessonLibraryTableWrap">
          <table className="lessonLibraryTable">
            <thead>
              <tr>
                <th>Title</th>
                <th>Description</th>
                <th>Items</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((l) => (
                <tr key={l.id}>
                  <td className="lessonLibraryTitleCell">{l.title}</td>
                  <td className="muted lessonLibraryDescCell">{l.description || '—'}</td>
                  <td>
                    <span className="lessonItemCountBadge">{Number(l.item_count) || 0}</span>
                  </td>
                  <td>
                    <div className="row studyMaterialRowActions">
                      <button type="button" className="secondaryBtn" onClick={() => startView(l)}>
                        View
                      </button>
                      <button type="button" className="secondaryBtn" onClick={() => startEdit(l)}>
                        Edit
                      </button>
                      <button type="button" className="dangerBtn" onClick={() => handleDeleteLesson(l.id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {paged.length === 0 ? <p className="muted lessonLibraryEmpty">No lessons yet. Create one to pull in library content.</p> : null}
        </div>
        <div className="row lessonLibraryPager">
          <button
            type="button"
            className="secondaryBtn"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Prev
          </button>
          <span className="muted">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="secondaryBtn"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      </SectionCard>

      {legacyLessons.length > 0 ? (
        <SectionCard title="Legacy course lessons" subtitle="Older per-course lesson rows (read-only). Prefer lesson library above.">
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {legacyLessons.slice(0, 15).map((l) => (
                  <tr key={l.id}>
                    <td>{l.title}</td>
                    <td className="muted">{l.description || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {legacyLessons.length > 15 ? (
              <p className="muted" style={{ marginTop: 8 }}>
                Showing 15 of {legacyLessons.length} legacy rows.
              </p>
            ) : null}
          </div>
        </SectionCard>
      ) : null}

      <Modal open={viewOpen} title="View lesson" onClose={closeView} variant="modal">
        {viewLoading ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="lessonViewBody">
            <h4 className="lessonViewTitle">{viewLesson?.title || 'Lesson'}</h4>
            {viewLesson?.description ? <p className="fieldHint">{viewLesson.description}</p> : null}
            <p className="fieldLabel" style={{ marginTop: 16, marginBottom: 8 }}>
              Content order ({viewItems.length})
            </p>
            {viewItems.length === 0 ? (
              <p className="muted">No library items in this lesson yet.</p>
            ) : (
              <ol className="lessonViewOrderedList">
                {viewItems.map((row, idx) => (
                  <li key={`${row.type}-${row.id}-${idx}`}>
                    <span className="lessonViewType">{typeLabel(row.type)}</span>
                    <span className="lessonViewItemTitle">{row.title}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={open}
        title={editingId == null ? 'Create lesson' : 'Edit lesson'}
        onClose={closeModal}
        variant="drawer"
      >
        <form className="lessonComposerForm" onSubmit={submit}>
          <div className="courseFormField">
            <label className="fieldLabel" htmlFor="lesson-title">
              Title
            </label>
            <input
              id="lesson-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Lesson title"
              required
              disabled={saving}
              autoComplete="off"
            />
          </div>
          <div className="courseFormField">
            <label className="fieldLabel" htmlFor="lesson-desc">
              Description
            </label>
            <textarea
              id="lesson-desc"
              className="courseTextarea"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary for admins and trainers"
              disabled={saving}
            />
          </div>

          <div className="lessonComposerSection">
            <div className="lessonComposerSectionHead">
              <h4 className="lessonComposerSectionTitle">Lesson content</h4>
              <p className="fieldHint" style={{ marginTop: 0 }}>
                Drag rows to set order. Only published library items can be added.
              </p>
            </div>

            {loadingComposition ? (
              <p className="muted">Loading content…</p>
            ) : (
              <ul className="lessonContentList">
                {items.map((row, idx) => (
                  <li
                    key={`${row.type}-${row.id}-${idx}`}
                    className="lessonContentRow"
                    draggable
                    onDragStart={() => onDragStart(idx)}
                    onDragOver={onDragOver}
                    onDrop={() => onDrop(idx)}
                  >
                    <span className="lessonContentGrip" title="Drag to reorder">
                      ⋮⋮
                    </span>
                    <span className="lessonContentOrder">{idx + 1}</span>
                    <span className="lessonContentType">{typeLabel(row.type)}</span>
                    <span className="lessonContentTitle">{row.title}</span>
                    <button
                      type="button"
                      className="secondaryBtn lessonContentRemove"
                      onClick={() => removeItem(idx)}
                      disabled={saving}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="lessonAddRow">
              <select
                className="courseSelect"
                value={addType}
                onChange={(e) => setAddType(e.target.value)}
                disabled={saving}
                aria-label="Content type"
              >
                {TYPE_ORDER.map((t) => (
                  <option key={t} value={t}>
                    {typeLabel(t)}
                  </option>
                ))}
              </select>
              <select
                className="courseSelect lessonAddSelect"
                value={addId}
                onChange={(e) => setAddId(e.target.value)}
                disabled={saving || pickOptions.length === 0}
                aria-label="Library item"
              >
                <option value="">
                  {pickOptions.length === 0 ? 'No items available' : 'Choose item…'}
                </option>
                {pickOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button type="button" className="secondaryBtn" onClick={addSelectedItem} disabled={saving || !addId}>
                Add
              </button>
            </div>
          </div>

          {notice ? (
            <p className="studyAutosaveHint studyAutosaveHintError" style={{ marginTop: 8 }}>
              {notice}
            </p>
          ) : null}

          <div className="lessonComposerActions">
            <button type="button" className="secondaryBtn" onClick={closeModal} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="uploadPrimaryBtn" disabled={saving || loadingComposition}>
              {saving ? 'Saving…' : 'Save lesson'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
