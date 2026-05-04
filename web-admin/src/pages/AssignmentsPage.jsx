import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';
import RichTextField from '../components/RichTextField';

function snippet(text, max = 96) {
  const t = String(text || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t || '—';
  return `${t.slice(0, max)}…`;
}

function formatWhen(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '—';
  }
}

export default function AssignmentsPage({
  assignments,
  showCreatedBy = false,
  libraryCanMutate = () => true,
  loadAssignment,
  createAssignment,
  updateAssignment,
  deleteAssignment,
}) {
  const [q, setQ] = useState('');
  const [viewingId, setViewingId] = useState(null);
  const [viewDetail, setViewDetail] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorId, setEditorId] = useState(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorNotice, setEditorNotice] = useState('');

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return assignments || [];
    return (assignments || []).filter((a) => {
      const t = String(a.title || '').toLowerCase();
      const d = String(a.description || '').toLowerCase();
      return t.includes(needle) || d.includes(needle);
    });
  }, [assignments, q]);

  const fetchOne = useCallback(
    async (id) => loadAssignment(id),
    [loadAssignment],
  );

  useEffect(() => {
    if (!viewingId) {
      setViewDetail(null);
      return undefined;
    }
    let cancelled = false;
    setViewLoading(true);
    fetchOne(viewingId)
      .then((row) => {
        if (!cancelled) setViewDetail(row);
      })
      .catch(() => {
        if (!cancelled) setViewDetail(null);
      })
      .finally(() => {
        if (!cancelled) setViewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [viewingId, fetchOne]);

  function openCreate() {
    setEditorNotice('');
    setEditorId(null);
    setTitle('');
    setDescription('');
    setContentHtml('');
    setEditorOpen(true);
  }

  async function openEdit(id) {
    setEditorNotice('');
    setEditorId(id);
    setEditorOpen(true);
    setEditorLoading(true);
    try {
      const row = await fetchOne(id);
      setTitle(row.title || '');
      setDescription(row.description || '');
      setContentHtml(row.content_html || '');
    } catch (e) {
      setEditorNotice(e.message || 'Could not load');
      setEditorOpen(false);
    } finally {
      setEditorLoading(false);
    }
  }

  function resetEditorPanel() {
    setEditorOpen(false);
    setEditorId(null);
    setEditorNotice('');
  }

  const closeEditor = useCallback(() => {
    if (editorSaving) return;
    resetEditorPanel();
  }, [editorSaving]);

  useEffect(() => {
    if (!editorOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') closeEditor();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editorOpen, closeEditor]);

  async function persist(payload) {
    setEditorSaving(true);
    setEditorNotice('');
    try {
      if (editorId == null) await createAssignment(payload);
      else await updateAssignment(editorId, payload);
      resetEditorPanel();
    } catch (e) {
      setEditorNotice(e.message || 'Save failed');
    } finally {
      setEditorSaving(false);
    }
  }

  async function saveDraft() {
    const t = String(title || '').trim() || 'Untitled draft';
    await persist({
      title: t,
      description,
      contentHtml,
      isDraft: true,
    });
  }

  async function publish() {
    const t = String(title || '').trim();
    if (!t) {
      window.alert('Enter a title before publishing.');
      return;
    }
    await persist({
      title: t,
      description,
      contentHtml,
      isDraft: false,
    });
  }

  async function removeRow(id) {
    if (!window.confirm('Delete this assignment from the library? This cannot be undone.')) return;
    try {
      await deleteAssignment(id);
      if (viewingId === id) setViewingId(null);
    } catch (e) {
      window.alert(e.message || 'Could not delete');
    }
  }

  return (
    <div className="stack">
      <SectionCard
        title="Assignment Library"
        subtitle="Short homework briefs with rich text — title, description, and instructions for learners"
      >
        <div className="assignmentLibraryToolbar">
          <input
            className="assignmentLibrarySearch"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title or description"
            aria-label="Search assignments"
          />
          <button type="button" className="uploadPrimaryBtn" onClick={openCreate}>
            + New assignment
          </button>
        </div>

        <div className="tableWrap">
          <table className="assignmentLibraryTable">
            <thead>
              <tr>
                <th>Title</th>
                <th>Description</th>
                {showCreatedBy ? <th>Created by</th> : null}
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const isDraft = Number(a.is_draft) === 1;
                return (
                  <tr key={a.id}>
                    <td className="assignmentLibraryTitleCell">{a.title || '—'}</td>
                    <td className="muted assignmentLibraryDescCell">{snippet(a.description)}</td>
                    {showCreatedBy ? <td>{a.creator_name || `#${a.created_by}` || '—'}</td> : null}
                    <td>
                      {isDraft ? <span className="studyDraftBadge">Draft</span> : <span className="muted">Published</span>}
                    </td>
                    <td className="muted assignmentLibraryDateCell">{formatWhen(a.updated_at)}</td>
                    <td>
                      <div className="row studyMaterialRowActions">
                        <button type="button" className="secondaryBtn" onClick={() => setViewingId(a.id)}>
                          View
                        </button>
                        {libraryCanMutate(a) ? (
                          <>
                            <button type="button" className="secondaryBtn" onClick={() => openEdit(a.id)}>
                              Edit
                            </button>
                            <button type="button" className="dangerBtn" onClick={() => removeRow(a.id)}>
                              Delete
                            </button>
                          </>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 ? <p className="muted assignmentLibraryEmpty">No assignments match your search.</p> : null}
        </div>
      </SectionCard>

      {viewingId ? (
        <div
          className="studyViewOverlay"
          role="presentation"
          onClick={() => setViewingId(null)}
        >
          <div
            className="studyViewModal assignmentViewModal"
            role="dialog"
            aria-labelledby="assignment-view-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modalHead">
              <h3 id="assignment-view-title">{viewLoading ? 'Loading…' : viewDetail?.title || 'Assignment'}</h3>
              <button type="button" className="secondaryBtn" onClick={() => setViewingId(null)}>
                Close
              </button>
            </div>
            {viewLoading ? (
              <p className="muted">Loading assignment…</p>
            ) : viewDetail ? (
              <>
                {viewDetail.description ? (
                  <p className="fieldHint" style={{ marginTop: 0 }}>
                    {viewDetail.description}
                  </p>
                ) : null}
                {Number(viewDetail.is_draft) === 1 ? (
                  <p className="studyDraftBanner">This assignment is a draft and is hidden from learners until published.</p>
                ) : null}
                <div
                  className="studyViewPreviewWrap assignmentViewHtml"
                  dangerouslySetInnerHTML={{ __html: viewDetail.content_html || '' }}
                />
                <div className="row" style={{ marginTop: 12 }}>
                  {libraryCanMutate(viewDetail) ? (
                    <>
                      <button
                        type="button"
                        className="secondaryBtn"
                        onClick={() => {
                          const id = viewDetail.id;
                          setViewingId(null);
                          openEdit(id);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="dangerBtn"
                        onClick={async () => {
                          await removeRow(viewDetail.id);
                          setViewingId(null);
                        }}
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <p className="muted" style={{ margin: 0 }}>
                      You can view this assignment; only the author or staff can edit or delete it.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <p className="muted">Could not load this assignment.</p>
            )}
          </div>
        </div>
      ) : null}

      {editorOpen ? (
        <div className="modalOverlay" role="presentation" onClick={() => closeEditor()}>
          <div
            className="modalCard assignmentLibraryModal"
            role="dialog"
            aria-labelledby="assignment-editor-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modalHead">
              <h3 id="assignment-editor-title">{editorId == null ? 'New assignment' : 'Edit assignment'}</h3>
              <button type="button" className="secondaryBtn" onClick={closeEditor} disabled={editorSaving}>
                Cancel
              </button>
            </div>

            {editorLoading ? (
              <p className="muted">Loading…</p>
            ) : (
              <form
                className="assignmentEditorForm"
                onSubmit={(e) => {
                  e.preventDefault();
                  publish();
                }}
              >
                <div className="courseFormField">
                  <label className="fieldLabel" htmlFor="assignment-title">
                    Title
                  </label>
                  <input
                    id="assignment-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Assignment title"
                    autoComplete="off"
                  />
                  <p className="fieldHint">Required to publish. Drafts may use “Untitled draft” until you name it.</p>
                </div>

                <div className="courseFormField">
                  <label className="fieldLabel" htmlFor="assignment-desc">
                    Description
                  </label>
                  <textarea
                    id="assignment-desc"
                    className="courseTextarea"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief summary (optional) — shown in lists and alongside the title"
                  />
                </div>

                <div className="courseFormField">
                  <label className="fieldLabel">Assignment content</label>
                  <p className="fieldHint">Instructions, tasks, links, and formatting for learners.</p>
                  <RichTextField value={contentHtml} onChange={setContentHtml} />
                </div>

                {editorNotice ? (
                  <p className="studyAutosaveHint studyAutosaveHintError" style={{ marginTop: 8 }}>
                    {editorNotice}
                  </p>
                ) : null}

                <div className="assignmentEditorActions">
                  <button
                    type="button"
                    className="studySaveDraftCloseBtn"
                    disabled={editorSaving}
                    onClick={() => saveDraft()}
                  >
                    Save draft &amp; close
                  </button>
                  <button type="submit" className="uploadPrimaryBtn" disabled={editorSaving}>
                    Publish
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
