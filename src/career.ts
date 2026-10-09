import type { AppData, CareerData, Project } from './types';
import { addDays, dayNumber, mondayOf } from './utils';

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export const commitsOn = (c: CareerData, date: string) => c.commits[date] ?? 0;

export function weekStats(c: CareerData, today: string) {
  const monday = mondayOf(today);
  let commits = 0;
  let activeDays = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (d > today) break;
    const n = commitsOn(c, d);
    commits += n;
    if (n > 0) activeDays++;
  }
  return { commits, activeDays };
}

/** Consecutive days with a commit. Today only counts once it has one, so a streak isn't broken until the day is over. */
export function commitStreak(c: CareerData, today: string): number {
  let d = commitsOn(c, today) > 0 ? today : addDays(today, -1);
  let n = 0;
  while (n < 400 && commitsOn(c, d) > 0) {
    n++;
    d = addDays(d, -1);
  }
  return n;
}

/** 0 = none, 1..4 = increasing activity. */
export const level = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : n <= 6 ? 3 : 4);

export function heatmap(c: CareerData, today: string, weeks = 12) {
  const start = addDays(mondayOf(today), -7 * (weeks - 1));
  const cells: { date: string; n: number; future: boolean }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(start, i);
    cells.push({ date, n: commitsOn(c, date), future: date > today });
  }
  return { start, cells };
}

export const milestoneProgress = (p: Project) => ({ done: p.milestones.filter((m) => m.done).length, total: p.milestones.length });
export const shippedCount = (c: CareerData) => c.projects.filter((p) => p.status === 'shipped').length;

export function goalForecast(c: CareerData, today: string) {
  const shipped = shippedCount(c);
  const remaining = Math.max(0, c.goalCount - shipped);
  const weeksLeft = Math.max(0, (dayNumber(c.deadline) - dayNumber(today)) / 7);
  const weeksElapsed = Math.max(1, (dayNumber(today) - dayNumber(c.startDate)) / 7);
  const neededWeeksEach = remaining > 0 ? weeksLeft / remaining : 0;
  const actualWeeksEach = shipped > 0 ? weeksElapsed / shipped : null;
  return {
    shipped,
    remaining,
    weeksLeft,
    neededWeeksEach,
    actualWeeksEach,
    onTrack: remaining === 0 || (actualWeeksEach != null && actualWeeksEach <= neededWeeksEach),
  };
}

export function totalCommits(c: CareerData, today: string, days: number) {
  let n = 0;
  for (let i = 0; i < days; i++) n += commitsOn(c, addDays(today, -i));
  return n;
}

export const hasData = (data: AppData) => Object.keys(data.career.commits).length > 0;
