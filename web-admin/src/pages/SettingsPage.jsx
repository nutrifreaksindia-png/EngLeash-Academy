import React, { useState } from 'react';
import SectionCard from '../components/SectionCard';

export default function SettingsPage({
  holidays,
  categories,
  onAddHoliday,
  onDeleteHoliday,
  onCreateCategory,
  onDeleteCategory,
}) {
  const [newCategory, setNewCategory] = useState('');

  async function submitCategory(e) {
    e.preventDefault();
    if (!newCategory.trim()) return;
    await onCreateCategory(newCategory.trim());
    setNewCategory('');
  }

  return (
    <div className="stack">
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
