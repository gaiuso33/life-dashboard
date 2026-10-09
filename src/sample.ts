import { DEFAULT_PROGRAM } from './program';
import type { DayKey } from './program';

const DAY_BY_WEEKDAY: Record<number, DayKey> = { 1: 'push', 3: 'pull', 5: 'legs' };
const dayDef = (k: DayKey) => DEFAULT_PROGRAM.find((d) => d.key === k)!;
const PROGRAM = DEFAULT_PROGRAM;
import type { AppData, BodyEntry, CareerData, DayLog, MoneyData, Session, Txn, PlanItem } from './types';
import { emptyAdvisor, emptyCareer, emptyMoney, emptyRewards, sessionKey } from './types';
import { addDays, clamp, mondayOf, round1, todayKey, weekday } from './utils';

// Small deterministic generator so the sample looks the same on every load.
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const SAMPLE_LOADS: Record<string, string> = {
  bench: 'Bar + 2 small plates',
  incline: 'Blue dumbbells',
  ohp: 'Bar + 1 small plate',
  lateral: 'Light dumbbells',
  dips: 'Bodyweight',
  triext: 'Blue dumbbell',
  row: 'Bar + 2 small plates',
  pullup: 'Bodyweight',
  dbrow: 'Blue dumbbell',
  reardelt: 'Light dumbbells',
  bbcurl: 'Bar + 1 small plate',
  hammer: 'Light dumbbells',
  squat: 'Bar + 3 small plates',
  rdl: 'Bar + 2 small plates',
  bulgarian: 'Blue dumbbells',
  lunge: 'Light dumbbells',
  calf: 'Blue dumbbells',
  plank: 'Bodyweight',
};

// Exercises whose latest session reached the top of the range, so the
// "add load" flag has something to show.
const READY_TO_PROGRESS = new Set(['lateral', 'calf', 'hammer', 'dips']);

export function buildSampleData(): AppData {
  const today = todayKey();
  const rand = rng(20261006);
  const days: Record<string, DayLog> = {};
  const sessions: Record<string, Session> = {};
  const WEEKS = 8;
  const start = addDays(today, -WEEKS * 7);

  // The latest session of each day type gets the "ready to progress" treatment.
  const lastOfDay: Record<string, string> = {};
  for (let i = 0; i < WEEKS * 7; i++) {
    const k = addDays(start, i);
    const d = DAY_BY_WEEKDAY[weekday(k)];
    if (d && k < today) lastOfDay[d] = k;
  }

  for (let i = 0; i < WEEKS * 7; i++) {
    const k = addDays(start, i);
    if (k >= today) break;
    const wd = weekday(k);
    const week = Math.floor(i / 7);
    const log: DayLog = {};
    if (rand() < 0.72) log.code = true;
    if (rand() < 0.35 + week * 0.07) log.money = true;
    if (rand() < 0.6) log.energy = 2 + Math.floor(rand() * 4);

    const dayKey = DAY_BY_WEEKDAY[wd];
    if (dayKey) {
      if (rand() < 0.9) {
        const def = dayDef(dayKey);
        const s: Session = { date: k, day: dayKey, loads: {}, reps: {}, finished: true };
        for (const ex of def.exercises) {
          s.loads[ex.id] = SAMPLE_LOADS[ex.id] ?? '';
          const ready = lastOfDay[dayKey] === k && READY_TO_PROGRESS.has(ex.id);
          const reps: number[] = [];
          for (let n = 0; n < ex.sets; n++) {
            if (ready) {
              reps.push(ex.max);
            } else {
              const progress = (week / (WEEKS - 1)) * (ex.max - ex.min) * 0.7;
              const fade = n * (ex.unit === 'sec' ? 4 : 0.7);
              const jitter = (rand() - 0.5) * 2;
              reps.push(Math.round(clamp(ex.min + progress - fade + jitter, ex.min - 2, ex.max - 1)));
            }
          }
          s.reps[ex.id] = reps;
        }
        sessions[sessionKey(k, dayKey)] = s;
      }
    } else if (rand() < 0.6) {
      log.mobility = true;
    }
    days[k] = log;
  }
  days[today] = { code: true };

  const body: BodyEntry[] = [];
  const weighIns = 9;
  // Weekly weigh-ins on the most recent Sundays.
  let sunday = today;
  while (weekday(sunday) !== 0) sunday = addDays(sunday, -1);
  for (let i = 0; i < weighIns; i++) {
    const idx = weighIns - 1 - i;
    const date = addDays(sunday, -7 * idx);
    const noise = (rand() - 0.5) * 0.5;
    body.push({
      date,
      weight: round1(67.4 + i * 0.27 + noise),
      m: {
        shoulders: round1(107.5 + i * 0.2),
        chest: round1(91.5 + i * 0.25),
        arm: round1(30.6 + i * 0.12),
        waist: round1(75.5 + i * 0.1),
        thigh: round1(54 + i * 0.16),
        calf: round1(35.2 + i * 0.05),
      },
    });
  }

  const rewards = emptyRewards();
  rewards.claims.push({ id: 'sample-claim', tier: 'week', period: addDays(mondayOf(today), -14), itemId: 'i-rest', name: 'Rest or gaming hour', cost: 0, date: addDays(mondayOf(today), -8), logged: false });
  return { version: 1, sample: true, money: buildSampleMoney(rand, start, today), career: buildSampleCareer(rand, start, today), rewards, advisor: emptyAdvisor(), plans: samplePlans(today), gone: [], onboarded: true, days, sessions, body, goalWeight: null };
}

