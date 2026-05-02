import React, { useMemo, useState } from 'react';
import SectionCard from '../components/SectionCard';
import ActionMenu from '../components/ActionMenu';

export default function VideosPage({
  videos,
  categories,
  lessons,
  courses,
  showCreatedBy = false,
  libraryCanMutate = () => true,
  onCreateVideo,
  onUpdateVideo,
  onDeleteVideo,
  onAssignVideo,
}) {
  const fileInputRef = React.useRef(null);
  const [q, setQ] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [videoFile, setVideoFile] = useState(null);
  const [categoryId, setCategoryId] = useState('');
  const [assignVideoId, setAssignVideoId] = useState('');
  const [scopeType, setScopeType] = useState('lesson');
  const [scopeId, setScopeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [processingSeconds, setProcessingSeconds] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadState, setUploadState] = useState('idle');
  const [uploadMessage, setUploadMessage] = useState('');
  const [uploadError, setUploadError] = useState('');

  const filtered = useMemo(() => {
    const needle = q.toLowerCase().trim();
    if (!needle) return videos || [];
    return (videos || []).filter((v) => {
      const title = String(v.title || '').toLowerCase();
      const desc = String(v.description || '').toLowerCase();
      const cat = String(v.category_name || '').toLowerCase();
      return title.includes(needle) || desc.includes(needle) || cat.includes(needle);
    });
  }, [videos, q]);

  React.useEffect(() => {
    if (uploadState !== 'processing') {
      setProcessingSeconds(0);
      return undefined;
    }
    const timer = setInterval(() => setProcessingSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [uploadState]);

  const scopeOptions = useMemo(() => {
    if (scopeType === 'course') {
      return (courses || []).map((c) => ({ id: c.id, label: c.name }));
    }
    return (lessons || [])
      .filter((l) => Number.isFinite(Number(l.id)))
      .map((l) => ({ id: Number(l.id), label: l.title }));
  }, [scopeType, courses, lessons]);

  async function createVideo(e) {
    e.preventDefault();
    if (!videoFile) return;
    if (!categoryId) {
      setUploadError('Please select a category');
      return;
    }
    let failed = false;
    setBusy(true);
    setUploadError('');
    setUploadProgress(0);
    setUploadState('uploading');
    setUploadMessage('Uploading to secure cloud storage...');
    try {
      await onCreateVideo(
        { title, description, categoryId: Number(categoryId), file: videoFile },
        (pct) => {
          setUploadProgress(pct);
          if (pct >= 100) {
            setUploadState('processing');
            setUploadMessage('Optimizing and preparing your video...');
          }
        }
      );
      setUploadState('done');
      setUploadMessage('Upload completed successfully.');
      setTitle('');
      setDescription('');
      setCategoryId('');
      clearSelectedFile();
      setUploadProgress(100);
    } catch (err) {
      failed = true;
      setUploadState('failed');
      setUploadMessage('Upload failed.');
      setUploadError(err?.message || 'Video upload failed');
    } finally {
      setBusy(false);
      if (!failed) {
        setTimeout(() => {
          setUploadState('idle');
          setUploadProgress(0);
        }, 1400);
      }
    }
  }

  async function saveMeta(video) {
    const nextTitle = window.prompt('Video title', video.title || '');
    if (nextTitle == null) return;
    const nextDesc = window.prompt('Video description', video.description || '');
    if (nextDesc == null) return;
    await onUpdateVideo(video.id, { title: nextTitle, description: nextDesc });
  }

  async function assign(e) {
    e.preventDefault();
    if (!assignVideoId || !scopeId) return;
    const picked = (videos || []).find((x) => Number(x.id) === Number(assignVideoId));
    if (!libraryCanMutate(picked)) return;
    setBusy(true);
    try {
      await onAssignVideo(Number(assignVideoId), { scopeType, scopeId: Number(scopeId) });
      setScopeId('');
    } finally {
      setBusy(false);
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

  return (
    <div className="stack">
      <SectionCard title="Video Library" subtitle="Reusable uploaded videos stored in DO Spaces">
        <form className="videoUploaderForm" onSubmit={createVideo}>
          <div className="videoUploaderField">
            <label className="fieldLabel">Video title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Enter a clear lesson video title" required disabled={busy} />
          </div>
          <div className="videoUploaderField">
            <label className="fieldLabel">Description</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional summary" disabled={busy} />
          </div>
          <div className="videoUploaderField">
            <label className="fieldLabel">Category (mandatory)</label>
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required disabled={busy}>
              <option value="">Select category</option>
              {(categories || []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className={`videoDropZone ${videoFile ? 'hasFile' : ''}`}>
            <label className="fieldLabel">Upload video</label>
            <p className="fieldHint">MP4/MOV recommended. Upload goes directly to DO Spaces and is processed automatically.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
              required
              disabled={busy}
            />
            {fileInfo ? (
              <div className="videoFileChip">
                <span>{fileInfo}</span>
                <button
                  type="button"
                  className="fileChipClearBtn"
                  onClick={clearSelectedFile}
                  disabled={busy}
                  aria-label="Clear selected file"
                  title="Clear selected file"
                >
                  x
                </button>
              </div>
            ) : <div className="videoDropHint">Choose a file to begin</div>}
          </div>

          {uploadState !== 'idle' ? (
            <div className="uploadStatusCard">
              <div className="uploadStatusRow">
                <span>{uploadMessage}</span>
                <strong>{uploadProgress}%</strong>
              </div>
              <div className="uploadProgressTrack">
                <div className={`uploadProgressBar ${uploadState}`} style={{ width: `${uploadProgress}%` }} />
              </div>
              {uploadState === 'processing' ? (
                <div className="fieldHint">
                  Final cloud processing in progress... {processingSeconds}s elapsed.
                </div>
              ) : null}
              {uploadError ? <div className="uploadErrorText">{uploadError}</div> : null}
            </div>
          ) : null}

          <button type="submit" disabled={busy || !videoFile} className="uploadPrimaryBtn">
            {busy ? (uploadState === 'processing' ? 'Processing...' : 'Uploading...') : 'Upload Video'}
          </button>
        </form>
      </SectionCard>

      <SectionCard title="Uploaded Videos" subtitle="Searchable gallery with quick previews">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, description, or category" />
        <div className="videoGalleryGrid">
          {filtered.map((v) => (
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
                <ActionMenu>
                  {libraryCanMutate(v) ? (
                    <>
                      <button className="secondaryBtn" onClick={() => saveMeta(v)}>Edit</button>
                      <button className="dangerBtn" onClick={() => onDeleteVideo(v.id)}>Delete</button>
                    </>
                  ) : null}
                </ActionMenu>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Link Video to Lesson/Course" subtitle="Works like quiz assignments">
        <form className="formGrid" onSubmit={assign}>
          <select value={assignVideoId} onChange={(e) => setAssignVideoId(e.target.value)} required>
            <option value="">Select video</option>
            {(videos || []).map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
          </select>
          <select value={scopeType} onChange={(e) => { setScopeType(e.target.value); setScopeId(''); }}>
            <option value="lesson">Lesson</option>
            <option value="course">Course</option>
          </select>
          <select value={scopeId} onChange={(e) => setScopeId(e.target.value)} required>
            <option value="">Select {scopeType}</option>
            {scopeOptions.map((o) => <option key={`${scopeType}-${o.id}`} value={o.id}>{o.label}</option>)}
          </select>
          <button
            type="submit"
            disabled={
              busy
              || !assignVideoId
              || !libraryCanMutate((videos || []).find((x) => Number(x.id) === Number(assignVideoId)))
            }
          >
            Link Video
          </button>
        </form>
      </SectionCard>
    </div>
  );
}
