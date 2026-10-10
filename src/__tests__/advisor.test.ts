import { describe, expect, it } from 'vitest';
import { buildSummary, summaryJson } from '../advisorData';
import { AiError, askClaude } from '../ai';
import { buildSampleData } from '../sample';
import type { ShareArea } from '../types';

const ALL: Record<ShareArea, boolean> = { training: true, body: true, money: true, career: true, rewards: true };

describe('what the advisor can see', () => {
  const d = buildSampleData();
  d.money.txns.push({ id: 's', date: '2026-10-09', kind: 'expense', amount: 500, category: 'Food', note: 'SECRET-note' });
  d.career.githubUser = 'SECRET-user';
  d.career.projects.push({ id: 'p', name: 'SECRET-proj', repo: 'SECRET-repo', concept: 'SECRET-concept', status: 'building', milestones: [{ id: 'm', text: 'SECRET-ms', done: true }] });
  d.career.learning.push({ id: 'l', date: '2026-10-09', course: 'SECRET-course', note: 'SECRET-ln' });
  d.rewards.claims.push({ id: 'c', date: '2026-10-09', name: 'SECRET-treat', cost: 100, tier: 'week', logged: false, period: 'x', itemId: 'i' });
  d.plans.push({ id: 'pl', date: '2026-10-10', title: 'SECRET-plan', kind: 'bill', amount: 5000, repeat: 'none', doneOn: [] });
  d.money.categories = ['Food', 'SECRET-category', 'Rewards', 'Other'];

  it('contains no free text the person typed', () => {
    const j = summaryJson(buildSummary(d, '2026-10-09', ALL));
    expect(j).not.toContain('SECRET');
    expect(j.length).toBeGreaterThan(500);
  });
  it('leaves out areas that are switched off', () => {
    const none = buildSummary(d, '2026-10-09', { training: false, body: false, money: false, career: false, rewards: false });
    expect(Object.keys(none)).not.toContain('money');
    expect(Object.keys(buildSummary(d, '2026-10-09', { ...ALL, money: false }))).not.toContain('money');
  });
});

describe('askClaude', () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  const run = (fetchImpl: typeof fetch) => askClaude({ apiKey: 'k', model: 'm', system: 's', messages: [], fetchImpl });
  it.each([
    [401, 'key'],
    [404, 'model'],
    [429, 'limit'],
    [500, 'busy'],
    [529, 'busy'],
  ])('maps status %i to %s', async (status, kind) => {
    await expect(run(reply(status, { error: { message: 'x' } }))).rejects.toMatchObject({ kind });
  });
  it('recognises an empty credit balance', async () => {
    await expect(run(reply(400, { error: { message: 'Your credit balance is too low' } }))).rejects.toMatchObject({ kind: 'credit' });
  });
  it('reports a network failure', async () => {
    await expect(run((async () => { throw new TypeError('f'); }) as unknown as typeof fetch)).rejects.toBeInstanceOf(AiError);
  });
  it('sends the right headers and joins text blocks', async () => {
    let seen: RequestInit | undefined;
    const text = await askClaude({
      apiKey: ' sk-x ',
      model: ' m ',
      system: 'S',
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: (async (_u: unknown, init?: RequestInit) => {
        seen = init;
        return new Response(JSON.stringify({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], stop_reason: 'max_tokens' }));
      }) as unknown as typeof fetch,
    });
    const h = seen!.headers as Record<string, string>;
    expect(text.startsWith('ab')).toBe(true);
    expect(text).toContain('cut off');
    expect(h['x-api-key']).toBe('sk-x');
    expect(h['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(JSON.parse(String(seen!.body)).model).toBe('m');
  });
});
