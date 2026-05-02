import React from 'react';
import SectionCard from '../components/SectionCard';

export default function HolidaysPage({ onAddHoliday, holidays }) {
  return (
    <div className="stack">
      <SectionCard title="Add Holiday" subtitle="Holidays are excluded in generated schedules">
        <form onSubmit={onAddHoliday} className="row">
          <input name="holidayDate" type="date" required />
          <input name="reason" placeholder="Reason" />
          <button type="submit">Add Holiday</button>
        </form>
      </SectionCard>
      <SectionCard title="Holidays" subtitle="Configured holiday list">
        <div className="tableWrap">
          <table>
            <thead><tr><th>Date</th><th>Reason</th></tr></thead>
            <tbody>
              {holidays.map((h) => (
                <tr key={h.id}>
                  <td>{h.holiday_date}</td>
                  <td>{h.reason || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
