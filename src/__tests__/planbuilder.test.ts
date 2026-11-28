import { describe, expect, it } from 'vitest';
import { PlanError, avoidTerms, buildPlanOffline, isAvoided, parseAiPlan } from '../planBuilder';
import type { PlanRequest } from '../planBuilder';
import { programError } from '../program';

const base: PlanRequest = { goal: 'muscle', days: 3, equipment: 'full', experience: 'beginner', avoid: '' };
const names = (p: ReturnType<typeof buildPlanOffline>) => p.flatMap((d) => d.exercises.map((e) => e.name));

describe('built-in rules', () => {
  it('make a valid plan for every combination of days, equipment and goal', () => {
    for (const days of [2, 3, 4, 5, 6])
      for (const equipment of ['full', 'dumbbells', 'none'] as const)
        for (const goal of ['muscle', 'strength', 'fatloss', 'general'] as const)
          for (const experience of ['beginner', 'some', 'experienced'] as const) {
            const plan = buildPlanOffline({ ...base, days, equipment, goal, experience });
            expect(plan).toHaveLength(days);
            expect(programError(plan), `${days} ${equipment} ${goal} ${experience}`).toBeNull();
          }
  });

  it('use only the equipment the person has', () => {
    expect(names(buildPlanOffline({ ...base, equipment: 'none' })).join(' ')).not.toMatch(/Barbell|Dumbbell|Goblet/);
    expect(names(buildPlanOffline({ ...base, equipment: 'dumbbells' })).join(' ')).not.toMatch(/Barbell|Pull-ups/);
  });

  it('leave out movements the person asked to avoid, and never come back empty', () => {
    const plan = buildPlanOffline({ ...base, days: 4, avoid: 'Squats, overhead press, lunges' });
    expect(names(plan).filter((n) => /squat|overhead press|lunge/i.test(n))).toEqual([]);
    for (const d of plan) expect(d.exercises.length).toBeGreaterThan(0);
  });

  it('use wider rep ranges for strength than for fat loss', () => {
    const s = buildPlanOffline({ ...base, goal: 'strength' })[0].exercises[0];
    const f = buildPlanOffline({ ...base, goal: 'fatloss' })[0].exercises[0];
    expect(s.max).toBeLessThan(f.max);
  });
});

describe('avoid words', () => {
  it('read commas and new lines and ignore very short words', () => {
    expect(avoidTerms('Squats, bench\nok')).toEqual(['squat', 'bench']);
    expect(isAvoided('Barbell back squat', ['squat'])).toBe(true);
    expect(isAvoided('Push-ups', ['squat'])).toBe(false);
  });
});

describe('reading a plan from the AI', () => {
  const good = JSON.stringify({ sessions: [
    { title: 'Upper', focus: 'Push and pull', exercises: [{ name: 'Barbell bench press', sets: 4, min: 5, max: 8, unit: 'reps' }, { name: 'Plank', sets: 3, min: 20, max: 45, unit: 'sec' }] },
    { title: 'Lower', focus: 'Legs', exercises: [{ name: 'Goblet squat', sets: 3, min: 8, max: 12, unit: 'reps', perSide: false }] },
  ] });
  const req: PlanRequest = { ...base, days: 2 };

  it('accepts a valid plan, even with text around the JSON', () => {
    const plan = parseAiPlan(`Here you go:\n${good}\nEnjoy!`, req);
    expect(plan).toHaveLength(2);
    expect(programError(plan)).toBeNull();
    expect(plan[0].weekday).not.toBe(plan[1].weekday);
  });

  it('rejects the wrong number of sessions', () => {
    expect(() => parseAiPlan(good, { ...req, days: 3 })).toThrow(PlanError);
  });

  it('rejects invalid sets and ranges', () => {
    const bad = (e: object) => JSON.stringify({ sessions: [{ title: 'A', focus: '', exercises: [e] }, { title: 'B', focus: '', exercises: [{ name: 'Plank', sets: 3, min: 20, max: 40, unit: 'sec' }] }] });
    expect(() => parseAiPlan(bad({ name: 'X', sets: 0, min: 5, max: 8 }), req)).toThrow(/sets/);
    expect(() => parseAiPlan(bad({ name: 'X', sets: 3, min: 9, max: 8 }), req)).toThrow(/range/);
    expect(() => parseAiPlan(bad({ name: 'X', sets: 3.5, min: 5, max: 8 }), req)).toThrow(/sets/);
    expect(() => parseAiPlan(bad({ name: '', sets: 3, min: 5, max: 8 }), req)).toThrow(/name/);
  });

  it('rejects a plan that includes an avoided movement', () => {
    expect(() => parseAiPlan(good, { ...req, avoid: 'bench press' })).toThrow(/avoid/);
  });

  it('rejects text that is not a plan', () => {
    expect(() => parseAiPlan('Sorry, I cannot help with that.', req)).toThrow(PlanError);
  });
});
