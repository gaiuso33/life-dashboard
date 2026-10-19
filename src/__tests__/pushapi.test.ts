import { describe, expect, it } from 'vitest';
import { DEVICE_CAP, TEST_LIMIT, TEST_WINDOW_MS, createHandler, looksLikeSessionToken, runTick, safeEndpoint } from '../../api/push';
import type { Deps, Payload, Req, Res, SendOutcome, SubRow } from '../../api/push';

// The push function from the outside: every way it can be called, against a fake Supabase and a fake push sender.
// Nothing here touches the network.

const SECRET = 'cron-secret-value-0123456789';
const SERVICE_KEY = 'service-role-key-SHOULD-NEVER-LEAK';
const VAPID_PRIVATE = 'vapid-private-key-SHOULD-NEVER-LEAK';
const ANON = 'anon-key';
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';
const seg = (n: string) => n.padEnd(12, 'x');
const jwt = (name: string) => `${seg('h' + name)}.${seg('p' + name)}.${seg('s' + name)}`;
const TOKEN_A = jwt('alice');
const TOKEN_B = jwt('bob');
const NOW = new Date('2026-10-19T08:00:00.000Z'); // 09:00 in Lagos

const FULL_ENV: Record<string, string> = {
  SUPABASE_URL: 'https://proj.supabase.co/',
  VITE_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  VITE_VAPID_PUBLIC_KEY: 'public-key',
  VAPID_PRIVATE_KEY: VAPID_PRIVATE,
  CRON_SECRET: SECRET,
};

const everyDay = (id: string, time: string) => ({ id, time, days: [], title: `Title ${id}`, body: `Body ${id}` });
const device = (endpoint: string, user_id: string, over: Partial<SubRow> = {}): SubRow => ({
  endpoint,
  user_id,
  p256dh: 'k',
  auth: 'a',
  tz: 'Africa/Lagos',
  schedule: [everyDay('checkin', '09:00')],
  last_sent: {},
  ...over,
});

interface Call {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: unknown;
}

/** Enough of Supabase for the function: auth, the devices table, and the test log. */
class FakeSupabase {
  sessions = new Map<string, string | { status: number }>([[TOKEN_A, ALICE], [TOKEN_B, BOB]]);
  devices: SubRow[] = [];
  tests: { user_id: string; at: string }[] = [];
  healthColumns = true;
  testLogTable = true;
  deviceStatus = 0; // force an error status on the devices table
  authDown = false;
  calls: Call[] = [];

  fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const u = new URL(url);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = init.headers as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, path: u.pathname, query: u.searchParams, headers, body });
    const json = (status: number, b: unknown = {}) => new Response(status === 204 ? null : JSON.stringify(b), { status });

    if (u.pathname === '/auth/v1/user') {
      if (this.authDown) return json(503);
      const s = this.sessions.get((headers.Authorization ?? '').replace('Bearer ', ''));
      if (s === undefined) return json(401, { msg: 'bad jwt' });
      if (typeof s === 'object') return json(s.status);
      return json(200, { id: s });
    }
    const filter = (col: string) => /^eq\.(.*)$/.exec(u.searchParams.get(col) ?? '')?.[1];
    if (u.pathname === '/rest/v1/push_subscriptions') {
      if (this.deviceStatus) return json(this.deviceStatus);
      if (method === 'GET') {
        if (!this.healthColumns && /failing_since|last_error/.test(u.searchParams.get('select') ?? '')) return json(400, { message: 'column does not exist' });
        const user = filter('user_id');
        let rows = this.devices.filter((r) => !user || r.user_id === user);
        const limit = Number(u.searchParams.get('limit') ?? 1e9);
        rows = rows.slice(0, limit);
        return json(200, rows);
      }
      const ep = filter('endpoint');
      const row = this.devices.find((r) => r.endpoint === ep);
      if (method === 'PATCH') {
        const b = body as Record<string, unknown>;
        if (!this.healthColumns && ('failing_since' in b || 'last_error' in b)) return json(400, { message: 'column does not exist' });
        if (row) Object.assign(row, b);
        return json(204);
      }
      if (method === 'DELETE') {
        this.devices = this.devices.filter((r) => r.endpoint !== ep);
        return json(204);
      }
    }
    if (u.pathname === '/rest/v1/push_test_log') {
      if (!this.testLogTable) return json(404, { message: 'relation does not exist' });
      if (method === 'GET') {
        const user = filter('user_id');
        const gte = /^gte\.(.*)$/.exec(u.searchParams.get('at') ?? '')?.[1] ?? '';
        const rows = this.tests.filter((t) => t.user_id === user && t.at >= gte).sort((a, b) => a.at.localeCompare(b.at)).slice(0, Number(u.searchParams.get('limit')));
        return json(200, rows.map((t) => ({ at: t.at })));
      }
      if (method === 'POST') {
        this.tests.push(body as { user_id: string; at: string });
        return json(201);
      }
      if (method === 'DELETE') {
        const user = filter('user_id');
        const lt = /^lt\.(.*)$/.exec(u.searchParams.get('at') ?? '')?.[1] ?? '';
        this.tests = this.tests.filter((t) => !(t.user_id === user && t.at < lt));
        return json(204);
      }
    }
    return json(404);
  };
}

