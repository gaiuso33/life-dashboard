import { describe, expect, it } from 'vitest';
import { buildSetup, defaultAnswers, setupErrors } from '../setup';
import { emptyData } from '../types';

describe('first-run setup', () => {
  it('accepts the defaults', () => expect(setupErrors(defaultAnswers())).toEqual({}));
  it('rejects clashing days, silly weights, past deadlines and bad usernames', () => {
    const e = setupErrors({ ...defaultAnswers(), days: [1, 1, 5], weight: 5, deadline: '2020-01-01', githubUser: 'bad name!', goalCount: 0, savePct: 150 });
    expect(Object.keys(e).sort()).toEqual(['days', 'deadline', 'githubUser', 'goalCount', 'savePct', 'weight']);
  });
  it('applies valid answers and leaves invalid ones out', () => {
    const d = buildSetup(emptyData(), { ...defaultAnswers(), days: [2, 3, 5], weight: 68, goalWeight: 400, dailyEstimate: 5000, githubUser: '@octocat', keepRewards: false });
    expect(d.onboarded).toBe(true);
    expect(d.program?.map((p) => p.weekday)).toEqual([2, 3, 5]);
    expect(d.body[0].weight).toBe(68);
    expect(d.goalWeight).toBeNull();
    expect(d.money.dailyEstimate).toBe(5000);
    expect(d.career.githubUser).toBe('octocat');
    expect(d.rewards.items).toEqual([]);
  });
  it('keeps the original programme when the default days are chosen', () => expect(buildSetup(emptyData(), defaultAnswers()).program).toBeUndefined());
});
