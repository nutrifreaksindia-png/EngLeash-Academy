import React, { useEffect, useRef, useState } from 'react';
import AudioPlayerWithDuration from './AudioPlayerWithDuration';

/**
 * WhatsApp-style recorder: growing waveform of recorded audio (history bars),
 * pause/resume/delete, and preview with visible duration.
 */
export default function VoiceRecorder({ valueBlob, onChange, disabled }) {
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  /** Accumulated envelope of the recording (oldest → newest). */
  const [wave, setWave] = useState([]);
  const [error, setError] = useState('');
  const [previewUrl, setPreviewUrl] = useState('');

  const mediaRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const rafRef = useRef(0);
  const analyserRef = useRef(null);
  const audioCtxRef = useRef(null);
  const startedAtRef = useRef(0);
  const accumulatedRef = useRef(0);
  const tickRef = useRef(0);
  const waveRef = useRef([]);
  const lastSampleAtRef = useRef(0);

  useEffect(() => {
    if (!valueBlob) {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      return undefined;
    }
    const url = URL.createObjectURL(valueBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [valueBlob]);

  useEffect(
    () => () => {
      stopTracks();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (tickRef.current) clearInterval(tickRef.current);
      try {
        audioCtxRef.current?.close();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  function stopTracks() {
    mediaRef.current?.getTracks?.().forEach((t) => t.stop());
    mediaRef.current = null;
  }

  function formatMs(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  async function start() {
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRef.current = stream;
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      waveRef.current = [];
      setWave([]);
      lastSampleAtRef.current = 0;

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        onChange?.(blob.size ? blob : null);
        stopTracks();
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        try {
          audioCtxRef.current?.close();
        } catch {
          /* ignore */
        }
        audioCtxRef.current = null;
        analyserRef.current = null;
      };
      recorderRef.current = rec;

      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);
      analyserRef.current = analyser;
      const timeData = new Uint8Array(analyser.fftSize);

      const paint = () => {
        const recState = recorderRef.current?.state;
        if (recState === 'recording') {
          analyser.getByteTimeDomainData(timeData);
          // RMS of PCM window → one bar of the recording envelope
          let sum = 0;
          for (let i = 0; i < timeData.length; i += 1) {
            const v = (timeData[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / timeData.length);
          const now = Date.now();
          // Append ~12 bars/sec so the wave grows with the recording
          if (now - lastSampleAtRef.current >= 80) {
            lastSampleAtRef.current = now;
            const level = Math.max(0.08, Math.min(1, rms * 3.2));
            waveRef.current = [...waveRef.current, level].slice(-64);
            setWave(waveRef.current);
          }
        }
        rafRef.current = requestAnimationFrame(paint);
      };
      paint();

      accumulatedRef.current = 0;
      startedAtRef.current = Date.now();
      setElapsedMs(0);
      tickRef.current = window.setInterval(() => {
        if (recorderRef.current?.state === 'recording') {
          setElapsedMs(accumulatedRef.current + (Date.now() - startedAtRef.current));
        }
      }, 200);

      rec.start(120);
      setRecording(true);
      setPaused(false);
      onChange?.(null);
    } catch (e) {
      setError(e?.message || 'Microphone permission denied');
      stopTracks();
    }
  }

  function pause() {
    const rec = recorderRef.current;
    if (!rec || rec.state !== 'recording') return;
    rec.pause();
    accumulatedRef.current += Date.now() - startedAtRef.current;
    setPaused(true);
  }

  function resume() {
    const rec = recorderRef.current;
    if (!rec || rec.state !== 'paused') return;
    startedAtRef.current = Date.now();
    rec.resume();
    setPaused(false);
  }

  function stop() {
    const rec = recorderRef.current;
    if (!rec || (rec.state !== 'recording' && rec.state !== 'paused')) return;
    if (rec.state === 'recording') {
      accumulatedRef.current += Date.now() - startedAtRef.current;
    }
    setElapsedMs(accumulatedRef.current);
    rec.stop();
    setRecording(false);
    setPaused(false);
    if (tickRef.current) clearInterval(tickRef.current);
  }

  function discard() {
    if (recorderRef.current && recording) {
      try {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    stopTracks();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    setRecording(false);
    setPaused(false);
    setElapsedMs(0);
    waveRef.current = [];
    setWave([]);
    onChange?.(null);
  }

  return (
    <div className="voiceRecRoot">
      {error ? <p className="voiceRecError">{error}</p> : null}

      {!recording && !valueBlob ? (
        <button type="button" className="voiceRecMicBtn" onClick={() => void start()} disabled={disabled}>
          <span className="voiceRecMicIcon" aria-hidden>
            ●
          </span>
          Record voice feedback
        </button>
      ) : null}

      {recording ? (
        <div className={`voiceRecBar ${paused ? 'voiceRecPaused' : ''}`}>
          <button type="button" className="voiceRecTrash" onClick={discard} aria-label="Delete recording">
            ⌫
          </button>
          <div className="voiceRecWave" aria-hidden>
            {(wave.length ? wave : [0.12]).map((lv, i) => (
              <span key={i} style={{ height: `${10 + lv * 24}px` }} />
            ))}
          </div>
          <span className="voiceRecTime">{formatMs(elapsedMs)}</span>
          {paused ? (
            <button type="button" className="voiceRecRound" onClick={resume} aria-label="Resume">
              ▶
            </button>
          ) : (
            <button type="button" className="voiceRecRound" onClick={pause} aria-label="Pause">
              ❚❚
            </button>
          )}
          <button type="button" className="voiceRecSend" onClick={stop} aria-label="Finish">
            ✓
          </button>
        </div>
      ) : null}

      {!recording && valueBlob ? (
        <div className="voiceRecDone">
          <AudioPlayerWithDuration src={previewUrl} />
          <button type="button" className="secondaryBtn" onClick={discard} disabled={disabled}>
            Delete voice
          </button>
        </div>
      ) : null}
    </div>
  );
}
