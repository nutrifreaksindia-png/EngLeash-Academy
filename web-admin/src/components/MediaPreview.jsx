import React, { useCallback, useEffect, useRef, useState } from 'react';
import AudioPlayerWithDuration from './AudioPlayerWithDuration';

function extOf(url = '') {
  try {
    const path = String(url).split('?')[0].split('#')[0];
    const m = /\.([a-z0-9]+)$/i.exec(path);
    return m ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

export function detectMediaKind({ url, mimeType, typeHint } = {}) {
  const hint = String(typeHint || '').toLowerCase();
  if (['pdf', 'document'].includes(hint)) return 'pdf';
  if (['image', 'gif'].includes(hint)) return 'image';
  if (hint === 'video') return 'video';
  if (['audio', 'voice'].includes(hint)) return 'audio';

  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';

  const ext = extOf(url);
  if (ext === 'pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) return 'image';
  if (['mp4', 'mov', 'webm', 'm4v', 'mkv'].includes(ext)) return 'video';
  if (['mp3', 'm4a', 'wav', 'aac', 'ogg', 'oga'].includes(ext)) return 'audio';
  if (/\/invoice(\?|$)/i.test(String(url || ''))) return 'pdf';
  return 'file';
}

function MediaBody({ src, kind, title, maxHeight }) {
  if (kind === 'image') {
    return (
      <img
        src={src}
        alt={title || 'Preview'}
        style={{ maxWidth: '100%', maxHeight, objectFit: 'contain', display: 'block', margin: '0 auto' }}
      />
    );
  }

  if (kind === 'video') {
    return (
      <video
        src={src}
        controls
        playsInline
        style={{ width: '100%', maxHeight, display: 'block', background: '#000' }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  if (kind === 'audio') {
    return (
      <div style={{ padding: 12 }} onClick={(e) => e.stopPropagation()}>
        {title ? <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div> : null}
        <AudioPlayerWithDuration src={src} />
      </div>
    );
  }

  return (
    <iframe
      title={title || 'Document'}
      src={src}
      style={{ width: '100%', height: maxHeight, border: 0, display: 'block', background: '#fff' }}
    />
  );
}

function FullscreenLightbox({ open, url, title, typeHint, mimeType, onClose }) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const kind = detectMediaKind({ url, mimeType, typeHint });

  useEffect(() => {
    if (!open) return undefined;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(5, z + 0.25));
      if (e.key === '-') setZoom((z) => Math.max(0.5, z - 0.25));
      if (e.key === '0') {
        setZoom(1);
        setOffset({ x: 0, y: 0 });
      }
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.12 : 0.12;
    setZoom((z) => Math.max(0.5, Math.min(5, Number((z + delta).toFixed(2)))));
  }, []);

  if (!open || !url) return null;

  return (
    <div className="mediaFsOverlay" role="dialog" aria-modal="true">
      <div className="mediaFsTop">
        <div className="mediaFsTitle">{title || 'Preview'}</div>
        <div className="mediaFsTools">
          {kind === 'image' ? (
            <>
              <button type="button" className="mediaFsBtn" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
                −
              </button>
              <button
                type="button"
                className="mediaFsBtn"
                onClick={() => {
                  setZoom(1);
                  setOffset({ x: 0, y: 0 });
                }}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" className="mediaFsBtn" onClick={() => setZoom((z) => Math.min(5, z + 0.25))}>
                +
              </button>
            </>
          ) : null}
          <button type="button" className="mediaFsBtn mediaFsClose" onClick={onClose}>
            Close
          </button>
        </div>
      </div>

      <div
        className="mediaFsStage"
        onWheel={kind === 'image' ? onWheel : undefined}
        onMouseDown={
          kind === 'image'
            ? (e) => {
                if (zoom <= 1) return;
                dragRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  ox: offset.x,
                  oy: offset.y,
                };
              }
            : undefined
        }
        onMouseMove={(e) => {
          if (!dragRef.current) return;
          const d = dragRef.current;
          setOffset({
            x: d.ox + (e.clientX - d.x),
            y: d.oy + (e.clientY - d.y),
          });
        }}
        onMouseUp={() => {
          dragRef.current = null;
        }}
        onMouseLeave={() => {
          dragRef.current = null;
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {kind === 'image' ? (
          <img
            src={url}
            alt={title || 'Full screen'}
            className="mediaFsImg"
            style={{
              transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
              cursor: zoom > 1 ? 'grab' : 'zoom-in',
            }}
            onDoubleClick={() => {
              if (zoom === 1) setZoom(2);
              else {
                setZoom(1);
                setOffset({ x: 0, y: 0 });
              }
            }}
            draggable={false}
          />
        ) : (
          <div className="mediaFsOther" onClick={(e) => e.stopPropagation()}>
            <MediaBody src={url} kind={kind} title={title} maxHeight={Math.round(window.innerHeight * 0.85)} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Inline media viewer — click opens true fullscreen (images with zoom).
 */
export default function MediaPreview({
  url,
  typeHint,
  mimeType,
  title,
  style,
  maxHeight = 360,
  expandable = true,
}) {
  const [open, setOpen] = useState(false);
  const src = String(url || '').trim();
  if (!src) {
    return <p className="muted" style={{ margin: 0 }}>No media.</p>;
  }
  const kind = detectMediaKind({ url: src, mimeType, typeHint });
  const wrapStyle = {
    marginTop: 8,
    borderRadius: 12,
    overflow: 'hidden',
    border: '1px solid #e2e8f0',
    background: kind === 'image' || kind === 'audio' ? '#f8fafc' : kind === 'pdf' || kind === 'file' ? '#525659' : '#0f172a',
    position: 'relative',
    cursor: expandable && kind !== 'audio' ? 'zoom-in' : undefined,
    ...style,
  };

  return (
    <>
      <div
        style={wrapStyle}
        role={expandable && kind !== 'audio' ? 'button' : undefined}
        tabIndex={expandable && kind !== 'audio' ? 0 : undefined}
        onClick={
          expandable && kind !== 'audio'
            ? (e) => {
                if (kind === 'video') {
                  const tag = e.target?.tagName;
                  if (tag === 'VIDEO' || tag === 'BUTTON' || e.target?.closest?.('button')) return;
                }
                setOpen(true);
              }
            : undefined
        }
        onKeyDown={
          expandable && kind !== 'audio'
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpen(true);
                }
              }
            : undefined
        }
      >
        <MediaBody src={src} kind={kind} title={title} maxHeight={maxHeight} />
        {expandable && kind !== 'audio' ? (
          <button
            type="button"
            className="mediaExpandHint"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(true);
            }}
          >
            View full
          </button>
        ) : null}
      </div>
      <FullscreenLightbox
        open={open}
        url={src}
        title={title}
        typeHint={typeHint}
        mimeType={mimeType}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

/** @deprecated Use MediaPreview expandable — kept for callers */
export function MediaPreviewModal(props) {
  return <FullscreenLightbox {...props} />;
}
