import type { AppData } from './types';

/**
 * Single-value settings. Each one is stamped with the time it was last changed, so merging two devices keeps
 * the setting that was changed most recently rather than the one from whichever device was edited last overall.
 */
export interface Scalar {
  get: (d: AppData) => unknown;
  set: (d: AppData, v: never) => AppData;
}

const mk = <T,>(get: (d: AppData) => T, set: (d: AppData, v: T) => AppData): Scalar => ({ get, set: set as Scalar['set'] });

export const SCALARS: Record<string, Scalar> = {
  savePct: mk((d) => d.money.savePct, (d, v) => ({ ...d, money: { ...d.money, savePct: v } })),
  dailyEstimate: mk((d) => d.money.dailyEstimate, (d, v) => ({ ...d, money: { ...d.money, dailyEstimate: v } })),
  survivalOpening: mk((d) => d.money.survivalOpening, (d, v) => ({ ...d, money: { ...d.money, survivalOpening: v } })),
  categories: mk((d) => d.money.categories, (d, v) => ({ ...d, money: { ...d.money, categories: v } })),
  goalWeight: mk((d) => d.goalWeight, (d, v) => ({ ...d, goalWeight: v })),
  program: mk((d) => d.program, (d, v) => ({ ...d, program: v })),
  goalCount: mk((d) => d.career.goalCount, (d, v) => ({ ...d, career: { ...d.career, goalCount: v } })),
  deadline: mk((d) => d.career.deadline, (d, v) => ({ ...d, career: { ...d.career, deadline: v } })),
  githubUser: mk((d) => d.career.githubUser, (d, v) => ({ ...d, career: { ...d.career, githubUser: v } })),
  advisorSettings: mk((d) => d.advisor.settings, (d, v) => ({ ...d, advisor: { ...d.advisor, settings: v } })),
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Records the time of every setting that differs between two states. */
export function stampChanges(before: AppData, after: AppData, now: string): AppData {
  let stamps = after.stamps;
  for (const [k, s] of Object.entries(SCALARS)) {
    if (!same(s.get(before), s.get(after))) stamps = { ...stamps, [k]: now };
  }
  return stamps === after.stamps ? after : { ...after, stamps };
}

/** Takes each setting from the side that changed it last. */
export function mergeScalars(base: AppData, a: AppData, b: AppData): AppData {
  let out = base;
  const stamps: Record<string, string> = {};
  for (const [k, s] of Object.entries(SCALARS)) {
    const sa = a.stamps?.[k] ?? '';
    const sb = b.stamps?.[k] ?? '';
    const winner = sb > sa ? b : sa > sb ? a : null;
    if (winner) out = s.set(out, s.get(winner) as never);
    const latest = sa > sb ? sa : sb;
    if (latest) stamps[k] = latest;
  }
  return { ...out, stamps };
}
