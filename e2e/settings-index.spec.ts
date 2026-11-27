import { expect, test } from '@playwright/test';
import { APP, DESKTOP, PHONE, expectNoA11yViolations, newContext, openTab, setUpEmptyDashboard } from './helpers';

// Settings is a long list of sections, so a row of jump links sits above it.
for (const [name, viewport] of [['phone', PHONE], ['desktop', DESKTOP]] as const) {
  test(`settings: a jump link takes you to its section and moves focus there (${name})`, async ({ browser }) => {
    const ctx = await newContext(browser, { viewport });
    const page = await ctx.newPage();
    await page.goto(APP);
    await setUpEmptyDashboard(page);
    await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
    const index = page.getByRole('navigation', { name: 'Jump to a settings section' });
    await expect(index).toBeVisible();
    expect(await index.getByRole('button').count()).toBeGreaterThanOrEqual(6);

    await index.getByRole('button', { name: 'Jump to Reminders' }).click();
    const heading = page.locator('.settings > .panel > h2', { hasText: /^Reminders$/ });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expectNoA11yViolations(page, `settings with jump links (${name})`);
    await ctx.close();
  });
}

test('settings jump links do not get in the way of opening other screens from Settings (phone)', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: PHONE });
  const page = await ctx.newPage();
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await page.getByRole('button', { name: 'Settings', exact: true }).first().click();
  await openTab(page, 'Rewards');
  await expect(page.getByRole('heading', { name: 'Rewards', level: 1 })).toBeVisible();
  await ctx.close();
});
