import { useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import type { CloudStatus } from '../cloud/CloudProvider';

const when = (iso: string | null) => {
  if (!iso) return 'not yet';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`;
};

export const statusText = (s: CloudStatus, last: string | null): string =>
  s === 'syncing' ? 'Syncing…' : s === 'idle' ? `Synced ${when(last)}` : s === 'offline' ? 'Offline. Will sync when you’re back online' : s === 'locked' ? 'Locked. Enter your passphrase' : s === 'error' ? 'Sync problem' : '';

const MIN_PASS = 10;

/** Compact status for the top bar. Renders nothing unless this device is signed in. */
export function CloudBadge() {
  const { configured, email, status, lastSynced } = useCloud();
  if (!configured || !email) return null;
  return (
    <span className="muted-s cloud-badge" role="status">
      Cloud: {statusText(status, lastSynced)}
    </span>
  );
}

export function Account() {
  const c = useCloud();
  if (!c.configured) {
    return <p className="note first">Cloud sync isn’t switched on for this copy of the app. You can still move your data between devices with a file, below.</p>;
  }
  if (c.resetToken) return <NewPassword />;
  if (!c.email) return <SignedOut />;
  if (c.status === 'locked' && c.lock) return <Unlock />;
  return <SignedIn />;
}

function Msg({ error, ok }: { error?: string; ok?: string }) {
  return (
    <>
      {error && <p className="err" role="alert">{error}</p>}
      {ok && <p className="ok" role="status">{ok}</p>}
    </>
  );
}

function SignedOut() {
  const c = useCloud();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(c.error);
  const [ok, setOk] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setOk('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (mode === 'up' && pw.length < 8) return setError('Use at least 8 characters for the password.');
    setBusy(true);
    try {
      if (mode === 'up') {
        const r = await c.signUp(email, pw);
        if (r === 'confirm') {
          setOk('Account created. Check your email for a confirmation link, then come back and sign in.');
          setMode('in');
          setPw('');
        }
      } else await c.signIn(email, pw);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setError('');
    setOk('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Type your email above first, then choose this again.');
    try {
      await c.recover(email);
      setOk('If that account exists, a reset link is on its way. Your data passphrase is separate and doesn’t change.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  return (
    <form onSubmit={submit} className="account-form">
      <p className="note first">Sign in to keep your phone and laptop in step automatically. Your data is encrypted on this device before it is uploaded, so the server can’t read it.</p>
      <div className="segment two" role="radiogroup" aria-label="Account">
        <button type="button" role="radio" aria-checked={mode === 'in'} onClick={() => setMode('in')}>Sign in</button>
        <button type="button" role="radio" aria-checked={mode === 'up'} onClick={() => setMode('up')}>Create account</button>
      </div>
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" autoComplete={mode === 'up' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <Msg error={error} ok={ok} />
      <div className="row-action">
        <button className="btn primary" disabled={busy || !email || !pw}>
          {busy ? 'One moment…' : mode === 'up' ? 'Create account' : 'Sign in'}
        </button>
        {mode === 'in' && (
          <button type="button" className="link-btn" onClick={() => void forgot()}>
            Forgot password
          </button>
        )}
      </div>
      <p className="note">Signing in combines this device’s data with what’s in your account. Nothing is deleted.</p>
    </form>
  );
}

function Unlock() {
  const c = useCloud();
  const first = c.lock?.reason === 'new';
  const [p, setP] = useState('');
  const [p2, setP2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(c.lock?.reason === 'wrong' ? 'That passphrase didn’t open your data. Try again.' : '');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (first) {
      if (p.length < MIN_PASS) return setError(`Use at least ${MIN_PASS} characters. A few words works well.`);
      if (p !== p2) return setError('The two passphrases don’t match.');
    }
    setBusy(true);
    try {
      await c.unlock(p);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="account-form">
      <p className="note first">
        <b>{c.email}</b>
      </p>
      {first ? (
        <p className="note first">
          Choose a passphrase. It encrypts your data on this device before it is uploaded and you’ll type it once on each device. <b>It can’t be reset or recovered by anyone, including us.</b> Lose it and the cloud copy can’t be opened, though your data on your devices is unaffected.
        </p>
      ) : (
        <p className="note first">Enter the passphrase you chose on your first device.</p>
      )}
      <label className="field">
        <span>Passphrase</span>
        <input type="password" autoComplete="off" value={p} onChange={(e) => setP(e.target.value)} />
      </label>
      {first && (
        <label className="field">
          <span>Passphrase again</span>
          <input type="password" autoComplete="off" value={p2} onChange={(e) => setP2(e.target.value)} />
        </label>
      )}
      <Msg error={error} />
      <div className="row-action">
        <button className="btn primary" disabled={busy || !p}>
          {busy ? 'Unlocking…' : first ? 'Encrypt and start syncing' : 'Unlock'}
        </button>
        <button type="button" className="link-btn" onClick={() => void c.signOut()}>
          Sign out
        </button>
      </div>
    </form>
  );
}

function SignedIn() {
  const c = useCloud();
  const [msg, setMsg] = useState('');
  return (
    <div className="account-form">
      <p className="note first">
        Signed in as <b>{c.email}</b>
      </p>
      <p role="status" className={c.status === 'idle' ? 'ok' : 'note first'} aria-live="polite">
        {statusText(c.status, c.lastSynced)}
      </p>
      {c.error && <p className="err" role="alert">{c.error}</p>}
      <label className="check">
        <input type="checkbox" checked={c.remember} onChange={(e) => c.setRemember(e.target.checked)} />
        <span>Keep this device unlocked (don’t ask for the passphrase again)</span>
      </label>
      <div className="row-action">
        <button className="btn primary" onClick={c.syncNow} disabled={c.status === 'syncing'}>
          Sync now
        </button>
        <button className="btn" onClick={() => void c.signOut()}>
          Sign out
        </button>
        <button
          className="btn ghost"
          onClick={async () => {
            if (!window.confirm('Delete the cloud copy? Your data stays on the devices you’ve used. It will be uploaded again at the next sync unless you sign out first.')) return;
            try {
              await c.deleteCloudCopy();
              setMsg('Cloud copy deleted.');
            } catch (e) {
              setMsg(e instanceof Error ? e.message : 'Couldn’t delete it.');
            }
          }}
        >
          Delete cloud copy
        </button>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
    </div>
  );
}

function NewPassword() {
  const c = useCloud();
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  if (done)
    return (
      <div className="account-form">
        <p className="ok" role="status">Password changed.</p>
        <button className="btn primary" onClick={c.clearReset}>Continue to sign in</button>
      </div>
    );
  return (
    <form
      className="account-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < 8) return setError('Use at least 8 characters.');
        try {
          await c.setNewPassword(pw);
          setDone(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Something went wrong.');
        }
      }}
    >
      <p className="note first">Choose a new account password.</p>
      <label className="field">
        <span>New password</span>
        <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
      </label>
      <Msg error={error} />
      <button className="btn primary" disabled={!pw}>Save password</button>
    </form>
  );
}
