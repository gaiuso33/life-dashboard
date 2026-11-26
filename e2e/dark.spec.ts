import { test } from '@playwright/test';
import { APP, expectNoA11yViolations, newContext, openTab, PHONE, TABS } from './helpers';

// The dark colours (used when the phone or computer is set to dark) must pass the same contrast checks as the light ones.
test('every screen passes the accessibility checks in the dark colours (phone)', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: PHONE, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(APP);
  await page.getByRole('button', { name: /sample data/i }).click();
  for (const t of [...TABS, 'Settings'] as const) {
    if (t === 'Settings') await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    else await openTab(page, t);
    await expectNoA11yViolations(page, `${t} (dark)`);
  }
  await ctx.close();
});
