import React, { useEffect, useRef, useState } from 'react';

function fmt(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Reliable audio player for blob + remote URLs.
 * Avoids crossOrigin (breaks Spaces playback). Uses the webm duration seek trick.
 */
export default function AudioPlayerWithDuration({ src, className, style }) {
  const ref = useRef(null);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const probingRef = useRef(false);

  useEffect(() => {
    setDuration(0);
    setCurrent(0);
    setPlaying(false);
    setError('');
    probingRef.current = false;
  }, [src]);

  function adoptDuration(d) {
    if (Number.isFinite(d) && d > 0 && d !== Infinity) {
      setDuration(d);
      return true;
    }
    return false;
  }

  function probeDuration(el) {
    if (!el || probingRef.current) return;
    const d = el.duration;
    if (adoptDuration(d)) return;
    // MediaRecorder webm often reports Infinity until seeked to the end
    if (d === Infinity || !Number.isFinite(d) || d === 0) {
      probingRef.current = true;
      const onTime = () => {
        el.removeEventListener('timeupdate', onTime);
        adoptDuration(el.duration);
        try {
          el.currentTime = 0;
        } catch {
          /* ignore */
        }
        probingRef.current = false;
      };
      el.addEventListener('timeupdate', onTime);
      try {
        el.currentTime = 1e101;
      } catch {
        probingRef.current = false;
      }
    }
  }

  async function togglePlay() {
    const el = ref.current;
    if (!el) return;
    setError('');
    try {
      if (el.paused) {
        await el.play();
      } else {
        el.pause();
      }
    } catch (e) {
      setError(e?.message || 'Could not play audio');
      setPlaying(false);
    }
  }

  if (!src) return null;

  return (
    <div className={`audioDurRoot ${className || ''}`} style={style} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="audioDurPlay" aria-label={playing ? 'Pause' : 'Play'} onClick={() => void togglePlay()}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="audioDurMeta">
        <div
          className="audioDurTrack"
          role="slider"
          aria-valuenow={current}
          aria-valuemin={0}
          aria-valuemax={duration || 0}
          onClick={(e) => {
            const el = ref.current;
            if (!el || !duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            el.currentTime = pct * duration;
            setCurrent(el.currentTime);
          }}
        >
          <div
            className="audioDurFill"
            style={{ width: duration > 0 ? `${Math.min(100, (current / duration) * 100)}%` : '0%' }}
          />
        </div>
        <div className="audioDurTimes">
          <span>{fmt(current)}</span>
          <span>{duration > 0 ? fmt(duration) : '0:00'}</span>
        </div>
        {error ? <div className="audioDurError">{error}</div> : null}
      </div>
      <audio
        ref={ref}
        src={src}
        preload="auto"
        onLoadedMetadata={(e) => probeDuration(e.currentTarget)}
        onDurationChange={(e) => {
          if (!adoptDuration(e.currentTarget.duration)) probeDuration(e.currentTarget);
        }}
        onCanPlay={(e) => {
          if (!duration) probeDuration(e.currentTarget);
        }}
        onTimeUpdate={(e) => {
          if (probingRef.current) return;
          setCurrent(e.currentTarget.currentTime || 0);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onError={() => setError('Audio failed to load')}
      />
    </div>
  );
}