export const exerciseCount = PROGRAM.reduce((n, d) => n + d.exercises.length, 0);

const SPEND: { category: string; weight: number; lo: number; hi: number; notes: string[] }[] = [
  { category: 'Food', weight: 45, lo: 500, hi: 1600, notes: ['Lunch', 'Dinner', 'Breakfast', 'Groceries'] },
  { category: 'Transport', weight: 20, lo: 200, hi: 900, notes: ['Bus', 'Bike ride'] },
  { category: 'Data and airtime', weight: 10, lo: 500, hi: 1500, notes: ['Data bundle'] },
  { category: 'Personal care', weight: 6, lo: 500, hi: 1500, notes: ['Haircut', 'Toiletries'] },
  { category: 'Health and gym', weight: 5, lo: 500, hi: 1500, notes: ['Protein snack'] },
  { category: 'Giving', weight: 5, lo: 200, hi: 1000, notes: ['Gift'] },
  { category: 'Entertainment', weight: 5, lo: 500, hi: 1500, notes: ['Movie night'] },
  { category: 'Other', weight: 4, lo: 200, hi: 1000, notes: [''] },
];

function buildSampleMoney(rand: () => number, start: string, today: string): MoneyData {
  const txns: Txn[] = [];
  let id = 0;
  const add = (t: Omit<Txn, 'id'>) => txns.push({ ...t, id: `s${id++}` });
  const totalWeight = SPEND.reduce((n, s) => n + s.weight, 0);
  let nextIncome = 3;
  for (let i = 0; i < 56; i++) {
    const k = addDays(start, i);
    if (k >= today) break;
    const entries = rand() < 0.82 ? 1 + Math.floor(rand() * 3) : 0;
    for (let n = 0; n < entries; n++) {
      let r = rand() * totalWeight;
      const pick = SPEND.find((s) => (r -= s.weight) < 0) ?? SPEND[0];
      const amount = Math.round(((pick.lo + rand() * (pick.hi - pick.lo)) * 0.6) / 50) * 50;
      add({ date: k, kind: 'expense', amount, category: pick.category, note: pick.notes[Math.floor(rand() * pick.notes.length)] });
    }
    if (i === nextIncome) {
      const income = Math.round((12000 + rand() * 10000) / 500) * 500;
      add({ date: k, kind: 'income', amount: income, note: 'Project payment' });
      if (rand() < 0.85) add({ date: k, kind: 'saving', amount: Math.round(income * 0.2), fund: 'survival', note: 'To survival fund' });
      nextIncome += 9 + Math.floor(rand() * 7);
    }
    if (i % 16 === 11) add({ date: k, kind: 'expense', amount: 7000, category: 'Rewards', note: 'Parfait' });
  }
  return { ...emptyMoney(), txns, survivalOpening: 0 };
}

function buildSampleCareer(rand: () => number, start: string, today: string): CareerData {
  const commits: Record<string, number> = {};
  for (let i = 0; i < 56; i++) {
    const k = addDays(start, i);
    if (k >= today) break;
    if (rand() < 0.62) commits[k] = 1 + Math.floor(rand() * rand() * 9);
  }
  let n = 0;
  const id = () => `c${n++}`;
  const ms = (items: [string, boolean][]) => items.map(([text, done]) => ({ id: id(), text, done }));
  return {
    ...emptyCareer(),
    startDate: start,
    deadline: addDays(today, 365),
    lastSync: today,
    commits,
    projects: [
      {
        id: id(),
        name: 'Budget tracker API',
        repo: '',
        concept: 'REST APIs and databases',
        status: 'shipped',
        shippedOn: addDays(today, -21),
        milestones: ms([['Design the data model', true], ['Build the endpoints', true], ['Write the README', true]]),
      },
      {
        id: id(),
        name: 'Study planner',
        repo: '',
        concept: 'Data structures and state',
        status: 'building',
        milestones: ms([['Plan the screens', true], ['Task list with priorities', true], ['Calendar view', false], ['Deploy it', false]]),
      },
    ],
    learning: [
      { id: id(), date: addDays(today, -3), course: 'Data Structures', note: 'Finished the week on hash tables' },
      { id: id(), date: addDays(today, -10), course: 'Data Structures', note: 'Linked lists and stacks' },
      { id: id(), date: addDays(today, -24), course: 'Databases', note: 'Joins and indexes' },
    ],
  };
}

function samplePlans(today: string): PlanItem[] {
  const first = `${today.slice(0, 7)}-01`;
  const at = (day: number) => `${today.slice(0, 7)}-${String(day).padStart(2, '0')}`;
  return [
    { id: 'plan-data', date: at(12), title: 'Data subscription', kind: 'bill', amount: 3500, repeat: 'monthly', doneOn: [] },
    { id: 'plan-income', date: at(25), title: 'Client payment', kind: 'income', amount: 40000, repeat: 'monthly', doneOn: [] },
    { id: 'plan-ship', date: at(28), title: 'Ship project milestone', kind: 'task', amount: 0, repeat: 'none', doneOn: [] },
    { id: 'plan-start', date: first, title: 'Monthly review and reset', kind: 'task', amount: 0, repeat: 'monthly', doneOn: [] },
  ];
}
