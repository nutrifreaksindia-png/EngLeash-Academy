import React, { useEffect, useState } from 'react';
import SectionCard from '../components/SectionCard';

export default function SettingsPage({
  holidays,
  categories,
  onAddHoliday,
  onDeleteHoliday,
  onCreateCategory,
  onDeleteCategory,
  loadAssignmentRetention,
  saveAssignmentRetention,
}) {
  const [newCategory, setNewCategory] = useState('');
  const [retentionDays, setRetentionDays] = useState(20);
  const [retentionDefault, setRetentionDefault] = useState(20);
  const [retentionSaving, setRetentionSaving] = useState(false);
  const [retentionNotice, setRetentionNotice] = useState('');

  useEffect(() => {
    if (!loadAssignmentRetention) return;
    let cancelled = false;
    loadAssignmentRetention()
      .then((row) => {
        if (cancelled || !row) return;
        setRetentionDays(Number(row.days) || 20);
        setRetentionDefault(Number(row.defaultDays) || 20);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [loadAssignmentRetention]);

  async function submitCategory(e) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    await onCreateCategory(newCategory.trim());
    setNewCategory('');
  }

  async function submitRetention(e) {
    e.preventDefault();
    if (!saveAssignmentRetention) return;
    setRetentionSaving(true);
    setRetentionNotice('');
    try {
      const row = await saveAssignmentRetention(Number(retentionDays));
      setRetentionDays(Number(row.days) || retentionDays);
      setRetentionNotice('Saved. Cloud copies of assignment responses older than this will be deleted.');
    } catch (err) {
      setRetentionNotice(err.message || 'Save failed');
    } finally {
      setRetentionSaving(false);
    }
  }

  return (
    <div className="stack">
      {loadAssignmentRetention ? (
        <SectionCard
          title="Assignment response retention"
          subtitle="How long student responses stay in DigitalOcean Spaces. After this, cloud files are deleted; students keep a copy on their phone if they submitted from the app."
        >
          <form className="row" onSubmit={submitRetention}>
            <label>
              Days{' '}
              <input
                type="number"
                min={1}
                max={3650}
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                style={{ width: 88 }}
                required
              />
            </label>
            <button type="submit" disabled={retentionSaving}>
              {retentionSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="secondaryBtn"
              onClick={() => setRetentionDays(retentionDefault)}
            >
              Reset to {retentionDefault}
            </button>
          </form>
          {retentionNotice ? <p className="muted" style={{ marginTop: 8 }}>{retentionNotice}</p> : null}
        </SectionCard>
      ) : null}

      <SectionCard title="Video Categories" subtitle="Categories used for mandatory video uploads">
        <form className="row" onSubmit={submitCategory}>
          <input
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="Category name"
            required
          />
          <button type="submit">Add Category</button>
        </form>
        <div className="tableWrap">
          <table>
            <thead><tr><th>Name</th><th>Slug</th><th>Action</th></tr></thead>
            <tbody>
              {(categories || []).map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.slug}</td>
                  <td>
                    <button className="dangerBtn" onClick={() => onDeleteCategory(c.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Holidays" subtitle="Manage holiday exclusions for schedules">
        <form onSubmit={onAddHoliday} className="row">
          <input name="holidayDate" type="date" required />
          <input name="reason" placeholder="Reason" />
          <button type="submit">Add Holiday</button>
        </form>
        <div className="tableWrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Reason</th>
                {onDeleteHoliday ? <th aria-label="Remove" /> : null}
              </tr>
            </thead>
            <tbody>
              {(holidays || []).map((h) => (
                <tr key={h.id}>
                  <td>{h.holiday_date}</td>
                  <td>{h.reason || '-'}</td>
                  {onDeleteHoliday ? (
                    <td>
                      <button
                        type="button"
                        className="dangerBtn"
                        onClick={() => {
                          if (!window.confirm(`Remove holiday ${h.holiday_date}?`)) return;
                          void onDeleteHoliday(h.holiday_date);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
