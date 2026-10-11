// @ts-nocheck
// Ported from the original browser scripts. Each file is one long flow; every check is a soft assertion
// so a failure reports all the checks that broke, not just the first.
import { expect, test } from '@playwright/test';
import fs from 'fs';
import { APP, newContext } from './helpers';

test('month schedule', async ({ browser: b }, testInfo) => {
  test.setTimeout(150_000);
  const S = testInfo.outputDir + '/';
  fs.mkdirSync(S, { recursive: true });
  const ok = (c: unknown, m: string) => expect.soft(!!c, m).toBe(true);
const page=await (await newContext(b,{viewport:{width:1280,height:900}})).newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
await page.goto(APP); await page.getByRole('button',{name:'Look around with sample data first'}).click();
await page.getByRole('button',{name:'Month'}).first().click();
ok(await page.locator('h1',{hasText:'October 2026'}).isVisible(),'title');
ok(await page.locator('.cal-d').count()===35,'35 cells');
await page.locator('.cal-d[aria-label^="Monday, 12"]').click();
ok(await page.locator('.plan-list li',{hasText:'Data subscription'}).isVisible(),'sample monthly item on 12th');
await page.fill('input[placeholder^="Rent"]','Pay rent'); await page.getByRole('radio',{name:'Bill'}).click();
await page.fill('input[placeholder="3500"]','50,000'); await page.getByText('Repeat every month').click();
await page.getByRole('button',{name:'Add',exact:true}).click();
ok(await page.locator('.plan-list li',{hasText:'Pay rent'}).isVisible(),'added');
await page.locator('.plan-list li',{hasText:'Pay rent'}).locator('input').check();
await page.getByRole('button',{name:'Next month'}).click();
ok(await page.locator('h1',{hasText:'November 2026'}).isVisible(),'next month');
await page.locator('.cal-d[aria-label^="Thursday, 12"]').click();
ok(await page.locator('.plan-list li',{hasText:'Pay rent'}).isVisible()&&!(await page.locator('.plan-list li',{hasText:'Pay rent'}).locator('input').isChecked()),'repeats next month, not done there');
await page.waitForTimeout(500); await page.reload(); await page.getByRole('button',{name:'Month'}).first().click();
await page.locator('.cal-d[aria-label^="Monday, 12"]').click();
ok(await page.locator('.plan-list li',{hasText:'Pay rent'}).locator('input').isChecked(),'persists + done kept');
page.once('dialog',d=>d.accept()); await page.locator('.plan-list li',{hasText:'Pay rent'}).getByRole('button',{name:'Delete'}).click();
ok(await page.locator('.plan-list li',{hasText:'Pay rent'}).count()===0,'deleted');
await page.getByRole('button',{name:'This month'}).click(); await page.screenshot({path:S+'month-laptop.png',fullPage:true});
const p2=await (await newContext(b,{viewport:{width:390,height:844}})).newPage(); p2.on('pageerror',e=>errs.push(e.message));
await p2.goto(APP); await p2.getByRole('button',{name:'Look around with sample data first'}).click(); await p2.getByRole('button',{name:'Month'}).first().click();
await p2.waitForSelector('.cal-d');
ok(await p2.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no h-scroll phone');
await p2.screenshot({path:S+'month-phone.png',fullPage:true});
await p2.getByRole('button',{name:'Today'}).first().click(); await p2.screenshot({path:S+'phone-nav.png'});
ok(errs.length===0,'no errors '+errs.join('|'));
});
