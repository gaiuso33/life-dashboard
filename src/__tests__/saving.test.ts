import { describe, expect, it } from 'vitest';
import { fundForecast } from '../forecast';
import { backtestSaving, completeMonths, monthFigures, savingEstimate } from '../saving';
import { emptyData } from '../types';
import type { AppData, Txn, TxnKind } from '../types';

const TODAY = '2026-10-20';
const MONTHS = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
let n = 0;
const tx = (kind: TxnKind, ym: string, amount: number, day = 10, extra: Partial<Txn> = {}): Txn => ({ id: `t${n++}`, date: `${ym}-${String(day).padStart(2, '0')}`, kind, amount, note: '', ...extra });
const build = (txns: Txn[]): AppData => {
  const d = emptyData();
  return { ...d, money: { ...d.money, txns, dailyEstimate: 3000 } };
};
/** Every month: the same income, spending and saving. */
const steady = (months = MONTHS, income = 100_000, spent = 60_000, saved = 20_000) =>
  months.flatMap((m, i) => [tx('income', m, income, i === 0 ? 2 : 3), tx('expense', m, spent / 2, 8), tx('expense', m, spent / 2, 12), tx('saving', m, saved, 15)]);

describe('which months count', () => {
  it('leaves out the month in progress, and the first month unless logging began in its first five days', () => {
    expect(completeMonths(build([tx('expense', '2026-03', 5, 2)]), TODAY)).toEqual(MONTHS);
    expect(completeMonths(build([tx('expense', '2026-03', 5, 5)]), TODAY)).toEqual(MONTHS);
    expect(completeMonths(build([tx('expense', '2026-03', 5, 6)]), TODAY)).toEqual(MONTHS.slice(1));
  });
  it('is empty with no entries, and crosses a year end', () => {
    expect(completeMonths(build([]), TODAY)).toEqual([]);
    expect(completeMonths(build([tx('expense', '2025-11', 5, 2)]), '2026-02-10')).toEqual(['2025-11', '2025-12', '2026-01']);
  });
});

describe('the monthly saving estimate', () => {
  it('has nothing to say with fewer than three whole months', () => {
    expect(savingEstimate(build(steady(MONTHS.slice(0, 2))), '2026-05-20')).toBeNull();
    expect(savingEstimate(build(steady(MONTHS.slice(0, 3))), '2026-06-20')?.months).toBe(3);
  });
  it('is the saving per month, with a narrow range and high confidence, when every month looks alike', () => {
    const e = savingEstimate(build(steady()), TODAY)!;
    expect(e.months).toBe(6);
    expect(e.typical).toBe(20_000);
    expect(e.slow).toBe(20_000);
    expect(e.fast).toBe(20_000);
    expect(e.lumpy).toBe(0);
    expect(e.confidence).toBe('high');
    expect(e.oneOffs).toEqual([]);
  });
  it('works out what is left after spending, from income as well as spending', () => {
    expect(savingEstimate(build(steady(MONTHS, 100_000, 60_000, 20_000)), TODAY)!.leftOver).toBe(40_000);
  });
  it('says nothing about what is left over when income is hardly ever logged', () => {
    const only = steady().filter((t) => t.kind !== 'income');
    const one = [...only, tx('income', '2026-06', 90_000)];
    for (const d of [build(only), build(one)]) {
      const e = savingEstimate(d, TODAY)!;
      expect(e.leftOver).toBeNull();
      expect(e.lumpy).toBe(0);
    }
  });
  it('counts only savings that went to the survival fund', () => {
    const d = build([...steady(), ...MONTHS.map((m) => tx('saving', m, 50_000, 20, { fund: 'investment' }))]);
    expect(savingEstimate(d, TODAY)!.typical).toBe(20_000);
  });
  it('is based on the last six whole months only', () => {
    const early = [tx('saving', '2026-03', 900_000, 4)];
    const d = build([...steady(), ...early]);
    // Mar is outside the window of Apr..Sep, so that huge month is not in it at all.
    expect(savingEstimate(d, TODAY)!.typical).toBe(20_000);
  });
});

