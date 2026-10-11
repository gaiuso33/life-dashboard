import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { APP, expectNoA11yViolations, newDevice, stored } from './helpers';

// Requests are answered by the test, but the browser still applies the page's security policy first,
// so these also prove the policy lets each provider through.
interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

async function mockProviders(page: Page): Promise<Seen[]> {
  const seen: Seen[] = [];
  const reply = (path: RegExp | string, body: unknown) =>
    page.route(path, async (route) => {
      const r = route.request();
      seen.push({ url: r.url(), headers: r.headers(), body: JSON.parse(r.postData() ?? '{}') });
      await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    });
  await reply('https://api.anthropic.com/**', { content: [{ type: 'text', text: 'Claude says hello.' }], stop_reason: 'end_turn' });
  await reply('https://api.openai.com/**', { choices: [{ message: { content: 'OpenAI says hello.' }, finish_reason: 'stop' }] });
  await reply('https://openrouter.ai/**', { choices: [{ message: { content: 'OpenRouter says hello.' }, finish_reason: 'stop' }] });
  await reply('https://generativelanguage.googleapis.com/**', { candidates: [{ content: { parts: [{ text: 'Gemini says hello.' }] }, finishReason: 'STOP' }] });
  // the browser asks permission first for cross-origin calls with custom headers
  for (const host of ['api.anthropic.com', 'api.openai.com', 'openrouter.ai', 'generativelanguage.googleapis.com']) {
    await page.route(`https://${host}/**`, (route) => (route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } }) : route.fallback()));
  }
  return seen;
}

const connect = async (page: Page, provider: string, key: string) => {
  await page.getByLabel('Provider').selectOption({ label: provider });
  await page.getByLabel(/API key$/).fill(key);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText('Connected, key ending')).toBeVisible();
};
const ask = async (page: Page, q: string) => {
  await page.getByLabel('Your question').fill(q);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
};

