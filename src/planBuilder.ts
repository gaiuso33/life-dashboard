import type { DayDef, ExerciseDef } from './program';
import { programError } from './program';

export type Goal = 'muscle' | 'strength' | 'fatloss' | 'general';
export type Equipment = 'full' | 'dumbbells' | 'none';
export type Experience = 'beginner' | 'some' | 'experienced';

export interface PlanRequest {
  goal: Goal;
  days: number; // 2 to 6 sessions a week
  equipment: Equipment;
  experience: Experience;
  avoid: string; // movements to leave out, separated by commas or new lines
  bodyKg?: number; // latest weigh-in, if there is one
}

export const GOALS: { id: Goal; label: string }[] = [
  { id: 'muscle', label: 'Build muscle' },
  { id: 'strength', label: 'Get stronger' },
  { id: 'fatloss', label: 'Lose fat' },
  { id: 'general', label: 'General fitness' },
];
export const EQUIPMENT: { id: Equipment; label: string }[] = [
  { id: 'full', label: 'Gym or barbell and dumbbells' },
  { id: 'dumbbells', label: 'Dumbbells only' },
  { id: 'none', label: 'No equipment' },
];
export const EXPERIENCE: { id: Experience; label: string }[] = [
  { id: 'beginner', label: 'New to lifting' },
  { id: 'some', label: 'A year or so' },
  { id: 'experienced', label: 'Several years' },
];

const WEEKDAYS: Record<number, number[]> = { 1: [3], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] };

/** Movements the person wants left out, as lowercase search words with a trailing "s" removed. */
export const avoidTerms = (text: string): string[] =>
  text
    .split(/[,;\n]/)
    .map((t) => t.trim().toLowerCase().replace(/s$/, ''))
    .filter((t) => t.length >= 3);

export const isAvoided = (name: string, terms: string[]) => {
  const n = name.toLowerCase();
  return terms.some((t) => n.includes(t));
};

/* ---------- exercise pool for the built-in rules ---------- */

type Pattern = 'squat' | 'hinge' | 'lunge' | 'hpush' | 'vpush' | 'hpull' | 'vpull' | 'biceps' | 'triceps' | 'delts' | 'calves' | 'core';
type Tier = 'bb' | 'db' | 'bw';
interface Move {
  id: string;
  name: string;
  tier: Tier;
  unit?: 'reps' | 'sec';
  perSide?: boolean;
}
const POOL: Record<Pattern, Move[]> = {
  squat: [{ id: 'squat', name: 'Barbell back squat', tier: 'bb' }, { id: 'goblet', name: 'Goblet squat', tier: 'db' }, { id: 'airsquat', name: 'Bodyweight squats', tier: 'bw' }],
  hinge: [{ id: 'rdl', name: 'Romanian deadlift', tier: 'bb' }, { id: 'dbrdl', name: 'Dumbbell Romanian deadlift', tier: 'db' }, { id: 'glute', name: 'Glute bridges', tier: 'bw' }],
  lunge: [{ id: 'bulgarian', name: 'Bulgarian split squats', tier: 'bw', perSide: true }, { id: 'lunge', name: 'Walking lunges', tier: 'bw', perSide: true }],
  hpush: [{ id: 'bench', name: 'Barbell bench press', tier: 'bb' }, { id: 'dbpress', name: 'Dumbbell floor press', tier: 'db' }, { id: 'pushup', name: 'Push-ups', tier: 'bw' }],
  vpush: [{ id: 'ohp', name: 'Standing overhead press', tier: 'bb' }, { id: 'dbohp', name: 'Seated dumbbell shoulder press', tier: 'db' }, { id: 'pike', name: 'Pike push-ups', tier: 'bw' }],
  hpull: [{ id: 'row', name: 'Bent-over barbell row', tier: 'bb' }, { id: 'dbrow', name: 'One-arm dumbbell row', tier: 'db', perSide: true }, { id: 'invrow', name: 'Inverted rows under a sturdy table', tier: 'bw' }],
  vpull: [{ id: 'pullup', name: 'Pull-ups or chin-ups', tier: 'bb' }, { id: 'superman', name: 'Superman holds', tier: 'bw', unit: 'sec' }],
  biceps: [{ id: 'bbcurl', name: 'Barbell curls', tier: 'bb' }, { id: 'dbcurl', name: 'Dumbbell curls', tier: 'db' }],
  triceps: [{ id: 'triext', name: 'Dumbbell overhead triceps extension', tier: 'db' }, { id: 'diamond', name: 'Diamond push-ups', tier: 'bw' }],
  delts: [{ id: 'lateral', name: 'Dumbbell lateral raises', tier: 'db' }, { id: 'reardelt', name: 'Rear delt flyes (dumbbells)', tier: 'db' }],
  calves: [{ id: 'calf', name: 'Standing calf raises', tier: 'db' }, { id: 'calfsl', name: 'Single-leg calf raises', tier: 'bw', perSide: true }],
  core: [{ id: 'plank', name: 'Plank', tier: 'bw', unit: 'sec' }, { id: 'deadbug', name: 'Dead bugs', tier: 'bw', perSide: true }],
};
const MAIN: Pattern[] = ['squat', 'hinge', 'hpush', 'vpush', 'hpull', 'vpull'];

