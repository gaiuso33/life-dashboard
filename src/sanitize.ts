import { programError } from './program';
import type { DayKey } from './program';
import { emptyAdvisor, emptyCareer, emptyMoney, emptyRewards } from './types';
import type { AppData } from './types';

/**
 * Defensive clean-up of anything that comes from outside the running app: saved data, imported files, other tabs.
 * Records that are missing something essential are dropped, so a damaged entry can never crash a screen.
 */

type Rec = Record<string, unknown>;
const obj = (x: unknown): Rec => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Rec) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown, fallback = ''): string => (typeof x === 'string' ? x : fallback);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (x: unknown): x is string => typeof x === 'string' && DATE.test(x);
const strings = (x: unknown): string[] => arr(x).filter((v): v is string => typeof v === 'string');
const oneOf = <T extends string>(x: unknown, list: readonly T[]): T | null => (list.includes(x as T) ? (x as T) : null);
const DAYS: readonly DayKey[] = ['push', 'pull', 'legs'];

function keep<T>(list: unknown, fn: (r: Rec) => T | null): T[] {
  const out: T[] = [];
  for (const x of arr(list)) {
    const v = fn(obj(x));
    if (v) out.push(v);
  }
  return out;
}

export function sanitize(input: AppData): AppData {
  const p = input as unknown as Rec;
  const money = obj(p.money);
  const career = obj(p.career);
  const rewards = obj(p.rewards);
  const advisor = obj(p.advisor);
  const adv = obj(advisor.settings);
  const defMoney = emptyMoney();
  const defCareer = emptyCareer();
  const defAdvisor = emptyAdvisor();
  const sample = p.sample === true;

  const days: AppData['days'] = {};
  for (const [k, v] of Object.entries(obj(p.days))) {
    if (!isDate(k)) continue;
    const d = obj(v);
    days[k] = {
      ...(d.code === true && { code: true }),
      ...(d.money === true && { money: true }),
      ...(d.mobility === true && { mobility: true }),
      ...(typeof d.energy === 'number' && d.energy >= 1 && d.energy <= 5 && { energy: d.energy }),
    };
  }

  const sessions: AppData['sessions'] = {};
  for (const [k, v] of Object.entries(obj(p.sessions))) {
    const s = obj(v);
    const day = oneOf(s.day, DAYS);
    if (!isDate(s.date) || !day || k !== `${s.date}|${day}`) continue;
    const loads: Record<string, string> = {};
    for (const [ex, l] of Object.entries(obj(s.loads))) if (typeof l === 'string') loads[ex] = l;
    const reps: Record<string, (number | null)[]> = {};
    for (const [ex, r] of Object.entries(obj(s.reps))) reps[ex] = arr(r).slice(0, 20).map((n) => (num(n) != null && (n as number) >= 0 ? (n as number) : null));
    sessions[k] = { date: s.date, day, loads, reps, finished: s.finished === true };
  }

  const body = keep(p.body, (b) => {
    const w = num(b.weight);
    if (!isDate(b.date) || w == null || w < 20 || w > 400) return null;
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(obj(b.m))) if (num(v) != null && (v as number) > 0 && (v as number) < 500) m[k] = v as number;
    return { date: b.date, weight: w, m };
  });

  const txns = keep(money.txns, (t) => {
    const kind = oneOf(t.kind, ['expense', 'income', 'saving'] as const);
    const amount = num(t.amount);
    if (typeof t.id !== 'string' || !isDate(t.date) || !kind || amount == null || amount < 0) return null;
    return {
      id: t.id,
      date: t.date,
      kind,
      amount,
      note: str(t.note),
      ...(typeof t.category === 'string' && { category: t.category }),
      ...(oneOf(t.fund, ['survival', 'investment'] as const) && { fund: t.fund as 'survival' | 'investment' }),
    };
  });

  const commits: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(career.commits))) if (isDate(k) && num(v) != null && (v as number) >= 0) commits[k] = v as number;

  const projects = keep(career.projects, (r) => {
    if (typeof r.id !== 'string') return null;
    return {
      id: r.id,
      name: str(r.name, 'Untitled project'),
      repo: str(r.repo),
      concept: str(r.concept),
      status: oneOf(r.status, ['idea', 'building', 'shipped'] as const) ?? 'idea',
      milestones: keep(r.milestones, (m) => (typeof m.id === 'string' ? { id: m.id, text: str(m.text), done: m.done === true } : null)),
      ...(isDate(r.shippedOn) && { shippedOn: r.shippedOn }),
    };
  });

  const learning = keep(career.learning, (l) => (typeof l.id === 'string' && isDate(l.date) ? { id: l.id, date: l.date, course: str(l.course), note: str(l.note) } : null));

  const TIERS = ['week', 'biweek', 'month', 'landmark'] as const;
  const items = keep(rewards.items, (i) => {
    const tier = oneOf(i.tier, TIERS);
    const cost = num(i.cost);
    return typeof i.id === 'string' && tier && cost != null && cost >= 0 && typeof i.name === 'string' ? { id: i.id, name: i.name, cost, tier } : null;
  });
  const claims = keep(rewards.claims, (c) => {
    const tier = oneOf(c.tier, TIERS);
    const cost = num(c.cost);
    if (typeof c.id !== 'string' || !tier || cost == null || !isDate(c.date)) return null;
    return { id: c.id, tier, period: str(c.period), itemId: str(c.itemId), name: str(c.name), cost, date: c.date, logged: c.logged === true };
  });
  const badges: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(rewards.badges))) if (isDate(v)) badges[k] = v;

  const plans = keep(p.plans, (r) => {
    const kind = oneOf(r.kind, ['bill', 'income', 'task', 'event'] as const);
    if (typeof r.id !== 'string' || !isDate(r.date) || !kind || typeof r.title !== 'string') return null;
    return { id: r.id, date: r.date, title: r.title, kind, amount: Math.max(0, num(r.amount) ?? 0), repeat: r.repeat === 'monthly' ? ('monthly' as const) : ('none' as const), doneOn: strings(r.doneOn).filter(isDate) };
  });

  const reviews = keep(advisor.reviews, (r) => (isDate(r.week) && typeof r.text === 'string' ? { week: r.week, text: r.text, at: str(r.at), model: str(r.model) } : null));
  const share = obj(adv.share);
  const stamps: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(p.stamps))) if (typeof v === 'string') stamps[k] = v;
  const savePct = num(money.savePct);
  const program = p.program != null && programError(p.program as never) == null ? (p.program as AppData['program']) : undefined;
  const cats = strings(money.categories);

  const out: AppData = {
    version: 1,
    sample,
    onboarded: typeof p.onboarded === 'boolean' ? p.onboarded : true,
    gone: strings(p.gone),
    days,
    sessions,
    body: body.sort((a, b) => a.date.localeCompare(b.date)),
    goalWeight: num(p.goalWeight) != null && (p.goalWeight as number) >= 30 && (p.goalWeight as number) <= 250 ? (p.goalWeight as number) : null,
    money: {
      txns,
      savePct: savePct != null && savePct >= 0 && savePct <= 100 ? savePct : defMoney.savePct,
      dailyEstimate: num(money.dailyEstimate) != null && (money.dailyEstimate as number) >= 0 ? (money.dailyEstimate as number) : null,
      survivalOpening: Math.max(0, num(money.survivalOpening) ?? 0),
      ...(cats.length > 0 && { categories: cats }),
    },
    career: {
      githubUser: str(career.githubUser),
      commits,
      lastSync: typeof career.lastSync === 'string' ? career.lastSync : null,
      goalCount: Number.isInteger(career.goalCount) && (career.goalCount as number) >= 1 && (career.goalCount as number) <= 20 ? (career.goalCount as number) : defCareer.goalCount,
      startDate: isDate(career.startDate) ? career.startDate : defCareer.startDate,
      deadline: isDate(career.deadline) ? career.deadline : defCareer.deadline,
      projects,
      learning,
    },
    rewards: { items: Array.isArray(rewards.items) ? items : emptyRewards().items, claims, badges },
    advisor: {
      settings: {
        model: str(adv.model).trim() || defAdvisor.settings.model,
        share: {
          training: share.training !== false,
          body: share.body !== false,
          money: share.money !== false,
          career: share.career !== false,
          rewards: share.rewards !== false,
        },
      },
      reviews,
    },
    plans,
    stamps,
    ...(program && { program }),
    ...(typeof p.modified === 'string' && { modified: p.modified }),
  };
  return out;
}
