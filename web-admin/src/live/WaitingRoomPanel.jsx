/** For the trainer or admin: who is waiting to be let in. */
export default function WaitingRoomPanel({ waiting, busy, onDecide }) {
  if (!waiting?.length) return null;
  return (
    <section className="liveWaitingPanel" aria-label="Waiting room" aria-live="polite">
      <header className="liveWaitingHeader">
        <strong>Waiting to join ({waiting.length})</strong>
        <button type="button" className="liveBarBtn liveBarBtnPrimary" disabled={busy} onClick={() => onDecide('all', 'admit')}>
          Admit all
        </button>
      </header>
      <ul className="liveWaitingList">
        {waiting.map((person) => (
          <li key={person.userId} className="liveWaitingRow">
            <span className="liveWaitingName">{person.name}</span>
            <button type="button" className="liveBarBtn liveBarBtnPrimary" disabled={busy} onClick={() => onDecide(person.userId, 'admit')}>
              Admit
            </button>
            <button type="button" className="liveBarBtn liveBarBtnGhost" disabled={busy} onClick={() => onDecide(person.userId, 'deny')}>
              Deny
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
