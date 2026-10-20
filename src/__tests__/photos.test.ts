import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_PHOTOS, NOTE_MAX, PhotoError, addPhoto, byDate, cleanPhoto, daysBetween, fitWithin, importPhotos, memoryStore, photoErrorText, photosFromFile } from '../photos';
import type { Photo } from '../photos';
import { sanitize } from '../sanitize';
import { MAX_IMPORT_BYTES, parseImport, photosFitInCopy } from '../sync';
import { emptyData } from '../types';

const JPEG = 'data:image/jpeg;base64,';
const pic = (n = 100) => JPEG + 'A'.repeat(n);
const photo = (id: string, date = '2026-10-01', over: Partial<Photo> = {}): Photo => ({ id, date, note: '', thumb: pic(40), full: pic(200), ...over });

describe('sizing', () => {
  it('keeps the longest side within the limit and the shape the same', () => {
    expect(fitWithin(4000, 3000, 1280)).toEqual({ w: 1280, h: 960 });
    expect(fitWithin(3000, 4000, 320)).toEqual({ w: 240, h: 320 });
  });
  it('never enlarges a small picture', () => {
    expect(fitWithin(300, 200, 1280)).toEqual({ w: 300, h: 200 });
  });
  it('never returns a zero or broken size', () => {
    expect(fitWithin(10000, 1, 320)).toEqual({ w: 320, h: 1 });
    for (const [w, h] of [[0, 0], [-5, 10], [NaN, 10], [10, Infinity - Infinity]]) expect(fitWithin(w, h, 320)).toEqual({ w: 1, h: 1 });
  });
});

describe('checking a photo that came from a file', () => {
  it('accepts a plain photo and tidies its note', () => {
    const p = cleanPhoto({ ...photo('a1'), note: '  Front \n  relaxed  ' });
    expect(p).toMatchObject({ id: 'a1', date: '2026-10-01', note: 'Front relaxed' });
  });
  it('cuts a long note', () => {
    expect(cleanPhoto({ ...photo('a'), note: 'x'.repeat(500) })!.note).toHaveLength(NOTE_MAX);
  });
  it('treats a missing or odd note as empty', () => {
    expect(cleanPhoto({ ...photo('a'), note: undefined })!.note).toBe('');
    expect(cleanPhoto({ ...photo('a'), note: 42 })!.note).toBe('');
  });
  it('refuses anything that is not a plain JPEG as base64, so nothing but a picture reaches an image tag', () => {
    const bad = [
      'data:image/png;base64,AAAA',
      'data:image/svg+xml;base64,AAAA',
      'data:text/html;base64,AAAA',
      'javascript:alert(1)',
      'https://example.com/me.jpg',
      JPEG,
      JPEG + '"><script>alert(1)</script>',
      JPEG + 'AAAA AAAA',
      JPEG + 'AA=A',
      42,
      null,
    ];
    for (const full of bad) expect(cleanPhoto({ ...photo('a'), full }), String(full)).toBeNull();
    for (const thumb of bad) expect(cleanPhoto({ ...photo('a'), thumb }), String(thumb)).toBeNull();
  });
  it('refuses a picture bigger than the app would ever keep', () => {
    expect(cleanPhoto(photo('a', '2026-10-01', { full: pic(950_000) }))).toBeNull();
    expect(cleanPhoto(photo('a', '2026-10-01', { thumb: pic(130_000) }))).toBeNull();
  });
  it('refuses odd ids and impossible dates', () => {
    for (const id of ['', '../x', 'a b', 'a/b', '<b>', 'x'.repeat(41), 7]) expect(cleanPhoto({ ...photo('a'), id }), String(id)).toBeNull();
    for (const date of ['2026-02-30', '2026-13-01', '2026-1-1', 'yesterday', '', null, 20261001]) expect(cleanPhoto({ ...photo('a'), date }), String(date)).toBeNull();
  });
  it('refuses things that are not photos at all', () => {
    for (const x of [null, undefined, 'x', 5, [], {}]) expect(cleanPhoto(x)).toBeNull();
  });
});

describe('the photos in an import file', () => {
  it('is empty when the file has none, or has something else under that name', () => {
    for (const raw of [{}, { photos: 'lots' }, { photos: {} }, { photos: null }, null, 'x']) expect(photosFromFile(raw)).toEqual([]);
  });
  it('drops junk and repeated ids but keeps the good ones in order', () => {
    const list = photosFromFile({ photos: [photo('a'), { id: 'b' }, photo('a', '2026-10-05'), null, photo('c')] });
    expect(list.map((p) => p.id)).toEqual(['a', 'c']);
    expect(list[0].date).toBe('2026-10-01');
  });
  it('never returns more than the device keeps', () => {
    const many = Array.from({ length: MAX_PHOTOS + 50 }, (_, i) => photo(`p${i}`));
    expect(photosFromFile({ photos: many })).toHaveLength(MAX_PHOTOS);
  });
  it('comes back from parseImport separately and is never part of the saved data', () => {
    const text = JSON.stringify({ ...emptyData(), photos: [photo('a'), photo('b')] });
    const res = parseImport(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.photos.map((p) => p.id)).toEqual(['a', 'b']);
    expect(Object.keys(res.data)).not.toContain('photos');
    expect(JSON.stringify(res.data)).not.toContain(JPEG);
  });
  it('is empty for a file made without photos', () => {
    const res = parseImport(JSON.stringify(emptyData()));
    expect(res.ok && res.photos).toEqual([]);
  });
  it('is dropped by the cleaner that every save goes through', () => {
    const clean = sanitize({ ...emptyData(), photos: [photo('a')] } as never);
    expect(JSON.stringify(clean)).not.toContain(JPEG);
    expect(Object.keys(clean)).not.toContain('photos');
  });
});

