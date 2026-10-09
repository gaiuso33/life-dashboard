import { buildSampleData } from './sample';
import { emptyAdvisor, emptyCareer, emptyMoney, emptyRewards } from './types';
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
      // Sample data from before the money or career screens existed is simply rebuilt.
      if (parsed.sample && (!parsed.money || !parsed.career)) return buildSampleData();
      // Real data keeps everything it has and gains an empty version of any section added since it was saved.
      return {
        ...parsed,
        money: parsed.money ?? emptyMoney(),
        career: parsed.career ?? emptyCareer(),
        rewards: parsed.rewards ?? emptyRewards(),
        advisor: parsed.advisor ?? emptyAdvisor(),
      };
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
