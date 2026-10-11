import { test } from '@playwright/test';
import { APP, expectNoA11yViolations, newDevice, PHONE, DESKTOP, setUpEmptyDashboard, TABS } from './helpers';

for (const [name, viewport] of [['desktop', DESKTOP], ['phone', PHONE]] as const) {
  test(`first run screens have no accessibility violations (${name})`, async ({ browser }) => {
    const { page } = await newDevice(browser, viewport);
    await expectNoA11yViolations(page, 'welcome');
    await page.getByRole('button', { name: 'Set up my dashboard' }).click();
    await expectNoA11yViolations(page, 'wizard step 1');
  });

  test(`every screen on real, empty data (${name})`, async ({ browser }) => {
    const { page } = await newDevice(browser, viewport);
    await setUpEmptyDashboard(page);
    for (const t of [...TABS, 'Settings'] as const) {
      await page.getByRole('button', { name: t, exact: true }).first().click();
      await expectNoA11yViolations(page, `${t} (${name}, empty)`);
    }
  });

  test(`every screen on sample data, plus the sync dialog (${name})`, async ({ browser }) => {
    const { page } = await newDevice(browser, viewport);
    await page.getByRole('button', { name: /sample data/i }).click();
    for (const t of TABS) {
      await page.getByRole('button', { name: t, exact: true }).first().click();
      await expectNoA11yViolations(page, `${t} (${name}, sample)`);
    }
    await page.getByRole('button', { name: 'Sync and backup' }).first().click();
    await page.locator('#sync-title').waitFor();
    await expectNoA11yViolations(page, `sync dialog (${name})`);
  });
}
void APP;