describe('keeping photos', () => {
  it('lists small records without the big picture, and hands back the big one by id', async () => {
    const s = memoryStore();
    await s.add(photo('a'));
    const [meta] = await s.list();
    expect(meta).toMatchObject({ id: 'a', date: '2026-10-01' });
    expect(Object.keys(meta)).not.toContain('full');
    expect(await s.full('a')).toBe(pic(200));
    expect(await s.full('nope')).toBeNull();
  });
  it('deletes one, then all', async () => {
    const s = memoryStore();
    await s.add(photo('a'));
    await s.add(photo('b'));
    await s.remove('a');
    expect((await s.list()).map((p) => p.id)).toEqual(['b']);
    await s.clear();
    expect(await s.list()).toEqual([]);
    expect(await s.all()).toEqual([]);
  });
  it('stops at the most it keeps, and says nothing was added', async () => {
    const s = memoryStore();
    for (let i = 0; i < MAX_PHOTOS; i++) await addPhoto(s, photo(`p${i}`));
    const err = await addPhoto(s, photo('one-more')).catch((e) => e);
    expect(err).toBeInstanceOf(PhotoError);
    expect((err as PhotoError).code).toBe('limit');
    expect(photoErrorText(err)).toMatch(/Nothing was added/);
    expect(await s.full('one-more')).toBeNull();
  });
  it('adds only the photos from an import that it does not have, and never replaces one', async () => {
    const s = memoryStore();
    await s.add(photo('a', '2026-10-01', { note: 'mine' }));
    const r = await importPhotos(s, [photo('a', '2026-10-02', { note: 'theirs' }), photo('b'), photo('c')]);
    expect(r).toEqual({ added: 2, skipped: 1 });
    const list = await s.list();
    expect(list.find((p) => p.id === 'a')!.note).toBe('mine');
    expect(list).toHaveLength(3);
  });
  it('stops an import at the limit and counts what it skipped', async () => {
    const s = memoryStore();
    for (let i = 0; i < MAX_PHOTOS - 1; i++) await s.add(photo(`p${i}`));
    const r = await importPhotos(s, [photo('x1'), photo('x2'), photo('x3')]);
    expect(r).toEqual({ added: 1, skipped: 2 });
    expect(await s.list()).toHaveLength(MAX_PHOTOS);
  });
  it('gives a plain, specific message for each way it can fail', () => {
    const codes = ['storage', 'unavailable', 'unsupported', 'too-big', 'limit'] as const;
    const texts = codes.map((c) => photoErrorText(new PhotoError(c)));
    expect(new Set(texts).size).toBe(codes.length);
    for (const t of texts) expect(t).toMatch(/Nothing was added/);
    expect(photoErrorText(new Error('whatever'))).toBe(texts[0]);
  });
});

describe('order and gaps', () => {
  it('puts the oldest first and keeps the order added within a day', () => {
    const list = byDate([photo('c', '2026-10-03'), photo('a', '2026-10-01'), photo('b2', '2026-10-02'), photo('b1', '2026-10-02')]);
    expect(list.map((p) => p.id)).toEqual(['a', 'b2', 'b1', 'c']);
  });
  it('counts whole days between two dates, whichever way round', () => {
    expect(daysBetween('2026-09-01', '2026-10-01')).toBe(30);
    expect(daysBetween('2026-10-01', '2026-09-01')).toBe(30);
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(0);
  });
});

describe('a copy that includes photos', () => {
  it('is refused before saving when it would be too big for this app to open again', () => {
    const big = Array.from({ length: 150 }, (_, i) => photo(`p${i}`, '2026-10-01', { full: pic(800_000), thumb: pic(100_000) }));
    expect(photosFitInCopy(big)).toBe(false);
    expect(photosFitInCopy(big.slice(0, 20))).toBe(true);
    expect(photosFitInCopy([])).toBe(true);
    expect(MAX_IMPORT_BYTES).toBeGreaterThan(20_000_000);
  });
});

describe('photos never go anywhere on their own', () => {
  const src = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8');
  const SENDS = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|importScripts|\bimport\s*\(|<form|\.submit\(/;
  const NETWORK = new RegExp(`${SENDS.source}|navigator\\.share`);

  it('the photo code does not use anything that can send data out', () => {
    expect(src('photos.ts')).not.toMatch(NETWORK);
    expect(src('components/Photos.tsx')).not.toMatch(NETWORK);
  });
  it('only the screens that save or open a copy by hand, and the photo screen, can reach the photos', () => {
    const all: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const full = join(d, f);
        if (statSync(full).isDirectory()) {
          if (f !== '__tests__') walk(full);
        } else if (/\.(ts|tsx)$/.test(f)) all.push(full);
      }
    };
    walk(join(process.cwd(), 'src'));
    const users = all
      .filter((f) => /from '\.{1,2}\/(\.\.\/)?photos'/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(join(process.cwd(), 'src').length + 1))
      .sort();
    expect(users).toEqual(['components/Photos.tsx', 'components/Recovery.tsx', 'components/Settings.tsx', 'components/Sync.tsx', 'components/Welcome.tsx', 'sync.ts']);
    // in particular: not the cloud code, the AI code, the advisor summary, the store or the saved data
    for (const never of ['cloud/', 'ai.ts', 'advisorData.ts', 'store.tsx', 'repository.ts', 'sanitize.ts', 'push.ts', 'github.ts', 'coach.ts']) expect(users.some((u) => u.startsWith(never))).toBe(false);
  });
  it('the only place a file is made with photos in it is the one that is handed to the person', () => {
    const s = src('sync.ts');
    expect(s.match(/\.\.\.data, photos/g)).toHaveLength(1);
    expect(s).not.toMatch(SENDS);
  });
});
