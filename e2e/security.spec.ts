import { expect, test } from '@playwright/test';
import { APP, newDevice, TABS } from './helpers';

test('production security headers are sent and the app runs under them without violations', async ({ browser }) => {
  const { page, errors } = await newDevice(browser, undefined, 'about:blank');
  const messages: string[] = [];
  page.on('console', (m) => /Content Security|Refused to/i.test(m.text()) && messages.push(m.text()));
  const res = await page.goto(APP);
  const h = res!.headers();
  expect(h['content-security-policy']).toContain("object-src 'none'");
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('no-referrer');
  await page.getByRole('button', { name: /sample data/i }).click();
  for (const t of TABS) {
    await page.getByRole('button', { name: t, exact: true }).first().click();
    await page.waitForTimeout(100);
  }
  expect(messages).toEqual([]);
  expect(errors).toEqual([]);
});

test('the policy refuses connections to sites it does not list', async ({ browser }) => {
  const { page } = await newDevice(browser);
  const refused: string[] = [];
  page.on('console', (m) => /Content Security Policy/i.test(m.text()) && refused.push(m.text()));
  const outcome = await page.evaluate(async () => {
    try {
      await fetch('https://example.org/collect');
      return 'reached';
    } catch {
      return 'refused';
    }
  });
  expect(outcome).toBe('refused');
  expect(refused.join(' ')).toContain('connect-src');
});

test('the app loads its own fonts and makes no outside requests while in use', async ({ browser }) => {
  const { page } = await newDevice(browser, undefined, 'about:blank');
  const hosts = new Set<string>();
  page.on('request', (r) => {
    if (!r.url().startsWith('data:')) hosts.add(new URL(r.url()).host);
  });
  await page.goto(APP);
  await page.getByRole('button', { name: /sample data/i }).click();
  for (const t of TABS) await page.getByRole('button', { name: t, exact: true }).first().click();
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    const faces = [...document.fonts].map((f) => `${f.family.replace(/"/g, '')} ${f.weight} ${f.status}`);
    return { faces, display: document.fonts.check('700 20px "Barlow Condensed"'), body: document.fonts.check('400 16px Barlow') };
  });
  expect(fonts.faces.sort()).toEqual(['Barlow 400 loaded', 'Barlow 600 loaded', 'Barlow Condensed 600 loaded', 'Barlow Condensed 700 loaded']);
  expect(fonts.display && fonts.body).toBe(true);
  expect([...hosts]).toEqual(['localhost:4173']);
});
