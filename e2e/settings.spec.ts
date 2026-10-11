// @ts-nocheck
// Ported from the original browser scripts. Each file is one long flow; every check is a soft assertion
// so a failure reports all the checks that broke, not just the first.
import { expect, test } from '@playwright/test';
import fs from 'fs';
import { APP, newContext } from './helpers';

test('settings', async ({ browser: b }, testInfo) => {
  test.setTimeout(150_000);
  const S = testInfo.outputDir + '/';
  fs.mkdirSync(S, { recursive: true });
  const ok = (c: unknown, m: string) => expect.soft(!!c, m).toBe(true);
const errs=[];
const page=await (await newContext(b,{viewport:{width:1280,height:900}})).newPage(); page.on('pageerror',e=>errs.push(e.message)); page.on('dialog',d=>d.accept());
await page.goto(APP); await page.getByRole('button',{name:'Set up my dashboard'}).click(); for (let i=0;i<4;i++) await page.getByRole('button',{name:'Next',exact:true}).click(); await page.getByRole('button',{name:'Open my dashboard'}).click();
ok(await page.getByRole('button',{name:'Settings'}).count()===2,'Settings link in rail and top bar (no duplicate)');
await page.getByRole('button',{name:'Settings'}).last().click();
await page.waitForSelector('h1:has-text("Settings")');
// programme: rename, change sets, invalid weekday clash
await page.locator('.prog-day > summary').first().click();
const ex=page.locator('.prog-day').first().locator('.set-ex li').first();
await ex.locator('input').first().fill('Flat barbell bench');
await ex.locator('.mini input').first().fill('5');
await page.locator('.prog-day').first().locator('select').first().selectOption('3'); // Push -> Wednesday (clash with Pull)
ok(await page.locator('.err',{hasText:'same weekday'}).isVisible()&&await page.getByRole('button',{name:'Save programme'}).isDisabled(),'weekday clash blocked');
await page.locator('.prog-day').first().locator('select').first().selectOption('2'); // Tuesday
ok(await page.getByRole('button',{name:'Save programme'}).isEnabled(),'valid draft can be saved');
await page.getByRole('button',{name:'Save programme'}).click();
await page.getByRole('button',{name:'Train'}).first().click(); await page.locator('.tabs button',{hasText:'Push'}).click();
await page.getByText('Flat barbell bench').first().waitFor(); ok(true,'Train shows renamed exercise');
// Month shows push on a Tuesday
await page.getByRole('button',{name:'Month'}).first().click();
ok(await page.locator('.cal-d[aria-label^="Tuesday"] .sess',{hasText:'Push'}).count()>0&&await page.locator('.cal-d[aria-label^="Monday"] .sess',{hasText:'Push'}).count()===0,'calendar follows new weekday');
// reload keeps it
await page.waitForTimeout(500); await page.reload(); await page.getByRole('button',{name:'Train'}).first().click(); await page.locator('.tabs button',{hasText:'Push'}).click(); ok(await page.getByText('Flat barbell bench').first().isVisible(),'programme persists');
// reset
await page.getByRole('button',{name:'Settings'}).last().click(); await page.getByRole('button',{name:'Reset to the original'}).click();
await page.getByRole('button',{name:'Train'}).first().click(); await page.locator('.tabs button',{hasText:'Push'}).click(); ok(await page.getByText('Barbell bench press').first().isVisible(),'reset restores original');
// categories
await page.getByRole('button',{name:'Settings'}).last().click();
await page.fill('input[placeholder^="Tithes"]','Tithes'); await page.locator('.inline-add').first().getByRole('button',{name:'Add'}).click();
ok(await page.locator('.cat-list input[value="Tithes"]').count()===1,'category added');
await page.fill('input[placeholder^="Tithes"]','tithes'); ok(await page.locator('.err',{hasText:'already have'}).isVisible(),'duplicate (case-insensitive) blocked');
// log a txn with the new category on Money and rename
await page.getByRole('button',{name:'Money'}).first().click();
ok(await page.getByRole('radio',{name:'Tithes'}).count()>0,'new category available in Money logger');
// rewards
await page.getByRole('button',{name:'Settings'}).last().click();
await page.fill('input[placeholder="Cinema night"]','Cinema night'); await page.locator('input[placeholder="0"]').fill('5000');
await page.locator('.inline-add.wide select').selectOption('biweek'); await page.locator('.inline-add.wide').getByRole('button',{name:'Add'}).click();
ok(await page.locator('.item-list input[value="Cinema night"]').count()===1,'reward added');
const c=page.locator('.item-list input[aria-label="Cost of Cinema night"]'); await c.fill('6500'); await c.blur();
await page.waitForTimeout(300);
const st=JSON.parse(await page.evaluate(()=>localStorage.getItem('life-dashboard:v1')));
ok(st.rewards.items.find(i=>i.name==='Cinema night')?.cost===6500&&st.stamps?.categories,'reward cost saved; setting stamped');
await page.locator('.item-list li:has(input[aria-label="Name of Cinema night"])').getByRole('button',{name:'Remove'}).click();
ok(await page.locator('.item-list input[value="Cinema night"]').count()===0,'reward removed');
// goals
await page.locator('.goal-grid input').first().fill('80'); await page.locator('.goal-grid input').first().blur();
await page.waitForTimeout(300);
ok(JSON.parse(await page.evaluate(()=>localStorage.getItem('life-dashboard:v1'))).goalWeight===80,'goal weight saved');
await page.screenshot({path:S+'settings-laptop.png',fullPage:true});
const p2=await (await newContext(b,{viewport:{width:390,height:844}})).newPage(); p2.on('pageerror',e=>errs.push(e.message));
await p2.goto(APP); await p2.getByRole('button',{name:'Look around with sample data first'}).click(); await p2.getByRole('button',{name:'Settings'}).last().click(); await p2.waitForSelector('h1:has-text("Settings")');
ok(await p2.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no h-scroll on phone');
await p2.screenshot({path:S+'settings-phone.png',fullPage:true});
ok(errs.length===0,'no errors '+errs.join('|'));
});
