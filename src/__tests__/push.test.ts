import { describe, expect, it } from 'vitest';
import { WINDOW_MINUTES, cleanSchedule, dueReminders, localParts, runTick, sameSecret } from '../../api/push';
import type { Payload, SendResult, SubRow } from '../../api/push';
import { DEFAULT_PROGRAM } from '../program';
import { buildPushSchedule, keyToBytes } from '../push';
import { DEFAULT_REMINDERS } from '../reminders';

// Monday 12 Oct 2026, 20:00 UTC. In Lagos (UTC+1) that is 21:00 the same day; in Los Angeles (UTC-7) it is 13:00.
const NOW = new Date(Date.UTC(2026, 9, 12, 20, 0, 0));
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);

const item = (over: Record<string, unknown> = {}) => ({ id: 'checkin', time: '21:00', days: [], title: 'Time to check in', body: 'Tick your plates.', ...over });

describe('local time in a time zone', () => {
  it('works out the date, weekday and minutes for the device’s own zone', () => {
    expect(localParts(NOW, 'Africa/Lagos')).toEqual({ date: '2026-10-12', weekday: 1, minutes: 21 * 60 });
    expect(localParts(NOW, 'America/Los_Angeles')).toEqual({ date: '2026-10-12', weekday: 1, minutes: 13 * 60 });
  });
  it('rolls the date and weekday over for zones already in the next day', () => {
    expect(localParts(NOW, 'Pacific/Auckland')).toEqual({ date: '2026-10-13', weekday: 2, minutes: 9 * 60 });
  });
  it('returns null for a zone that does not exist', () => {
    expect(localParts(NOW, 'Not/AZone')).toBeNull();
    expect(localParts(NOW, '')).toBeNull();
  });
});

describe('reading the stored schedule', () => {
  it('keeps good reminders and drops malformed ones instead of trusting them', () => {
    const out = cleanSchedule([
      item(),
      item({ id: 'BAD ID!' }),
      item({ id: 'a', time: '24:00' }),
      item({ id: 'b', time: '9:00' }),
      item({ id: 'c', title: 5 }),
      null,
      'nope',
      item({ id: 'd', days: [1, 1, 3, 9, -1, 2.5, 'x'] }),
    ]);
    expect(out.map((r) => r.id)).toEqual(['checkin', 'd']);
    expect(out[1].days).toEqual([1, 3]);
  });
  it('treats anything that is not a list as empty, and caps the list', () => {
    expect(cleanSchedule(null)).toEqual([]);
    expect(cleanSchedule({})).toEqual([]);
    expect(cleanSchedule(Array.from({ length: 40 }, (_, i) => item({ id: `r${i}` })))).toHaveLength(12);
  });
  it('trims over-long wording', () => {
    const [r] = cleanSchedule([item({ title: 'x'.repeat(500), body: 'y'.repeat(500) })]);
    expect(r.title).toHaveLength(80);
    expect(r.body).toHaveLength(160);
  });
});

