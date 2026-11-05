import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import SectionCard from '../components/SectionCard';

function timeLabel(value) {
  if (!value) return '';
  const s = String(value);
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return s;
}

export default function TrainerTodayPage({
  loadToday,
  loadReviewQueue,
  onOpenBatch,
  loadLessonComposition,
}) {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [today, queue] = await Promise.all([
          loadToday(),
          loadReviewQueue ? loadReviewQueue('pending') : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setSessions(Array.isArray(today) ? today : []);
        setPendingCount(Array.isArray(queue) ? queue.length : 0);
      } catch (e) {
        if (!cancelled) setError(e?.message || 'Could not load today');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function previewLesson(lessonId) {
    if (!lessonId || !loadLessonComposition) return;
    try {
      const data = await loadLessonComposition(lessonId);
      setPreview({ lessonId, items: data?.items || [] });
    } catch (e) {
      setPreview({ lessonId, items: [], error: e?.message || 'Could not load lesson' });
    }
  }

  return (
    <div className="stack">
      <SectionCard title="Today" subtitle="Sessions you teach today, plus work waiting for review.">
        <div className="statsGrid">
          <div className="statTile">
            <div className="statLabel">Sessions today</div>
            <div className="statValue">{sessions.length}</div>
          </div>
          <div className="statTile">
            <div className="statLabel">Pending reviews</div>
            <div className="statValue">{pendingCount}</div>
          </div>
        </div>
        {loading ? <p className="muted">Loading…</p> : null}
        {error ? <p className="error">{error}</p> : null}
      </SectionCard>

      {(sessions || []).map((s) => {
        const liveId = s.live_session_id;
        const liveStatus = s.live_status;
        const canJoin = liveId && liveStatus !== 'ended' && liveStatus !== 'cancelled' && s.status !== 'cancelled';
        return (
          <SectionCard
            key={s.id}
            title={s.batch_title || s.batch_name || `Batch ${s.batch_id}`}
            subtitle={`${s.lesson_title || `Day ${s.session_day}`} · ${timeLabel(s.starts_at)}${s.ends_at ? `–${timeLabel(s.ends_at)}` : ''}`}
            actions={
              <>
                {canJoin ? (
                  <button type="button" onClick={() => navigate(`/live/${liveId}`)}>
                    {liveStatus === 'live' ? 'Join class' : 'Start class'}
                  </button>
                ) : null}
                {onOpenBatch ? (
                  <button type="button" className="secondaryBtn" onClick={() => onOpenBatch(s.batch_id)}>
                    Open batch
                  </button>
                ) : null}
              </>
            }
          >
            <p className="muted">
              Status: {s.status === 'cancelled' ? 'Cancelled' : liveStatus === 'live' ? 'Live' : 'Scheduled'}
            </p>
            {s.lesson_id && loadLessonComposition ? (
              <button type="button" className="secondaryBtn" onClick={() => previewLesson(s.lesson_id)}>
                Preview lesson
              </button>
            ) : null}
          </SectionCard>
        );
      })}
      {!loading && sessions.length === 0 ? <p className="muted">No sessions scheduled for today.</p> : null}

      {preview ? (
        <SectionCard
          title="Lesson preview"
          subtitle={`Lesson #${preview.lessonId}`}
          actions={
            <button type="button" className="secondaryBtn" onClick={() => setPreview(null)}>
              Close
            </button>
          }
        >
          {preview.error ? <p className="muted">{preview.error}</p> : null}
          <ol className="todoList">
            {(preview.items || []).map((item, i) => (
              <li key={`${item.item_type}-${item.item_id}-${i}`}>
                {item.item_type}: {item.title || item.item_id}
              </li>
            ))}
          </ol>
          {!(preview.items || []).length && !preview.error ? <p className="muted">No items in this lesson.</p> : null}
        </SectionCard>
      ) : null}
    </div>
  );
}
