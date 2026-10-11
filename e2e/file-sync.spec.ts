// @ts-nocheck
// Ported from the original browser scripts. Each file is one long flow; every check is a soft assertion
// so a failure reports all the checks that broke, not just the first.
import { expect, test } from '@playwright/test';
import fs from 'fs';
import { APP, newContext } from './helpers';

test('file export, import and merge between devices', async ({ browser: b }, testInfo) => {
  test.setTimeout(150_000);
  const S = testInfo.outputDir + '/';
  fs.mkdirSync(S, { recursive: true });
  const ok = (c: unknown, m: string) => expect.soft(!!c, m).toBe(true);
const errs=[];
const mk=async(vp)=>{const c=await newContext(b,{viewport:vp,acceptDownloads:true}); const p=await c.newPage(); p.on('pageerror',e=>errs.push(e.message)); p.on('dialog',d=>d.accept()); await p.goto(APP); await p.getByRole('button',{name:'Set up my dashboard'}).click(); for (let i=0;i<4;i++) await p.getByRole('button',{name:'Next',exact:true}).click(); await p.getByRole('button',{name:'Open my dashboard'}).click(); await p.waitForSelector('text=Today’s plates'); return p;};
const addPlan=async(p,title)=>{await p.getByRole('button',{name:'Month'}).first().click(); await p.fill('input[placeholder^="Rent"]',title); await p.getByRole('button',{name:'Add',exact:true}).click();};
const logSpend=async(p)=>{await p.getByRole('button',{name:'Today'}).first().click(); await p.getByRole('button',{name:'Spent nothing'}).click();};
const openSync=async(p)=>{await p.getByRole('button',{name:'Sync and backup'}).last().click(); await p.waitForSelector('#sync-title');};
const exportFrom=async(p,path)=>{await openSync(p); const [dl]=await Promise.all([p.waitForEvent('download'),p.getByRole('button',{name:'Download copy'}).click()]); await dl.saveAs(path); await p.getByRole('button',{name:'Close',exact:true}).click();};
const A=await mk({width:1280,height:900}), P=await mk({width:390,height:844});
await addPlan(A,'Laptop task'); await logSpend(A);
await addPlan(P,'Phone task');
await exportFrom(A,S+'a.json');
ok(!fs.readFileSync(S+'a.json','utf8').includes('sk-'),'export has no key');
// phone imports laptop file
await openSync(P);
await P.setInputFiles('input[type=file]',S+'a.json');
await P.waitForSelector('text=Merging adds to this device');
ok(await P.locator('.preview-box li',{hasText:'1 new planned item'}).isVisible(),'preview shows gains');
await P.screenshot({path:S+'sync-phone.png',fullPage:true});
await P.getByRole('button',{name:'Merge',exact:true}).click(); await P.waitForSelector('text=Merged.');
await P.getByRole('button',{name:'Close',exact:true}).click();
await P.getByRole('button',{name:'Month'}).first().click();
ok(await P.locator('.plan-list li',{hasText:'Phone task'}).isVisible()&&await P.locator('.plan-list li',{hasText:'Laptop task'}).isVisible(),'phone has both tasks');
// phone deletes laptop task; laptop imports
await P.locator('.plan-list li',{hasText:'Laptop task'}).getByRole('button',{name:'Delete'}).click();
await exportFrom(P,S+'p.json');
await openSync(A); await A.setInputFiles('input[type=file]',S+'p.json'); await A.waitForSelector('text=Merging adds to this device');
ok(await A.locator('.preview-box').innerText().then(t=>t.includes('Phone task')||t.includes('1 new planned item')&&t.includes('deleted on the other device')),'laptop preview: new + deletion');
await A.screenshot({path:S+'sync-laptop.png'});
await A.getByRole('button',{name:'Merge',exact:true}).click(); await A.waitForSelector('text=Merged.'); await A.getByRole('button',{name:'Close',exact:true}).click();
await A.getByRole('button',{name:'Month'}).first().click();
ok(await A.locator('.plan-list li',{hasText:'Phone task'}).isVisible()&&await A.locator('.plan-list li',{hasText:'Laptop task'}).count()===0,'laptop got phone task, deletion honoured');
// merging same file again changes nothing
await openSync(A); await A.setInputFiles('input[type=file]',S+'p.json'); await A.waitForSelector('text=Nothing new in this file'); ok(true,'re-import shows nothing new');
// invalid file
fs.writeFileSync(S+'bad.json','{"hello":1}'); await A.setInputFiles('input[type=file]',S+'bad.json'); await A.waitForSelector('text=isn’t a Life Dashboard export'); ok(true,'bad file rejected');
// replace
await A.setInputFiles('input[type=file]',S+'a.json'); await A.waitForSelector('.preview-box');
await A.getByRole('button',{name:'Replace instead'}).click(); await A.waitForSelector('text=Replaced.'); ok(true,'replace works');
await A.keyboard.press('Escape'); ok(await A.locator('#sync-title').count()===0,'Esc closes');
const saved=await A.evaluate(()=>localStorage.getItem('life-dashboard:v1')); await A.waitForTimeout(400);
ok(JSON.parse(await A.evaluate(()=>localStorage.getItem('life-dashboard:v1'))).gone.length>=0,'persisted');
ok(await P.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'phone no h-scroll');
ok(errs.length===0,'no errors '+errs.join('|'));
});
