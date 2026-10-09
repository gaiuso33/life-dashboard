import { buildSampleData } from './sample';
import { emptyCareer, emptyMoney, emptyRewards } from './types';
import type { AppData } from './types';

/**
 * Storage sits behind this interface so a cloud or IndexedDB implementation can
 * replace the local one later without touching any screen.
 */
export interface Repository {
  load(): Promise<AppData | null>;
  save(data: AppData): Promise<void>;
  clear(): Promise<void>;
}

const KEY = 'life-dashboard:v1';

export function isAppData(x: unknown): x is AppData {
  if (!x || typeof x !== 'object') return false;
  const d = x as Record<string, unknown>;
  return (
    d.version === 1 &&
    typeof d.days === 'object' &&
    d.days !== null &&
    typeof d.sessions === 'object' &&
    d.sessions !== null &&
    Array.isArray(d.body)
  );
}

export class LocalRepository implements Repository {
  private memory: string | null = null;

  async load(): Promise<AppData | null> {
    let raw: string | null = this.memory;
    try {
      raw = window.localStorage.getItem(KEY) ?? raw;
    } catch {
      /* storage blocked: fall back to memory */
    }
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isAppData(parsed)) return null;
      // Saves from before the rewards screen existed gain the default reward menu, nothing else changes.
      if (!parsed.rewards && parsed.money && parsed.career) return { ...parsed, rewards: emptyRewards() };
      if (!parsed.money || !parsed.career) {
        // Saved before the money or career screens existed: sample data is rebuilt with everything included, real data keeps what it has and gains empty sections.
        return parsed.sample ? buildSampleData() : { ...parsed, money: parsed.money ?? emptyMoney(), career: parsed.career ?? emptyCareer(), rewards: parsed.rewards ?? emptyRewards() };
      }
      return parsed;
    } catch {
      return null;
    }
  }

  async save(data: AppData): Promise<void> {
    const raw = JSON.stringify(data);
    this.memory = raw;
    try {
      window.localStorage.setItem(KEY, raw);
    } catch {
      /* storage blocked: data lives for this visit only */
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
}
