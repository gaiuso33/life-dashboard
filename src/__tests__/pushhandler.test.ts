import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) } }));

import handler, { FAIL_KEY, TEST_LIMIT, TEST_WINDOW_MS, TIMEOUT_MS, runTick, safeEndpoint, testAllowance } from '../../api/push';
import type { SubRow } from '../../api/push';

const ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon',
  SUPABASE_SERVICE_ROLE_KEY: 'service-secret',
  VAPID_PRIVATE_KEY: 'vapid-private-secret',
  VITE_VAPID_PUBLIC_KEY: 'vapid-public',
  CRON_SECRET: 'cron-secret-value',
};

interface Out {
  status: number;
  body: unknown;
  headers: Record<string, string>;
}
async function call(method: string | undefined, auth?: string): Promise<Out> {
  const out: Out = { status: 0, body: undefined, headers: {} };
  const res = {
    status(c: number) {
      out.status = c;
      return res;
    },
    setHeader(k: string, v: string) {
      out.headers[k] = v;
      return res;
    },
    json(b: unknown) {
      out.body = b;
    },
    end() {},
  };
  await handler({ method, headers: auth === undefined ? {} : { authorization: auth } }, res);
  return out;
}

const row = (over: Partial<SubRow> = {}): SubRow => ({ endpoint: 'https://fcm.googleapis.com/send/abc', user_id: 'u1', p256dh: 'p', auth: 'a', tz: 'Africa/Lagos', schedule: [], last_sent: {}, ...over });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

