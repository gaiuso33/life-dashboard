import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { mergeData } from '../merge';
import { useStore } from '../store';
import { AuthError, CloudApi, cloudConfig, NetworkError } from './api';
import { deriveKey, newSalt, stable } from './crypto';
import { syncOnce } from './engine';
import type { Keys } from './engine';
import { forgetKeys, recallKey, rememberKey } from './keystore';

export type CloudStatus = 'off' | 'signed-out' | 'locked' | 'idle' | 'syncing' | 'offline' | 'error';

interface CloudCtx {
  configured: boolean;
  status: CloudStatus;
  email: string | null;
  lastSynced: string | null;
  error: string;
  /** Why the passphrase is wanted: first time ever, from another device, or the last one didn't match. */
  lock: { reason: 'new' | 'existing' | 'wrong' } | null;
  remember: boolean;
  setRemember: (v: boolean) => void;
  /** Set when the person arrived from a password-reset email. */
  resetToken: string | null;
  clearReset: () => void;
  signUp: (email: string, password: string) => Promise<'signed-in' | 'confirm'>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  recover: (email: string) => Promise<void>;
  setNewPassword: (password: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  syncNow: () => void;
  deleteCloudCopy: () => Promise<void>;
}

const Ctx = createContext<CloudCtx | null>(null);
const REMEMBER_SLOT = 'life-dashboard:v1:cloud-remember';
const LAST_SLOT = 'life-dashboard:v1:cloud-last';
const read = (k: string) => {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v == null) window.localStorage.removeItem(k);
    else window.localStorage.setItem(k, v);
  } catch {
    /* ignore */
  }
};

/** A reset email sends the person back with the token in the address; take it and tidy the address. */
function takeResetToken(): string | null {
  try {
    const h = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (h.get('type') !== 'recovery' || !h.get('access_token')) return null;
    const token = h.get('access_token');
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return token;
  } catch {
    return null;
  }
}

// Read once when the app loads (not inside a component, which React may run twice).
const RESET_TOKEN = takeResetToken();