describe('which reminders are due', () => {
  const lagos = 'Africa/Lagos';
  it('sends at the chosen clock time in the device’s own zone, not the server’s', () => {
    expect(dueReminders([item()], {}, lagos, NOW)).toHaveLength(1);
    expect(dueReminders([item()], {}, 'America/Los_Angeles', NOW)).toHaveLength(0);
    expect(dueReminders([item({ time: '13:00' })], {}, 'America/Los_Angeles', NOW)).toHaveLength(1);
  });
  it('does not send early', () => {
    expect(dueReminders([item()], {}, lagos, at(-1))).toHaveLength(0);
  });
  it('still sends a little late, but not hours late', () => {
    expect(dueReminders([item()], {}, lagos, at(WINDOW_MINUTES - 1))).toHaveLength(1);
    expect(dueReminders([item()], {}, lagos, at(WINDOW_MINUTES))).toHaveLength(0);
    expect(dueReminders([item()], {}, lagos, at(180))).toHaveLength(0);
  });
  it('sends once a day: not again after it has gone out on that local date', () => {
    expect(dueReminders([item()], { checkin: '2026-10-12' }, lagos, at(2))).toHaveLength(0);
    expect(dueReminders([item()], { checkin: '2026-10-11' }, lagos, at(2))).toHaveLength(1);
  });
  it('honours the days it is limited to (0 = Sunday)', () => {
    expect(dueReminders([item({ days: [1, 3, 5] })], {}, lagos, NOW)).toHaveLength(1); // Monday
    expect(dueReminders([item({ days: [3, 5] })], {}, lagos, NOW)).toHaveLength(0);
    expect(dueReminders([item({ days: [0] })], {}, lagos, NOW)).toHaveLength(0);
  });
  it('uses the weekday of the device’s zone, which can differ from the server’s', () => {
    // 20:00 UTC Monday is already 09:00 Tuesday in Auckland.
    expect(dueReminders([item({ time: '09:00', days: [2] })], {}, 'Pacific/Auckland', NOW)).toHaveLength(1);
    expect(dueReminders([item({ time: '09:00', days: [1] })], {}, 'Pacific/Auckland', NOW)).toHaveLength(0);
  });
  it('sends nothing for a broken zone, schedule or sent-map', () => {
    expect(dueReminders([item()], {}, 'Not/AZone', NOW)).toEqual([]);
    expect(dueReminders('junk', {}, lagos, NOW)).toEqual([]);
    expect(dueReminders([item()], 'junk', lagos, NOW)).toHaveLength(1);
  });
  it('does not send a reminder late across midnight', () => {
    // 23:55 reminder, checked at 00:03 the next day: minutes are earlier than the target, so it is skipped.
    const justAfterMidnight = new Date(Date.UTC(2026, 9, 12, 23, 3, 0)); // 00:03 Tue in Lagos
    expect(dueReminders([item({ time: '23:55' })], {}, lagos, justAfterMidnight)).toHaveLength(0);
  });
});

describe('running a tick', () => {
  const row = (over: Partial<SubRow> = {}): SubRow => ({ endpoint: 'https://push.example/' + 'a'.repeat(30), user_id: 'u1', p256dh: 'k', auth: 'a', tz: 'Africa/Lagos', schedule: [item()], last_sent: {}, ...over });
  const sender = (result: SendResult | ((r: SubRow, p: Payload) => SendResult)) => {
    const calls: { endpoint: string; payload: Payload }[] = [];
    const send = async (r: SubRow, p: Payload): Promise<SendResult> => {
      calls.push({ endpoint: r.endpoint, payload: p });
      return typeof result === 'function' ? result(r, p) : result;
    };
    return { send, calls };
  };

  it('sends what is due and records it so it is not sent twice', async () => {
    const { send, calls } = sender('ok');
    const res = await runTick([row()], NOW, send);
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toEqual({ title: 'Time to check in', body: 'Tick your plates.', tag: 'checkin' });
    expect(res).toMatchObject({ sent: 1, retry: 0, gone: [] });
    expect(res.updates).toEqual([{ endpoint: row().endpoint, last_sent: { checkin: '2026-10-12' } }]);
    // The next minute, with that saved state, sends nothing.
    const again = sender('ok');
    await runTick([row({ last_sent: res.updates[0].last_sent })], at(1), again.send);
    expect(again.calls).toHaveLength(0);
  });
  it('skips devices with nothing due without sending anything', async () => {
    const { send, calls } = sender('ok');
    const res = await runTick([row({ tz: 'America/Los_Angeles' })], NOW, send);
    expect(calls).toHaveLength(0);
    expect(res).toEqual({ updates: [], gone: [], sent: 0, retry: 0 });
  });
  it('leaves a failed reminder unmarked so the next minute tries again (only the device is flagged)', async () => {
    const { send } = sender('retry');
    const res = await runTick([row()], NOW, send);
    expect(res).toMatchObject({ sent: 0, retry: 1 });
    expect(Object.keys(res.updates[0].last_sent)).toEqual(['_fail']);
  });
  it('treats a thrown error like a failed send and carries on with other devices', async () => {
    const bad = row({ endpoint: 'https://push.example/' + 'b'.repeat(30) });
    const good = row({ endpoint: 'https://push.example/' + 'c'.repeat(30) });
    const send = async (r: SubRow): Promise<SendResult> => {
      if (r.endpoint === bad.endpoint) throw new Error('network');
      return 'ok';
    };
    const res = await runTick([bad, good], NOW, send);
    expect(res).toMatchObject({ sent: 1, retry: 1 });
    expect(res.updates.map((u) => u.endpoint).sort()).toEqual([bad.endpoint, good.endpoint].sort());
    expect(res.updates.find((u) => u.endpoint === good.endpoint)!.last_sent._fail).toBeUndefined();
  });
  it('reports a dead push address for removal and stops sending to it', async () => {
    const two = row({ schedule: [item(), item({ id: 'money' })] });
    const { send, calls } = sender('gone');
    const res = await runTick([two], NOW, send);
    expect(calls).toHaveLength(1);
    expect(res.gone).toEqual([two.endpoint]);
    expect(res.updates).toEqual([]);
  });
  it('sends each due reminder on a device and forgets entries for reminders that no longer exist', async () => {
    const { send, calls } = sender('ok');
    const res = await runTick([row({ schedule: [item(), item({ id: 'money' })], last_sent: { review: '2026-10-05' } })], NOW, send);
    expect(calls.map((c) => c.payload.tag)).toEqual(['checkin', 'money']);
    expect(res.updates[0].last_sent).toEqual({ checkin: '2026-10-12', money: '2026-10-12' });
  });
  it('handles many devices at once', async () => {
    const rows = Array.from({ length: 57 }, (_, i) => row({ endpoint: `https://push.example/${String(i).padStart(30, '0')}` }));
    const { send, calls } = sender('ok');
    const res = await runTick(rows, NOW, send);
    expect(calls).toHaveLength(57);
    expect(res.updates).toHaveLength(57);
  });
});

