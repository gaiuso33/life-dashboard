import { afterEach, describe, expect, it } from 'vitest';
import { sessionVolume, weeklyVolume } from '../derive';
import { MIN_LOAD_COVERAGE, strengthForecast } from '../forecast';
import { mergeData } from '../merge';
import { sanitize } from '../sanitize';
import { reducer } from '../store';
import { emptyData } from '../types';
import type { AppData, Session } from '../types';
import { LEGACY_PREFS, MAX_LOAD_KG, loadStep, loadText, nextLoadKg, parseLoad, setActivePrefs, toDisplay } from '../units';

afterEach(() => setActivePrefs(LEGACY_PREFS));
const LB = { currency: 'USD', weightUnit: 'lb', lengthUnit: 'in' } as const;

describe('typing a load', () => {
  it('reads what is typed in the unit shown and keeps kilograms', () => {
    expect(parseLoad('22.5')).toBe(22.5);
    expect(parseLoad(' 20 ')).toBe(20);
    expect(parseLoad('22,5')).toBe(22.5); // a comma as the decimal mark
    expect(parseLoad('2.')).toBe(2); // on the way to "2.5"
    expect(parseLoad('.5')).toBe(0.5);
    setActivePrefs(LB);
    expect(parseLoad('45')).toBe(20.41); // 45 lb, to 0.01 kg
    expect(parseLoad('100')).toBe(45.36);
  });
  it('refuses empty, zero, negative, silly and non-numbers', () => {
    for (const t of ['', ' ', '0', '0.0', '-5', 'abc', '5kg', '1e3', '1.2.3', '1001', String(MAX_LOAD_KG + 1), '.', ',']) expect(parseLoad(t), JSON.stringify(t)).toBeNull();
    expect(parseLoad(String(MAX_LOAD_KG))).toBe(MAX_LOAD_KG);
  });
  it('shows a stored load back as it was typed, in either unit', () => {
    expect(loadText(22.5)).toBe('22.5');
    expect(loadText(20)).toBe('20');
    setActivePrefs(LB);
    for (const typed of ['45', '100', '135', '12.5', '5']) expect(loadText(parseLoad(typed)!), typed).toBe(typed);
  });
  it('suggests 2.5 kg or 5 lb more', () => {
    expect(loadStep()).toBe(2.5);
    expect(toDisplay(nextLoadKg(20))).toBe(22.5);
    expect(toDisplay(nextLoadKg(22.5))).toBe(25);
    setActivePrefs(LB);
    expect(loadStep()).toBe(5);
    expect(toDisplay(nextLoadKg(parseLoad('45')!))).toBe(50);
    expect(toDisplay(nextLoadKg(parseLoad('135')!))).toBe(140);
  });
  it('switching unit changes how it is shown, not what is stored', () => {
    const kg = parseLoad('20')!;
    setActivePrefs(LB);
    expect(loadText(kg)).toBe('44.1');
    setActivePrefs(LEGACY_PREFS);
    expect(loadText(kg)).toBe('20');
  });
});

const session = (over: Partial<Session> = {}): Session => ({ date: '2026-10-05', day: 'push', loads: {}, reps: {}, finished: true, ...over });

describe('saving and combining loads', () => {
  const withSession = (s: Session): AppData => ({ ...emptyData(), sessions: { [`${s.date}|${s.day}`]: s } });
  it('an older session with no numeric loads is unchanged, and a session without any adds nothing', () => {
    const out = sanitize(withSession(session({ loads: { bench: 'bar' }, reps: { bench: [5] } })))!;
    expect(out.sessions['2026-10-05|push']).toEqual({ date: '2026-10-05', day: 'push', loads: { bench: 'bar' }, reps: { bench: [5] }, finished: true });
    expect('kg' in out.sessions['2026-10-05|push']).toBe(false);
  });
  it('keeps sensible loads and drops the rest', () => {
    const raw = withSession(session({ kg: { bench: 42.5, ohp: 0, row: -3, dips: 5000, x: 'heavy' as unknown as number, y: Number.NaN, z: 12.345 } }));
    expect(sanitize(raw)!.sessions['2026-10-05|push'].kg).toEqual({ bench: 42.5, z: 12.35 });
    expect('kg' in sanitize(withSession(session({ kg: { a: 0 } })))!.sessions['2026-10-05|push']).toBe(false);
    expect(sanitize(withSession(session({ kg: 'junk' as unknown as Record<string, number> })))!.sessions['2026-10-05|push'].loads).toEqual({});
  });
  it('merging two devices keeps loads from both, with the newer copy winning a clash', () => {
    const older = { ...withSession(session({ kg: { bench: 40, ohp: 25 } })), modified: '2026-10-05T08:00:00.000Z' };
    const newer = { ...withSession(session({ kg: { bench: 42.5, row: 40 } })), modified: '2026-10-05T09:00:00.000Z' };
    expect(mergeData(older, newer).sessions['2026-10-05|push'].kg).toEqual({ bench: 42.5, ohp: 25, row: 40 });
    expect(mergeData(newer, older).sessions['2026-10-05|push'].kg).toEqual({ bench: 42.5, ohp: 25, row: 40 });
    expect(mergeData(withSession(session()), withSession(session())).sessions['2026-10-05|push'].kg).toBeUndefined();
  });
});

