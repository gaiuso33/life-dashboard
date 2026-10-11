import { buildSampleData } from './sample';
import type { LoadResult, Repository, SaveResult } from './repository';

const params = (): URLSearchParams => {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
};

const DEMO_PATH = /^(.*\/)demo\/?$/;
const onDemoPath = (): boolean => {
  try {
    return DEMO_PATH.test(window.location.pathname);
  } catch {
    return false;
  }
};

/** Open the app at `/demo` (or with `?demo`) to run it on sample data that is never saved, synced or mixed with real data. */
export const isDemo: boolean = params().has('demo') || onDemoPath();
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

/** Back to the real app: from `/demo` to the folder above it, from `?demo` to the same page without it. */
export const leaveDemo = (): void => {
  window.location.href = window.location.pathname.replace(DEMO_PATH, '$1');
};
