import { describe, expect, it } from 'vitest';
import { dailyNudges } from '../coach';
import { dueSoon, monthCells, occursOn, plansBetween, shiftMonth } from '../plan';
import { buildSampleData } from '../sample';
import type { PlanItem } from '../types';

const item = (date: string, repeat: 'none' | 'monthly'): PlanItem => ({ id: 'x', date, title: 't', kind: 'bill', amount: 100, repeat, doneOn: [] });

describe('plans', () => {
  it('one-off items happen once', () => {
    expect(occursOn(item('2026-10-12', 'none'), '2026-10-12')).toBe(true);
    expect(occursOn(item('2026-10-12', 'none'), '2026-11-12')).toBe(false);
  });
  it('monthly items repeat from their start, never before', () => {
    expect(occursOn(item('2026-10-12', 'monthly'), '2026-11-12')).toBe(true);
    expect(occursOn(item('2026-10-12', 'monthly'), '2026-09-12')).toBe(false);
  });
  it('a 31st lands on the last day of a shorter month', () => {
    expect(occursOn(item('2026-01-31', 'monthly'), '2026-02-28')).toBe(true);
    expect(occursOn(item('2026-01-31', 'monthly'), '2026-02-27')).toBe(false);
    expect(occursOn(item('2026-01-31', 'monthly'), '2026-04-30')).toBe(true);
  });
  it('builds whole Monday-first weeks', () => {
    const c = monthCells('2026-10');
    expect(c[0]).toBe('2026-09-28');
    expect(c.length % 7).toBe(0);
    expect(c[c.length - 1]).toBe('2026-11-01');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
  it('flags what is due soon and tracks completion per occurrence', () => {
    const d = buildSampleData();
    d.plans.push({ id: 'tmr', date: '2026-10-10', title: 'Rent', kind: 'bill', amount: 5000, repeat: 'none', doneOn: [] });
    expect(dueSoon(d, '2026-10-09').some((o) => o.item.id === 'tmr')).toBe(true);
    expect(dailyNudges(d, '2026-10-09').some((n) => n.text.includes('Due tomorrow'))).toBe(true);
    d.plans[0].doneOn = ['2026-10-12'];
    expect(plansBetween(d, '2026-10-12', '2026-10-12').find((o) => o.item.id === d.plans[0].id)?.done).toBe(true);
  });
});