describe('the Train screen’s actions', () => {
  const act = { date: '2026-10-05', day: 'push' as const, ex: 'bench' };
  it('sets and clears a load, leaving nothing behind when it is cleared', () => {
    let d = reducer(emptyData(), { t: 'load-kg', ...act, kg: 42.5 });
    expect(d.sessions['2026-10-05|push'].kg).toEqual({ bench: 42.5 });
    d = reducer(d, { t: 'load-kg', ...act, ex: 'ohp', kg: 25 });
    d = reducer(d, { t: 'load-kg', ...act, kg: null });
    expect(d.sessions['2026-10-05|push'].kg).toEqual({ ohp: 25 });
    d = reducer(d, { t: 'load-kg', ...act, ex: 'ohp', kg: null });
    expect('kg' in d.sessions['2026-10-05|push']).toBe(false);
  });
  it('rep-only logging works with no load at all', () => {
    let d = reducer(emptyData(), { t: 'reps', ...act, idx: 0, sets: 4, value: 8 });
    d = reducer(d, { t: 'finish', date: act.date, day: act.day, finished: true });
    expect(d.sessions['2026-10-05|push'].reps.bench).toEqual([8, null, null, null]);
    expect(d.sessions['2026-10-05|push'].kg).toBeUndefined();
  });
  it('Copy last time brings the load too, but never overwrites one already typed', () => {
    let d = reducer(emptyData(), { t: 'fillReps', ...act, reps: [8, 8], kg: 40 });
    expect(d.sessions['2026-10-05|push'].kg).toEqual({ bench: 40 });
    d = reducer(d, { t: 'load-kg', ...act, kg: 45 });
    d = reducer(d, { t: 'fillReps', ...act, reps: [7, 7], kg: 40 });
    expect(d.sessions['2026-10-05|push'].kg).toEqual({ bench: 45 });
    d = reducer(emptyData(), { t: 'fillReps', ...act, reps: [8] });
    expect(d.sessions['2026-10-05|push'].kg).toBeUndefined();
  });
});

describe('weight lifted', () => {
  it('is reps times load, set by set, and leaves out lifts without a load, empty sets and timed holds', () => {
    // pullup and plank-type holds: find a timed exercise in the default programme
    const v = sessionVolume(session({ reps: { bench: [8, 8, null, 0], row: [10, 10] }, kg: { bench: 40 } }));
    expect(v).toEqual({ kg: 640, loadedReps: 16, reps: 36 });
  });
  it('a timed hold with a load typed is not counted as weight lifted', () => {
    const v = sessionVolume(session({ reps: { bench: [5], plank: [60, 60, 60] }, kg: { bench: 100, plank: 20 } }));
    expect(v).toEqual({ kg: 500, loadedReps: 5, reps: 185 });
  });
});

// Finished Monday sessions on the weeks before Friday 9 Oct 2026.
const MONDAYS = ['2026-08-24', '2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']; // all before this week's Monday, 5 Oct
const TODAY = '2026-10-09';
const build = (weeks: { reps: number[]; kg?: number }[]): AppData => {
  const d = emptyData();
  const mondays = MONDAYS.slice(-weeks.length);
  mondays.forEach((date, i) => {
    const w = weeks[i];
    d.sessions[`${date}|push`] = { date, day: 'push', loads: {}, reps: { bench: w.reps }, ...(w.kg != null && { kg: { bench: w.kg } }), finished: true };
  });
  return d;
};
const strength = (d: AppData) => strengthForecast(d, TODAY);

