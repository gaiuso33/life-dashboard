import { describe, expect, it } from 'vitest';
import { fundForecast, forecasts, portfolioForecast, weightForecast } from '../forecast';
import { backtestWeight, fitLine, percentile, predictAt, savingPaces, shipPaces, tMultiplier, weightFit } from '../projection';
import { buildSampleData } from '../sample';
import { emptyData } from '../types';
import type { BodyEntry } from '../types';
import { addDays } from '../utils';

const TODAY = '2026-10-09';
const body = (n: number, kgPerWeek: number, wobble = 0): BodyEntry[] =>
  Array.from({ length: n }, (_, i) => ({ date: addDays('2026-07-01', i * 7), weight: 70 + kgPerWeek * i + (i % 2 ? wobble : -wobble), m: {} }));

describe('straight-line fit', () => {
  it('recovers a perfect line and needs three points', () => {
    const f = fitLine([0, 1, 2, 3], [1, 3, 5, 7])!;
    expect(f.slope).toBeCloseTo(2);
    expect(f.s).toBeCloseTo(0);
    expect(fitLine([0, 1], [1, 2])).toBeNull();
    expect(fitLine([1, 1, 1], [1, 2, 3])).toBeNull();
  });
  it('gives a wider range further ahead and with noisier data', () => {
    const calm = fitLine([0, 1, 2, 3, 4, 5], [70, 70.3, 70.5, 70.8, 71, 71.3])!;
    const noisy = fitLine([0, 1, 2, 3, 4, 5], [70, 71.2, 70.1, 71.6, 70.4, 72])!;
    const w = (f: typeof calm, x: number) => { const p = predictAt(f, x); return p.high - p.low; };
    expect(w(calm, 17)).toBeGreaterThan(w(calm, 5));
    expect(w(noisy, 5)).toBeGreaterThan(w(calm, 5));
  });
  it('widens small samples with a bigger multiplier', () => {
    expect(tMultiplier(1)).toBeGreaterThan(tMultiplier(4));
    expect(tMultiplier(4)).toBeGreaterThan(tMultiplier(100));
  });
  it('percentiles interpolate', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([5], 0.8)).toBe(5);
  });
});

describe('bodyweight forecast', () => {
  it('has an ordered range and a confidence that grows with history', () => {
    const few = weightForecast({ ...emptyData(), body: body(3, 0.3, 0.2) });
    const many = weightForecast({ ...emptyData(), body: body(10, 0.3, 0.2) });
    expect(few.confidence).toBe('low');
    expect(many.confidence).toBe('high');
    for (const f of [few, many]) {
      const c = f.chart!;
      c.mid.forEach((m, i) => {
        expect(c.low[i].y).toBeLessThanOrEqual(m.y);
        expect(c.high[i].y).toBeGreaterThanOrEqual(m.y);
      });
      expect(c.high[3].y - c.low[3].y).toBeGreaterThan(c.high[0].y - c.low[0].y);
    }
  });
  it('replays history honestly: a steady series was forecast well, a jumpy one badly', () => {
    const steady = backtestWeight(body(12, 0.3, 0.05))!;
    const jumpy = backtestWeight(body(12, 0.3, 1.5))!;
    expect(steady.mae).toBeLessThan(0.3);
    expect(jumpy.mae).toBeGreaterThan(steady.mae);
    expect(steady.n).toBeGreaterThanOrEqual(3);
    expect(backtestWeight(body(4, 0.3))).toBeNull();
  });
  it('shows the track record only when there is something to check', () => {
    expect(weightForecast({ ...emptyData(), body: body(4, 0.3) }).trackRecord).toBeUndefined();
    expect(weightForecast({ ...emptyData(), body: body(12, 0.3, 0.1) }).trackRecord).toMatch(/missed by about/);
  });
  it('gives a spread of weeks to the goal, and says so when the trend is flat', () => {
    const up = weightForecast({ ...emptyData(), body: body(10, 0.3, 0.2), goalWeight: 80 });
    expect(up.detail).toMatch(/anywhere from \d+ to \d+ weeks|much longer/);
    const flat = weightForecast({ ...emptyData(), body: body(8, 0, 0.1), goalWeight: 80 });
    expect(flat.tone).toBe('warn');
  });
  it('fits only the recent weigh-ins', () => {
    const b = [...body(8, 0), ...body(6, 0.5).map((e, i) => ({ ...e, date: addDays('2026-08-30', i * 7), weight: 72 + 0.5 * i }))];
    expect(weightFit(b)!.fit.slope).toBeCloseTo(0.5, 1);
  });
});

