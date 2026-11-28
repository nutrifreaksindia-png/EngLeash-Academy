import React, { useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';

/** First published screen share in the room (remote first, then your own). */
function findScreenShare(room) {
  if (!room) return null;
  for (const p of [...room.remoteParticipants.values(), room.localParticipant]) {
    const pub = p.getTrackPublication(Track.Source.ScreenShare);
    if (pub?.track && !pub.isMuted) return pub.track;
  }
  return null;
}

export default function ScreenShareStage({ clientRef, onActiveChange }) {
  const [track, setTrack] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    const t = window.setInterval(() => setTrack(findScreenShare(clientRef.current?.room)), 600);
    return () => window.clearInterval(t);
  }, [clientRef]);

  useEffect(() => {
    onActiveChange?.(Boolean(track));
  }, [track, onActiveChange]);

  useEffect(() => {
    const box = boxRef.current;
    if (!track || !box) return undefined;
    const el = track.attach();
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.objectFit = 'contain';
    box.appendChild(el);
    return () => {
      track.detach(el);
      el.remove();
    };
  }, [track]);

  if (!track) return null;
  return <div ref={boxRef} className="liveScreenShare" role="region" aria-label="Shared screen" />;
}
