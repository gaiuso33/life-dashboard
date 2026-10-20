/**
 * Progress photos. They live in this browser only (IndexedDB), never in the saved dashboard data, never in the cloud copy and
 * never in a request: nothing in this file talks to the network. A photo is shrunk and re-drawn on the device before it is
 * kept, which also drops the camera's hidden details (where and when it was taken, the phone model).
 */
import { dayNumber } from './utils';

/** Longest side of the kept photo and of its thumbnail, in pixels. */
export const FULL_SIDE = 1280;
export const THUMB_SIDE = 320;
export const FULL_QUALITY = 0.8;
export const THUMB_QUALITY = 0.7;
/** The most photos kept, so storage cannot grow without limit. */
export const MAX_PHOTOS = 200;
/** A picked file larger than this is refused before it is read (a phone photo is a few MB). */
export const MAX_INPUT_BYTES = 30_000_000;
/** Pictures with more pixels than this are refused: drawing them can crash a phone's browser. */
export const MAX_PIXELS = 120_000_000;
export const NOTE_MAX = 80;

const JPEG = 'data:image/jpeg;base64,';
/** What a kept photo can weigh at most (as text), whatever a file claims. */
const MAX_FULL_CHARS = 900_000;
const MAX_THUMB_CHARS = 120_000;

export interface PhotoMeta {
  id: string;
  /** The day the photo shows, YYYY-MM-DD. */
  date: string;
  note: string;
  /** Small JPEG as a data address, for the grid. */
  thumb: string;
}
export interface Photo extends PhotoMeta {
  /** The shrunk JPEG as a data address. */
  full: string;
}

export type PhotoErrorCode = 'storage' | 'unavailable' | 'unsupported' | 'too-big' | 'limit';
export class PhotoError extends Error {
  constructor(public code: PhotoErrorCode) {
    super(code);
  }
}

export function photoErrorText(e: unknown): string {
  const code = e instanceof PhotoError ? e.code : 'storage';
  switch (code) {
    case 'unavailable':
      return 'This browser is not letting the app keep photos (private browsing or blocked site data can cause this). Nothing was added.';
    case 'unsupported':
      return 'That file could not be opened as a picture. Try a JPEG or PNG. Nothing was added.';
    case 'too-big':
      return 'That picture is too large to open here. Try a smaller one. Nothing was added.';
    case 'limit':
      return `You already have ${MAX_PHOTOS} photos, which is the most this device keeps. Delete some to add more. Nothing was added.`;
    default:
      return 'The browser would not save the photo. Storage may be full or blocked. Free some space and try again. Nothing was added.';
  }
}

/** The size a picture is drawn at: no side longer than `max`, same shape, never enlarged, never zero. */
export function fitWithin(width: number, height: number, max: number): { w: number; h: number } {
  if (!(width > 0) || !(height > 0)) return { w: 1, h: 1 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

const validDay = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const jpegText = (s: unknown, max: number): s is string => typeof s === 'string' && s.startsWith(JPEG) && s.length > JPEG.length && s.length <= max && /^[A-Za-z0-9+/]+={0,2}$/.test(s.slice(JPEG.length));

/**
 * One photo from a file someone handed us. Only a plain JPEG as base64 is accepted (so nothing but a picture ever reaches an
 * image tag), with an ordinary id, a real date and a short note. Anything else is dropped.
 */
export function cleanPhoto(raw: unknown): Photo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(r.id) || !validDay(r.date)) return null;
  if (!jpegText(r.full, MAX_FULL_CHARS) || !jpegText(r.thumb, MAX_THUMB_CHARS)) return null;
  const note = typeof r.note === 'string' ? r.note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX) : '';
  return { id: r.id, date: r.date, note, thumb: r.thumb, full: r.full };
}

/** The `photos` list of an import file, cleaned. Missing or malformed gives an empty list. */
export function photosFromFile(raw: unknown): Photo[] {
  const list = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).photos : null;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: Photo[] = [];
  for (const item of list.slice(0, MAX_PHOTOS * 2)) {
    const p = cleanPhoto(item);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out.slice(0, MAX_PHOTOS);
}

/** Oldest first, so "before" and "after" read left to right. Same day: the order they were added. */
export const byDate = <T extends { date: string }>(list: T[]): T[] => list.map((p, i) => ({ p, i })).sort((a, b) => a.p.date.localeCompare(b.p.date) || a.i - b.i).map((x) => x.p);

export const daysBetween = (a: string, b: string) => Math.abs(dayNumber(b) - dayNumber(a));

export const newPhotoId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ---- Where photos are kept ----

export interface PhotoStore {
  list(): Promise<PhotoMeta[]>;
  full(id: string): Promise<string | null>;
  /** Throws a PhotoError if the browser refuses. */
  add(photo: Photo): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /** Everything, for a file export the person chose to include photos in. */
  all(): Promise<Photo[]>;
}

/** Adds a photo unless the device already holds the most it keeps. */
export async function addPhoto(store: PhotoStore, photo: Photo): Promise<void> {
  if ((await store.list()).length >= MAX_PHOTOS) throw new PhotoError('limit');
  await store.add(photo);
}

