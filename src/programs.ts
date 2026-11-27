import { DEFAULT_PROGRAM } from './program';
import type { DayDef, ExerciseDef } from './program';

export interface ReadyProgram {
  id: string;
  name: string;
  blurb: string;
  level: string;
  equipment: string;
  days: DayDef[];
}

const ex = (id: string, name: string, sets: number, min: number, max: number, more: Partial<ExerciseDef> = {}): ExerciseDef => ({ id, name, sets, min, max, unit: 'reps', ...more });

const FULL_BODY: DayDef[] = [
  {
    key: 'full-a', title: 'Full A', weekday: 1, focus: 'Squat, push, pull',
    exercises: [ex('squat', 'Barbell back squat', 3, 5, 8), ex('bench', 'Barbell bench press', 3, 5, 8), ex('row', 'Bent-over barbell row', 3, 6, 10), ex('lateral', 'Dumbbell lateral raises', 2, 12, 15), ex('plank', 'Plank', 3, 30, 60, { unit: 'sec' })],
  },
  {
    key: 'full-b', title: 'Full B', weekday: 3, focus: 'Hinge, press, pull',
    exercises: [ex('rdl', 'Romanian deadlift', 3, 6, 10), ex('ohp', 'Standing overhead press', 3, 6, 10), ex('pullup', 'Pull-ups or chin-ups', 3, 6, 10), ex('lunge', 'Dumbbell walking lunges', 2, 10, 15, { perSide: true }), ex('bbcurl', 'Barbell curls', 2, 8, 12)],
  },
  {
    key: 'full-c', title: 'Full C', weekday: 5, focus: 'Legs, chest, back',
    exercises: [ex('bulgarian', 'Bulgarian split squats', 3, 8, 12, { perSide: true }), ex('incline', 'Incline dumbbell press', 3, 8, 12), ex('dbrow', 'One-arm dumbbell row', 3, 8, 12, { perSide: true }), ex('calf', 'Standing calf raises', 3, 15, 20), ex('triext', 'Dumbbell overhead triceps extension', 2, 10, 15)],
  },
];

const UPPER_LOWER: DayDef[] = [
  {
    key: 'upper-a', title: 'Upper A', weekday: 1, focus: 'Chest, back, shoulders',
    exercises: [ex('bench', 'Barbell bench press', 4, 5, 8), ex('row', 'Bent-over barbell row', 4, 6, 10), ex('ohp', 'Standing overhead press', 3, 6, 10), ex('pullup', 'Pull-ups or chin-ups', 3, 6, 10), ex('lateral', 'Dumbbell lateral raises', 3, 12, 15)],
  },
  {
    key: 'lower-a', title: 'Lower A', weekday: 2, focus: 'Quads, glutes, calves',
    exercises: [ex('squat', 'Barbell back squat', 4, 5, 8), ex('rdl', 'Romanian deadlift', 3, 8, 12), ex('lunge', 'Dumbbell walking lunges', 3, 10, 15, { perSide: true }), ex('calf', 'Standing calf raises', 4, 15, 20)],
  },
  {
    key: 'upper-b', title: 'Upper B', weekday: 4, focus: 'Arms, upper chest, back',
    exercises: [ex('incline', 'Incline dumbbell press', 3, 8, 12), ex('dbrow', 'One-arm dumbbell row', 3, 8, 12, { perSide: true }), ex('bbcurl', 'Barbell curls', 3, 8, 12), ex('triext', 'Dumbbell overhead triceps extension', 3, 10, 15), ex('reardelt', 'Rear delt flyes (dumbbells)', 3, 12, 15)],
  },
  {
    key: 'lower-b', title: 'Lower B', weekday: 5, focus: 'Hamstrings, glutes, core',
    exercises: [ex('bulgarian', 'Bulgarian split squats', 3, 8, 12, { perSide: true }), ex('rdl2', 'Dumbbell Romanian deadlift', 3, 8, 12), ex('calf2', 'Seated or single-leg calf raises', 3, 12, 20), ex('plank', 'Plank', 3, 30, 60, { unit: 'sec' })],
  },
];

const HOME: DayDef[] = [
  {
    key: 'home-push', title: 'Push', weekday: 1, focus: 'Chest, shoulders, triceps (no equipment)',
    exercises: [ex('pushup', 'Push-ups', 4, 8, 20), ex('pike', 'Pike push-ups', 3, 6, 15), ex('dips', 'Bench dips', 3, 10, 15), ex('diamond', 'Diamond push-ups', 3, 6, 15)],
  },
  {
    key: 'home-legs', title: 'Legs', weekday: 3, focus: 'Quads, glutes, calves (no equipment)',
    exercises: [ex('airsquat', 'Bodyweight squats', 4, 15, 30), ex('bulgarian', 'Bulgarian split squats', 3, 8, 15, { perSide: true }), ex('lunge', 'Walking lunges', 3, 10, 20, { perSide: true }), ex('calf', 'Single-leg calf raises', 3, 15, 25, { perSide: true }), ex('plank', 'Plank', 3, 30, 60, { unit: 'sec' })],
  },
  {
    key: 'home-core', title: 'Core and back', weekday: 5, focus: 'Core, back, rear shoulders (no equipment)',
    exercises: [ex('superman', 'Superman holds', 3, 20, 45, { unit: 'sec' }), ex('deadbug', 'Dead bugs', 3, 8, 12, { perSide: true }), ex('hollow', 'Hollow body hold', 3, 15, 40, { unit: 'sec' }), ex('glute', 'Glute bridges', 3, 12, 20)],
  },
];

export const READY_PROGRAMS: ReadyProgram[] = [
  { id: 'ppl', name: 'Push · Pull · Legs', blurb: 'The original plan: chest and arms, back and biceps, then legs.', level: 'Some experience', equipment: 'Barbell and dumbbells', days: DEFAULT_PROGRAM },
  { id: 'fullbody', name: 'Full body', blurb: 'Three whole-body sessions a week. Simple, forgiving and good for beginners.', level: 'Beginner friendly', equipment: 'Barbell and dumbbells', days: FULL_BODY },
  { id: 'upperlower', name: 'Upper · Lower', blurb: 'Four sessions: upper body and lower body twice each.', level: 'Some experience', equipment: 'Barbell and dumbbells', days: UPPER_LOWER },
  { id: 'home', name: 'Bodyweight at home', blurb: 'Three sessions with no equipment at all.', level: 'Any level', equipment: 'None', days: HOME },
];

const same = (a: DayDef[], b: DayDef[]) => JSON.stringify(a) === JSON.stringify(b);

/** The ready-made program that matches the one in use, or null for the person's own. */
export const matchProgram = (active: DayDef[]): ReadyProgram | null => READY_PROGRAMS.find((p) => same(p.days, active)) ?? null;
