import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';
import RichTextField from '../components/RichTextField';
import TransferOwnerControl from '../components/TransferOwnerControl';

const RESPONSE_TYPES = [
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'file', label: 'File' },
  { id: 'voice', label: 'Voice' },
  { id: 'other', label: 'Other (mark done)' },
];

const HEADER_TYPES = [
  { id: 'text', label: 'Text' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'pdf', label: 'PDF' },
  { id: 'file', label: 'File' },
  { id: 'link', label: 'Link' },
];

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

function displayName(a) {
  return a?.displayLabel || a?.label || a?.title || `Assignment #${a?.id || ''}`;
}

export default function AssignmentsPage({
  assignments,
  showCreatedBy = false,
  libraryCanMutate = () => true,
  loadAssignment,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  uploadAssignmentAsset,
  deleteAssignmentAsset,
  staffUsers = [],
  onTransferOwner,
}) {
  const [q, setQ] = useState('');
  const [viewingId, setViewingId] = useState(null);
  const [viewDetail, setViewDetail] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorId, setEditorId] = useState(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [contentHtml, setContentHtml] = useState('');
  const [responseType, setResponseType] = useState('file');
  const [headerType, setHeaderType] = useState('text');
  const [headerText, setHeaderText] = useState('');
  const [headerUrl, setHeaderUrl] = useState('');
  const [assets, setAssets] = useState([]);
  const [recurring, setRecurring] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState('weekly');
  const [recurrenceCount, setRecurrenceCount] = useState(4);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorNotice, setEditorNotice] = useState('');
  const [uploadingAsset, setUploadingAsset] = useState(false);

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return assignments || [];
    return (assignments || []).filter((a) => {
      const t = displayName(a).toLowerCase();
      const body = String(a.content_html || '').toLowerCase();
      return t.includes(needle) || body.includes(needle);
    });
  }, [assignments, q]);

  const fetchOne = useCallback(async (id) => loadAssignment(id), [loadAssignment]);

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

  function buildHeader() {
    if (headerType === 'text') return { type: 'text', text: headerText };
    if (headerType === 'link') return { type: 'link', url: headerUrl, title: headerText || headerUrl };
    return { type: headerType, url: headerUrl, text: headerText };
  }

  function buildRecurrence() {
    if (!recurring) return null;
    return {
      frequency: recurrenceFrequency,
      interval: 1,
      count: Number(recurrenceCount) || 1,
      byWeekday: recurrenceFrequency === 'weekly' ? [1, 2, 3, 4, 5] : undefined,
    };
  }

  function openCreate() {
    setEditorNotice('');
    setEditorId(null);
    setContentHtml('');
    setResponseType('file');
    setHeaderType('text');
    setHeaderText('');
    setHeaderUrl('');
    setAssets([]);
    setRecurring(false);
    setRecurrenceFrequency('weekly');
    setRecurrenceCount(4);
    setEditorOpen(true);
  }

  async function openEdit(id) {
    setEditorNotice('');
    setEditorId(id);
    setEditorOpen(true);
    setEditorLoading(true);
    try {
      const row = await fetchOne(id);
      setContentHtml(row.content_html || '');
      setResponseType(row.response_type || 'file');
      const h = row.header || {};
      setHeaderType(h.type || 'text');
      setHeaderText(h.text || h.title || '');
      setHeaderUrl(h.url || '');
      setAssets(Array.isArray(row.assets) ? row.assets : []);
      const rec = row.recurrence;
      setRecurring(Boolean(rec && rec.frequency));
      if (rec?.frequency) setRecurrenceFrequency(rec.frequency);
      if (rec?.count) setRecurrenceCount(rec.count);
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

  async function persist(isDraft) {
    setEditorSaving(true);
    setEditorNotice('');
    try {
      const payload = {
        header: buildHeader(),
        contentHtml,
        responseType,
        recurrence: buildRecurrence(),
        isDraft,
        label: headerType === 'text' ? headerText : headerText || headerUrl,
      };
      if (editorId == null) await createAssignment(payload);
      else await updateAssignment(editorId, payload);
      resetEditorPanel();
    } catch (e) {
      setEditorNotice(e.message || 'Save failed');
    } finally {
      setEditorSaving(false);
    }
  }

  async function onAttachFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || editorId == null || !uploadAssignmentAsset) {
      if (editorId == null) window.alert('Save a draft first, then attach files.');
      return;
    }
    const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';
    let assetType = 'file';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) assetType = ext === 'gif' ? 'gif' : 'image';
    else if (['mp4', 'mov', 'webm'].includes(ext)) assetType = 'video';
    else if (['mp3', 'wav', 'm4a', 'aac'].includes(ext)) assetType = 'audio';
    else if (ext === 'pdf') assetType = 'pdf';
    setUploadingAsset(true);
    try {
      const asset = await uploadAssignmentAsset(editorId, file, assetType);
      setAssets((prev) => [...prev, asset]);
    } catch (err) {
      window.alert(err.message || 'Upload failed');
    } finally {
      setUploadingAsset(false);
    }
  }

  async function removeAsset(assetId) {
    if (!deleteAssignmentAsset || editorId == null) return;
    try {
      await deleteAssignmentAsset(editorId, assetId);
      setAssets((prev) => prev.filter((a) => a.id !== assetId));
    } catch (err) {
      window.alert(err.message || 'Could not remove');
    }
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
        subtitle="Header, instructions, attachments, and how learners respond — no separate title field"
      >
        <div className="assignmentLibraryToolbar">
          <input
            className="assignmentLibrarySearch"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search assignments"
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
                <th>Assignment</th>
                <th>Response</th>
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
                    <td className="assignmentLibraryTitleCell">{displayName(a)}</td>
                    <td className="muted">{a.response_type || 'file'}</td>
                    {showCreatedBy ? <td>{a.creator_name || `#${a.created_by}` || '—'}</td> : null}
                    <td>
                      {isDraft ? (
                        <span className="studyDraftBadge">Draft</span>
                      ) : (
                        <span className="muted">Published</span>
                      )}
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
                        {onTransferOwner ? (
                          <TransferOwnerControl
                            itemType="assignment"
                            itemId={a.id}
                            staffUsers={staffUsers}
                            onTransfer={onTransferOwner}
                          />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 ? (
            <p className="muted assignmentLibraryEmpty">No assignments match your search.</p>
          ) : null}
        </div>
      </SectionCard>

      {viewingId ? (
        <div className="studyViewOverlay" role="presentation" onClick={() => setViewingId(null)}>
          <div
            className="studyViewModal assignmentViewModal"
            role="dialog"
            aria-labelledby="assignment-view-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modalHead">
              <h3 id="assignment-view-title">
                {viewLoading ? 'Loading…' : displayName(viewDetail) || 'Assignment'}
              </h3>
              <button type="button" className="secondaryBtn" onClick={() => setViewingId(null)}>
                Close
              </button>
            </div>
            {viewLoading ? (
              <p className="muted">Loading assignment…</p>
            ) : viewDetail ? (
              <>
                <p className="fieldHint" style={{ marginTop: 0 }}>
                  Response type: <strong>{viewDetail.response_type || 'file'}</strong>
                </p>
                {Number(viewDetail.is_draft) === 1 ? (
                  <p className="studyDraftBanner">Draft — hidden from learners until published.</p>
                ) : null}
                <div
                  className="studyViewPreviewWrap assignmentViewHtml"
                  dangerouslySetInnerHTML={{ __html: viewDetail.content_html || '' }}
                />
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
                  void persist(false);
                }}
              >
                <div className="courseFormField">
                  <label className="fieldLabel">Header</label>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                    <select value={headerType} onChange={(e) => setHeaderType(e.target.value)}>
                      {HEADER_TYPES.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.label}
                        </option>
                      ))}
                    </select>
                    {headerType === 'text' || headerType === 'link' ? (
                      <input
                        style={{ flex: 1, minWidth: 180 }}
                        value={headerText}
                        onChange={(e) => setHeaderText(e.target.value)}
                        placeholder={headerType === 'link' ? 'Link title (optional)' : 'Header text'}
                      />
                    ) : null}
                    {headerType !== 'text' ? (
                      <input
                        style={{ flex: 1, minWidth: 180 }}
                        value={headerUrl}
                        onChange={(e) => setHeaderUrl(e.target.value)}
                        placeholder="URL or uploaded asset URL"
                      />
                    ) : null}
                  </div>
                </div>

                <div className="courseFormField">
                  <label className="fieldLabel">Response type</label>
                  <select value={responseType} onChange={(e) => setResponseType(e.target.value)}>
                    {RESPONSE_TYPES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="courseFormField">
                  <label className="fieldLabel">Assignment content</label>
                  <RichTextField value={contentHtml} onChange={setContentHtml} />
                </div>

                <div className="courseFormField">
                  <label className="fieldLabel">Attachments</label>
                  {editorId == null ? (
                    <p className="fieldHint">Save a draft first to upload attachments.</p>
                  ) : (
                    <>
                      <input type="file" onChange={onAttachFile} disabled={uploadingAsset} />
                      <ul className="muted">
                        {assets.map((a) => (
                          <li key={a.id}>
                            {a.asset_type}: {a.url || '—'}{' '}
                            <button type="button" className="dangerBtn" onClick={() => removeAsset(a.id)}>
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>

                <div className="courseFormField">
                  <label className="fieldLabel">
                    <input
                      type="checkbox"
                      checked={recurring}
                      onChange={(e) => setRecurring(e.target.checked)}
                    />{' '}
                    Recurring template (used when setting for batches)
                  </label>
                  {recurring ? (
                    <div className="row" style={{ gap: 8, marginTop: 8 }}>
                      <select
                        value={recurrenceFrequency}
                        onChange={(e) => setRecurrenceFrequency(e.target.value)}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly (weekdays)</option>
                      </select>
                      <label>
                        Occurrences{' '}
                        <input
                          type="number"
                          min={1}
                          max={60}
                          value={recurrenceCount}
                          onChange={(e) => setRecurrenceCount(e.target.value)}
                          style={{ width: 64 }}
                        />
                      </label>
                    </div>
                  ) : null}
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
                    onClick={() => void persist(true)}
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
