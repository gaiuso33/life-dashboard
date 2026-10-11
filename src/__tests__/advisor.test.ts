import { describe, expect, it } from 'vitest';
import { buildSummary, summaryJson } from '../advisorData';
import { AiError, askAi, askClaude, clearKey, loadKey, looksLikeKey, saveKey } from '../ai';
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

describe('other providers', () => {
  const ok = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
  const capture = () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(JSON.stringify(reply), { status: 200 }));
    }) as unknown as typeof fetch;
    let reply: unknown = {};
    return { calls, f, set: (r: unknown) => (reply = r) };
  };
  const turns = [{ role: 'user' as const, content: 'hi' }, { role: 'assistant' as const, content: 'hello' }, { role: 'user' as const, content: 'and?' }];

  it('OpenAI: bearer key, system message first, answer read from choices', async () => {
    const c = capture();
    c.set({ choices: [{ message: { content: ' fine ' }, finish_reason: 'stop' }] });
    const text = await askAi({ provider: 'openai', apiKey: ' sk-abc ', model: ' gpt-x ', system: 'SYS', messages: turns, fetchImpl: c.f });
    expect(text).toBe('fine');
    expect(c.calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    const h = c.calls[0].init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer sk-abc');
    expect(h['x-api-key']).toBeUndefined();
    const b = JSON.parse(c.calls[0].init.body as string);
    expect(b.model).toBe('gpt-x');
    expect(b.messages[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(b.messages).toHaveLength(4);
  });

  it('OpenRouter: its own address, and a length cutoff is reported', async () => {
    const c = capture();
    c.set({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] });
    const text = await askAi({ provider: 'openrouter', apiKey: 'sk-or-v1-x', model: 'meta-llama/x', system: 's', messages: turns, fetchImpl: c.f });
    expect(c.calls[0].url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(text).toContain('cut off');
  });

  it('Gemini: key in a header (not the address), roles mapped, thinking text ignored', async () => {
    const c = capture();
    c.set({ candidates: [{ content: { parts: [{ text: 'secret thoughts', thought: true }, { text: 'Answer.' }] }, finishReason: 'STOP' }] });
    const text = await askAi({ provider: 'google', apiKey: 'AIzaKEY', model: 'models/gemini-x', system: 'SYS', messages: turns, fetchImpl: c.f });
    expect(text).toBe('Answer.');
    expect(c.calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent');
    expect(c.calls[0].url).not.toContain('AIzaKEY');
    expect((c.calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIzaKEY');
    const b = JSON.parse(c.calls[0].init.body as string);
    expect(b.systemInstruction.parts[0].text).toBe('SYS');
    expect(b.contents.map((x: { role: string }) => x.role)).toEqual(['user', 'model', 'user']);
  });

  it('Anthropic path still works through askAi', async () => {
    const c = capture();
    c.set({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' });
    expect(await askAi({ provider: 'anthropic', apiKey: 'k', model: 'm', system: 's', messages: turns, fetchImpl: c.f })).toBe('ok');
    expect(c.calls[0].url).toBe('https://api.anthropic.com/v1/messages');
  });

  it('explains problems in terms of the chosen provider', async () => {
    const err = async (provider: 'openai' | 'google' | 'openrouter', status: number, body: unknown) => {
      try {
        await askAi({ provider, apiKey: 'k', model: 'm', system: 's', messages: [], fetchImpl: ok(body, status) as unknown as typeof fetch });
      } catch (e) {
        return e as AiError;
      }
      throw new Error('expected an error');
    };
    expect((await err('openai', 401, { error: { message: 'bad key' } })).kind).toBe('key');
    expect((await err('openai', 401, {})).message).toContain('OpenAI');
    expect((await err('openai', 429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } })).kind).toBe('credit');
    expect((await err('openai', 429, { error: { code: 'rate_limit_exceeded', message: 'slow down' } })).kind).toBe('limit');
    expect((await err('openai', 404, { error: { message: 'model not found' } })).kind).toBe('model');
    expect((await err('google', 400, { error: { message: 'API key not valid. Please pass a valid API key.' } })).kind).toBe('key');
    expect((await err('google', 404, { error: { message: 'models/x is not found' } })).kind).toBe('model');
    expect((await err('openrouter', 402, { error: { message: 'Insufficient credits' } })).kind).toBe('credit');
    expect((await err('openrouter', 503, {})).kind).toBe('busy');
  });

  it('an empty reply is an error, not a blank answer', async () => {
    const c = capture();
    c.set({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] });
    await expect(askAi({ provider: 'openai', apiKey: 'k', model: 'm', system: 's', messages: turns, fetchImpl: c.f })).rejects.toMatchObject({ kind: 'bad' });
  });

  it('key checks tell providers apart', () => {
    expect(looksLikeKey('sk-ant-api03-abcdefghijklmnopqrst', 'anthropic')).toBe(true);
    expect(looksLikeKey('sk-proj-abcdefghijklmnopqrstuvwx', 'openai')).toBe(true);
    expect(looksLikeKey('sk-ant-api03-abcdefghijklmnopqrst', 'openai')).toBe(false);
    expect(looksLikeKey('sk-or-v1-abcdefghijklmnopqrstuv', 'openai')).toBe(false);
    expect(looksLikeKey('sk-or-v1-abcdefghijklmnopqrstuv', 'openrouter')).toBe(true);
    expect(looksLikeKey('AIzaSyabcdefghijklmnopqrstuvwxyz', 'google')).toBe(true);
    expect(looksLikeKey('AIzaSyabcdefghijklmnopqrstuvwxyz', 'openai')).toBe(false);
    expect(looksLikeKey('sk-ant- has spaces inside it here', 'anthropic')).toBe(false);
  });

  it('keys are stored per provider, and the first provider keeps its original slot', () => {
    const store = new Map<string, string>();
    (globalThis as unknown as { window: unknown }).window = { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } };
    saveKey('A', 'anthropic');
    saveKey('O', 'openai');
    expect([...store.keys()].sort()).toEqual(['life-dashboard:ai-key', 'life-dashboard:ai-key:openai']);
    expect(loadKey('anthropic')).toBe('A');
    expect(loadKey('openai')).toBe('O');
    expect(loadKey('google')).toBe('');
    clearKey('openai');
    expect(loadKey('openai')).toBe('');
    expect(loadKey('anthropic')).toBe('A');
    delete (globalThis as unknown as { window?: unknown }).window;
  });
});
