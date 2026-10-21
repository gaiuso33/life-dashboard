import { photosFromFile } from './photos';
import type { Photo } from './photos';
import { normalize, isAppData } from './repository';
import type { AppData } from './types';
import { todayKey } from './utils';

const EXPORT_SLOT = 'life-dashboard:last-export';

export const lastExport = (): string | null => {
  try {
    return window.localStorage.getItem(EXPORT_SLOT);
  } catch {
    return null;
  }
};

const markExported = () => {
  try {
    window.localStorage.setItem(EXPORT_SLOT, new Date().toISOString());
  } catch {
    /* ignore */
  }
};

/**
 * Data only: the Claude API key lives in its own slot and is never part of this file. Progress photos are in it only when the
 * caller passes them, which the screen does only after the person ticks the box.
 */
const fileFor = (data: AppData, photos?: Photo[]) =>
  new File([JSON.stringify(photos?.length ? { ...data, photos } : data, null, photos?.length ? undefined : 2)], `life-dashboard-${todayKey()}.json`, { type: 'application/json' });

export function downloadData(data: AppData, photos?: Photo[]): void {
  const f = fileFor(data, photos);
  const url = URL.createObjectURL(f);
  const a = document.createElement('a');
  a.href = url;
  a.download = f.name;
  a.click();
  URL.revokeObjectURL(url);
  markExported();
}

export const canShareFile = (data: AppData): boolean => {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [fileFor(data)] });
  } catch {
    return false;
  }
};

/** Opens the phone's share sheet with the file attached. Returns false if the person cancelled. */
export async function shareData(data: AppData, photos?: Photo[]): Promise<boolean> {
  try {
    await navigator.share({ files: [fileFor(data, photos)], title: 'Life Dashboard data' });
    markExported();
    return true;
  } catch {
    return false;
  }
}

/** The largest export file the app will open. A copy with photos in it is far bigger than one without. */
export const MAX_IMPORT_BYTES = 120_000_000;
export const fileTooLargeText = 'That file is too large to be a dashboard export.';

/** True when a copy with these photos in it would be small enough for this app to open again. Checked before saving one. */
export const photosFitInCopy = (photos: Photo[]): boolean => photos.reduce((n, p) => n + p.full.length + p.thumb.length + 200, 0) <= MAX_IMPORT_BYTES - 5_000_000;

/** `photos` are the progress photos the file carries, already checked. They are never part of `data`. */
export type ParsedImport = { ok: true; data: AppData; photos: Photo[] } | { ok: false; error: string };

export function parseImport(text: string): ParsedImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file isn’t a Life Dashboard export. It should be a .json file saved from this app.' };
  }
  if (!isAppData(raw)) return { ok: false, error: 'That file isn’t a Life Dashboard export. It should be a .json file saved from this app.' };
  return { ok: true, data: normalize(raw), photos: photosFromFile(raw) };
}

export const daysAgo = (iso: string | null | undefined): number | null => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)) : null);
export const agoText = (n: number | null) => (n == null ? 'never' : n === 0 ? 'today' : n === 1 ? 'yesterday' : `${n} days ago`);

/** Saves any text as a file download. Used for data the app can't open itself. */
export function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
