import { expect, test } from '@playwright/test';
import { APP, PHONE, expectNoA11yViolations, newContext, openTab, setUpEmptyDashboard } from './helpers';

const open = async (page: import('@playwright/test').Page) => {
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await openTab(page, 'Train');
  await page.getByRole('button', { name: 'Change program' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
};

test('coach plan: built-in rules make a plan, nothing changes until it is used (phone)', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: PHONE });
  const page = await ctx.newPage();
  await open(page);
  await expectNoA11yViolations(page, 'plan questions');
  await page.getByRole('radio', { name: 'Get stronger' }).click();
  await page.getByRole('radio', { name: '4', exact: true }).click();
  await page.getByRole('radio', { name: 'No equipment' }).click();
  await page.getByLabel('Movements to leave out (optional)').fill('push-ups');
  await page.getByRole('button', { name: 'Build my plan' }).click();

  await expect(page.getByRole('heading', { name: 'Review the plan' })).toBeVisible();
  await expect(page.getByText('not medical advice')).toBeVisible();
  await expect(page.getByText(/Push-ups/)).toHaveCount(0);
  await expect(page.locator('.program-list li')).toHaveCount(4);
  await expectNoA11yViolations(page, 'plan review');

  // Going back changes nothing.
  await page.getByRole('button', { name: 'Change answers' }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'Use Upper · Lower' }).waitFor();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.getByRole('button', { name: 'Use this plan' }).click();
  await expect(page.getByRole('tablist', { name: 'Session' }).getByRole('tab')).toHaveCount(4); // 3 sessions + Mobility
  await expect(page.getByText('My own program')).toBeVisible();
  await ctx.close();
});

test('coach plan: with an AI key the plan comes from the AI, and a bad reply falls back cleanly', async ({ browser }) => {
  const ctx = await newContext(browser, { viewport: PHONE });
  const page = await ctx.newPage();
  let reply = JSON.stringify({ sessions: [{ title: 'Home A', focus: 'Everything', exercises: [{ name: 'Goblet squat', sets: 3, min: 8, max: 12, unit: 'reps' }] }, { title: 'Home B', focus: 'Upper', exercises: [{ name: 'Push-ups', sets: 3, min: 8, max: 15, unit: 'reps' }] }] });
  const prompts: string[] = [];
  await page.route('https://api.anthropic.com/**', async (r) => {
    prompts.push(r.request().postData() ?? '');
    await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ content: [{ type: 'text', text: reply }], stop_reason: 'end_turn' }) });
  });
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  await page.evaluate(() => localStorage.setItem('life-dashboard:ai-key', 'sk-ant-test-key-1234567890'));
  await openTab(page, 'Train');
  await page.getByRole('button', { name: 'Change program' }).click();
  await page.getByRole('button', { name: 'Build my plan' }).click();
  await page.getByRole('radio', { name: '2', exact: true }).click();

  // A reply that breaks the rules is refused and nothing is used.
  reply = 'I am not able to write JSON today.';
  await page.getByRole('button', { name: 'Build with my AI key' }).click();
  await expect(page.getByRole('alert')).toContainText('built-in rules');
  await expect(page.getByRole('heading', { name: 'Review the plan' })).toHaveCount(0);

  reply = JSON.stringify({ sessions: [{ title: 'Home A', focus: 'Everything', exercises: [{ name: 'Goblet squat', sets: 3, min: 8, max: 12, unit: 'reps' }] }, { title: 'Home B', focus: 'Upper', exercises: [{ name: 'Push-ups', sets: 3, min: 8, max: 15, unit: 'reps' }] }] });
  await page.getByRole('button', { name: 'Build with my AI key' }).click();
  await expect(page.getByText('Made by the coach')).toBeVisible();
  await expect(page.getByText('Goblet squat 3×8–12')).toBeVisible();
  expect(prompts.at(-1)).toContain('exactly 2');
  await page.getByRole('button', { name: 'Use this plan' }).click();
  await expect(page.getByRole('tab', { name: /Home A/ })).toBeVisible();
  await ctx.close();
});
