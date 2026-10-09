export type DayKey = 'push' | 'pull' | 'legs';

export interface ExerciseDef {
  id: string;
  name: string;
  sets: number;
  min: number;
  max: number;
  unit: 'reps' | 'sec';
  perSide?: boolean;
  note?: string;
}

export interface DayDef {
  key: DayKey;
  title: string;
  weekday: number; // 0 = Sunday
  focus: string;
  exercises: ExerciseDef[];
}

export const DEFAULT_PROGRAM: DayDef[] = [
  {
    key: 'push',
    title: 'Push',
    weekday: 1,
    focus: 'Chest, shoulders, triceps',
    exercises: [
      { id: 'bench', name: 'Barbell bench press', sets: 4, min: 5, max: 8, unit: 'reps' },
      { id: 'incline', name: 'Incline dumbbell press', sets: 3, min: 8, max: 12, unit: 'reps' },
      { id: 'ohp', name: 'Standing overhead press', sets: 3, min: 6, max: 10, unit: 'reps' },
      { id: 'lateral', name: 'Dumbbell lateral raises', sets: 3, min: 12, max: 15, unit: 'reps' },
      { id: 'dips', name: 'Bench dips', sets: 3, min: 10, max: 15, unit: 'reps' },
      { id: 'triext', name: 'Dumbbell overhead triceps extension', sets: 3, min: 10, max: 15, unit: 'reps' },
    ],
  },
  {
    key: 'pull',
    title: 'Pull',
    weekday: 3,
    focus: 'Back, biceps, rear delts',
    exercises: [
      { id: 'row', name: 'Bent-over barbell row', sets: 4, min: 6, max: 10, unit: 'reps' },
      {
        id: 'pullup',
        name: 'Pull-ups or chin-ups',
        sets: 3,
        min: 6,
        max: 10,
        unit: 'reps',
        note: 'Replaces the pull-day Romanian deadlift. Can’t hit 6 yet? Jump up and lower over 3–5 seconds.',
      },
      { id: 'dbrow', name: 'One-arm dumbbell row', sets: 3, min: 8, max: 12, unit: 'reps', perSide: true },
      { id: 'reardelt', name: 'Rear delt flyes (dumbbells)', sets: 3, min: 12, max: 15, unit: 'reps' },
      { id: 'bbcurl', name: 'Barbell curls', sets: 3, min: 8, max: 12, unit: 'reps' },
      { id: 'hammer', name: 'Hammer curls', sets: 3, min: 10, max: 15, unit: 'reps' },
    ],
  },
  {
    key: 'legs',
    title: 'Legs',
    weekday: 5,
    focus: 'Quads, hamstrings, glutes, calves, core',
    exercises: [
      { id: 'squat', name: 'Barbell back squat', sets: 4, min: 5, max: 8, unit: 'reps' },
      { id: 'rdl', name: 'Romanian deadlift', sets: 3, min: 8, max: 12, unit: 'reps' },
      { id: 'bulgarian', name: 'Bulgarian split squats', sets: 3, min: 8, max: 12, unit: 'reps', perSide: true },
      { id: 'lunge', name: 'Dumbbell walking lunges', sets: 3, min: 10, max: 15, unit: 'reps', perSide: true },
      { id: 'calf', name: 'Standing calf raises', sets: 4, min: 15, max: 20, unit: 'reps' },
      {
        id: 'plank',
        name: 'Plank',
        sets: 3,
        min: 30,
        max: 60,
        unit: 'sec',
        note: 'Logged in seconds. 30–60 seconds is a starting range you can change.',
      },
    ],
  },
];

/**
 * The programme in use. The store sets it from the saved data whenever that changes, so every screen
 * reads the person's own programme (or the default) through these functions.
 */
let active: DayDef[] = DEFAULT_PROGRAM;
export const getProgram = (): DayDef[] => active;
export const setActiveProgram = (p?: DayDef[]) => {
  active = p && programError(p) == null ? p : DEFAULT_PROGRAM;
};
export const dayDef = (k: DayKey): DayDef => active.find((d) => d.key === k)!;
export const dayForWeekday = (wd: number): DayKey | null => active.find((d) => d.weekday === wd)?.key ?? null;
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Returns a plain-words problem with a programme, or null when it is usable. */
export function programError(p: DayDef[]): string | null {
  const keys: DayKey[] = ['push', 'pull', 'legs'];
  if (!Array.isArray(p) || p.length !== 3 || !keys.every((k) => p.some((d) => d.key === k))) return 'The programme needs a push, a pull and a legs day.';
  const days = p.map((d) => d.weekday);
  if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return 'Pick a weekday for every session.';
  if (new Set(days).size !== 3) return 'Two sessions are on the same weekday. Give each its own day.';
  for (const d of p) {
    if (!d.title.trim()) return 'Every session needs a name.';
    if (d.exercises.length === 0) return `${d.title} has no exercises. Add at least one.`;
    const ids = new Set<string>();
    for (const e of d.exercises) {
      if (!e.name.trim()) return `${d.title} has an exercise without a name.`;
      if (ids.has(e.id)) return `${d.title} has a duplicate exercise.`;
      ids.add(e.id);
      if (!Number.isInteger(e.sets) || e.sets < 1 || e.sets > 10) return `${e.name}: sets must be from 1 to 10.`;
      if (!Number.isInteger(e.min) || !Number.isInteger(e.max) || e.min < 1 || e.max < e.min || e.max > 200) return `${e.name}: the range must go from a smaller number up to a larger one.`;
    }
  }
  return null;
}

export interface MobilityStep {
  id: string;
  name: string;
  dose: string;
  cue: string;
  warmup: boolean;
}

export const MOBILITY: MobilityStep[] = [
  { id: 'catcow', name: 'Cat-cow', dose: '10 slow reps', cue: 'Move one bone at a time through your spine.', warmup: false },
  { id: 'wgs', name: 'World’s greatest stretch', dose: '5 per side', cue: 'Lunge, elbow to instep, then rotate and reach up.', warmup: true },
  { id: 'ninety', name: '90/90 hip switches', dose: '10 reps', cue: 'Sit tall and rotate both knees side to side without using your hands.', warmup: true },
  { id: 'squathold', name: 'Deep bodyweight squat hold', dose: '3 × 30 sec', cue: 'Heels down, chest up, push knees out over your toes.', warmup: true },
  { id: 'openbook', name: 'Thoracic open book', dose: '8 per side', cue: 'Lie on your side, knees stacked, open the top arm and follow it with your eyes.', warmup: false },
  { id: 'dislocate', name: 'Towel shoulder dislocates', dose: '10 reps', cue: 'Wide grip, arms straight, go only as far as your shoulders allow.', warmup: true },
  { id: 'hipflexor', name: 'Half-kneeling hip flexor stretch', dose: '45 sec per side', cue: 'Tuck your pelvis under and squeeze the glute of the back leg.', warmup: false },
  { id: 'hamhinge', name: 'Standing hamstring hinge stretch', dose: '45 sec per side', cue: 'Heel forward, toes up, hinge from the hips with a flat back.', warmup: false },
];

export const MEASURES = [
  { key: 'neck', label: 'Neck' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'chest', label: 'Chest' },
  { key: 'arm', label: 'Upper arm' },
  { key: 'waist', label: 'Waist' },
  { key: 'hips', label: 'Hips' },
  { key: 'thigh', label: 'Thigh' },
  { key: 'calf', label: 'Calf' },
] as const;
