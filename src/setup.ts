import { cleanUsername, USERNAME } from './github';
import { DEFAULT_PROGRAM } from './program';
import type { AppData } from './types';
import { addDays, todayKey } from './utils';

/** Everything the first-run setup asks for. Every answer can be skipped or changed later in Settings. */
export interface SetupAnswers {
  days: [number, number, number]; // weekdays (0 = Sunday) for push, pull and legs
  weight: number | null;
  goalWeight: number | null;
  dailyEstimate: number | null;
  savePct: number;
  survivalOpening: number;
  goalCount: number;
  deadline: string;
  githubUser: string;
  keepRewards: boolean;
}

export const defaultAnswers = (): SetupAnswers => ({
  days: [1, 3, 5],
  weight: null,
  goalWeight: null,
  dailyEstimate: null,
  savePct: 20,
  survivalOpening: 0,
  goalCount: 5,
  deadline: addDays(todayKey(), 365),
  githubUser: '',
  keepRewards: true,
});

const okWeight = (w: number | null) => w == null || (Number.isFinite(w) && w >= 30 && w <= 250);

/** Plain-words problems, keyed by the field they belong to. Empty when everything is fine. */
export function setupErrors(a: SetupAnswers, today = todayKey()): Partial<Record<'days' | 'weight' | 'goalWeight' | 'dailyEstimate' | 'savePct' | 'survivalOpening' | 'goalCount' | 'deadline' | 'githubUser', string>> {
  const e: ReturnType<typeof setupErrors> = {};
  if (new Set(a.days).size !== 3) e.days = 'Pick three different days.';
  if (!okWeight(a.weight)) e.weight = 'Enter a weight between 30 and 250 kg.';
  if (!okWeight(a.goalWeight)) e.goalWeight = 'Enter a weight between 30 and 250 kg.';
  if (a.dailyEstimate != null && !(a.dailyEstimate >= 0 && a.dailyEstimate <= 10_000_000)) e.dailyEstimate = 'Enter a smaller amount.';
  if (!(a.savePct >= 0 && a.savePct <= 100)) e.savePct = 'Use a percentage from 0 to 100.';
  if (!(a.survivalOpening >= 0 && a.survivalOpening <= 1_000_000_000)) e.survivalOpening = 'Enter a smaller amount.';
  if (!Number.isInteger(a.goalCount) || a.goalCount < 1 || a.goalCount > 20) e.goalCount = 'Choose from 1 to 20 projects.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.deadline) || a.deadline <= today) e.deadline = 'Pick a date after today.';
  else if (a.deadline > addDays(today, 365 * 6)) e.deadline = 'Pick a date within six years.';
  const u = cleanUsername(a.githubUser);
  if (u && !USERNAME.test(u)) e.githubUser = 'That doesn’t look like a GitHub username. Use just the name.';
  return e;
}

/** Applies the answers to an empty dashboard. Answers with a problem are left out rather than saved wrong. */
export function buildSetup(state: AppData, a: SetupAnswers): AppData {
  const today = todayKey();
  const bad = setupErrors(a, today);
  const program = bad.days
    ? undefined
    : a.days.join() === '1,3,5'
      ? undefined
      : DEFAULT_PROGRAM.map((d, i) => ({ ...d, weekday: a.days[i] }));
  return {
    ...state,
    onboarded: true,
    program,
    goalWeight: !bad.goalWeight && a.goalWeight != null ? a.goalWeight : null,
    body: !bad.weight && a.weight != null ? [{ date: today, weight: a.weight, m: {} }] : [],
    money: {
      ...state.money,
      dailyEstimate: !bad.dailyEstimate && a.dailyEstimate ? Math.round(a.dailyEstimate) : null,
      savePct: bad.savePct ? 20 : Math.round(a.savePct),
      survivalOpening: bad.survivalOpening ? 0 : Math.round(a.survivalOpening),
    },
    career: {
      ...state.career,
      startDate: today,
      goalCount: bad.goalCount ? 5 : a.goalCount,
      deadline: bad.deadline ? addDays(today, 365) : a.deadline,
      githubUser: bad.githubUser ? '' : cleanUsername(a.githubUser),
    },
    rewards: a.keepRewards ? state.rewards : { ...state.rewards, items: [] },
  };
}
