import React, { useEffect, useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';
import Modal from '../components/Modal';
import RichTextField from '../components/RichTextField';
import ActionMenu from '../components/ActionMenu';

const emptyForm = {
  id: null,
  title: '',
  description: '',
  studyMaterialHtml: '',
  worksheetHtml: '',
  worksheetAnswerKeyHtml: '',
  assignmentTitle: '',
};

export default function LessonsPage({ onCreateLessonLibrary, onUpdateLessonLibrary, onDeleteLessonLibrary, library }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const filtered = useMemo(() => library.filter((l) => String(l.title || '').toLowerCase().includes(q.toLowerCase())), [library, q]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function startNew() {
    setForm(emptyForm);
    setOpen(true);
  }

  function editItem(item) {
    if (item.source === 'legacy_lessons') return;
    setForm({
      id: item.id,
      title: item.title || '',
      description: item.description || '',
      studyMaterialHtml: item.study_material_html || '',
      worksheetHtml: item.worksheet_html || '',
      worksheetAnswerKeyHtml: item.worksheet_answer_key_html || '',
      assignmentTitle: item.assignment_title || '',
    });
    setOpen(true);
  }

  async function submit(e) {
    e.preventDefault();
    if (form.id) {
      await onUpdateLessonLibrary(form);
    } else {
      await onCreateLessonLibrary(form);
    }
    setOpen(false);
    setForm(emptyForm);
  }

  async function duplicateItem(item) {
    if (item.source === 'legacy_lessons') return;
    await onCreateLessonLibrary({
      title: `${item.title || 'Untitled'} (Copy)`,
      description: item.description || '',
      studyMaterialHtml: item.study_material_html || '',
      worksheetHtml: item.worksheet_html || '',
      worksheetAnswerKeyHtml: item.worksheet_answer_key_html || '',
      assignmentTitle: item.assignment_title || '',
    });
  }

  return (
    <div className="stack">
      <SectionCard
        title="Lesson Library"
        subtitle="Reusable templates and legacy lessons"
        actions={
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lessons" />
            <button onClick={startNew}>+ New Template</button>
          </>
        }
      >
        <div className="tableWrap">
          <table>
            <thead><tr><th>Title</th><th>Description</th><th>Source</th><th>Actions</th></tr></thead>
            <tbody>
              {paged.map((l) => (
                <tr key={l.id}>
                  <td>{l.title}</td>
                  <td>
                    {l.description || '-'}
                    {l.video_url ? <div className="muted">Video: available</div> : <div className="muted">Video: none</div>}
                  </td>
                  <td><span className={`badge ${l.source === 'legacy_lessons' ? 'inactive' : 'active'}`}>{l.source || 'lesson_library'}</span></td>
                  <td>
                    {l.source === 'legacy_lessons' ? (
                      <span className="muted">Read-only</span>
                    ) : (
                      <ActionMenu>
                        <button className="secondaryBtn" onClick={() => editItem(l)}>Edit</button>
                        <button className="secondaryBtn" onClick={() => duplicateItem(l)}>Duplicate</button>
                        <button className="dangerBtn" onClick={() => onDeleteLessonLibrary(l.id)}>Delete</button>
                      </ActionMenu>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button className="secondaryBtn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Prev</button>
          <span className="muted">Page {page} of {totalPages}</span>
          <button className="secondaryBtn" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</button>
        </div>
      </SectionCard>
      <Modal open={open} title={form.id ? 'Edit Lesson Template' : 'Create Lesson Template'} onClose={() => setOpen(false)} variant="drawer">
        <form onSubmit={submit} className="formGrid">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Lesson title" required />
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Description" />
          <div>
            <label>Study Material</label>
            <RichTextField value={form.studyMaterialHtml} onChange={(v) => setForm({ ...form, studyMaterialHtml: v })} />
          </div>
          <div>
            <label>Worksheet</label>
            <RichTextField value={form.worksheetHtml} onChange={(v) => setForm({ ...form, worksheetHtml: v })} />
          </div>
          <div>
            <label>Worksheet Answer Key</label>
            <RichTextField value={form.worksheetAnswerKeyHtml} onChange={(v) => setForm({ ...form, worksheetAnswerKeyHtml: v })} />
          </div>
          <input value={form.assignmentTitle} onChange={(e) => setForm({ ...form, assignmentTitle: e.target.value })} placeholder="Assignment title" />
          <button type="submit">{form.id ? 'Update' : 'Create'}</button>
        </form>
      </Modal>
    </div>
  );
}
