import React from 'react';
import SectionCard from '../components/SectionCard';

export default function ApprovalsPage({ pendingUsers, onApproveUser }) {
  return (
    <SectionCard title="Pending Student Approvals" subtitle="Approve new student registrations">
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>Mobile</th><th>City</th><th>State</th><th>Action</th>
            </tr>
          </thead>
          <tbody>
            {pendingUsers.length === 0 ? (
              <tr><td colSpan="6" className="muted">No pending approvals</td></tr>
            ) : pendingUsers.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.mobile_number || '-'}</td>
                <td>{u.city_district || '-'}</td>
                <td>{u.state_province || '-'}</td>
                <td><button onClick={() => onApproveUser(u.id)}>Approve</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}
