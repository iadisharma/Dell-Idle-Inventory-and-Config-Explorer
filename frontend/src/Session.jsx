import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, Icon } from './ui.jsx';
import appearance from './login-appearance.json';
import './session.css';

function SignIn({ onSuccess, message }) {
  const [demo, setDemo] = useState({ accounts: [] }),
    [demoError, setDemoError] = useState('');
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [visible, setVisible] = useState(false);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api('/api/auth/demo', { signal: controller.signal })
      .then(setDemo)
      .catch((err) => {
        if (!controller.signal.aborted) setDemoError(err.message);
      });
    return () => controller.abort();
  }, []);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      onSuccess(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="signin">
      <section className="signin-intro">
        <img
          className="brand"
          src="/dell-technologies.svg"
          alt="Dell Technologies"
        />
        <div className="signin-story">
          <div className="signin-rule" />
          <h1>
            Inventory <br />
            workspace
          </h1>
          <p>
            Trace idle stock to its configurations and move decisions from
            review to resolution.
          </p>
        </div>
        <div className="signin-stage">
          {!imageFailed && appearance.imageUrl && (
            <img
              src={appearance.imageUrl}
              alt={appearance.imageAlt}
              onError={() => setImageFailed(true)}
            />
          )}
        </div>
        <span className="signin-foot">
          Portfolio demo · Synthetic inventory data
        </span>
      </section>
      <section className="signin-controls" aria-labelledby="signin-title">
        <div className="signin-card">
          <span className="signin-icon">
            <Icon name="lock" size={22} />
          </span>
          <h2 id="signin-title">Sign in</h2>
          <p>Use your workspace account to continue.</p>
          {message && (
            <div className="signin-message" role="status">
              {message}
            </div>
          )}
          <form className="signin-form" onSubmit={submit}>
            <label>
              Email address
              <input
                type="email"
                autoComplete="username"
                name="email"
                required
                value={email}
                disabled={busy}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </label>
            <label htmlFor="signin-password">Password</label>
            <div className="password-field">
              <input
                id="signin-password"
                name="password"
                type={visible ? 'text' : 'password'}
                autoComplete="current-password"
                disabled={busy}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label={visible ? 'Hide password' : 'Show password'}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                <Icon name="eye" size={17} />
              </button>
            </div>
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary-btn signin-submit" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
              <Icon name="arrow" size={16} />
            </button>
          </form>
          {demo.accounts.length > 0 && (
            <section className="demo-accounts">
              <h3>Try a demo role</h3>
              <div className="demo-choices">
                {demo.accounts.map((account) => (
                  <button
                    key={account.id || account.email}
                    type="button"
                    disabled={busy}
                    aria-pressed={email === account.email}
                    onClick={() => {
                      setEmail(account.email);
                      setPassword(demo.passwordHint || '');
                      setError('');
                    }}
                  >
                    {account.roleLabel || account.role}
                  </button>
                ))}
              </div>
              {demo.passwordHint && (
                <p>
                  Demo password <code>{demo.passwordHint}</code>
                </p>
              )}
            </section>
          )}
          {demoError && (
            <p className="inline-error">
              Demo accounts unavailable. {demoError}
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
export default function Session({ children }) {
  const [state, setState] = useState({ phase: 'checking' }),
    [message, setMessage] = useState(''),
    [signingOut, setSigningOut] = useState(false),
    [signOutError, setSignOutError] = useState('');
  const active = useRef(null),
    channel = useRef(null);
  const clear = useCallback((notice = '') => {
    active.current?.abort();
    setMessage(notice);
    setSignOutError('');
    setState({ phase: 'guest' });
  }, []);
  const check = useCallback(
    async (quiet = false) => {
      active.current?.abort();
      const controller = new AbortController();
      active.current = controller;
      if (!quiet) setState({ phase: 'checking' });
      try {
        const { user } = await api('/api/auth/session', {
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setState({ phase: 'signed-in', user });
      } catch (err) {
        if (controller.signal.aborted) return;
        if (err.status === 401)
          clear(
            quiet ? 'Your session has ended. Sign in again to continue.' : ''
          );
        else if (!quiet) setState({ phase: 'error', message: err.message });
      }
    },
    [clear]
  );
  useEffect(() => {
    check();
    const expired = () =>
      clear('Your session has ended. Sign in again to continue.');
    window.addEventListener('workspace:session-expired', expired);
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('inventory-workspace-session');
      channel.current.onmessage = () => check();
    }
    return () => {
      active.current?.abort();
      channel.current?.close();
      window.removeEventListener('workspace:session-expired', expired);
    };
  }, [check, clear]);
  useEffect(() => {
    if (state.phase !== 'signed-in') return;
    const verify = () => {
      if (!document.hidden) check(true);
    };
    window.addEventListener('focus', verify);
    document.addEventListener('visibilitychange', verify);
    const timer = window.setInterval(verify, 60000);
    return () => {
      window.removeEventListener('focus', verify);
      document.removeEventListener('visibilitychange', verify);
      window.clearInterval(timer);
    };
  }, [state.phase, check]);
  async function logout() {
    setSigningOut(true);
    setSignOutError('');
    try {
      await api('/api/auth/logout', { method: 'POST' });
      window.history.replaceState(
        null,
        '',
        window.location.pathname + window.location.search
      );
      clear('You have signed out.');
      channel.current?.postMessage('changed');
    } catch (err) {
      if (err.status === 401) clear();
      else setSignOutError(err.message);
    } finally {
      setSigningOut(false);
    }
  }
  if (state.phase === 'signed-in')
    return children({ user: state.user, logout, signingOut, signOutError });
  if (state.phase === 'guest')
    return (
      <SignIn
        message={message}
        onSuccess={(user) => {
          active.current?.abort();
          setMessage('');
          setState({ phase: 'signed-in', user });
          channel.current?.postMessage('changed');
        }}
      />
    );
  return (
    <main className="session-check" aria-live="polite">
      <img src="/dell-technologies.svg" alt="Dell Technologies" />
      {state.phase === 'checking' ? (
        <p>Checking your workspace session…</p>
      ) : (
        <>
          <h1>Workspace unavailable</h1>
          <p>{state.message}</p>
          <button className="primary-btn" onClick={() => check()}>
            Try again
          </button>
        </>
      )}
    </main>
  );
}
