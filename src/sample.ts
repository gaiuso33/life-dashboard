import { DAY_BY_WEEKDAY, PROGRAM, dayDef } from './program';
import type { AppData, BodyEntry, DayLog, Session } from './types';
import { sessionKey } from './types';
import { addDays, clamp, round1, todayKey, weekday } from './utils';

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

  return { version: 1, sample: true, days, sessions, body, goalWeight: null };
}

export const exerciseCount = PROGRAM.reduce((n, d) => n + d.exercises.length, 0);
