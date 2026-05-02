import React from 'react';
import SectionCard from '../components/SectionCard';

export default function DashboardPage({ users, pendingUsers, courses, batches, holidays }) {
  const stats = [
    { label: 'Users', value: users.length },
    { label: 'Pending Approvals', value: pendingUsers.length },
    { label: 'Courses', value: courses.length },
    { label: 'Batches', value: batches.length },
    { label: 'Holidays', value: holidays.length },
  ];

  return (
    <div className="stack">
      <SectionCard title="Overview" subtitle="Quick snapshot of the academy setup">
        <div className="statsGrid">
          {stats.map((s) => (
            <div className="statTile" key={s.label}>
              <div className="statLabel">{s.label}</div>
              <div className="statValue">{s.value}</div>
            </div>
          ))}
        </div>
      </SectionCard>
      <SectionCard title="What next?" subtitle="Recommended first setup steps">
        <ol className="todoList">
          <li>Create trainers and approve pending students.</li>
          <li>Create courses with duration and enrollment type.</li>
          <li>Create lesson library templates and map to courses.</li>
          <li>Create batches and start with planned date.</li>
        </ol>
      </SectionCard>
    </div>
  );
}