/** Adds photos from an import that this device does not have yet (same id: skipped). Stops at the limit. */
export async function importPhotos(store: PhotoStore, photos: Photo[]): Promise<{ added: number; skipped: number }> {
  const have = new Set((await store.list()).map((p) => p.id));
  let added = 0;
  let skipped = 0;
  for (const p of photos) {
    if (have.has(p.id) || have.size >= MAX_PHOTOS) {
      skipped++;
      continue;
    }
    await store.add(p);
    have.add(p.id);
    added++;
  }
  return { added, skipped };
}

/** A store held in memory. Used by the tests; also what the app falls back to when nothing else can be used. */
export function memoryStore(): PhotoStore {
  const rows = new Map<string, Photo>();
  return {
    list: async () => [...rows.values()].map(({ full: _full, ...meta }) => meta),
    full: async (id) => rows.get(id)?.full ?? null,
    add: async (p) => void rows.set(p.id, p),
    remove: async (id) => void rows.delete(id),
    clear: async () => rows.clear(),
    all: async () => [...rows.values()],
  };
}

const DB_NAME = 'life-dashboard-photos';
const META = 'meta';
const FULL = 'full';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new PhotoError('unavailable'));
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch {
      return reject(new PhotoError('unavailable'));
    }
    req.onupgradeneeded = () => {
      // Small records (date, note, thumbnail) are kept apart from the big pictures so the grid never loads the big ones.
      req.result.createObjectStore(META, { keyPath: 'id' });
      req.result.createObjectStore(FULL, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new PhotoError('unavailable'));
    req.onblocked = () => reject(new PhotoError('unavailable'));
  });
}

/** Runs one transaction. A refusal (full disk, blocked storage) becomes a PhotoError, and nothing is half-written. */
async function run<T>(stores: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => IDBRequest | null): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let req: IDBRequest | null = null;
      tx.oncomplete = () => resolve((req ? req.result : undefined) as T);
      tx.onabort = () => reject(new PhotoError('storage'));
      tx.onerror = () => reject(new PhotoError('storage'));
      try {
        req = work(tx);
      } catch {
        // A write that fails straight away must undo the writes before it, or half a photo (its thumbnail without its picture) would be kept.
        try {
          tx.abort();
        } catch {
          /* already finished */
        }
        reject(new PhotoError('storage'));
      }
    });
  } finally {
    db.close();
  }
}

export function idbStore(): PhotoStore {
  return {
    list: () => run<PhotoMeta[]>([META], 'readonly', (tx) => tx.objectStore(META).getAll()),
    full: async (id) => (await run<{ full: string } | undefined>([FULL], 'readonly', (tx) => tx.objectStore(FULL).get(id)))?.full ?? null,
    add: (p) =>
      run<void>([META, FULL], 'readwrite', (tx) => {
        const { full, ...meta } = p;
        tx.objectStore(META).put(meta);
        tx.objectStore(FULL).put({ id: p.id, full });
        return null;
      }),
    remove: (id) =>
      run<void>([META, FULL], 'readwrite', (tx) => {
        tx.objectStore(META).delete(id);
        tx.objectStore(FULL).delete(id);
        return null;
      }),
    clear: () =>
      run<void>([META, FULL], 'readwrite', (tx) => {
        tx.objectStore(META).clear();
        tx.objectStore(FULL).clear();
        return null;
      }),
    all: async () => {
      const metas = await run<PhotoMeta[]>([META], 'readonly', (tx) => tx.objectStore(META).getAll());
      const fulls = await run<{ id: string; full: string }[]>([FULL], 'readonly', (tx) => tx.objectStore(FULL).getAll());
      const at = new Map(fulls.map((f) => [f.id, f.full]));
      return metas.flatMap((m) => (at.has(m.id) ? [{ ...m, full: at.get(m.id)! }] : []));
    },
  };
}

/** Asks the browser not to clear stored photos when it is short of space. Best effort: the answer is not needed. */
export async function askToKeepPhotos(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* not available */
  }
}

// ---- Shrinking ----

function drawn(source: CanvasImageSource, w: number, h: number, quality: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new PhotoError('unsupported');
  // A flat background so a transparent picture does not turn black as a JPEG.
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(source, 0, 0, w, h);
  const url = canvas.toDataURL('image/jpeg', quality);
  if (!url.startsWith(JPEG)) throw new PhotoError('unsupported');
  return url;
}

/**
 * Opens the picked file, turns it upright, and returns a smaller photo and a thumbnail as JPEGs. Re-drawing is what drops the
 * camera's hidden details. Everything happens in this browser tab.
 */
export async function shrinkImage(file: Blob): Promise<{ full: string; thumb: string }> {
  if (file.size > MAX_INPUT_BYTES) throw new PhotoError('too-big');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      throw new PhotoError('unsupported');
    }
  }
  try {
    if (bitmap.width * bitmap.height > MAX_PIXELS) throw new PhotoError('too-big');
    const big = fitWithin(bitmap.width, bitmap.height, FULL_SIDE);
    const small = fitWithin(bitmap.width, bitmap.height, THUMB_SIDE);
    const full = drawn(bitmap, big.w, big.h, FULL_QUALITY);
    const thumb = drawn(bitmap, small.w, small.h, THUMB_QUALITY);
    if (full.length > MAX_FULL_CHARS) return { full: drawn(bitmap, big.w, big.h, 0.6), thumb };
    return { full, thumb };
  } finally {
    bitmap.close();
  }
}