describe('one-offs do not become the new normal', () => {
  const base = steady().concat(MONTHS.map((m) => tx('income', m, 20_000, 20)));
  it('leaves out one huge income, and the big saving made from it', () => {
    const d = build([...base, tx('income', '2026-06', 2_000_000, 21), tx('saving', '2026-06', 400_000, 22)]);
    const e = savingEstimate(d, TODAY)!;
    expect(e.oneOffs.map((o) => [o.kind, o.amount])).toEqual([
      ['income', 2_000_000],
      ['saving', 400_000],
    ]);
    expect(e.typical).toBe(20_000);
    expect(e.leftOver).toBe(60_000);
  });
  it('without leaving them out the same month would have looked like a different person', () => {
    const d = build([...base, tx('income', '2026-06', 2_000_000, 21), tx('saving', '2026-06', 400_000, 22)]);
    const raw = monthFigures(d, ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']);
    expect(raw.reduce((s, f) => s + f.saved, 0) / 6).toBeGreaterThan(80_000);
  });
  it('leaves out one big purchase', () => {
    const d = build([...steady(), tx('expense', '2026-07', 450_000, 18)]);
    const e = savingEstimate(d, TODAY)!;
    expect(e.oneOffs.map((o) => [o.kind, o.amount])).toEqual([['expense', 450_000]]);
    expect(e.leftOver).toBe(40_000);
  });
  it('does not call rent a one-off just because it is bigger than daily spending', () => {
    const d = build([...steady(), ...MONTHS.map((m) => tx('expense', m, 150_000, 1))]);
    expect(savingEstimate(d, TODAY)!.oneOffs).toEqual([]);
    expect(savingEstimate(d, TODAY)!.leftOver).toBe(-110_000);
  });
  it('does not call anything unusual when there are too few entries to judge', () => {
    const d = build([tx('income', '2026-06', 5_000_000, 2), tx('income', '2026-07', 50_000), tx('income', '2026-08', 50_000), tx('saving', '2026-06', 10_000), tx('saving', '2026-07', 10_000), tx('saving', '2026-08', 10_000)]);
    expect(savingEstimate(d, '2026-09-20')!.oneOffs).toEqual([]);
  });
  it('does not call a modest bump a one-off', () => {
    const d = build([...steady(), tx('expense', '2026-07', 45_000, 18)]); // 1.5x the usual month's entries, under 3x
    expect(savingEstimate(d, TODAY)!.oneOffs).toEqual([]);
  });
});

describe('uneven income widens the range', () => {
  // The same savings every month, with income either steady or arriving in two big lumps.
  const withIncome = (incomes: number[]) =>
    build(
      MONTHS.slice(0, 6).flatMap((m, i) => [tx('income', m, incomes[i], 3), tx('expense', m, 30_000, 8), tx('saving', m, i % 2 ? 30_000 : 10_000, 15)]).concat([tx('expense', '2026-03', 1, 9)]),
    );
  it('is wider and less sure when income comes in lumps', () => {
    const calm = savingEstimate(withIncome([100_000, 100_000, 100_000, 100_000, 100_000, 100_000]), '2026-09-20')!;
    const lumps = savingEstimate(withIncome([0, 0, 300_000, 0, 0, 300_000]), '2026-09-20')!;
    expect(calm.lumpy).toBeLessThan(0.05);
    expect(lumps.lumpy).toBeGreaterThan(0.9);
    expect(lumps.typical).toBe(calm.typical);
    expect(lumps.fast - lumps.slow).toBeGreaterThan((calm.fast - calm.slow) * 1.5);
    expect(lumps.slow).toBeLessThan(calm.slow);
    expect(lumps.fast).toBeGreaterThan(calm.fast);
  });
  it('lowers the confidence label when income is very uneven, but never raises it', () => {
    const d = build(MONTHS.flatMap((m, i) => [tx('income', m, i % 3 === 0 ? 300_000 : 0, 3), tx('expense', m, 30_000, 8), tx('saving', m, 20_000, 15)]));
    expect(savingEstimate(d, TODAY)!.confidence).toBe('medium'); // six months would be high
    expect(savingEstimate(build(steady()), TODAY)!.confidence).toBe('high');
  });
});

describe('replaying history', () => {
  it('shows nothing until there are enough months to check', () => {
    expect(backtestSaving(build(steady(MONTHS.slice(0, 6))), '2026-09-20')).toBeNull();
  });
  it('is spot on, and always inside the range, when every month looks alike', () => {
    const bt = backtestSaving(build(steady()), TODAY)!;
    expect(bt.n).toBe(3);
    expect(bt.mae).toBe(0);
    expect(bt.inside).toBe(1);
  });
  it('reports a miss when saving changed after the forecast', () => {
    const d = build([...steady(MONTHS.slice(0, 5)), ...steady(MONTHS.slice(5), 100_000, 60_000, 0)]);
    const bt = backtestSaving(d, TODAY)!;
    expect(bt.mae).toBeGreaterThan(0);
    expect(bt.inside).toBeLessThan(1);
  });
  it('never looks ahead: later entries cannot change what an earlier forecast said', () => {
    const early = steady(MONTHS.slice(0, 5));
    const plain = savingEstimate(build(early), '2026-08-20')!;
    const withFuture = savingEstimate(build([...early, tx('saving', '2026-08', 999_999, 25), tx('income', '2026-09', 9_999_999, 5), tx('expense', '2026-09', 8_888_888, 5)]), '2026-08-01')!;
    // today is 2026-08-01, so only March to July count and anything dated later must be ignored
    const sameWindow = savingEstimate(build(early), '2026-08-01')!;
    expect(withFuture).toEqual(sameWindow);
    expect(plain.months).toBeGreaterThanOrEqual(sameWindow.months);
  });
});

describe('the survival fund forecast', () => {
  it('uses whole months once there are three, names what it left out and shows how past forecasts held up', () => {
    const d = build([...steady(), tx('income', '2026-06', 2_000_000, 21), ...MONTHS.map((m) => tx('income', m, 20_000, 20))]);
    const f = fundForecast(d, TODAY);
    expect(f.detail).toMatch(/last 6 full months/);
    expect(f.detail).toMatch(/Left out a one-off income of .*2,000,000/);
    expect(f.trackRecord).toMatch(/next two months/);
    expect(f.confidence).toBeDefined();
    expect(f.chart).toBeDefined();
  });
  it('says the range is wider when income is lumpy', () => {
    const d = build(MONTHS.flatMap((m, i) => [tx('income', m, i % 3 === 0 ? 300_000 : 0, 3), tx('expense', m, 150_000, 8), tx('saving', m, 20_000, 15)]));
    expect(fundForecast(d, TODAY).detail).toMatch(/uneven lumps/);
  });
  it('points out room to save when what is left after spending is well above what is saved', () => {
    expect(fundForecast(build(steady(MONTHS, 200_000, 60_000, 20_000)), TODAY).detail).toMatch(/keep about .*140,000 a month, more than/);
  });
  it('falls back to the recent-weeks estimate with less than three whole months', () => {
    const f = fundForecast(build(steady(MONTHS.slice(5))), '2026-09-25');
    expect(f.detail).toMatch(/last 8 weeks/);
    expect(f.trackRecord).toBeUndefined();
  });
  it('offers a clearly labelled what-if when nothing has been saved but money is left over', () => {
    const d = build(steady(MONTHS, 100_000, 60_000, 0).filter((t) => t.kind !== 'saving'));
    const f = fundForecast(d, TODAY);
    expect(f.headline).toMatch(/Nothing set aside yet.*if you saved what is left over/);
    expect(f.detail).toMatch(/only a what-if/);
    expect(f.chart).toBeUndefined();
    expect(f.confidence).toBe('low');
  });
  it('says so when nothing was saved and nothing is left over', () => {
    const d = build(steady(MONTHS, 50_000, 60_000, 0).filter((t) => t.kind !== 'saving'));
    expect(fundForecast(d, TODAY).headline).toMatch(/No savings in the last 6 full months/);
  });
});
