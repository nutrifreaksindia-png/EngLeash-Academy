import React, { useState } from 'react';
import brandPanelBg from '@brand/login-brand-panel-bg.jpg';
import logoIcon from '@brand/logo_icon.png';
import logoLong from '@brand/logo_long.jpg';

function EyeIcon({ off }) {
  if (off) {
    return (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
        <line x1="1" y1="1" x2="23" y2="23" />
      </svg>
    );
  }
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export default function LoginCard({
  email,
  password,
  setEmail,
  setPassword,
  onLogin,
  busy,
  error,
}) {
  const [showPassword, setShowPassword] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    if (!busy) onLogin();
  }

  const brandPanelStyle = {
    backgroundImage: `linear-gradient(165deg, rgba(13, 22, 72, 0.78) 0%, rgba(26, 35, 126, 0.62) 42%, rgba(13, 22, 72, 0.82) 100%), url(${brandPanelBg})`,
  };

  return (
    <div className="loginPage">
      <aside className="loginBrandPanel" style={brandPanelStyle} aria-hidden="true">
        <div className="loginBrandGlow" />
        <div className="loginBrandAcademyMark">
          <img src={logoIcon} alt="" className="loginBrandAcademyImg" width={72} height={72} />
        </div>
      </aside>

      <div className="loginFormPanel">
        <div className="loginFormCard">
          <div className="loginFormHeader">
            <img src={logoLong} alt="EngLeash Academy" className="loginLogo" width={260} loading="eager" />
            <h2 className="loginFormTitle">Sign in</h2>
          </div>

          <form className="loginForm" onSubmit={handleSubmit} noValidate>
            {error ? (
              <div className="loginAlert loginAlertError" role="alert">
                {error}
              </div>
            ) : null}

            <label className="loginLabel" htmlFor="login-email">
              Email
            </label>
            <input
              id="login-email"
              className="loginInput"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              disabled={busy}
            />

            <label className="loginLabel" htmlFor="login-password">
              Password
            </label>
            <div className="loginPasswordWrap">
              <input
                id="login-password"
                className="loginInput loginInputPassword"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                disabled={busy}
              />
              <button
                type="button"
                className="loginPasswordToggle"
                onClick={() => setShowPassword((v) => !v)}
                disabled={busy}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                <EyeIcon off={showPassword} />
              </button>
            </div>

            <button type="submit" className="loginSubmit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
