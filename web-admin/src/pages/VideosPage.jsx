import React, { useEffect, useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';
import ActionMenu from '../components/ActionMenu';
import TransferOwnerControl from '../components/TransferOwnerControl';

function isLinkedToLesson(video) {
  return Number(video?.lesson_link_count) > 0;
}

export default function VideosPage({
  videos,
  categories,
  showCreatedBy = false,
  libraryCanMutate = () => true,
  videoUploadJob = null,
  onStartVideoUpload,
  onStopVideoUpload,
  onDiscardVideoUpload,
  onUpdateVideo,
  onDeleteVideo,
  staffUsers = [],
  onTransferOwner,
}) {
  const fileInputRef = React.useRef(null);
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [categoryId, setCategoryId] = useState('');
  const [processingSeconds, setProcessingSeconds] = useState(0);
  const [formError, setFormError] = useState('');
  const [deletingId, setDeletingId] = useState(null);

  const uploadPhase = videoUploadJob?.phase || 'idle';
  const uploadProgress = Number(videoUploadJob?.progress) || 0;
  const uploadMessage = videoUploadJob?.message || '';
  const uploadError = videoUploadJob?.error || formError;
  const uploading = uploadPhase === 'uploading' || uploadPhase === 'processing';

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return videos || [];
    return (videos || []).filter((v) => {
      const t = String(v.title || '').toLowerCase();
      const desc = String(v.description || '').toLowerCase();
      const cat = String(v.category_name || '').toLowerCase();
      return t.includes(needle) || desc.includes(needle) || cat.includes(needle);
    });
  }, [videos, q]);

  useEffect(() => {
    if (uploadPhase !== 'processing') {
      setProcessingSeconds(0);
      return undefined;
    }
    const timer = setInterval(() => setProcessingSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [uploadPhase]);

  const prevJobRef = React.useRef(videoUploadJob);
  // Reset form when upload completes or the job is cleared (Discard from this page or global bar).
  useEffect(() => {
    const prev = prevJobRef.current;
    prevJobRef.current = videoUploadJob;
    const completedReset =
      videoUploadJob?.formResetToken &&
      videoUploadJob.formResetToken !== prev?.formResetToken;
    const discarded = Boolean(prev) && videoUploadJob == null;
    if (!completedReset && !discarded) return;
    setTitle('');
    setDescription('');
    setCategoryId('');
    clearSelectedFile();
    setFormError('');
  }, [videoUploadJob]);

  function createVideo(e) {
    e.preventDefault();
    if (!videoFile) return;
    if (!categoryId) {
      setFormError('Please select a category');
      return;
    }
    setFormError('');
    onStartVideoUpload?.({
      title,
      description,
      categoryId: Number(categoryId),
      file: videoFile,
    });
  }

  async function saveMeta(video) {
    const nextTitle = window.prompt('Video title', video.title || '');
    if (nextTitle == null) return;
    const nextDesc = window.prompt('Video description', video.description || '');
    if (nextDesc == null) return;
    await onUpdateVideo(video.id, { title: nextTitle, description: nextDesc });
  }

  async function removeVideo(video) {
    if (!libraryCanMutate(video)) return;
    if (isLinkedToLesson(video)) {
      window.alert('This video is attached to a lesson. Remove it from the lesson first, then delete.');
      return;
    }
    if (!window.confirm(`Delete “${video.title || 'this video'}”? This cannot be undone.`)) return;
    setDeletingId(video.id);
    try {
      await onDeleteVideo(video.id);
    } catch (err) {
      window.alert(err?.message || 'Could not delete video');
    } finally {
      setDeletingId(null);
    }
  }

  const fileInfo = useMemo(() => {
    if (!videoFile) return null;
    const sizeMb = (videoFile.size / (1024 * 1024)).toFixed(2);
    return `${videoFile.name} • ${sizeMb} MB`;
  }, [videoFile]);

  function clearSelectedFile() {
    setVideoFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  function handleDiscard() {
    onDiscardVideoUpload?.();
    setTitle('');
    setDescription('');
    setCategoryId('');
    clearSelectedFile();
    setFormError('');
  }

  return (
    <div className="stack">
      <SectionCard title="Video Library" subtitle="Reusable uploaded videos stored in DO Spaces">
        <form className="videoUploaderForm" onSubmit={createVideo}>
          <div className="videoUploaderField">
            <label className="fieldLabel">Video title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter a clear lesson video title"
              required
              disabled={uploading}
            />
          </div>
          <div className="videoUploaderField">
            <label className="fieldLabel">Description</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional summary"
              disabled={uploading}
            />
          </div>
          <div className="videoUploaderField">
            <label className="fieldLabel">Category (mandatory)</label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
              disabled={uploading}
            >
              <option value="">Select category</option>
              {(categories || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className={`videoDropZone ${videoFile ? 'hasFile' : ''}`}>
            <label className="fieldLabel">Upload video</label>
            <p className="fieldHint">
              MP4/MOV recommended. Upload continues if you leave this page — use Stop or Discard anytime.
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
              required={!uploading}
              disabled={uploading}
            />
            {fileInfo ? (
              <div className="videoFileChip">
                <span>{fileInfo}</span>
                <button
                  type="button"
                  className="fileChipClearBtn"
                  onClick={clearSelectedFile}
                  disabled={uploading}
                  aria-label="Clear selected file"
                  title="Clear selected file"
                >
                  x
                </button>
              </div>
            ) : (
              <div className="videoDropHint">Choose a file to begin</div>
            )}
          </div>

          {uploadPhase !== 'idle' && videoUploadJob ? (
            <div className="uploadStatusCard">
              <div className="uploadStatusRow">
                <span>{uploadMessage}</span>
                <strong>{uploadProgress}%</strong>
              </div>
              <div className="uploadProgressTrack">
                <div className={`uploadProgressBar ${uploadPhase}`} style={{ width: `${uploadProgress}%` }} />
              </div>
              {uploadPhase === 'processing' ? (
                <div className="fieldHint">
                  Final cloud processing in progress… {processingSeconds}s elapsed.
                </div>
              ) : null}
              {uploadError ? <div className="uploadErrorText">{uploadError}</div> : null}
              <div className="videoUploadActionRow">
                {uploading ? (
                  <button type="button" className="secondaryBtn" onClick={() => onStopVideoUpload?.()}>
                    Stop uploading
                  </button>
                ) : null}
                <button type="button" className="dangerBtn" onClick={handleDiscard}>
                  Discard
                </button>
              </div>
            </div>
          ) : null}

          <button type="submit" disabled={uploading || !videoFile} className="uploadPrimaryBtn">
            {uploading
              ? uploadPhase === 'processing'
                ? 'Processing…'
                : 'Uploading…'
              : 'Upload Video'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Uploaded Videos" subtitle="Searchable gallery with quick previews">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by title, description, or category"
        />
        <div className="videoGalleryGrid">
          {filtered.map((v) => {
            const linkedToLesson = isLinkedToLesson(v);
            const canMutate = libraryCanMutate(v);
            return (
              <article key={v.id} className="videoCard">
                <video className="videoPreviewPlayer" src={v.video_url} controls preload="metadata" />
                <div className="videoCardBody">
                  <h4>{v.title}</h4>
                  <p>{v.description || 'No description'}</p>
                  <div className="videoMetaRow">
                    <span className="videoTag">{v.category_name || 'Uncategorized'}</span>
                    <span>{v.assignment_count || 0} linked</span>
                    {showCreatedBy ? (
                      <span className="muted">By {v.creator_name || `#${v.created_by}` || '—'}</span>
                    ) : null}
                  </div>
                  {canMutate ? (
                    <div className="videoCardActions">
                      <ActionMenu>
                        <button className="secondaryBtn" onClick={() => saveMeta(v)}>
                          Edit title / description
                        </button>
                      </ActionMenu>
                      <button
                        type="button"
                        className="dangerBtn"
                        disabled={linkedToLesson || deletingId === v.id}
                        title={
                          linkedToLesson
                            ? 'Remove this video from its lesson before deleting'
                            : 'Delete video'
                        }
                        onClick={() => void removeVideo(v)}
                      >
                        {deletingId === v.id ? 'Deleting…' : 'Delete'}
                      </button>
                      {linkedToLesson ? (
                        <span className="fieldHint">Attached to a lesson — unlink to delete</span>
                      ) : null}
                    </div>
                  ) : null}
                  {onTransferOwner ? (
                    <TransferOwnerControl
                      itemType="video"
                      itemId={v.id}
                      staffUsers={staffUsers}
                      onTransfer={onTransferOwner}
                    />
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
