import React, { useCallback, useEffect, useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';
import RichTextField from '../components/RichTextField';
import TransferOwnerControl from '../components/TransferOwnerControl';
import MediaPreview from '../components/MediaPreview';
import { responseTypeLabel } from '../utils/assignmentLabels';

const RESPONSE_TYPES = [
  { id: 'text', label: 'Write' },
  { id: 'image', label: 'Photo' },
  { id: 'video', label: 'Video' },
  { id: 'file', label: 'File' },
  { id: 'voice', label: 'Voice note' },
  { id: 'other', label: 'Check-in' },
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
  libraryCanSharePublic = () => false,
  loadAssignment,
  createAssignment,
  updateAssignment,
  deleteAssignment,
  uploadAssignmentAsset,
  deleteAssignmentAsset,
  staffUsers = [],
  onTransferOwner,
  embedded = false,
}) {
  const [q, setQ] = useState('');
  const [viewingId, setViewingId] = useState(null);
  const [viewDetail, setViewDetail] = useState(null);
  const [viewLoading, setViewLoading] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editorId, setEditorId] = useState(null);
  const [editorLoading, setEditorLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [responseType, setResponseType] = useState('file');
  const [headerType, setHeaderType] = useState('text');
  const [headerText, setHeaderText] = useState('');
  const [headerUrl, setHeaderUrl] = useState('');
  const [headerFileName, setHeaderFileName] = useState('');
  const [headerAssetId, setHeaderAssetId] = useState(null);
  const [assets, setAssets] = useState([]);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorNotice, setEditorNotice] = useState('');
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [togglingPublicId, setTogglingPublicId] = useState(null);
  const [creatingDraft, setCreatingDraft] = useState(false);
  const createDraftInFlightRef = React.useRef(false);
  const createSessionRef = React.useRef(0);

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
    if (!headerUrl) return { type: headerType, text: headerText };
    return {
      type: headerType,
      url: headerUrl,
      text: headerText,
      assetId: headerAssetId != null ? Number(headerAssetId) : undefined,
    };
  }

  function fileLabelFromUrl(url) {
    try {
      const path = String(url || '').split('?')[0];
      const name = path.split('/').pop() || '';
      return decodeURIComponent(name).slice(0, 80) || 'Uploaded file';
    } catch {
      return 'Uploaded file';
    }
  }

  async function openCreate() {
    if (createDraftInFlightRef.current) return;
    createDraftInFlightRef.current = true;
    createSessionRef.current += 1;
    const session = createSessionRef.current;
    setEditorNotice('');
    setEditorId(null);
    setTitle('');
    setContentHtml('');
    setResponseType('file');
    setHeaderType('text');
    setHeaderText('');
    setHeaderUrl('');
    setHeaderFileName('');
    setHeaderAssetId(null);
    setAssets([]);
    setUploadProgress(null);
    setEditorOpen(true);
    setCreatingDraft(true);
    try {
      const created = await createAssignment({
        header: { type: 'text', text: '' },
        contentHtml: '',
        responseType: 'file',
        recurrence: null,
        isDraft: true,
        label: 'Untitled draft',
      });
      if (createSessionRef.current !== session) return;
      const id = Number(created?.id);
      if (!Number.isFinite(id)) throw new Error('Could not create draft');
      setEditorId(id);
    } catch (e) {
      if (createSessionRef.current === session) {
        setEditorNotice(e.message || 'Could not create draft');
        setEditorOpen(false);
      }
    } finally {
      createDraftInFlightRef.current = false;
      if (createSessionRef.current === session) setCreatingDraft(false);
    }
  }

  async function openEdit(id) {
    setEditorNotice('');
    setEditorId(id);
    setEditorOpen(true);
    setEditorLoading(true);
    try {
      const row = await fetchOne(id);
      setTitle(row.label || row.title || row.displayLabel || '');
      setContentHtml(row.content_html || '');
      setResponseType(row.response_type || 'file');
      const h = row.header || {};
      setHeaderType(h.type || 'text');
      setHeaderText(h.text || h.title || '');
      setHeaderUrl(h.url || '');
      setHeaderFileName(h.url ? fileLabelFromUrl(h.url) : '');
      setHeaderAssetId(h.assetId != null ? Number(h.assetId) : null);
      setAssets(Array.isArray(row.assets) ? row.assets : []);
      setUploadProgress(null);
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

  function detectAssetType(file, preferred) {
    const ext = (file?.name || '').split('.').pop()?.toLowerCase() || '';
    if (preferred && preferred !== 'link' && preferred !== 'text') {
      if (preferred === 'image' && ext === 'gif') return 'gif';
      return preferred;
    }
    if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return ext === 'gif' ? 'gif' : 'image';
    if (['mp4', 'mov', 'webm'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return 'audio';
    if (ext === 'pdf') return 'pdf';
    return 'file';
  }

  function acceptForHeaderType(type) {
    if (type === 'image') return 'image/*,.gif,.png,.jpg,.jpeg,.webp';
    if (type === 'video') return 'video/*,.mp4,.mov,.webm';
    if (type === 'audio') return 'audio/*,.mp3,.wav,.m4a,.aac';
    if (type === 'pdf') return 'application/pdf,.pdf';
    return '*/*';
  }

  /** Ensure a draft row exists so Spaces uploads have an assignment id. */
  async function ensureDraftId() {
    if (editorId != null) return editorId;
    if (creatingDraft || createDraftInFlightRef.current) {
      throw new Error('Draft is still being created — try again in a moment');
    }
    const created = await createAssignment({
      header: buildHeader(),
      contentHtml,
      responseType,
      recurrence: null,
      isDraft: true,
      label:
        title.trim() ||
        (headerType === 'text' ? headerText : headerText || headerFileName) ||
        'Untitled draft',
    });
    const id = Number(created?.id);
    if (!Number.isFinite(id)) throw new Error('Could not create draft for upload');
    setEditorId(id);
    return id;
  }

  async function persist(isDraft) {
    setEditorSaving(true);
    setEditorNotice('');
    try {
      const payload = {
        header: buildHeader(),
        contentHtml,
        responseType,
        recurrence: null,
        isDraft,
        label:
          title.trim() ||
          (headerType === 'text' ? headerText : headerText || headerFileName) ||
          (isDraft ? 'Untitled draft' : 'Assignment'),
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

  async function togglePublic(a) {
    if (!a?.id || Number(a.is_draft) === 1) return;
    if (!libraryCanSharePublic(a)) return;
    const next = Number(a.is_public) !== 1;
    setTogglingPublicId(a.id);
    try {
      await updateAssignment(a.id, { isPublic: next });
    } catch (e) {
      window.alert(e.message || 'Could not update public sharing');
    } finally {
      setTogglingPublicId(null);
    }
  }

  async function uploadFileToAssignment(file, preferredType) {
    if (!file || !uploadAssignmentAsset) throw new Error('Upload not available');
    const id = await ensureDraftId();
    const assetType = detectAssetType(file, preferredType);
    setUploadProgress(0);
    const asset = await uploadAssignmentAsset(id, file, assetType, (pct) => setUploadProgress(pct));
    setAssets((prev) => [...prev, asset]);
    setUploadProgress(100);
    return asset;
  }

  async function onHeaderFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAsset(true);
    setUploadProgress(0);
    setEditorNotice('');
    try {
      const asset = await uploadFileToAssignment(file, headerType);
      setHeaderUrl(asset.url || '');
      setHeaderFileName(file.name || fileLabelFromUrl(asset.url));
      setHeaderAssetId(asset.id != null ? Number(asset.id) : null);
      if (!headerText) setHeaderText(file.name || '');
    } catch (err) {
      setEditorNotice(err.message || 'Header upload failed');
      setUploadProgress(null);
    } finally {
      setUploadingAsset(false);
      window.setTimeout(() => setUploadProgress(null), 600);
    }
  }

  async function onAttachFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingAsset(true);
    setUploadProgress(0);
    setEditorNotice('');
    try {
      await uploadFileToAssignment(file, null);
    } catch (err) {
      setEditorNotice(err.message || 'Upload failed');
      setUploadProgress(null);
    } finally {
      setUploadingAsset(false);
      window.setTimeout(() => setUploadProgress(null), 600);
    }
  }

  function clearHeaderUpload() {
    setHeaderUrl('');
    setHeaderFileName('');
    setHeaderAssetId(null);
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

  const body = (
      <>
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
                <th>Attachments</th>
                {showCreatedBy ? <th>Created by</th> : null}
                <th>Status</th>
                <th>Updated</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const isDraft = Number(a.is_draft) === 1;
                const shared = Number(a.is_public) === 1;
                const assetCount = Array.isArray(a.assets)
                  ? a.assets.length
                  : Number(a.asset_count) || 0;
                return (
                  <tr key={a.id}>
                    <td className="assignmentLibraryTitleCell">{displayName(a)}</td>
                    <td>
                      <strong>{responseTypeLabel(a.response_type)}</strong>
                    </td>
                    <td className="muted">
                      {assetCount > 0 ? `${assetCount} attachment${assetCount === 1 ? '' : 's'}` : '—'}
                    </td>
                    {showCreatedBy ? <td>{a.creator_name || `#${a.created_by}` || '—'}</td> : null}
                    <td>
                      {isDraft ? (
                        <span className="studyDraftBadge">Draft</span>
                      ) : (
                        <div className="assignmentStatusCell">
                          <span className={shared ? 'studyPublicBadge' : 'muted'}>
                            {shared ? 'Public' : 'Published'}
                          </span>
                          {libraryCanSharePublic(a) ? (
                            <label className="assignmentPublicToggle">
                              <input
                                type="checkbox"
                                checked={shared}
                                disabled={togglingPublicId === a.id}
                                onChange={() => void togglePublic(a)}
                              />
                              Share with trainers
                            </label>
                          ) : null}
                        </div>
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
                  Response type: <strong>{responseTypeLabel(viewDetail.response_type)}</strong>
                </p>
                {Number(viewDetail.is_draft) === 1 ? (
                  <p className="studyDraftBanner">Draft — hidden from learners until published.</p>
                ) : null}
                {Number(viewDetail.is_public) === 1 && Number(viewDetail.is_draft) !== 1 ? (
                  <p className="fieldHint">Public — any trainer can view and assign this to their batches.</p>
                ) : null}
                {viewDetail.header?.type === 'text' && viewDetail.header?.text ? (
                  <p style={{ fontWeight: 700, fontSize: 16 }}>{viewDetail.header.text}</p>
                ) : null}
                {viewDetail.header?.url ? (
                  <div style={{ marginBottom: 12 }}>
                    <p className="muted" style={{ marginBottom: 4 }}>
                      Header ({viewDetail.header.type})
                      {viewDetail.header.title ? ` — ${viewDetail.header.title}` : ''}
                    </p>
                    <MediaPreview
                      url={viewDetail.header.url}
                      typeHint={viewDetail.header.type}
                      title={viewDetail.header.title || 'Header media'}
                      maxHeight={140}
                    />
                  </div>
                ) : null}
                <div
                  className="studyViewPreviewWrap assignmentViewHtml"
                  dangerouslySetInnerHTML={{ __html: viewDetail.content_html || '' }}
                />
                {Array.isArray(viewDetail.assets) && viewDetail.assets.length ? (
                  <div style={{ marginTop: 14 }}>
                    <p className="fieldLabel">Attachments</p>
                    <div style={{ display: 'grid', gap: 12 }}>
                      {viewDetail.assets.map((a) => (
                        <div key={a.id}>
                          <div className="muted" style={{ marginBottom: 4 }}>
                            {a.asset_type}
                          </div>
                          {a.url ? (
                            <MediaPreview url={a.url} typeHint={a.asset_type} maxHeight={140} />
                          ) : (
                            '—'
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {viewDetail.recurrence?.frequency ? (
                  <p className="muted" style={{ marginTop: 12 }}>
                    Recurrence template: {viewDetail.recurrence.frequency}
                    {viewDetail.recurrence.count ? ` × ${viewDetail.recurrence.count}` : ''}
                  </p>
                ) : null}
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

            {editorLoading || creatingDraft ? (
              <p className="muted">{creatingDraft ? 'Creating draft…' : 'Loading…'}</p>
            ) : (
              <form
                className="assignmentEditorForm"
                onSubmit={(e) => {
                  e.preventDefault();
                  void persist(false);
                }}
              >
                <div className="courseFormField">
                  <label className="fieldLabel">Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Shown in lists, lessons, and My Assignments"
                    required
                  />
                </div>

                <div className="courseFormField">
                  <label className="fieldLabel">Header</label>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
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
                    {headerType === 'link' ? (
                      <input
                        style={{ flex: 1, minWidth: 180 }}
                        value={headerUrl}
                        onChange={(e) => setHeaderUrl(e.target.value)}
                        placeholder="https://…"
                      />
                    ) : null}
                    {headerType !== 'text' && headerType !== 'link' ? (
                      <label className="secondaryBtn" style={{ cursor: uploadingAsset ? 'wait' : 'pointer' }}>
                        {uploadingAsset
                          ? uploadProgress != null
                            ? `Uploading ${uploadProgress}%`
                            : 'Uploading…'
                          : 'Upload file'}
                        <input
                          type="file"
                          accept={acceptForHeaderType(headerType)}
                          onChange={onHeaderFile}
                          disabled={uploadingAsset || editorSaving}
                          style={{ display: 'none' }}
                        />
                      </label>
                    ) : null}
                  </div>
                  {headerType !== 'text' && headerType !== 'link' && headerUrl ? (
                    <div style={{ marginTop: 8 }}>
                      <div className="row" style={{ gap: 8, marginBottom: 6, alignItems: 'center' }}>
                        <span className="fieldHint">{headerFileName || 'Uploaded file'}</span>
                        <button
                          type="button"
                          className="dangerBtn"
                          onClick={clearHeaderUpload}
                          disabled={uploadingAsset || editorSaving}
                        >
                          Remove
                        </button>
                      </div>
                      <MediaPreview url={headerUrl} typeHint={headerType} title="Header media" maxHeight={120} />
                    </div>
                  ) : null}
                  {uploadingAsset && uploadProgress != null ? (
                    <div className="uploadProgressTrack" style={{ marginTop: 8 }}>
                      <div
                        className="uploadProgressBar"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  ) : null}
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
                  <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <label className="secondaryBtn" style={{ cursor: uploadingAsset ? 'wait' : 'pointer' }}>
                      {uploadingAsset
                        ? uploadProgress != null
                          ? `Uploading ${uploadProgress}%`
                          : 'Uploading…'
                        : 'Upload file'}
                      <input
                        type="file"
                        onChange={onAttachFile}
                        disabled={uploadingAsset || editorSaving}
                        style={{ display: 'none' }}
                      />
                    </label>
                    <span className="fieldHint">Images, video, audio, PDF, or any file.</span>
                  </div>
                  {uploadingAsset && uploadProgress != null ? (
                    <div className="uploadProgressTrack" style={{ marginTop: 8 }}>
                      <div className="uploadProgressBar" style={{ width: `${uploadProgress}%` }} />
                    </div>
                  ) : null}
                  {assets.length ? (
                    <ul className="muted" style={{ marginTop: 8, listStyle: 'none', padding: 0 }}>
                      {assets.map((a) => (
                        <li key={a.id} style={{ marginBottom: 12 }}>
                          <div className="row" style={{ gap: 8, marginBottom: 6, alignItems: 'center' }}>
                            <span>{a.asset_type}</span>
                            <button type="button" className="dangerBtn" onClick={() => removeAsset(a.id)}>
                              Remove
                            </button>
                          </div>
                          {a.url ? (
                            <MediaPreview url={a.url} typeHint={a.asset_type} maxHeight={120} />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="fieldHint" style={{ marginTop: 6 }}>
                      No attachments yet.
                    </p>
                  )}
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
      </>
  );

  if (embedded) {
    return <div className="stack assignLibraryEmbedded">{body}</div>;
  }

  return (
    <div className="stack">
      <SectionCard
        title="Assignment Library"
        subtitle="Title, header, instructions, attachments, and how learners respond"
      >
        {body}
      </SectionCard>
    </div>
  );
}
