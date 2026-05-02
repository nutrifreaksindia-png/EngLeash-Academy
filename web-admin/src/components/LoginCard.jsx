import React from 'react';

export default function LoginCard({ email, password, setEmail, setPassword, onLogin, busy }) {
  return (
    <div className="loginWrap">
      <div className="loginCard">
        <h2>Admin Login</h2>
        <p className="muted">Sign in to manage users, courses, batches, and schedules.</p>
        <div className="formGrid">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" />
          <button disabled={busy} onClick={onLogin}>{busy ? 'Signing in...' : 'Login'}</button>
        </div>
      </div>
    </div>
  );
}
