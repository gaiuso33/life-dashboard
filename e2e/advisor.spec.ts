// @ts-nocheck
// Ported from the original browser scripts. Each file is one long flow; every check is a soft assertion
// so a failure reports all the checks that broke, not just the first.
import { expect, test } from '@playwright/test';
import fs from 'fs';
import { APP, newContext } from './helpers';

test('advisor', async ({ browser: b }, testInfo) => {
  test.setTimeout(150_000);
  const S = testInfo.outputDir + '/';
  fs.mkdirSync(S, { recursive: true });
  const ok = (c: unknown, m: string) => expect.soft(!!c, m).toBe(true);
const ctx=await newContext(b,{viewport:{width:1280,height:900}});
const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
let calls=[]; let mode='ok';
await page.route('https://api.anthropic.com/**',async r=>{const req=r.request(); calls.push({h:req.headers(),b:JSON.parse(req.postData())});
 if(mode==='401') return r.fulfill({status:401,contentType:'application/json',body:'{"error":{"message":"bad"}}'});
 r.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({content:[{type:'text',text:'Mock advice: train Friday.'}],stop_reason:'end_turn'})});});
await page.goto(APP); await page.getByRole('button',{name:'Look around with sample data first'}).click();
await page.getByRole('button',{name:'Advisor'}).first().click();
await page.waitForSelector('text=Claude setup and privacy');
ok(await page.locator('text=Today').first().isVisible(),'screen renders');
ok(await page.getByRole('button',{name:'Write my review'}).isDisabled(),'review disabled without key');
await page.screenshot({path:S+'adv-nokey.png',fullPage:true});
await page.fill('input[type=password]','bad key');
await page.getByRole('button',{name:'Connect'}).click();
ok(await page.locator('text=doesn’t look like').isVisible(),'bad key rejected');
await page.fill('input[type=password]','sk-ant-api03-abcdefghijklmnopqrstuvwxyz1234');
await page.getByRole('button',{name:'Connect'}).click();
ok(await page.locator('text=Connected').isVisible(),'connected');
await page.getByRole('button',{name:'Write my review'}).click();
await page.waitForSelector('text=Mock advice');
ok(calls.length===1&&calls[0].h['x-api-key'].startsWith('sk-ant-api03'),'review call made');
ok(calls[0].b.system.includes('"asOf"')&&!calls[0].b.system.includes('githubUser'),'summary in system prompt');
await page.getByRole('button',{name:'What should I focus on this week?'}).click();
await page.waitForSelector('.chat li.assistant:not(.pending)');
ok(calls.length===2,'chat call made');
// untick money, ask again
await page.locator('.shares label',{hasText:'Money'}).locator('input').uncheck();
await page.fill('input[aria-label="Your question"]','Anything?'); await page.getByRole('button',{name:'Ask',exact:true}).click();
await page.waitForFunction(()=>document.querySelectorAll('.chat li.assistant').length>=2);
ok(!calls[2].b.system.includes('"money"')&&calls[2].b.messages.length===3,'money excluded, history sent');
// error path
mode='401'; await page.fill('input[aria-label="Your question"]','again'); await page.getByRole('button',{name:'Ask',exact:true}).click();
await page.waitForSelector('text=rejected this API key'); ok(true,'401 message shown');
// key not in saved data
await page.waitForTimeout(500);
const st=await page.evaluate(()=>({app:localStorage.getItem('life-dashboard:v1'),key:localStorage.getItem('life-dashboard:ai-key')}));
ok(!st.app.includes('sk-ant')&&!!st.key,'key stored separately, not in app data');
ok(JSON.parse(st.app).advisor.reviews.length===1&&JSON.parse(st.app).advisor.settings.share.money===false,'review + settings persisted');
await page.reload(); await page.getByRole('button',{name:'Advisor'}).first().click();
ok(await page.locator('text=Mock advice').isVisible()&&await page.locator('text=Connected').isVisible(),'persists after reload');
await page.screenshot({path:S+'adv-laptop.png',fullPage:true});
await page.getByRole('button',{name:'Today'}).first().click();
ok(await page.locator('h2',{hasText:'Coach'}).count()>=0,'today ok');
await page.screenshot({path:S+'today-coach.png'});
const ph=await newContext(b,{viewport:{width:390,height:844}}); const p2=await ph.newPage(); p2.on('pageerror',e=>errs.push(e.message));
await p2.goto(APP); await p2.getByRole('button',{name:'Look around with sample data first'}).click(); await p2.getByRole('button',{name:'Advisor'}).first().click();
await p2.waitForSelector('text=Claude setup and privacy');
ok(await p2.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'no horizontal scroll on phone');
await p2.screenshot({path:S+'adv-phone.png',fullPage:true});
ok(errs.length===0,'no page errors '+errs.join('|'));
});
