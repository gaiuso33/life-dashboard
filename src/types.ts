import type { DayKey, MEASURES } from './program';

export type MeasureKey = (typeof MEASURES)[number]['key'];

export interface DayLog {
  code?: boolean;
  money?: boolean;
  energy?: number; // 1-5
  mobility?: boolean;
}

export interface Session {
  date: string;
  day: DayKey;
  loads: Record<string, string>;
  reps: Record<string, (number | null)[]>;
  finished: boolean;
}

export interface BodyEntry {
  date: string;
  weight: number;
  m: Partial<Record<MeasureKey, number>>;
}

export interface AppData {
  version: 1;
  sample: boolean;
  days: Record<string, DayLog>;
  sessions: Record<string, Session>; // key: `${date}|${day}`
  body: BodyEntry[]; // ascending by date
  goalWeight: number | null;
}

export const sessionKey = (date: string, day: DayKey) => `${date}|${day}`;

export const emptyData = (): AppData => ({
  version: 1,
  sample: false,
  days: {},
  sessions: {},
  body: [],
  goalWeight: null,
});