describe('comparing the shared secret', () => {
  it('accepts only an exact match', () => {
    expect(sameSecret('s3cret-value', 's3cret-value')).toBe(true);
    expect(sameSecret('s3cret-value', 's3cret-valuf')).toBe(false);
    expect(sameSecret('s3cret', 's3cret-value')).toBe(false);
  });
  it('never accepts an empty secret, even against an empty guess', () => {
    expect(sameSecret('', '')).toBe(false);
    expect(sameSecret('', 'x')).toBe(false);
  });
});

describe('what the app tells the server', () => {
  it('builds generic wording only, on the right days, for the reminders that are on', () => {
    const plan = { ...DEFAULT_REMINDERS, money: { on: true, time: '20:30' } };
    const s = buildPushSchedule(plan, DEFAULT_PROGRAM);
    expect(s.map((r) => r.id)).toEqual(['checkin', 'training', 'money', 'review']);
    expect(s.find((r) => r.id === 'training')?.days).toEqual([1, 3, 5]);
    expect(s.find((r) => r.id === 'review')?.days).toEqual([0]);
    expect(s.find((r) => r.id === 'money')?.time).toBe('20:30');
    // Nothing from the person's programme (exercise names) leaks into the wording.
    const text = JSON.stringify(s).toLowerCase();
    for (const d of DEFAULT_PROGRAM) for (const e of d.exercises) expect(text).not.toContain(e.name.toLowerCase());
  });
  it('leaves out switched-off reminders, and training when there is no programme', () => {
    expect(buildPushSchedule({ ...DEFAULT_REMINDERS, checkin: { on: false, time: '21:00' } }, DEFAULT_PROGRAM).map((r) => r.id)).not.toContain('checkin');
    expect(buildPushSchedule(DEFAULT_REMINDERS, []).map((r) => r.id)).not.toContain('training');
  });
  it('produces a schedule the server accepts unchanged', () => {
    const plan = { ...DEFAULT_REMINDERS, money: { on: true, time: '20:00' } };
    const sent = buildPushSchedule(plan, DEFAULT_PROGRAM);
    expect(cleanSchedule(JSON.parse(JSON.stringify(sent)))).toEqual(sent);
  });
});

describe('the public key', () => {
  it('turns URL-safe base64 into the bytes the browser needs', () => {
    expect(Array.from(keyToBytes('AAECAw'))).toEqual([0, 1, 2, 3]);
    expect(Array.from(keyToBytes('-_8'))).toEqual([251, 255]);
    expect(keyToBytes('')).toHaveLength(0);
  });
  it('converts a real-length (65 byte) VAPID key', () => {
    const bytes = Uint8Array.from({ length: 65 }, (_, i) => (i * 7) % 256);
    const b64 = Buffer.from(bytes).toString('base64url');
    expect(Array.from(keyToBytes(b64))).toEqual(Array.from(bytes));
  });
});