interface Rig {
  db: FakeSupabase;
  logs: string[];
  sent: { endpoint: string; payload: Payload }[];
  outcome: (row: SubRow) => SendOutcome;
  clock: { now: Date };
  env: Record<string, string>;
  call: (req: Partial<Req>) => Promise<{ status: number; body: unknown; headers: Record<string, string> }>;
  setOutcome: (f: (row: SubRow) => SendOutcome) => void;
}

function rig(env: Record<string, string> = FULL_ENV): Rig {
  const db = new FakeSupabase();
  const logs: string[] = [];
  const sent: Rig['sent'] = [];
  const clock = { now: NOW };
  let outcome: (row: SubRow) => SendOutcome = () => 'ok';
  const deps: Deps = {
    env: (k) => env[k] ?? '',
    fetch: db.fetch,
    makeSender: async () => async (row, payload) => {
      sent.push({ endpoint: row.endpoint, payload });
      return outcome(row);
    },
    now: () => clock.now,
    log: (l) => logs.push(l),
  };
  const handler = createHandler(deps);
  const call: Rig['call'] = async (req) => {
    let status = 0;
    let body: unknown;
    const headers: Record<string, string> = {};
    const res: Res = {
      status(c) {
        status = c;
        return res;
      },
      setHeader(n, v) {
        headers[n] = v;
        return res;
      },
      json(b) {
        body = b;
      },
      end() {},
    };
    await handler({ method: 'POST', headers: {}, ...req }, res);
    return { status, body, headers };
  };
  return { db, logs, sent, outcome, clock, env, call, setOutcome: (f) => (outcome = f) };
}

const bearer = (t: string): Partial<Req> => ({ headers: { authorization: `Bearer ${t}` } });
const cron = () => bearer(SECRET);
const logged = (r: Rig) => r.logs.map((l) => JSON.parse(l) as Record<string, unknown>);

describe('who is let in', () => {
  it('refuses anything but POST, and says which method is allowed', async () => {
    const r = rig();
    for (const method of ['GET', 'PUT', 'DELETE', undefined]) {
      const out = await r.call({ method });
      expect(out.status).toBe(405);
      expect(out.headers.Allow).toBe('POST');
    }
    expect(r.db.calls).toEqual([]);
  });
  it('says it is not set up when anything it needs is missing, before doing any work', async () => {
    for (const key of Object.keys(FULL_ENV).filter((k) => k !== 'VITE_SUPABASE_ANON_KEY')) {
      const env = { ...FULL_ENV };
      delete env[key];
      if (key === 'VITE_VAPID_PUBLIC_KEY') delete env.VAPID_PUBLIC_KEY;
      const r = rig(env);
      const out = await r.call(cron());
      expect(out.status, `missing ${key}`).toBe(503);
      expect(r.db.calls, `missing ${key}`).toEqual([]);
    }
  });
  it('turns away a request with no token, and one with a token that is not a session token, without asking Supabase', async () => {
    const r = rig();
    expect((await r.call({})).status).toBe(401);
    expect((await r.call(bearer(''))).status).toBe(401);
    for (const t of ['not-a-token', 'a.b', 'a.b.c.d', 'x'.repeat(5000), 'wrong-secret', `${SECRET}x`, SECRET.slice(0, -1)]) {
      const out = await r.call(bearer(t));
      expect(out.status, t.slice(0, 20)).toBe(401);
    }
    expect(r.db.calls).toEqual([]);
  });
  it('a session token Supabase does not accept (expired, forged, signed out) is turned away', async () => {
    const r = rig();
    const out = await r.call(bearer(jwt('forged')));
    expect(out.status).toBe(401);
    expect(out.body).toEqual({ error: 'Please sign in again.' });
    expect(r.sent).toEqual([]);
    r.db.sessions.set(jwt('expired'), { status: 403 });
    expect((await r.call(bearer(jwt('expired')))).status).toBe(401);
  });
  it('a reply that carries no user, or a malformed user id, is not trusted', async () => {
    const r = rig();
    r.db.sessions.set(jwt('odd'), "' or 1=1 --");
    expect((await r.call(bearer(jwt('odd')))).status).toBe(401);
    expect(r.db.calls.every((c) => !c.path.includes('push_'))).toBe(true);
  });
  it('an outage at Supabase is a server error, not "sign in again"', async () => {
    const r = rig();
    r.db.authDown = true;
    const out = await r.call(bearer(TOKEN_A));
    expect(out.status).toBe(500);
    expect(out.body).toEqual({ error: 'Something went wrong sending notifications.' });
  });
  it('the sign-in token check', () => {
    expect(looksLikeSessionToken(TOKEN_A)).toBe(true);
    for (const t of ['', 'a', 'a.b', 'a..c', 'a.b.', '.b.c', 'a b.c.d', 'a.b.c!', 'x'.repeat(4100)]) expect(looksLikeSessionToken(t), t.slice(0, 10)).toBe(false);
  });
  it('accepts the shared secret in either case of "Bearer"', async () => {
    const r = rig();
    expect((await r.call({ headers: { authorization: `bearer ${SECRET}` } })).status).toBe(200);
    expect((await r.call({ headers: { authorization: [`Bearer ${SECRET}`] as unknown as string } })).status).toBe(200);
  });
});