const TIERS: Record<Equipment, Tier[]> = { full: ['bb', 'db', 'bw'], dumbbells: ['db', 'bw'], none: ['bw'] };

interface Session {
  key: string;
  title: string;
  focus: string;
  patterns: Pattern[];
}
const FULL_A: Pattern[] = ['squat', 'hpush', 'hpull', 'core'];
const FULL_B: Pattern[] = ['hinge', 'vpush', 'vpull', 'lunge'];
const FULL_C: Pattern[] = ['lunge', 'hpush', 'hpull', 'delts', 'calves'];
const UPPER: Pattern[] = ['hpush', 'hpull', 'vpush', 'vpull', 'delts', 'triceps'];
const UPPER_B: Pattern[] = ['vpush', 'hpull', 'hpush', 'biceps', 'triceps', 'delts'];
const LOWER: Pattern[] = ['squat', 'hinge', 'lunge', 'calves', 'core'];
const PUSH: Pattern[] = ['hpush', 'vpush', 'delts', 'triceps'];
const PULL: Pattern[] = ['hpull', 'vpull', 'biceps', 'delts'];
const LEGS: Pattern[] = ['squat', 'hinge', 'lunge', 'calves', 'core'];

function split(days: number): Session[] {
  const s = (key: string, title: string, focus: string, patterns: Pattern[]): Session => ({ key, title, focus, patterns });
  if (days <= 1) return [s('full-a', 'Full body', 'Whole body', FULL_A)];
  if (days === 2) return [s('full-a', 'Full A', 'Squat, push, pull', FULL_A), s('full-b', 'Full B', 'Hinge, press, pull', FULL_B)];
  if (days === 3) return [s('full-a', 'Full A', 'Squat, push, pull', FULL_A), s('full-b', 'Full B', 'Hinge, press, pull', FULL_B), s('full-c', 'Full C', 'Legs, chest, back', FULL_C)];
  if (days === 4) return [s('upper-a', 'Upper A', 'Chest, back, shoulders', UPPER), s('lower-a', 'Lower A', 'Quads, glutes, calves', LOWER), s('upper-b', 'Upper B', 'Shoulders, back, arms', UPPER_B), s('lower-b', 'Lower B', 'Hamstrings, glutes, core', [...LOWER].reverse())];
  if (days === 5) return [s('push-a', 'Push', 'Chest, shoulders, triceps', PUSH), s('pull-a', 'Pull', 'Back, biceps, rear delts', PULL), s('legs-a', 'Legs', 'Quads, hamstrings, glutes', LEGS), s('upper-a', 'Upper', 'Chest and back', UPPER), s('lower-a', 'Lower', 'Legs and core', [...LOWER].reverse())];
  return [s('push-a', 'Push A', 'Chest, shoulders, triceps', PUSH), s('pull-a', 'Pull A', 'Back, biceps, rear delts', PULL), s('legs-a', 'Legs A', 'Quads, hamstrings, glutes', LEGS), s('push-b', 'Push B', 'Shoulders, chest, triceps', [...PUSH].reverse()), s('pull-b', 'Pull B', 'Back, biceps', [...PULL].reverse()), s('legs-b', 'Legs B', 'Hamstrings, quads, core', [...LEGS].reverse())];
}

function dose(req: PlanRequest, pattern: Pattern, mv: Move): Pick<ExerciseDef, 'sets' | 'min' | 'max' | 'unit'> {
  if (mv.unit === 'sec') return { sets: 3, min: 20, max: 45, unit: 'sec' };
  const main = MAIN.includes(pattern);
  let sets = main ? 3 : 2;
  if (req.experience === 'experienced' && req.days <= 4) sets += 1;
  if (req.experience === 'beginner') sets = Math.min(sets, 3);
  let [min, max] = main ? [6, 10] : [10, 15];
  if (req.goal === 'strength') [min, max] = main ? [3, 6] : [6, 10];
  if (req.goal === 'fatloss') [min, max] = main ? [8, 12] : [12, 20];
  if (req.goal === 'general') [min, max] = main ? [8, 12] : [10, 15];
  // With no weights, hard bodyweight moves need wider ranges so progress is possible.
  if (mv.tier === 'bw') [min, max] = [Math.max(min, 8), Math.max(max + 8, 20)];
  return { sets, min, max, unit: 'reps' };
}

