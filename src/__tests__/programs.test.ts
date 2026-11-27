import { afterEach, describe, expect, it } from 'vitest';
import { weekStreak } from '../derive';
import { DEFAULT_PROGRAM, dayDef, programError, sessionsPerWeek, setActiveProgram } from '../program';
import { READY_PROGRAMS, matchProgram } from '../programs';
import { sanitize } from '../sanitize';
import { emptyData } from '../types';

afterEach(() => setActiveProgram(undefined));

describe('ready-made programs', () => {
  it('are all valid, with their own weekdays and unique session ids', () => {
    for (const p of READY_PROGRAMS) {
      expect(programError(p.days), p.name).toBeNull();
      expect(p.days.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('match themselves and nothing else', () => {
    for (const p of READY_PROGRAMS) expect(matchProgram(p.days)?.id).toBe(p.id);
    expect(matchProgram([{ ...DEFAULT_PROGRAM[0] }])).toBeNull();
  });
});

describe('programs of any shape', () => {
  it('accepts from 1 to 6 sessions and rejects duplicates and empty programs', () => {
    expect(programError([DEFAULT_PROGRAM[0]])).toBeNull();
    expect(programError([])).not.toBeNull();
    expect(programError([DEFAULT_PROGRAM[0], { ...DEFAULT_PROGRAM[1], weekday: DEFAULT_PROGRAM[0].weekday }])).toMatch(/same weekday/);
    expect(programError([DEFAULT_PROGRAM[0], { ...DEFAULT_PROGRAM[1], key: DEFAULT_PROGRAM[0].key }])).toMatch(/own id/);
  });

  it('counts the week streak against the number of sessions in the program', () => {
    const four = READY_PROGRAMS.find((p) => p.id === 'upperlower')!.days;
    setActiveProgram(four);
    expect(sessionsPerWeek()).toBe(4);
    const data = emptyData();
    // Monday 5 Oct 2026 week: finish three of four
    for (const [date, day] of [['2026-10-05', 'upper-a'], ['2026-10-06', 'lower-a'], ['2026-10-08', 'upper-b']] as const) data.sessions[`${date}|${day}`] = { date, day, loads: {}, reps: {}, finished: true };
    expect(weekStreak(data, '2026-10-09')).toBe(0);
    data.sessions['2026-10-09|lower-b'] = { date: '2026-10-09', day: 'lower-b', loads: {}, reps: {}, finished: true };
    expect(weekStreak(data, '2026-10-09')).toBe(1);
  });

  it('keeps history for sessions that are not in the current program', () => {
    expect(dayDef('push').title).toBe('Push');
    setActiveProgram(READY_PROGRAMS.find((p) => p.id === 'home')!.days);
    expect(dayDef('push').title).toBe('Push');
  });

  it('loads saved sessions with new ids and drops malformed ids', () => {
    const raw = {
      sessions: {
        '2026-10-05|upper-a': { date: '2026-10-05', day: 'upper-a', loads: {}, reps: { bench: [5] }, finished: true },
        '2026-10-05|<b>': { date: '2026-10-05', day: '<b>', loads: {}, reps: {}, finished: true },
      },
    };
    const out = sanitize(raw as never);
    expect(Object.keys(out.sessions)).toEqual(['2026-10-05|upper-a']);
  });
});
