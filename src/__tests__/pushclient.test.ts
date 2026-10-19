import { describe, expect, it } from 'vitest';
import { AuthError, CloudApi, NetworkError } from '../cloud/api';
import type { CloudSession } from '../cloud/api';

// The app's side of the push calls: listing the account's devices (also against a database that has not been given the
// newer columns), and asking the server for a test. A fake `fetch` stands in for the network.

const SESSION: CloudSession = { access_token: 'tok-123', refresh_token: 'ref', expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: 'u1', email: 'a@b.c' } };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function make(handler: (url: string, init: RequestInit) => Response | Promise<Response>, signedIn = true) {
  const calls: { url: string; init: RequestInit }[] = [];
  const api = new CloudApi({ url: 'https://proj.supabase.co', anonKey: 'anon' }, (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch);
  api.session = signedIn ? { ...SESSION } : null;
  return { api, calls };
}
const selectOf = (url: string) => new URL(url).searchParams.get('select') ?? '';

describe('listing the devices on the account', () => {
  const good = { endpoint: 'https://p.example/a', tz: 'Africa/Lagos', schedule: [], last_sent: {}, updated_at: '2026-10-09T09:00:00Z' };

  it('asks for the unreachable-device columns, as the signed-in person, and returns the rows', async () => {
    const { api, calls } = make(() => json(200, [{ ...good, failing_since: '2026-10-07T00:00:00Z', last_error: '403' }]));
    const rows = await api.listPush();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ endpoint: good.endpoint, last_error: '403' });
    expect(calls).toHaveLength(1);
    expect(selectOf(calls[0].url)).toContain('failing_since,last_error');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });
  it('asks again without those columns when the database has not been given them yet (a 400), and still lists the devices', async () => {
    const { api, calls } = make((url) => (selectOf(url).includes('failing_since') ? json(400, { message: 'column push_subscriptions.failing_since does not exist' }) : json(200, [good])));
    const rows = await api.listPush();
    expect(rows).toEqual([good]);
    expect(calls).toHaveLength(2);
    expect(selectOf(calls[1].url)).not.toContain('failing_since');
  });
  it('does not retry for any other failure, and reports it', async () => {
    const { api, calls } = make(() => json(500, { message: 'database is down' }));
    await expect(api.listPush()).rejects.toMatchObject({ name: 'AuthError', message: 'database is down' });
    expect(calls).toHaveLength(1);
  });
  it('drops malformed rows and tolerates a reply that is not a list', async () => {
    const { api } = make(() => json(200, [good, null, 'x', { endpoint: 5, tz: 'UTC' }, { endpoint: 'https://p.example/b' }]));
    expect((await api.listPush()).map((r) => r.endpoint)).toEqual([good.endpoint]);
    expect(await make(() => json(200, { not: 'a list' })).api.listPush()).toEqual([]);
    expect(await make(() => new Response('<html>oops</html>', { status: 200 })).api.listPush()).toEqual([]);
  });
  it('asks to sign in again when the session is gone', async () => {
    const { api, calls } = make(() => json(200, []), false);
    await expect(api.listPush()).rejects.toBeInstanceOf(AuthError);
    expect(calls).toEqual([]);
  });
});

describe('asking for a test notification', () => {
  it('sends the person’s own session to the app’s push address and returns the counts', async () => {
    const { api, calls } = make(() => json(200, { sent: 2, devices: 3 }));
    expect(await api.testPush()).toEqual({ sent: 2, devices: 3 });
    expect(calls[0].url).toBe('/api/push');
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
  });
  it('shows the server’s own words when it says to slow down (429), so the person knows how long to wait', async () => {
    const msg = 'You have sent several tests in the last hour. Try again in 50 minutes.';
    const { api } = make(() => new Response(JSON.stringify({ error: msg }), { status: 429, headers: { 'Retry-After': '3000' } }));
    await expect(api.testPush()).rejects.toMatchObject({ name: 'AuthError', message: msg, code: '429' });
  });
  it('passes on any other plain message from the server', async () => {
    await expect(make(() => json(503, { error: 'Push is not set up on the server yet.' })).api.testPush()).rejects.toMatchObject({ message: 'Push is not set up on the server yet.', code: '503' });
    await expect(make(() => json(401, { error: 'Please sign in again.' })).api.testPush()).rejects.toMatchObject({ message: 'Please sign in again.', code: '401' });
  });
  it('copes with a reply that is not JSON, such as an error page from the host', async () => {
    const { api } = make(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.testPush()).rejects.toMatchObject({ message: 'Server said 502', code: '502' });
  });
  it('says it cannot reach the server when there is no connection', async () => {
    const { api } = make(() => {
      throw new TypeError('fetch failed');
    });
    await expect(api.testPush()).rejects.toBeInstanceOf(NetworkError);
  });
  it('asks to sign in again, without calling the server, when the session is gone', async () => {
    const { api, calls } = make(() => json(200, {}), false);
    await expect(api.testPush()).rejects.toMatchObject({ message: 'Please sign in again.', code: 'signed_out' });
    expect(calls).toEqual([]);
  });
});