const withSavings = (weeklyAmounts: number[]) => {
  const d = emptyData();
  // weekly amounts, oldest first, ending with the last completed week before Mon 5 Oct
  weeklyAmounts.forEach((a, i) => {
    const date = addDays('2026-10-05', -7 * (weeklyAmounts.length - i) + 2);
    d.money.txns.push({ id: `s${i}`, date, kind: 'saving', amount: a, category: 'Savings', note: '' } as never);
    d.money.txns.push({ id: `e${i}`, date, kind: 'expense', amount: 50000, category: 'Food', note: '' } as never);
  });
  d.money.dailyEstimate = 3000;
  return d;
};

describe('savings pace and the survival-fund forecast', () => {
  it('is steady money when every week looks alike, and spread out when it does not', () => {
    const steady = savingPaces(withSavings(Array(12).fill(10000)), TODAY);
    const lumpy = savingPaces(withSavings([10000, 10000, 10000, 10000, 0, 0, 0, 0, 40000, 40000, 40000, 40000]), TODAY);
    expect(steady.fast - steady.slow).toBeLessThan(1);
    expect(lumpy.fast).toBeGreaterThan(lumpy.slow);
    expect(steady.confidence).toBe('high');
  });
  it('does not count weeks before logging began as zero saving', () => {
    const p = savingPaces(withSavings([10000, 10000, 10000, 10000]), TODAY);
    expect(p.typical).toBeGreaterThan(40000 * 0.9);
    expect(p.confidence).toBe('low');
  });
  it('orders slow <= typical <= fast and the fund range follows', () => {
    const f = fundForecast(withSavings([5000, 20000, 0, 15000, 8000, 30000, 0, 12000, 9000, 25000, 4000, 16000]), TODAY);
    expect(f.confidence).toBeDefined();
    const c = f.chart!;
    expect(c.low[3].y).toBeLessThanOrEqual(c.mid[3].y);
    expect(c.high[3].y).toBeGreaterThanOrEqual(c.mid[3].y);
    expect(f.detail).toMatch(/It could take|could be quicker/);
  });
  it('says plainly when nothing was saved', () => {
    expect(fundForecast(withSavings([]), TODAY).headline).toMatch(/No savings|No target/);
  });
});

describe('portfolio pace', () => {
  const proj = (id: string, shippedOn?: string) => ({ id, name: id, repo: '', concept: '', status: shippedOn ? ('shipped' as const) : ('building' as const), milestones: [], shippedOn });
  it('needs ship dates for a range', () => {
    const d = emptyData();
    d.career.startDate = '2026-07-01';
    d.career.deadline = '2027-07-01';
    d.career.goalCount = 5;
    expect(shipPaces(d)).toBeNull();
    d.career.projects = [proj('a', '2026-08-01'), proj('b', '2026-09-20'), proj('c', '2026-10-05'), proj('d'), proj('e')];
    const sp = shipPaces(d)!;
    expect(sp.fast).toBeLessThanOrEqual(sp.typical);
    expect(sp.slow).toBeGreaterThanOrEqual(sp.typical);
    expect(portfolioForecast(d, TODAY).detail).toMatch(/could fall between/);
  });
});

describe('every forecast on realistic and empty data', () => {
  it('has no NaN or Infinity anywhere in its numbers', () => {
    for (const d of [buildSampleData(), emptyData()]) {
      for (const f of forecasts(d, TODAY)) {
        expect(f.headline + f.detail).not.toMatch(/NaN|Infinity|undefined/);
        for (const s of [f.chart?.mid, f.chart?.low, f.chart?.high, f.chart?.history]) for (const p of s ?? []) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
    }
  });
});
