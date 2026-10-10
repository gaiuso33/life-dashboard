import { buildSampleData } from './sample';
import { sanitize } from './sanitize';
import type { AppData } from './types';

export type SaveResult = { ok: true } | { ok: false; reason: 'full' | 'blocked' };

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; data: AppData }
  /** Something is saved but can't be read. `raw` is kept untouched; `backup` is the last good copy, if any. */
  | { status: 'damaged'; raw: string; backup: { data: AppData; at: string } | null };

/**
 * Storage sits behind this interface so a cloud or IndexedDB implementation can
 * replace the local one later without touching any screen.
 */
export interface Repository {
  load(): Promise<LoadResult>;
  save(data: AppData): Promise<SaveResult>;
  clear(): Promise<void>;
  /** Called when another tab of the app saves. Returns an unsubscribe function. */
  subscribe?(onChange: (data: AppData) => void): () => void;
}

export const KEY = 'life-dashboard:v1';
const BACKUP = 'life-dashboard:v1:backup';
const BACKUP_AT = 'life-dashboard:v1:backup-at';
const DAMAGED = 'life-dashboard:v1:damaged';
const BACKUP_EVERY_MS = 20 * 3600 * 1000;

export function isAppData(x: unknown): x is AppData {
  if (!x || typeof x !== 'object') return false;
  const d = x as Record<string, unknown>;
  return d.version === 1 && typeof d.days === 'object' && d.days !== null && typeof d.sessions === 'object' && d.sessions !== null && Array.isArray(d.body);
}

/** Brings any saved or imported data up to the current shape, dropping anything unusable. */
export function normalize(parsed: AppData): AppData {
  // Sample data from before the money or career screens existed is simply rebuilt.
  if (parsed.sample && (!parsed.money || !parsed.career)) return buildSampleData();
  return sanitize(parsed);
}

const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string): boolean => {
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

function parse(raw: string | null): AppData | null {
  if (!raw) return null;
  try {
    const x: unknown = JSON.parse(raw);
    return isAppData(x) ? normalize(x) : null;
  } catch {
    return null;
  }
}

/** The saved text exactly as stored, for downloading when the app can't open it. */
export const rawSaved = (): string | null => read(KEY) ?? read(DAMAGED);

export function readBackup(): { data: AppData; at: string } | null {
  const data = parse(read(BACKUP));
  return data ? { data, at: read(BACKUP_AT) ?? '' } : null;
}

/** Puts the last good copy back as the live save. Used by the crash screen. */
export function restoreBackup(): boolean {
  const raw = read(BACKUP);
  return raw != null && parse(raw) != null && write(KEY, raw);
}

export class LocalRepository implements Repository {
  private memory: string | null = null;

  async load(): Promise<LoadResult> {
    const raw = read(KEY) ?? this.memory;
    if (!raw) return { status: 'empty' };
    const data = parse(raw);
    if (data) {
      // One backup a day, so a later mistake or corruption never costs more than about a day.
      const at = read(BACKUP_AT);
      if (!at || Date.now() - new Date(at).getTime() > BACKUP_EVERY_MS) {
        if (write(BACKUP, raw)) write(BACKUP_AT, new Date().toISOString());
      }
      return { status: 'ok', data };
    }
    // Never overwrite what we can't read: keep it aside and let the person choose.
    write(DAMAGED, raw);
    return { status: 'damaged', raw, backup: readBackup() };
  }

  async save(data: AppData): Promise<SaveResult> {
    const raw = JSON.stringify(data);
    this.memory = raw;
    try {
      window.localStorage.setItem(KEY, raw);
      return { ok: true };
    } catch (e) {
      const name = (e as { name?: string })?.name ?? '';
      return { ok: false, reason: /quota/i.test(name) || (e as { code?: number })?.code === 22 ? 'full' : 'blocked' };
    }
  }

  async clear(): Promise<void> {
    this.memory = null;
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }

  subscribe(onChange: (data: AppData) => void): () => void {
    const handler = (e: StorageEvent) => {
      if (e.key !== KEY || !e.newValue) return;
      const data = parse(e.newValue);
      if (data) onChange(data);
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }
}
