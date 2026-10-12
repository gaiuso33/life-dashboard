// A small stand-in for the parts of Supabase the app uses (email login, token refresh, password reset and the
// `vaults` table with row-level rules), so cloud sync can be tested end to end without the real service.
// Test-only admin endpoints under /__admin let the tests inspect and reset it.
import http from 'http';
import crypto from 'crypto';

const PORT = Number(process.env.MOCK_PORT ?? 4600);
const ANON = 'test-anon';
const fresh = () => ({ users: new Map(), vaults: new Map(), tokens: new Map(), log: [], sent: [], opts: { confirmEmail: false, ttlMs: 3600e3 } });
let st = fresh();
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'apikey,authorization,content-type,prefer,x-client-info', 'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS' };

const issue = (u) => {
  const access = 'a.' + crypto.randomUUID();
  const refresh = 'r.' + crypto.randomUUID();
  st.tokens.set(access, { uid: u.id, exp: Date.now() + st.opts.ttlMs });
  st.tokens.set(refresh, { uid: u.id, refresh: true });
  return { access_token: access, refresh_token: refresh, expires_in: 3600, expires_at: Math.floor((Date.now() + st.opts.ttlMs) / 1000), user: { id: u.id, email: u.email } };
};

http
  .createServer(async (q, r) => {
    const send = (code, body) => {
      r.writeHead(code, { ...cors, 'content-type': 'application/json' });
      r.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (q.method === 'OPTIONS') {
      r.writeHead(204, cors);
      return r.end();
    }
    let raw = '';
    for await (const c of q) raw += c;
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(q.url, 'http://x');

    if (url.pathname === '/__admin/state') {
      return send(200, {
        users: [...st.users.values()],
        vaults: [...st.vaults.values()].map((v) => ({ user_id: v.user_id, version: v.version, salt: v.salt, blob: v.blob })),
        liveAccessTokens: [...st.tokens].filter(([, t]) => !t.refresh && t.exp > Date.now()).map(([k]) => k),
        log: st.log,
        sent: st.sent,
      });
    }
    if (url.pathname === '/__admin/reset') {
      st = fresh();
      Object.assign(st.opts, body);
      return send(200, {});
    }
    st.log.push(q.method + ' ' + url.pathname + url.search);
    if (q.headers.apikey !== ANON) return send(401, { message: 'No API key' });
    const bearer = (q.headers.authorization || '').replace('Bearer ', '');
    const who = () => {
      const t = st.tokens.get(bearer);
      return t && !t.refresh && t.exp > Date.now() ? t.uid : null;
    };

    if (url.pathname === '/auth/v1/signup') {
      if ([...st.users.values()].some((u) => u.email === body.email)) return send(422, { error_code: 'user_already_exists', msg: 'User already registered' });
      const u = { id: crypto.randomUUID(), email: body.email, password: body.password };
      st.users.set(u.id, u);
      return st.opts.confirmEmail ? send(200, { id: u.id, email: u.email }) : send(200, issue(u));
    }
    if (url.pathname === '/auth/v1/token') {
      const g = url.searchParams.get('grant_type');
      if (g === 'password') {
        const u = [...st.users.values()].find((x) => x.email === body.email && x.password === body.password);
        return u ? send(200, issue(u)) : send(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      if (g === 'refresh_token') {
        const t = st.tokens.get(body.refresh_token);
        return t && t.refresh ? send(200, issue(st.users.get(t.uid))) : send(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
      }
    }
    if (url.pathname === '/auth/v1/logout') {
      st.tokens.delete(bearer);
      return send(204);
    }
    if (url.pathname === '/auth/v1/recover') {
      st.sent.push({ type: 'recover', email: body.email });
      return send(200, {});
    }
    if (url.pathname === '/auth/v1/user' && q.method === 'PUT') {
      const uid = who();
      if (!uid) return send(401, { msg: 'bad jwt' });
      st.users.get(uid).password = body.password;
      return send(200, {});
    }
    if (url.pathname === '/rest/v1/rpc/delete_my_account' && q.method === 'POST') {
      const uid = who();
      if (!uid) return send(401, { message: 'JWT expired', code: 'PGRST301' });
      st.users.delete(uid);
      st.vaults.delete(uid);
      for (const [k, t] of st.tokens) if (t.uid === uid) st.tokens.delete(k);
      return send(204);
    }
    if (url.pathname === '/rest/v1/vaults') {
      const uid = who();
      if (!uid) return send(401, { message: 'JWT expired', code: 'PGRST301' });
      const row = st.vaults.get(uid);
      if (q.method === 'GET') return send(200, row ? [row] : []);
      if (q.method === 'POST') {
        if (body.user_id !== uid) return send(403, { message: 'row-level security' });
        if (row) return send(409, { code: '23505', message: 'duplicate key' });
        const n = { ...body, updated_at: new Date().toISOString() };
        st.vaults.set(uid, n);
        return send(201, [n]);
      }
      if (q.method === 'PATCH') {
        const v = Number(/version=eq\.(\d+)/.exec(url.search)?.[1]);
        if (!row || row.version !== v) return send(200, []);
        const n = { ...row, ...body };
        st.vaults.set(uid, n);
        return send(200, [n]);
      }
      if (q.method === 'DELETE') {
        st.vaults.delete(uid);
        return send(200, []);
      }
    }
    send(404, { message: 'not found ' + url.pathname });
  })
  .listen(PORT, () => console.log('mock supabase on ' + PORT));
