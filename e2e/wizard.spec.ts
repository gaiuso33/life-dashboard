// @ts-nocheck
// Ported from the original browser scripts. Each file is one long flow; every check is a soft assertion
// so a failure reports all the checks that broke, not just the first.
import { expect, test } from '@playwright/test';
import fs from 'fs';
import { APP, newContext } from './helpers';

test('first-run setup', async ({ browser: b }, testInfo) => {
  test.setTimeout(150_000);
  const S = testInfo.outputDir + '/';
  fs.mkdirSync(S, { recursive: true });
  const ok = (c: unknown, m: string) => expect.soft(!!c, m).toBe(true);
const errs=[];
const URL=APP;
const mk=async(vp)=>{const p=await (await newContext(b,{viewport:vp})).newPage(); p.on('pageerror',e=>errs.push(e.message)); await p.goto(URL); return p;};
const next=(p)=>p.getByRole('button',{name:'Next',exact:true});
const p=await mk({width:1280,height:900});
ok(await p.locator('h1',{hasText:'Welcome'}).isVisible()&&await p.locator('.banner').count()===0,'first run shows welcome, not sample data');
await p.screenshot({path:S+'welcome.png'});
await p.getByRole('button',{name:'Set up my dashboard'}).click();
ok(await p.locator('text=Step 1 of 5: Training').isVisible(),'step 1');
const sel=p.locator('select'); await sel.nth(0).selectOption('3');
ok(await p.locator('.err',{hasText:'three different days'}).isVisible()&&await next(p).isDisabled(),'clashing days block Next');
await sel.nth(0).selectOption('2'); await next(p).click();
await p.fill('input[placeholder="Optional"] >> nth=0','abc20'); ok(await p.locator('input[placeholder="Optional"]').first().inputValue()==='20','letters stripped');
ok(await p.locator('.err',{hasText:'between 30 and 250'}).first().isVisible()&&await next(p).isDisabled(),'bad weight blocks');
await p.locator('input[placeholder="Optional"]').nth(0).fill('68'); await p.locator('input[placeholder="Optional"]').nth(1).fill('80'); await next(p).click();
await p.locator('input[placeholder="Optional"]').fill('5000'); ok(await p.locator('input[placeholder="Optional"]').inputValue()==='5,000','daily grouped');
await p.locator('input[placeholder="0"]').fill('50000'); await p.locator('label:has-text("Share of each income") input').fill('25'); await next(p).click();
await p.locator('label:has-text("Projects to ship") input').fill('4');
await p.locator('label:has-text("Deadline") input').fill('2020-01-01'); ok(await p.locator('.err',{hasText:'after today'}).isVisible()&&await next(p).isDisabled(),'past deadline blocks');
await p.locator('label:has-text("Deadline") input').fill('2027-06-01');
await p.locator('label:has-text("GitHub username") input').fill('bad name!'); ok(await p.locator('.err',{hasText:'GitHub username'}).isVisible(),'bad username blocks');
await p.locator('label:has-text("GitHub username") input').fill('octocat'); await next(p).click();
ok(await p.locator('text=Step 5 of 5: Rewards').isVisible(),'step 5');
await p.getByRole('button',{name:'Back'}).click(); ok(await p.locator('text=Step 4 of 5').isVisible()&&await p.locator('label:has-text("Projects to ship") input').inputValue()==='4','Back keeps answers'); await next(p).click();
await p.getByRole('radio',{name:'Start empty'}).click(); await p.screenshot({path:S+'wizard-last.png'});
await p.getByRole('button',{name:'Open my dashboard'}).click(); await p.waitForSelector('text=Today’s plates');
await p.waitForTimeout(400);
const d=JSON.parse(await p.evaluate(()=>localStorage.getItem('life-dashboard:v1')));
ok(d.onboarded&&!d.sample,'onboarded, not sample');
ok(d.program?.[0].weekday===2&&d.program[1].weekday===3&&d.program[2].weekday===5,'programme weekdays');
ok(d.body[0]?.weight===68&&d.goalWeight===80,'weight + goal');
ok(d.money.dailyEstimate===5000&&d.money.survivalOpening===50000&&d.money.savePct===25,'money');
ok(d.career.goalCount===4&&d.career.deadline==='2027-06-01'&&d.career.githubUser==='octocat','career');
ok(d.rewards.items.length===0,'empty reward menu');
ok(!!d.stamps?.program&&!!d.stamps?.savePct,'settings stamped');
await p.getByRole('button',{name:'Month'}).first().click();
ok(await p.locator('.cal-d[aria-label^="Tuesday"] .sess',{hasText:'Push'}).count()>0,'calendar follows chosen days');
await p.reload(); ok(await p.locator('text=Today’s plates').isVisible(),'no wizard after reload');
// import path
const q=await mk({width:390,height:844});
fs.writeFileSync(S+'old.json',JSON.stringify({version:1,sample:false,days:{},sessions:{},body:[{date:'2026-10-01',weight:70,m:{}}]}));
await q.locator('input[type=file]').setInputFiles(S+'old.json'); await q.waitForSelector('text=Today’s plates'); ok(true,'import from welcome lands in app (old export)');
ok(await q.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'phone no h-scroll');
const bad=await mk({width:390,height:844}); fs.writeFileSync(S+'junk.json','{"x":1}'); await bad.locator('input[type=file]').setInputFiles(S+'junk.json'); ok(await bad.locator('text=isn’t a Life Dashboard export').isVisible(),'junk import rejected');
await bad.screenshot({path:S+'welcome-phone.png'});
await bad.getByRole('button',{name:'Look around with sample data first'}).click(); ok(await bad.locator('.banner',{hasText:'sample data'}).isVisible(),'sample path');
// Start fresh from sample leads back to wizard
bad.on('dialog',d=>d.accept()); await bad.getByRole('button',{name:'Start fresh'}).click(); ok(await bad.locator('h1',{hasText:'Welcome'}).isVisible(),'Start fresh returns to welcome');
// existing saved user (no onboarded field) never sees it
const old=await (await newContext(b,{})).newPage(); old.on('pageerror',e=>errs.push(e.message));
await old.addInitScript(()=>{localStorage.setItem('life-dashboard:v1',JSON.stringify({version:1,sample:false,days:{},sessions:{},body:[]}))});
await old.goto(URL); ok(await old.locator('text=Today’s plates').isVisible(),'existing save skips wizard');
ok(errs.length===0,'no errors '+errs.join('|'));
});
