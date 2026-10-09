import type { AppData, DayLog, PlanItem, Project, Session } from './types';

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

/** Union by id. When both sides have the item, `pick` decides the result. Deleted ids are dropped. */
function unionById<T extends { id: string }>(older: T[], newer: T[], dead: Set<string>, pick: (o: T, n: T) => T = (_o, n) => n): T[] {
  const map = new Map<string, T>();
  for (const x of older) map.set(x.id, x);
  for (const x of newer) {
    const prev = map.get(x.id);
    map.set(x.id, prev ? pick(prev, x) : x);
  }
  return [...map.values()].filter((x) => !dead.has(x.id));
}

function mergeDay(o: DayLog = {}, n: DayLog = {}): DayLog {
  const out: DayLog = {};
  if (o.code || n.code) out.code = true;
  if (o.money || n.money) out.money = true;
  if (o.mobility || n.mobility) out.mobility = true;
  const energy = n.energy ?? o.energy;
  if (energy != null) out.energy = energy;
  return out;
}

function mergeSession(o: Session, n: Session): Session {
  const loads = { ...o.loads };
  for (const [k, v] of Object.entries(n.loads)) if (v) loads[k] = v;
  const reps: Session['reps'] = { ...o.reps };
  for (const [ex, arr] of Object.entries(n.reps)) {
    const prev = reps[ex] ?? [];
    const len = Math.max(prev.length, arr.length);
    reps[ex] = Array.from({ length: len }, (_, i) => arr[i] ?? prev[i] ?? null);
  }
  return { ...n, loads, reps, finished: o.finished || n.finished };
}

function mergeProject(o: Project, n: Project): Project {
  const doneBefore = new Set(o.milestones.filter((m) => m.done).map((m) => m.id));
  return { ...n, milestones: n.milestones.map((m) => (doneBefore.has(m.id) ? { ...m, done: true } : m)) };
}

const mergePlan = (o: PlanItem, n: PlanItem): PlanItem => ({ ...n, doneOn: uniq([...o.doneOn, ...n.doneOn]).sort() });

/**
 * Combines two copies of the dashboard. Things that only one side has are kept, things deleted on
 * either side stay deleted, and where both sides changed the same thing the more recently edited device wins.
 * Merging is repeatable: merging the same file twice changes nothing the second time.
 */
export function mergeData(local: AppData, incoming: AppData): AppData {
  // Sample data is never mixed with real data.
  if (local.sample !== incoming.sample) return local.sample ? incoming : local;

  const incomingNewer = (incoming.modified ?? '') > (local.modified ?? '');
  const o = incomingNewer ? local : incoming;
  const n = incomingNewer ? incoming : local;
  const gone = uniq([...o.gone, ...n.gone]).sort();
  const dead = new Set(gone);

  const days: AppData['days'] = {};
  for (const k of uniq([...Object.keys(o.days), ...Object.keys(n.days)])) days[k] = mergeDay(o.days[k], n.days[k]);

  const sessions: AppData['sessions'] = {};
  for (const k of uniq([...Object.keys(o.sessions), ...Object.keys(n.sessions)])) {
    sessions[k] = o.sessions[k] && n.sessions[k] ? mergeSession(o.sessions[k], n.sessions[k]) : (n.sessions[k] ?? o.sessions[k]);
  }

  const bodyMap = new Map(o.body.map((b) => [b.date, b]));
  for (const b of n.body) bodyMap.set(b.date, b);
  const body = [...bodyMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const commits: Record<string, number> = { ...o.career.commits };
  for (const [d, c] of Object.entries(n.career.commits)) commits[d] = Math.max(commits[d] ?? 0, c);

  const badges: Record<string, string> = { ...o.rewards.badges };
  for (const [id, d] of Object.entries(n.rewards.badges)) badges[id] = badges[id] && badges[id] < d ? badges[id] : d;

  const reviewMap = new Map(o.advisor.reviews.map((r) => [r.week, r]));
  for (const r of n.advisor.reviews) {
    const prev = reviewMap.get(r.week);
    if (!prev || r.at >= prev.at) reviewMap.set(r.week, r);
  }

  return {
    ...n,
    version: 1,
    sample: n.sample,
    gone,
    modified: [o.modified, n.modified].filter(Boolean).sort().pop(),
    days,
    sessions,
    body,
    goalWeight: n.goalWeight ?? o.goalWeight,
    money: {
      ...n.money,
      dailyEstimate: n.money.dailyEstimate ?? o.money.dailyEstimate,
      txns: unionById(o.money.txns, n.money.txns, dead).sort((a, b) => a.date.localeCompare(b.date)),
    },
    career: {
      ...n.career,
      githubUser: n.career.githubUser || o.career.githubUser,
      lastSync: [o.career.lastSync, n.career.lastSync].filter(Boolean).sort().pop() ?? null,
      commits,
      projects: unionById(o.career.projects, n.career.projects, dead, mergeProject),
      learning: unionById(o.career.learning, n.career.learning, dead),
    },
    rewards: {
      items: unionById(o.rewards.items, n.rewards.items, dead),
      claims: unionById(o.rewards.claims, n.rewards.claims, dead),
      badges,
    },
    advisor: { settings: n.advisor.settings, reviews: [...reviewMap.values()].sort((a, b) => b.week.localeCompare(a.week)).slice(0, 12) },
    plans: unionById(o.plans, n.plans, dead, mergePlan),
  };
}

/** What a merge adds to this device, in words for the preview. */
export function describeGains(local: AppData, merged: AppData): string[] {
  const count = (a: string[], b: string[]) => {
    const have = new Set(a);
    return b.filter((x) => !have.has(x)).length;
  };
  const rows: [number, string, string][] = [
    [count(local.money.txns.map((t) => t.id), merged.money.txns.map((t) => t.id)), 'money entry', 'money entries'],
    [count(Object.keys(local.sessions), Object.keys(merged.sessions)), 'training session', 'training sessions'],
    [count(Object.keys(local.days), Object.keys(merged.days)), 'daily check-in', 'daily check-ins'],
    [count(local.body.map((b) => b.date), merged.body.map((b) => b.date)), 'weigh-in', 'weigh-ins'],
    [count(Object.keys(local.career.commits), Object.keys(merged.career.commits)), 'commit day', 'commit days'],
    [count(local.career.projects.map((p) => p.id), merged.career.projects.map((p) => p.id)), 'project', 'projects'],
    [count(local.career.learning.map((l) => l.id), merged.career.learning.map((l) => l.id)), 'learning entry', 'learning entries'],
    [count(local.plans.map((p) => p.id), merged.plans.map((p) => p.id)), 'planned item', 'planned items'],
    [count(local.rewards.claims.map((c) => c.id), merged.rewards.claims.map((c) => c.id)), 'claimed reward', 'claimed rewards'],
    [count(Object.keys(local.rewards.badges), Object.keys(merged.rewards.badges)), 'badge', 'badges'],
  ];
  const ids = (d: AppData) => new Set([...d.money.txns, ...d.plans, ...d.career.projects, ...d.career.learning, ...d.rewards.claims, ...d.rewards.items].map((x) => x.id));
  const after = ids(merged);
  const removed = [...ids(local)].filter((id) => !after.has(id)).length;
  const out = rows.filter(([n]) => n > 0).map(([n, one, many]) => `${n} new ${n === 1 ? one : many}`);
  if (removed > 0) out.push(`${removed} ${removed === 1 ? 'item' : 'items'} you deleted on the other device will be removed here too`);
  return out;
}
