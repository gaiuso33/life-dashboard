import type { Vault, VaultApi } from './engine';

export interface CloudSession {
  access_token: string;
  refresh_token: string;
  /** Seconds since 1970. */
  expires_at: number;
  user: { id: string; email: string };
}

export class AuthError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'AuthError';
  }
}
export class NetworkError extends Error {
  constructor() {
    super('Can’t reach the server. Check your connection.');
    this.name = 'NetworkError';
  }
}

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export const cloudConfig = (): CloudConfig | null => {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return url && anonKey ? { url: url.replace(/\/+$/, ''), anonKey } : null;
};

const SESSION_SLOT = 'life-dashboard:v1:cloud-session';
export const loadSession = (): CloudSession | null => {
  try {
    const s = JSON.parse(window.localStorage.getItem(SESSION_SLOT) ?? 'null');
    return s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' && typeof s.user?.id === 'string' ? s : null;
  } catch {
    return null;
  }
};
const saveSession = (s: CloudSession | null) => {
  try {
    if (s) window.localStorage.setItem(SESSION_SLOT, JSON.stringify(s));
    else window.localStorage.removeItem(SESSION_SLOT);
  } catch {
    /* ignore */
  }
};

type Json = Record<string, unknown>;

/** Small client for Supabase's REST endpoints, so no extra dependency is needed. */
export class CloudApi implements VaultApi {
  session: CloudSession | null;
  constructor(private cfg: CloudConfig, private f: typeof fetch = (...a) => fetch(...a)) {
    this.session = loadSession();
  }

  private async call(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
    const headers: Record<string, string> = { apikey: this.cfg.anonKey, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) };
    if (init.auth) {
      await this.ensureFresh();
      if (!this.session) throw new AuthError('Please sign in again.', 'signed_out');
      headers.Authorization = `Bearer ${this.session.access_token}`;
    }
    try {
      return await this.f(`${this.cfg.url}${path}`, { ...init, headers });
    } catch {
      throw new NetworkError();
    }
  }

  private async failure(r: Response): Promise<never> {
    let body: Json = {};
    try {
      body = (await r.json()) as Json;
    } catch {
      /* not JSON */
    }
    const msg = String(body.msg ?? body.message ?? body.error_description ?? body.error ?? `Server said ${r.status}`);
    throw new AuthError(msg, String(body.error_code ?? body.code ?? r.status));
  }

  private take(body: Json): CloudSession {
    const user = body.user as { id?: string; email?: string } | undefined;
    if (typeof body.access_token !== 'string' || typeof body.refresh_token !== 'string' || !user?.id) throw new AuthError('Unexpected reply from the server.');
    const expires = typeof body.expires_at === 'number' ? body.expires_at : Math.floor(Date.now() / 1000) + Number(body.expires_in ?? 3600);
    this.session = { access_token: body.access_token, refresh_token: body.refresh_token, expires_at: expires, user: { id: user.id, email: user.email ?? '' } };
    saveSession(this.session);
    return this.session;
  }

  /** Returns the session, or `null` when the account needs its email confirmed before signing in. */
  async signUp(email: string, password: string): Promise<CloudSession | null> {
    const r = await this.call('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!r.ok) return this.failure(r);
    const body = (await r.json()) as Json;
    return typeof body.access_token === 'string' ? this.take(body) : null;
  }

  async signIn(email: string, password: string): Promise<CloudSession> {
    const r = await this.call('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) });
    if (!r.ok) return this.failure(r);
    return this.take((await r.json()) as Json);
  }

  async recover(email: string): Promise<void> {
    const r = await this.call('/auth/v1/recover', { method: 'POST', body: JSON.stringify({ email }) });
    if (!r.ok) return this.failure(r);
  }

  /** Used after following a password-reset link: the token from the link acts as a short session. */
  async setPassword(accessToken: string, password: string): Promise<void> {
    const r = await this.call('/auth/v1/user', { method: 'PUT', headers: { Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ password }) });
    if (!r.ok) return this.failure(r);
  }

  async signOut(): Promise<void> {
    const token = this.session?.access_token;
    this.session = null;
    saveSession(null);
    if (token) await this.call('/auth/v1/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
  }

  private refreshing: Promise<void> | null = null;
  private async ensureFresh(): Promise<void> {
    const s = this.session;
    if (!s || s.expires_at - 60 > Date.now() / 1000) return;
    this.refreshing ??= (async () => {
      const r = await this.call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: s.refresh_token }) });
      if (!r.ok) {
        this.session = null;
        saveSession(null);
        throw new AuthError('Your sign-in expired. Please sign in again.', 'signed_out');
      }
      this.take((await r.json()) as Json);
    })().finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
  }

  private async vaultCall(query: string, init: RequestInit): Promise<Response> {
    const r = await this.call(`/rest/v1/vaults${query}`, { ...init, auth: true, headers: { Prefer: 'return=representation', ...(init.headers as Record<string, string>) } });
    if (r.status === 401) {
      this.session = null;
      saveSession(null);
      throw new AuthError('Your sign-in expired. Please sign in again.', 'signed_out');
    }
    return r;
  }

  private row = (x: unknown): Vault | null => {
    const v = x as Partial<Vault> | undefined;
    return v && typeof v.salt === 'string' && typeof v.blob === 'string' && typeof v.version === 'number' ? { salt: v.salt, blob: v.blob, version: v.version, updated_at: String(v.updated_at ?? '') } : null;
  };

  async get(): Promise<Vault | null> {
    const r = await this.vaultCall('?select=salt,blob,version,updated_at', { method: 'GET' });
    if (!r.ok) return this.failure(r);
    return this.row(((await r.json()) as unknown[])[0]);
  }

  async insert(v: { salt: string; blob: string }): Promise<Vault | null> {
    const r = await this.vaultCall('', { method: 'POST', body: JSON.stringify({ user_id: this.session?.user.id, salt: v.salt, blob: v.blob, version: 1 }) });
    if (r.status === 409) return null;
    if (!r.ok) return this.failure(r);
    return this.row(((await r.json()) as unknown[])[0]);
  }

  async update(version: number, v: { blob: string }): Promise<Vault | null> {
    const r = await this.vaultCall(`?user_id=eq.${encodeURIComponent(this.session?.user.id ?? '')}&version=eq.${version}`, {
      method: 'PATCH',
      body: JSON.stringify({ blob: v.blob, version: version + 1, updated_at: new Date().toISOString() }),
    });
    if (!r.ok) return this.failure(r);
    return this.row(((await r.json()) as unknown[])[0]);
  }

  async deleteVault(): Promise<void> {
    const r = await this.vaultCall(`?user_id=eq.${encodeURIComponent(this.session?.user.id ?? '')}`, { method: 'DELETE' });
    if (!r.ok) return this.failure(r);
  }
}