let fetchMock: ReturnType<typeof vi.fn>;
let logs: string[];
beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.VITE_SUPABASE_URL;
  delete process.env.VAPID_PUBLIC_KEY;
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  sendNotification.mockReset().mockResolvedValue({});
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void logs.push(a.join(' ')));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('push handler: who may call it', () => {
  it('only accepts POST, and says so', async () => {
    for (const m of ['GET', 'PUT', undefined]) {
      const r = await call(m);
      expect(r.status).toBe(405);
      expect(r.headers.Allow).toBe('POST');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('never lets a response be cached', async () => {
    expect((await call('GET')).headers['Cache-Control']).toBe('no-store');
    expect((await call('POST', 'Bearer nope')).headers['Cache-Control']).toBe('no-store');
  });

  it.each(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VAPID_PRIVATE_KEY', 'CRON_SECRET', 'VITE_VAPID_PUBLIC_KEY'])('answers 503 when %s is missing', async (k) => {
    delete process.env[k];
    const r = await call('POST', `Bearer ${ENV.CRON_SECRET}`);
    expect(r.status).toBe(503);
    expect(JSON.stringify(r.body)).not.toContain(k);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers 401 with no token at all', async () => {
    expect((await call('POST')).status).toBe(401);
    expect((await call('POST', 'Bearer ')).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats a wrong secret as an ordinary session token and refuses it when Supabase does', async () => {
    fetchMock.mockResolvedValueOnce(json({ msg: 'bad' }, 401));
    const r = await call('POST', 'Bearer cron-secret-valuf');
    expect(r.status).toBe(401);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/auth/v1/user');
  });

  it('refuses an expired token with 401 and a plain message', async () => {
    fetchMock.mockResolvedValueOnce(json({ msg: 'token is expired' }, 401));
    const r = await call('POST', 'Bearer old.jwt.token');
    expect(r).toMatchObject({ status: 401, body: { error: 'Please sign in again.' } });
  });
});

describe('push handler: the clock', () => {
  it('reads every device, sends what is due and logs counts only', async () => {
    fetchMock.mockResolvedValueOnce(json([row({ schedule: [] })]));
    const r = await call('POST', `Bearer ${ENV.CRON_SECRET}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ devices: 1, sent: 0 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('/rest/v1/push_subscriptions');
    expect(logs.join('\n')).toMatch(/push tick: 1 devices/);
    expect(logs.join('\n')).not.toContain('fcm.googleapis');
  });

  it('answers a generic 500 when the database cannot be read, without leaking secrets', async () => {
    fetchMock.mockResolvedValueOnce(new Response('boom service-secret', { status: 500 }));
    const r = await call('POST', `Bearer ${ENV.CRON_SECRET}`);
    expect(r.status).toBe(500);
    const all = JSON.stringify(r.body) + logs.join('\n');
    for (const secret of [ENV.SUPABASE_SERVICE_ROLE_KEY, ENV.VAPID_PRIVATE_KEY, ENV.CRON_SECRET]) expect(all).not.toContain(secret);
    expect((r.body as { error: string }).error).toBe('Something went wrong sending notifications.');
  });
});

describe('push handler: Send a test', () => {
  const me = (meta: unknown = {}) => json({ id: 'u1', app_metadata: meta });
  it('sends to the signed-in person’s own devices and counts the test', async () => {
    fetchMock.mockResolvedValueOnce(me()).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json([row(), row({ endpoint: 'https://b.example/2' })]));
    const r = await call('POST', 'Bearer good.jwt');
    expect(r).toMatchObject({ status: 200, body: { sent: 2, devices: 2 } });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/auth/v1/admin/users/u1'))).toBe(true);
    expect(urls.some((u) => u.includes('user_id=eq.u1'))).toBe(true);
    const put = fetchMock.mock.calls.find((c) => String(c[0]).includes('/admin/users/'))![1] as RequestInit;
    expect(put.method).toBe('PUT');
    expect(JSON.parse(String(put.body)).app_metadata.push_tests).toHaveLength(1);
  });

  it('keeps other app_metadata when it records a test', async () => {
    fetchMock.mockResolvedValueOnce(me({ provider: 'email', role: 'x' })).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json([]));
    await call('POST', 'Bearer good.jwt');
    const put = fetchMock.mock.calls.find((c) => String(c[0]).includes('/admin/users/'))![1] as RequestInit;
    expect(JSON.parse(String(put.body)).app_metadata).toMatchObject({ provider: 'email', role: 'x' });
  });

  it('refuses the sixth test in an hour with 429 and how long to wait, sending nothing', async () => {
    const now = Date.now();
    const stamps = Array.from({ length: TEST_LIMIT }, (_, i) => now - (50 - i) * 60_000);
    fetchMock.mockResolvedValueOnce(me({ push_tests: stamps }));
    const r = await call('POST', 'Bearer good.jwt');
    expect(r.status).toBe(429);
    expect((r.body as { error: string }).error).toMatch(/Try again in \d+ minutes?\./);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still sends if recording the test fails', async () => {
    fetchMock.mockResolvedValueOnce(me()).mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(json([row()]));
    const r = await call('POST', 'Bearer good.jwt');
    expect(r).toMatchObject({ status: 200, body: { sent: 1 } });
  });

  it('removes devices the push service says are gone', async () => {
    sendNotification.mockRejectedValueOnce(Object.assign(new Error('gone'), { statusCode: 410 }));
    fetchMock.mockResolvedValueOnce(me()).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json([row()])).mockResolvedValueOnce(json({}));
    const r = await call('POST', 'Bearer good.jwt');
    expect(r.body).toMatchObject({ sent: 0, devices: 1 });
    expect(fetchMock.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === 'DELETE')).toBe(true);
  });
});

describe('the test limit', () => {
  const now = 1_000_000_000_000;
  it('allows up to the limit inside the window', () => {
    expect(testAllowance(undefined, now).allowed).toBe(true);
    expect(testAllowance([now - 1000, now - 2000], now).allowed).toBe(true);
    expect(testAllowance(Array(TEST_LIMIT).fill(now - 1000), now).allowed).toBe(false);
  });
  it('forgets tests older than the window and ignores junk', () => {
    const a = testAllowance([...Array(TEST_LIMIT).fill(now - TEST_WINDOW_MS - 1), 'x', null, NaN, now + 99999], now);
    expect(a.allowed).toBe(true);
    expect(a.recent).toEqual([]);
  });
  it('tells you when the oldest one expires', () => {
    const stamps = [10, 20, 30, 40, 50].map((m) => now - m * 60_000);
    expect(testAllowance(stamps, now).waitMinutes).toBe(10);
  });
});

describe('tracking a device that cannot be reached', () => {
  const NOW = new Date(Date.UTC(2026, 9, 12, 20, 0, 0)); // 21:00 in Lagos
  const sched = [{ id: 'checkin', time: '21:00', days: [], title: 't', body: 'b' }];
  it('records when sends first fail, and keeps the first time', async () => {
    const res = await runTick([row({ schedule: sched })], NOW, async () => 'retry');
    expect(res.updates[0].last_sent[FAIL_KEY]).toBe(NOW.toISOString());
    expect(res.updates[0].last_sent.checkin).toBeUndefined();
    const again = await runTick([row({ schedule: sched, last_sent: { [FAIL_KEY]: '2026-10-12T19:50:00.000Z' } })], NOW, async () => 'retry');
    expect(again.updates).toEqual([]);
  });
  it('clears the mark once a send gets through, and keeps it out of the pruning', async () => {
    const ok = await runTick([row({ schedule: sched, last_sent: { [FAIL_KEY]: '2026-10-12T19:50:00.000Z' } })], NOW, async () => 'ok');
    expect(ok.updates[0].last_sent).toEqual({ checkin: '2026-10-12' });
  });
  it('does not touch a device that is simply gone', async () => {
    const res = await runTick([row({ schedule: sched })], NOW, async () => 'gone');
    expect(res.updates).toEqual([]);
    expect(res.gone).toHaveLength(1);
  });
});

describe('safe push addresses', () => {
  it('accepts the real push services', () => {
    for (const u of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/xyz', 'https://web.push.apple.com/QAbc', 'https://wns2-par02p.notify.windows.com/w/?token=1']) expect(safeEndpoint(u)).toBe(true);
  });
  it('refuses anything that could reach inside a network or carry a login', () => {
    const bad = ['http://fcm.googleapis.com/x', 'https://localhost/x', 'https://127.0.0.1/x', 'https://169.254.169.254/latest', 'https://10.0.0.5/x', 'https://db.internal/x', 'https://printer.local/x', 'https://intranet/x', 'https://user:pw@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'ftp://fcm.googleapis.com/x', 'not a url', '', 'https://' + 'a'.repeat(2100) + '.com/x', null, 42];
    for (const u of bad) expect(safeEndpoint(u), String(u)).toBe(false);
  });
});

describe('push handler: unsafe addresses and slow services', () => {
  const sched = [{ id: 'checkin', time: '21:00', days: [], title: 't', body: 'b' }];
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 20, 0, 0)));
  });
  afterEach(() => vi.useRealTimers());

  it('never contacts an unsafe address and removes that device', async () => {
    const evil = row({ endpoint: 'https://169.254.169.254/latest/meta-data', schedule: sched });
    fetchMock.mockResolvedValueOnce(json([evil])).mockResolvedValue(json({}));
    const r = await call('POST', `Bearer ${ENV.CRON_SECRET}`);
    expect(r.status).toBe(200);
    expect(sendNotification).not.toHaveBeenCalled();
    expect(r.body).toMatchObject({ gone: ['https://169.254.169.254/latest/meta-data'] });
    expect(fetchMock.mock.calls.some(([u, init]) => String(u).includes('endpoint=eq.') && (init as RequestInit).method === 'DELETE')).toBe(true);
  });

  it('still sends to a normal address', async () => {
    fetchMock.mockResolvedValueOnce(json([row({ schedule: sched })])).mockResolvedValue(json({}));
    await call('POST', `Bearer ${ENV.CRON_SECRET}`);
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(sendNotification.mock.calls[0][2]).toMatchObject({ timeout: TIMEOUT_MS });
  });

  it('puts a time limit on every call it makes to Supabase', async () => {
    fetchMock.mockResolvedValueOnce(json([]));
    await call('POST', `Bearer ${ENV.CRON_SECRET}`);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    fetchMock.mockReset().mockResolvedValueOnce(json({ id: 'u1', app_metadata: {} })).mockResolvedValueOnce(json({})).mockResolvedValueOnce(json([]));
    await call('POST', 'Bearer some-session-token');
    for (const [, init] of fetchMock.mock.calls) expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });
});