describe('the training volume forecast', () => {
  it('stays about reps when no loads are logged, and says how to get weight lifted', () => {
    const f = strength(build([{ reps: [8, 8, 8] }, { reps: [8, 8, 8] }, { reps: [9, 9, 9] }, { reps: [9, 9, 9] }]));
    expect(f.headline).toMatch(/^Weekly reps are/);
    expect(f.detail).toContain('Log a load');
  });
  it('still needs three finished weeks, loads or not', () => {
    expect(strength(build([{ reps: [8], kg: 40 }, { reps: [8], kg: 40 }])).headline).toBe('Needs three finished weeks');
  });
  it('uses weight lifted once three recent weeks in a row have loads, even if the reps are flat', () => {
    const f = strength(build([{ reps: [8, 8, 8, 8], kg: 40 }, { reps: [8, 8, 8, 8], kg: 42.5 }, { reps: [8, 8, 8, 8], kg: 45 }, { reps: [8, 8, 8, 8], kg: 47.5 }]));
    expect(f.headline).toBe('Weight lifted is rising, about 80 kg a week'); // 32 reps x 2.5 kg per week
    expect(f.tone).toBe('good');
    expect(f.confidence).toBe('medium');
    expect(f.detail).toContain('4 finished weeks');
    expect(f.detail).toContain('100%');
  });
  it('shows the weekly change in the unit shown', () => {
    setActivePrefs(LB);
    const f = strength(build([{ reps: [8, 8, 8, 8], kg: 40 }, { reps: [8, 8, 8, 8], kg: 42.5 }, { reps: [8, 8, 8, 8], kg: 45 }]));
    expect(f.headline).toBe('Weight lifted is rising, about 176 lb a week');
  });
  it('says falling or flat as it is', () => {
    expect(strength(build([{ reps: [8, 8], kg: 50 }, { reps: [8, 8], kg: 45 }, { reps: [8, 8], kg: 40 }])).headline).toMatch(/^Weight lifted is falling/);
    const flat = strength(build([{ reps: [8, 8], kg: 40 }, { reps: [8, 8], kg: 40 }, { reps: [8, 8], kg: 40 }]));
    expect(flat.headline).toBe('Weight lifted is flat');
    expect(flat.tone).toBe('info');
  });
  it('does not mistake starting to log loads for getting stronger', () => {
    // Four weeks of reps only, then two weeks with loads: not yet three in a row, so the reps trend is still the answer.
    const f = strength(build([{ reps: [8, 8] }, { reps: [8, 8] }, { reps: [8, 8] }, { reps: [8, 8] }, { reps: [8, 8], kg: 40 }, { reps: [8, 8], kg: 40 }]));
    expect(f.headline).toMatch(/^Weekly reps are/);
    // Once three loaded weeks are in a row, only those weeks are used.
    const g = strength(build([{ reps: [8, 8] }, { reps: [8, 8] }, { reps: [8, 8] }, { reps: [8, 8], kg: 40 }, { reps: [8, 8], kg: 40 }, { reps: [8, 8], kg: 40 }]));
    expect(g.headline).toBe('Weight lifted is flat');
    expect(g.detail).toContain('3 finished weeks');
  });
  it('a gap in logging loads breaks the run', () => {
    const f = strength(build([{ reps: [8, 8], kg: 40 }, { reps: [8, 8], kg: 40 }, { reps: [8, 8] }, { reps: [8, 8], kg: 40 }, { reps: [8, 8], kg: 40 }]));
    expect(f.headline).toMatch(/^Weekly reps are/);
  });
  it('needs most of the reps to have a load', () => {
    expect(MIN_LOAD_COVERAGE).toBe(0.5);
    const mixed = (kgReps: number[], otherReps: number[]): AppData => {
      const d = emptyData();
      MONDAYS.slice(-3).forEach((date) => {
        d.sessions[`${date}|push`] = { date, day: 'push', loads: {}, reps: { bench: kgReps, row: otherReps }, kg: { bench: 40 }, finished: true };
      });
      return d;
    };
    expect(strength(mixed([8, 8, 8], [8, 8])).headline).toMatch(/^Weight lifted/); // 24 of 40 reps have a load
    expect(strength(mixed([8, 8], [8, 8, 8])).headline).toMatch(/^Weekly reps/); // 16 of 40
  });
  it('weeks are summed from every finished session, and unfinished ones are not counted', () => {
    const d = build([{ reps: [10, 10], kg: 20 }, { reps: [10, 10], kg: 20 }, { reps: [10, 10], kg: 20 }]);
    d.sessions['2026-09-28|push'].finished = false;
    const w = weeklyVolume(d, TODAY, 4);
    expect(w.map((x) => x.kg)).toEqual([400, 400, 0, 0]);
  });
});