/** A plan from plain rules: no internet or AI key needed. */
export function buildPlanOffline(req: PlanRequest): DayDef[] {
  const terms = avoidTerms(req.avoid);
  const tiers = TIERS[req.equipment];
  const days = Math.min(6, Math.max(1, Math.round(req.days)));
  const heavy = (req.bodyKg ?? 0) >= 110 && req.experience === 'beginner';
  const weekdays = WEEKDAYS[days];
  return split(days).map((sess, i) => {
    const exercises: ExerciseDef[] = [];
    for (const pattern of sess.patterns) {
      const mvs = POOL[pattern].filter((m) => tiers.includes(m.tier) && !isAvoided(m.name, terms) && !(heavy && m.id === 'pike'));
      mvs.sort((a, b) => tiers.indexOf(a.tier) - tiers.indexOf(b.tier));
      const mv = mvs[0];
      if (!mv || exercises.some((e) => e.id === mv.id)) continue;
      exercises.push({ id: mv.id, name: mv.name, ...dose(req, pattern, mv), ...(mv.perSide && { perSide: true }) });
    }
    return { key: sess.key, title: sess.title, weekday: weekdays[i], focus: sess.focus, exercises };
  });
}

/* ---------- the version that asks the person's AI ---------- */

export const PLAN_SYSTEM = `You write one person's weekly strength-training plan inside their private dashboard. Reply with JSON only, no other text, in exactly this shape:
{"sessions":[{"title":"Upper A","focus":"Chest, back, shoulders","exercises":[{"name":"Barbell bench press","sets":4,"min":5,"max":8,"unit":"reps","perSide":false}]}]}
Rules: unit is "reps" or "sec" (use "sec" only for holds such as planks). sets is a whole number from 1 to 6. min and max are whole numbers with max at least min. Use 3 to 7 exercises a session. Give each session a short title of at most 20 characters. Only use equipment the person has. Never include a movement they asked to avoid. Choose rep ranges that fit their goal and experience, and a sensible load of volume for their body mass. This is general fitness guidance, not medical advice.`;

export function planPrompt(req: PlanRequest, unit: string, display: (kg: number) => number): string {
  const goal = GOALS.find((g) => g.id === req.goal)?.label;
  const equip = EQUIPMENT.find((g) => g.id === req.equipment)?.label;
  const exp = EXPERIENCE.find((g) => g.id === req.experience)?.label;
  return [
    `Goal: ${goal}.`,
    `Sessions per week: exactly ${req.days}.`,
    `Equipment: ${equip}.`,
    `Experience: ${exp}.`,
    req.bodyKg ? `Body mass: ${display(req.bodyKg)} ${unit}.` : 'Body mass: not given.',
    req.avoid.trim() ? `Movements to avoid (do not include any): ${req.avoid.trim().slice(0, 200)}.` : 'Movements to avoid: none.',
    `Return exactly ${req.days} sessions.`,
  ].join('\n');
}

export class PlanError extends Error {}

const slug = (s: string, i: number) => `${s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 14) || 's'}-${i + 1}`;

/** Checks the reply from the AI and turns it into a programme, or says in plain words what was wrong. */
export function parseAiPlan(text: string, req: PlanRequest): DayDef[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new PlanError('The reply was not a plan I could read.');
  }
  const sessions = (raw as { sessions?: unknown })?.sessions;
  if (!Array.isArray(sessions) || sessions.length !== req.days) throw new PlanError(`The plan did not have ${req.days} sessions.`);
  const terms = avoidTerms(req.avoid);
  const weekdays = WEEKDAYS[req.days];
  const used = new Set<string>();
  const out: DayDef[] = sessions.map((s, i) => {
    const r = (s ?? {}) as Record<string, unknown>;
    const title = typeof r.title === 'string' ? r.title.trim().slice(0, 20) : '';
    const list = Array.isArray(r.exercises) ? r.exercises : [];
    if (!title || list.length < 1 || list.length > 8) throw new PlanError('A session in the plan was empty or too long.');
    const exercises = list.map((e, k): ExerciseDef => {
      const x = (e ?? {}) as Record<string, unknown>;
      const name = typeof x.name === 'string' ? x.name.trim().slice(0, 60) : '';
      if (!name) throw new PlanError('An exercise had no name.');
      if (isAvoided(name, terms)) throw new PlanError(`The plan included ${name}, which you asked to avoid.`);
      const unit = x.unit === 'sec' ? 'sec' : 'reps';
      const sets = Number(x.sets);
      const min = Number(x.min);
      const max = Number(x.max);
      if (!Number.isInteger(sets) || sets < 1 || sets > 6) throw new PlanError(`${name}: the number of sets was not valid.`);
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > (unit === 'sec' ? 180 : 60)) throw new PlanError(`${name}: the rep range was not valid.`);
      let id = slug(name, k);
      while (used.has(`${i}|${id}`)) id += 'x';
      used.add(`${i}|${id}`);
      return { id, name, sets, min, max, unit, ...(x.perSide === true && { perSide: true }) };
    });
    return { key: slug(title, i), title, weekday: weekdays[i], focus: typeof r.focus === 'string' ? r.focus.trim().slice(0, 60) : '', exercises };
  });
  const problem = programError(out);
  if (problem) throw new PlanError(problem);
  return out;
}