test('every provider can be connected and asked, each with its own key and model', async ({ browser }) => {
  const { page, errors } = await newDevice(browser);
  const seen = await mockProviders(page);
  await page.getByRole('button', { name: /sample data/i }).click();
  await page.getByRole('button', { name: 'Advisor', exact: true }).first().click();
  await expectNoA11yViolations(page, 'advisor with provider selector');

  // wrong-looking key for the chosen provider is caught before anything is sent
  await page.getByLabel('Provider').selectOption({ label: 'OpenAI' });
  await page.getByLabel(/API key$/).fill('sk-ant-api03-abcdefghijklmnopqrstuvwxyz');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'doesn’t look like a OpenAI key' })).toBeVisible();
  expect(seen).toHaveLength(0);

  await connect(page, 'Anthropic', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234');
  await ask(page, 'How am I doing?');
  await expect(page.getByText('Claude says hello.')).toBeVisible();

  await connect(page, 'OpenAI', 'sk-proj-abcdefghijklmnopqrstuvwxyz5678');
  await expect(page.getByRole('textbox', { name: /^Model/ })).toHaveValue('gpt-5-mini');
  await page.getByRole('textbox', { name: /^Model/ }).fill('gpt-custom');
  await ask(page, 'And now?');
  await expect(page.getByText('OpenAI says hello.')).toBeVisible();

  await connect(page, 'Google Gemini', 'AIzaSyabcdefghijklmnopqrstuvwxyz90');
  await ask(page, 'Gemini?');
  await expect(page.getByText('Gemini says hello.')).toBeVisible();

  await connect(page, 'OpenRouter (many models)', 'sk-or-v1-abcdefghijklmnopqrstuvwxyz11');
  await page.getByRole('textbox', { name: /^Model/ }).fill('meta-llama/llama-x');
  await ask(page, 'Router?');
  await expect(page.getByText('OpenRouter says hello.')).toBeVisible();

  // what went where
  const by = (host: string) => seen.filter((s) => new URL(s.url).host === host);
  expect(by('api.anthropic.com')[0].headers['x-api-key']).toContain('sk-ant-api03');
  expect(by('api.openai.com')[0].headers['authorization']).toBe('Bearer sk-proj-abcdefghijklmnopqrstuvwxyz5678');
  expect(by('api.openai.com')[0].body.model).toBe('gpt-custom');
  expect(by('generativelanguage.googleapis.com')[0].headers['x-goog-api-key']).toBe('AIzaSyabcdefghijklmnopqrstuvwxyz90');
  expect(by('generativelanguage.googleapis.com')[0].url).not.toContain('AIza');
  expect(by('openrouter.ai')[0].body.model).toBe('meta-llama/llama-x');
  // a key is never sent to a provider it doesn't belong to
  for (const s of seen) {
    const k = JSON.stringify(s.headers) + s.url;
    const host = new URL(s.url).host;
    if (host !== 'api.anthropic.com') expect(k).not.toContain('sk-ant');
    if (host !== 'api.openai.com') expect(k).not.toContain('sk-proj');
    if (host !== 'generativelanguage.googleapis.com') expect(k).not.toContain('AIza');
    if (host !== 'openrouter.ai') expect(k).not.toContain('sk-or-');
  }

  // keys sit in their own slots on the device, never in the dashboard data
  await page.waitForTimeout(500);
  const slots = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('life-dashboard:ai-key')).sort());
  expect(slots).toEqual(['life-dashboard:ai-key', 'life-dashboard:ai-key:google', 'life-dashboard:ai-key:openai', 'life-dashboard:ai-key:openrouter']);
  const data = JSON.stringify(await stored(page));
  for (const secret of ['sk-ant-api03', 'sk-proj', 'AIza', 'sk-or-v1']) expect(data).not.toContain(secret);
  const settings = (await stored(page)).advisor.settings;
  expect(settings.provider).toBe('openrouter');
  expect(settings.models.openai).toBe('gpt-custom');

  // switching back restores that provider's key and model
  await page.getByLabel('Provider').selectOption({ label: 'OpenAI' });
  await expect(page.getByRole('textbox', { name: /^Model/ })).toHaveValue('gpt-custom');
  await expect(page.getByText('Connected, key ending')).toContainText('5678');
  await page.getByRole('button', { name: 'Remove key' }).click();
  await expect(page.getByLabel('OpenAI API key')).toBeVisible();
  await page.getByLabel('Provider').selectOption({ label: 'Anthropic' });
  await expect(page.getByText('Connected, key ending')).toBeVisible();

  // only the numbers summary is sent, for every provider
  for (const s of seen) {
    const text = JSON.stringify(s.body);
    expect(text).not.toContain('Data subscription');
  }
  expect(errors).toEqual([]);
});

test('a provider error is explained in that provider’s terms', async ({ browser }) => {
  const { page } = await newDevice(browser);
  await page.route('https://api.openai.com/**', (route) => (route.request().method() === 'OPTIONS' ? route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } }) : route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"error":{"message":"bad"}}' })));
  await page.getByRole('button', { name: /sample data/i }).click();
  await page.getByRole('button', { name: 'Advisor', exact: true }).first().click();
  await connect(page, 'OpenAI', 'sk-proj-abcdefghijklmnopqrstuvwxyz5678');
  await ask(page, 'hello');
  await expect(page.getByRole('alert').filter({ hasText: 'OpenAI rejected this API key' })).toBeVisible();
});

test('the demo offers no way to enter a key for any provider', async ({ browser }) => {
  const { page } = await newDevice(browser, undefined, APP + '?demo&tour=0');
  await page.getByRole('button', { name: 'Advisor', exact: true }).first().click();
  for (const p of ['OpenAI', 'Google Gemini', 'OpenRouter (many models)']) {
    await page.getByLabel('Provider').selectOption({ label: p });
    await expect(page.getByLabel(/API key$/)).toHaveCount(0);
  }
  await expect(page.getByText('switched off in the demo')).toBeVisible();
});