describe('the clock (every minute)', () => {
  it('sends what is due, remembers it, and does not send it again the next minute', async () => {
    const r = rig();
    r.db.devices = [device('https://p.example/a'.padEnd(40, 'a'), ALICE)];
    const first = await r.call(cron());
    expect(first).toMatchObject({ status: 200, body: { devices: 1, due: 1, sent: 1, retry: 0, removed: 0, failing: 0 } });
    expect(r.sent.map((s) => s.payload.tag)).toEqual(['checkin']);
    expect(r.db.devices[0].last_sent).toEqual({ checkin: '2026-10-19' });
    r.clock.now = new Date(NOW.getTime() + 60_000);
    const second = await r.call(cron());
    expect(second.body).toMatchObject({ due: 0, sent: 0 });
    expect(r.sent).toHaveLength(1);
  });
  it('uses the service key to read devices, and the reply does not list device addresses', async () => {
    const r = rig();
    const ep = 'https://p.example/' + 'a'.repeat(30);
    r.db.devices = [device(ep, ALICE)];
    const out = await r.call(cron());
    expect(JSON.stringify(out.body)).not.toContain(ep);
    const reads = r.db.calls.filter((c) => c.path === '/rest/v1/push_subscriptions');
    expect(reads.length).toBeGreaterThan(0);
    for (const c of reads) expect(c.headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
  });
  it('removes a device the push service says is gone', async () => {
    const r = rig();
    r.db.devices = [device('https://p.example/' + 'g'.repeat(30), ALICE), device('https://p.example/' + 'h'.repeat(30), ALICE)];
    r.setOutcome((row) => (row.endpoint.endsWith('g'.repeat(30)) ? 'gone' : 'ok'));
    const out = await r.call(cron());
    expect(out.body).toMatchObject({ sent: 1, removed: 1 });
    expect(r.db.devices.map((x) => x.endpoint)).toEqual(['https://p.example/' + 'h'.repeat(30)]);
  });
  it('a failure to read devices is a server error with a plain message, and the reason goes only to the log', async () => {
    const r = rig();
    r.db.deviceStatus = 500;
    const out = await r.call(cron());
    expect(out).toMatchObject({ status: 500, body: { error: 'Something went wrong sending notifications.' } });
    expect(logged(r).find((l) => l.evt === 'push-error')?.error).toContain('500');
  });
  it('writes one summary line per run, with counts only', async () => {
    const r = rig();
    r.db.devices = [device('https://p.example/' + 'a'.repeat(30), ALICE), device('https://p.example/' + 'b'.repeat(30), BOB, { tz: 'America/Los_Angeles' })];
    await r.call(cron());
    expect(r.logs).toHaveLength(1);
    expect(logged(r)[0]).toMatchObject({ evt: 'push-tick', devices: 2, due: 1, sent: 1, retry: 0, removed: 0, failing: 0, capped: false, healthColumns: true });
    expect(typeof logged(r)[0].ms).toBe('number');
  });
  it('says so in the log when it reaches the most devices it reads in one run', async () => {
    const r = rig();
    r.db.devices = Array.from({ length: DEVICE_CAP }, (_, i) => device(`https://p.example/${String(i).padStart(30, '0')}`, ALICE, { tz: 'America/Los_Angeles' }));
    await r.call(cron());
    expect(logged(r)[0]).toMatchObject({ devices: DEVICE_CAP, capped: true });
  });
});

describe('noticing a device that cannot be reached', () => {
  const EP = 'https://p.example/' + 'f'.repeat(30);
  it('notes when it started failing and why, once, and does not rewrite it every minute', async () => {
    const r = rig();
    r.db.devices = [device(EP, ALICE)];
    r.setOutcome(() => ({ result: 'retry', code: '403' }));
    const out = await r.call(cron());
    expect(out.body).toMatchObject({ sent: 0, retry: 1, failing: 1 });
    expect(r.db.devices[0]).toMatchObject({ failing_since: NOW.toISOString(), last_error: '403' });
    // It keeps failing: nothing is rewritten, and the start time is kept.
    const before = r.db.calls.length;
    r.clock.now = new Date(NOW.getTime() + 60_000);
    await r.call(cron());
    expect(r.db.devices[0].failing_since).toBe(NOW.toISOString());
    expect(r.db.calls.slice(before).filter((c) => c.method === 'PATCH')).toEqual([]);
  });
  it('updates the reason if it changes, but keeps the original start time', async () => {
    const r = rig();
    r.db.devices = [device(EP, ALICE, { failing_since: '2026-10-17T00:00:00.000Z', last_error: '403' })];
    r.setOutcome(() => ({ result: 'retry', code: '500' }));
    await r.call(cron());
    expect(r.db.devices[0]).toMatchObject({ failing_since: '2026-10-17T00:00:00.000Z', last_error: '500' });
  });
  it('clears the note as soon as a send gets through', async () => {
    const r = rig();
    r.db.devices = [device(EP, ALICE, { failing_since: '2026-10-17T00:00:00.000Z', last_error: '403' })];
    await r.call(cron());
    expect(r.db.devices[0]).toMatchObject({ failing_since: null, last_error: null });
  });
  it('a plain "retry" with no reason is still noted, and a thrown error counts as a network failure', async () => {
    const r = rig();
    r.db.devices = [device(EP, ALICE)];
    r.setOutcome(() => 'retry');
    await r.call(cron());
    expect(r.db.devices[0].last_error).toBe('error');
    const r2 = rig();
    r2.db.devices = [device(EP, ALICE)];
    const out = await runTick(r2.db.devices, NOW, async () => {
      throw new Error('boom');
    });
    expect(out.healthUpdates).toEqual([{ endpoint: EP, failing_since: NOW.toISOString(), last_error: 'network' }]);
  });
  it('a device the push service has dropped is removed, not marked as failing', async () => {
    const r = rig();
    r.db.devices = [device(EP, ALICE)];
    r.setOutcome(() => 'gone');
    const out = await r.call(cron());
    expect(out.body).toMatchObject({ removed: 1, failing: 0 });
    expect(r.db.devices).toEqual([]);
  });
  it('sending still works, and is still only sent once, before the new columns have been added to the database', async () => {
    const r = rig();
    r.db.healthColumns = false;
    r.db.devices = [device(EP, ALICE)];
    const out = await r.call(cron());
    expect(out).toMatchObject({ status: 200, body: { sent: 1 } });
    expect(r.db.devices[0].last_sent).toEqual({ checkin: '2026-10-19' });
    expect(logged(r)[0]).toMatchObject({ healthColumns: false });
    // and it never tried to write them
    expect(r.db.calls.filter((c) => c.method === 'PATCH' && c.body && 'failing_since' in (c.body as object))).toEqual([]);
    r.clock.now = new Date(NOW.getTime() + 60_000);
    await r.call(cron());
    expect(r.sent).toHaveLength(1);
  });
  it('last-sent is saved on its own, so a problem with the new columns can never cause a repeat', async () => {
    const r = rig();
    r.db.devices = [device(EP, ALICE)];
    await r.call(cron());
    const patches = r.db.calls.filter((c) => c.method === 'PATCH');
    expect(patches.some((c) => c.body && 'last_sent' in (c.body as object) && !('failing_since' in (c.body as object)))).toBe(true);
  });
});

describe('"Send a test"', () => {
  const A1 = 'https://p.example/' + 'a'.repeat(30);
  const A2 = 'https://p.example/' + 'b'.repeat(30);
  const B1 = 'https://p.example/' + 'c'.repeat(30);
  const setup = () => {
    const r = rig();
    r.db.devices = [device(A1, ALICE), device(A2, ALICE), device(B1, BOB)];
    return r;
  };
  it('sends only to the signed-in person’s own devices', async () => {
    const r = setup();
    const out = await r.call(bearer(TOKEN_A));
    expect(out).toMatchObject({ status: 200, body: { sent: 2, devices: 2 } });
    expect(r.sent.map((s) => s.endpoint).sort()).toEqual([A1, A2]);
    expect(r.sent.every((s) => s.payload.tag === 'test')).toBe(true);
    const other = await r.call(bearer(TOKEN_B));
    expect(other.body).toMatchObject({ sent: 1, devices: 1 });
    expect(r.sent.map((s) => s.endpoint)).toContain(B1);
  });
  it('checks the token with Supabase using the anon key, never the service key, when an anon key is set', async () => {
    const r = setup();
    await r.call(bearer(TOKEN_A));
    const auth = r.db.calls.find((c) => c.path === '/auth/v1/user')!;
    expect(auth.headers.apikey).toBe(ANON);
    expect(auth.headers.Authorization).toBe(`Bearer ${TOKEN_A}`);
  });
  it('reports zero devices plainly, and removes ones the push service dropped', async () => {
    const r = rig();
    expect((await r.call(bearer(TOKEN_A))).body).toEqual({ sent: 0, devices: 0 });
    const s = setup();
    s.setOutcome((row) => (row.endpoint === A1 ? 'gone' : 'ok'));
    const out = await s.call(bearer(TOKEN_A));
    expect(out.body).toEqual({ sent: 1, devices: 2 });
    expect(s.db.devices.map((x) => x.endpoint).sort()).toEqual([A2, B1]);
  });
  it('a thrown error from the sender counts as not sent, and does not stop the others', async () => {
    const r = setup();
    r.setOutcome((row) => {
      if (row.endpoint === A1) throw new Error('boom');
      return 'ok';
    });
    expect((await r.call(bearer(TOKEN_A))).body).toEqual({ sent: 1, devices: 2 });
  });

  it(`allows ${TEST_LIMIT} tests in an hour, then says to wait and how long`, async () => {
    const r = setup();
    for (let i = 0; i < TEST_LIMIT; i++) {
      r.clock.now = new Date(NOW.getTime() + i * 60_000);
      expect((await r.call(bearer(TOKEN_A))).status, `test ${i + 1}`).toBe(200);
    }
    const sentBefore = r.sent.length;
    r.clock.now = new Date(NOW.getTime() + 10 * 60_000); // ten minutes after the first
    const out = await r.call(bearer(TOKEN_A));
    expect(out.status).toBe(429);
    expect(out.headers['Retry-After']).toBe(String(50 * 60));
    expect(out.body).toEqual({ error: 'You have sent several tests in the last hour. Try again in 50 minutes.' });
    expect(r.sent).toHaveLength(sentBefore); // nothing was sent
    expect(r.db.tests).toHaveLength(TEST_LIMIT); // and the refused one was not counted
  });
  it('the limit slides: once the oldest test is an hour old, one more is allowed', async () => {
    const r = setup();
    for (let i = 0; i < TEST_LIMIT; i++) {
      r.clock.now = new Date(NOW.getTime() + i * 60_000);
      await r.call(bearer(TOKEN_A));
    }
    r.clock.now = new Date(NOW.getTime() + TEST_WINDOW_MS - 1000);
    expect((await r.call(bearer(TOKEN_A))).status).toBe(429);
    r.clock.now = new Date(NOW.getTime() + TEST_WINDOW_MS + 1000);
    expect((await r.call(bearer(TOKEN_A))).status).toBe(200);
  });
  it('one person’s tests do not use up another person’s', async () => {
    const r = setup();
    for (let i = 0; i < TEST_LIMIT; i++) await r.call(bearer(TOKEN_A));
    expect((await r.call(bearer(TOKEN_A))).status).toBe(429);
    expect((await r.call(bearer(TOKEN_B))).status).toBe(200);
  });
  it('the clock’s own runs are never limited, and do not count as tests', async () => {
    const r = setup();
    for (let i = 0; i < TEST_LIMIT + 3; i++) expect((await r.call(cron())).status).toBe(200);
    expect(r.db.tests).toEqual([]);
  });
  it('tidies away that person’s test records older than a day, and nobody else’s', async () => {
    const r = setup();
    const old = new Date(NOW.getTime() - 25 * 3600_000).toISOString();
    r.db.tests = [{ user_id: ALICE, at: old }, { user_id: BOB, at: old }];
    await r.call(bearer(TOKEN_A));
    expect(r.db.tests).toEqual([{ user_id: BOB, at: old }, { user_id: ALICE, at: NOW.toISOString() }]);
  });
  it('still sends a test when the log table has not been created yet, and says so in the log', async () => {
    const r = setup();
    r.db.testLogTable = false;
    for (let i = 0; i < TEST_LIMIT + 2; i++) expect((await r.call(bearer(TOKEN_A))).status).toBe(200);
    expect(logged(r).some((l) => l.evt === 'push-limit-unavailable')).toBe(true);
  });
  it('logs each test without saying who asked or which devices', async () => {
    const r = setup();
    await r.call(bearer(TOKEN_A));
    expect(logged(r).filter((l) => l.evt === 'push-test')).toEqual([{ evt: 'push-test', devices: 2, sent: 2, removed: 0 }]);
  });
});

describe('nothing secret is ever said', () => {
  it('no reply and no log line contains a key, the shared secret, or a person’s token', async () => {
    const r = rig();
    r.db.devices = [device('https://p.example/' + 'a'.repeat(30), ALICE)];
    const replies: unknown[] = [];
    replies.push((await r.call(cron())).body);
    replies.push((await r.call(bearer(TOKEN_A))).body);
    replies.push((await r.call(bearer(jwt('forged')))).body);
    replies.push((await r.call({})).body);
    r.db.deviceStatus = 500;
    replies.push((await r.call(cron())).body);
    replies.push((await r.call(bearer(TOKEN_A))).body);
    const everything = JSON.stringify(replies) + r.logs.join('\n');
    for (const secret of [SECRET, SERVICE_KEY, VAPID_PRIVATE, TOKEN_A, TOKEN_B, ANON]) expect(everything).not.toContain(secret);
  });
});

describe('where it is willing to send', () => {
  it('accepts the real push services, and nothing that is not https on a public host', () => {
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bH',
      'https://web.push.apple.com/QGxyfJ1p2mZ',
      'https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB',
      'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD',
      'https://example.com:443/push',
    ])
      expect(safeEndpoint(ok), ok).toBe(true);
    for (const bad of [
      'http://fcm.googleapis.com/fcm/send/x', // not https
      'https://localhost/x',
      'https://localhost:3000/x',
      'https://127.0.0.1/x',
      'https://10.0.0.1/x',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x',
      'https://2130706433/x', // the same address written as one number
      'https://0x7f.1/x',
      'https://printer.local/x',
      'https://db.internal/x',
      'https://intranet/x',
      'https://user:pass@example.com/x',
      'https://example.com:8443/x',
      'https://example.com./x',
      'ftp://example.com/x',
      'javascript:alert(1)',
      'not a url',
      '',
      'https://example.com/' + 'a'.repeat(2000),
    ])
      expect(safeEndpoint(bad), bad.slice(0, 40)).toBe(false);
    for (const odd of [null, undefined, 42, {}, ['https://example.com/']]) expect(safeEndpoint(odd)).toBe(false);
  });
  it('never sends to an unsafe address, on the clock or for a test, and shows it as blocked', async () => {
    const r = rig();
    const evil = ['http://169.254.169.254/latest/meta-data', 'https://localhost/x', 'https://10.0.0.1/x'].map((e) => device(e, ALICE));
    const fine = device('https://fcm.googleapis.com/fcm/send/' + 'a'.repeat(20), ALICE);
    r.db.devices = [...evil, fine];
    const out = await r.call(cron());
    expect(out.body).toMatchObject({ devices: 4, due: 4, sent: 1, retry: 3, failing: 3 });
    expect(r.sent.map((s) => s.endpoint)).toEqual([fine.endpoint]);
    expect(r.db.devices.filter((d) => d.last_error === 'blocked')).toHaveLength(3);
    expect(r.db.devices).toHaveLength(4); // skipped, not deleted
    r.sent.length = 0;
    const test = await r.call(bearer(TOKEN_A));
    expect(test.body).toEqual({ sent: 1, devices: 4 });
    expect(r.sent.map((s) => s.endpoint)).toEqual([fine.endpoint]);
  });
});
