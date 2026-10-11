import { buildSampleData } from './sample';
import type { LoadResult, Repository, SaveResult } from './repository';

const params = (): URLSearchParams => {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
};

/** Open the app with `?demo` to run it on sample data that is never saved, synced or mixed with real data. */
export const isDemo: boolean = params().has('demo');
/** `?demo&tour=0` skips the guided tour (useful when someone else is driving). */
export const tourWanted: boolean = isDemo && params().get('tour') !== '0';

/** Holds the demo in memory only: reloading the page resets it, and the person's real data is never touched. */
export class MemoryRepository implements Repository {
  async load(): Promise<LoadResult> {
    return { status: 'ok', data: buildSampleData() };
  }
  async save(): Promise<SaveResult> {
    return { ok: true };
  }
  async clear(): Promise<void> {}
}

export const leaveDemo = (): void => {
  window.location.href = window.location.pathname;
};