export function CloudProvider({ children }: { children: ReactNode }) {
  const { data, importData } = useStore();
  const cfg = useMemo(cloudConfig, []);
  const api = useMemo(() => (cfg ? new CloudApi(cfg) : null), [cfg]);
  const [email, setEmail] = useState<string | null>(api?.session?.user.email ?? null);
  const [status, setStatus] = useState<CloudStatus>(!api ? 'off' : api.session ? 'syncing' : 'signed-out');
  const [error, setError] = useState('');
  const [lastSynced, setLastSynced] = useState<string | null>(read(LAST_SLOT));
  const [lock, setLock] = useState<CloudCtx['lock']>(null);
  const [remember, setRememberState] = useState(read(REMEMBER_SLOT) === '1');
  const [resetToken, setResetToken] = useState<string | null>(RESET_TOKEN);

  const latest = useRef(data);
  latest.current = data;
  const rememberRef = useRef(remember);
  rememberRef.current = remember;
  const pass = useRef<string | null>(null);
  const keyCache = useRef(new Map<string, CryptoKey>());
  const inflight = useRef(false);
  const dirty = useRef(false);
  const lastStable = useRef<string | null>(null);
  const lastRun = useRef(0);
  const locked = useRef(false);

  const keys = useMemo<Keys>(
    () => ({
      forSalt: async (salt) => {
        const uid = api?.session?.user.id ?? '';
        const cached = keyCache.current.get(salt) ?? (await recallKey(uid, salt));
        if (cached) {
          keyCache.current.set(salt, cached);
          return cached;
        }
        if (!pass.current) return null;
        const k = await deriveKey(pass.current, salt);
        keyCache.current.set(salt, k);
        return k;
      },
      forNew: async () => {
        if (!pass.current) return null;
        const salt = newSalt();
        const key = await deriveKey(pass.current, salt);
        keyCache.current.set(salt, key);
        return { salt, key };
      },
    }),
    [api],
  );

  const run = useCallback(async () => {
    if (!api?.session) return;
    if (inflight.current) {
      dirty.current = true;
      return;
    }
    inflight.current = true;
    lastRun.current = Date.now();
    setStatus('syncing');
    setError('');
    try {
      const res = await syncOnce(api, keys, latest.current);
      if (res.status === 'locked') {
        if (res.reason === 'wrong') {
          keyCache.current.clear();
          void forgetKeys();
        }
        const exists = res.reason === 'wrong' ? true : await api.get().then((v) => v != null).catch(() => true);
        locked.current = true;
        setLock({ reason: res.reason === 'wrong' ? 'wrong' : exists ? 'existing' : 'new' });
        setStatus('locked');
      } else if (res.status === 'busy') {
        setStatus('error');
        setError('Another device keeps changing the cloud copy. It will try again shortly.');
        dirty.current = true;
      } else {
        locked.current = false;
        setLock(null);
        // Edits made while the request was in flight are merged, not overwritten.
        const next = mergeData(latest.current, res.data);
        if (stable(next) !== stable(latest.current)) importData(next);
        lastStable.current = stable(next);
        setLastSynced(res.at);
        write(LAST_SLOT, res.at);
        setStatus('idle');
        if (rememberRef.current) {
          // Keep the unlocked key on this device (non-extractable) so the passphrase isn't asked for again.
          const uid = api.session.user.id;
          for (const [salt, k] of keyCache.current) void rememberKey(uid, salt, k);
        }
      }
    } catch (e) {
      if (e instanceof NetworkError) setStatus('offline');
      else if (e instanceof AuthError && e.code === 'signed_out') {
        setEmail(null);
        setStatus('signed-out');
        setError(e.message);
      } else {
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Sync failed.');
      }
    } finally {
      inflight.current = false;
      if (dirty.current && !locked.current) {
        dirty.current = false;
        window.setTimeout(() => void run(), 1500);
      }
    }
  }, [api, keys, importData]);

  // First sync after the app opens with a saved sign-in.
  const started = useRef(false);
  useEffect(() => {
    if (api?.session && !started.current) {
      started.current = true;
      void run();
    }
  }, [api, run]);

  // Local edits go up a few seconds after they stop.
  useEffect(() => {
    if (!api || lastStable.current === null) return;
    const id = window.setTimeout(() => {
      if (api.session && !locked.current && stable(latest.current) !== lastStable.current) void run();
    }, 3000);
    return () => window.clearTimeout(id);
    // Not re-run on status changes, so a failed attempt waits for the next poll or the connection coming back instead of looping.
  }, [data, api, run]);

  // Pick up changes from other devices: when coming back to the app, going online, and every minute while open.
  useEffect(() => {
    if (!api) return;
    const poll = (e?: Event) => {
      // Coming back online always tries straight away; other triggers wait at least 15 seconds between attempts.
      const wait = e?.type === 'online' ? 0 : 15000;
      if (!api.session || locked.current || document.visibilityState !== 'visible' || Date.now() - lastRun.current < wait) return;
      void run();
    };
    const id = window.setInterval(() => poll(), 60000);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('focus', poll);
    window.addEventListener('online', poll);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', poll);
      window.removeEventListener('focus', poll);
      window.removeEventListener('online', poll);
    };
  }, [api, run]);

  const value = useMemo<CloudCtx>(
    () => ({
      configured: !!api,
      status,
      email,
      lastSynced,
      error,
      lock,
      remember,
      resetToken,
      clearReset: () => setResetToken(null),
      setRemember: (v) => {
        setRememberState(v);
        write(REMEMBER_SLOT, v ? '1' : null);
        if (!v) void forgetKeys();
        else if (api?.session) for (const [salt, k] of keyCache.current) void rememberKey(api.session.user.id, salt, k);
      },
      signUp: async (em, pw) => {
        const s = await api!.signUp(em.trim(), pw);
        if (!s) return 'confirm';
        setEmail(s.user.email);
        started.current = true;
        void run();
        return 'signed-in';
      },
      signIn: async (em, pw) => {
        const s = await api!.signIn(em.trim(), pw);
        setEmail(s.user.email);
        started.current = true;
        lastStable.current = null;
        void run();
      },
      signOut: async () => {
        await api?.signOut();
        pass.current = null;
        keyCache.current.clear();
        locked.current = false;
        lastStable.current = null;
        setLock(null);
        setEmail(null);
        setError('');
        setStatus('signed-out');
        // Another person on this device must not inherit the saved key.
        void forgetKeys();
      },
      recover: (em) => api!.recover(em.trim()),
      setNewPassword: (pw) => api!.setPassword(resetToken ?? '', pw),
      unlock: async (p) => {
        pass.current = p;
        keyCache.current.clear();
        locked.current = false;
        await run();
      },
      syncNow: () => void run(),
      deleteCloudCopy: async () => {
        await api!.deleteVault();
        lastStable.current = null;
        setLastSynced(null);
        write(LAST_SLOT, null);
      },
    }),
    [api, status, email, lastSynced, error, lock, remember, resetToken, run],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCloud(): CloudCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useCloud must be used inside CloudProvider');
  return c;
}
