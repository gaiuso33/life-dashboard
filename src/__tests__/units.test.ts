import { afterEach, describe, expect, it } from 'vitest';
import { buildSummary, summaryJson } from '../advisorData';
import { evaluateBadges } from '../badges';
import { weightForecast } from '../forecast';
import { defaultItemsFor, savedSteps } from '../localize';
import { mergeData } from '../merge';
import { sanitize } from '../sanitize';
import { buildSetup, defaultAnswers, setupErrors } from '../setup';
import { emptyData } from '../types';
import type { BodyEntry } from '../types';
import { activePrefs, detectPrefs, fmtMoney, fmtWeight, fromDisplay, LEGACY_PREFS, regionOfLanguage, regionOfZone, resolvePrefs, setActivePrefs, toDisplay } from '../units';
import { addDays } from '../utils';

afterEach(() => setActivePrefs(LEGACY_PREFS));
const env = (timeZone: string, ...languages: string[]) => ({ timeZone, languages });

describe('where the person is', () => {
  it('reads the country from the timezone first', () => {
    expect(detectPrefs(env('Africa/Lagos', 'en-US')).prefs).toEqual({ currency: 'NGN', weightUnit: 'kg' });
    expect(detectPrefs(env('America/Chicago', 'en-GB')).prefs).toEqual({ currency: 'USD', weightUnit: 'lb' });
    expect(detectPrefs(env('Europe/London')).prefs).toEqual({ currency: 'GBP', weightUnit: 'kg' });
    expect(detectPrefs(env('Europe/Berlin')).prefs.currency).toBe('EUR');
    expect(detectPrefs(env('Asia/Kolkata')).prefs.currency).toBe('INR');
    expect(detectPrefs(env('Australia/Sydney')).prefs.currency).toBe('AUD');
    expect(detectPrefs(env('America/Toronto')).prefs.currency).toBe('CAD');
  });
  it('falls back to a language that names a country, then to dollars and kilograms', () => {
    expect(detectPrefs(env('Etc/UTC', 'en-GB')).prefs.currency).toBe('GBP');
    expect(detectPrefs(env('', 'fr', 'en-CA')).prefs.currency).toBe('CAD');
    const none = detectPrefs(env('Etc/UTC', 'en'));
    expect(none.prefs).toEqual({ currency: 'USD', weightUnit: 'kg' });
    expect(none.basis).toBe('default');
  });
  it('does not guess a country from a bare language', () => {
    expect(regionOfLanguage('en')).toBeNull();
    expect(regionOfLanguage('pt-BR')).toBe('BR');
    expect(regionOfLanguage('zh-Hans-CN')).toBe('CN');
    expect(regionOfZone('Nowhere/Land')).toBeNull();
  });
});

describe('which units a person ends up with', () => {
  it('keeps people who already have data on naira and kilograms until they choose', () => {
    expect(resolvePrefs({ onboarded: true }, env('America/Chicago'))).toEqual(LEGACY_PREFS);
  });
  it('uses their location for someone brand new, and their own choice over everything', () => {
    expect(resolvePrefs({ onboarded: false }, env('America/Chicago')).currency).toBe('USD');
    expect(resolvePrefs({ onboarded: true, prefs: { currency: 'GBP', weightUnit: 'kg' } }, env('America/Chicago'))).toEqual({ currency: 'GBP', weightUnit: 'kg' });
  });
  it('shows sample data in naira but weighs in the local unit', () => {
    expect(resolvePrefs({ onboarded: true, sample: true }, env('America/Chicago'))).toEqual({ currency: 'NGN', weightUnit: 'lb' });
  });
  it('finishing setup keeps what the person was shown and prices the starting rewards locally', () => {
    const d = buildSetup(emptyData(), { ...defaultAnswers(), keepRewards: true });
    expect(d.prefs).toBeDefined();
    const us = buildSetup({ ...emptyData(), prefs: { currency: 'USD', weightUnit: 'lb' } }, defaultAnswers());
    expect(us.prefs).toEqual({ currency: 'USD', weightUnit: 'lb' });
    expect(us.rewards.items.length).toBeGreaterThan(0);
    expect(us.rewards.items.some((i) => /₦/.test(i.name))).toBe(false);
    expect(Math.max(...us.rewards.items.map((i) => i.cost))).toBeLessThan(200);
    const ng = buildSetup({ ...emptyData(), prefs: { currency: 'NGN', weightUnit: 'kg' } }, defaultAnswers());
    expect(ng.rewards.items).toEqual(defaultItemsFor('NGN'));
  });
  it('does not overwrite rewards the person already edited', () => {
    const base = emptyData();
    const edited = { ...base, prefs: { currency: 'USD', weightUnit: 'lb' as const }, rewards: { ...base.rewards, items: [{ id: 'mine', name: 'My treat', cost: 5, tier: 'week' as const }] } };
    expect(buildSetup(edited, defaultAnswers()).rewards.items.map((i) => i.id)).toEqual(['mine']);
  });
});

describe('money and weight in the active units', () => {
  it('formats the currency chosen, never converting', () => {
    setActivePrefs({ currency: 'NGN', weightUnit: 'kg' });
    expect(fmtMoney(12500)).toBe('₦12,500');
    setActivePrefs({ currency: 'USD', weightUnit: 'kg' });
    expect(fmtMoney(12500)).toMatch(/^\$12,500$/);
    setActivePrefs({ currency: 'GBP', weightUnit: 'kg' });
    expect(fmtMoney(1250)).toMatch(/^£1,250$/);
  });
  it('converts weight exactly and round-trips what is typed', () => {
    setActivePrefs({ currency: 'USD', weightUnit: 'lb' });
    expect(toDisplay(68)).toBe(149.9);
    expect(fmtWeight(100)).toBe('220.5 lb');
    for (const lb of [110, 150.5, 187.2, 220]) expect(toDisplay(fromDisplay(lb))).toBe(lb);
    setActivePrefs({ currency: 'USD', weightUnit: 'kg' });
    expect(toDisplay(68.25)).toBe(68.3);
    expect(fromDisplay(68.3)).toBe(68.3);
  });
  it('limits for setup are shown in the person’s unit', () => {
    setActivePrefs({ currency: 'USD', weightUnit: 'lb' });
    const e = setupErrors({ ...defaultAnswers(), weight: 5 });
    expect(e.weight).toMatch(/lb/);
    expect(e.weight).toMatch(/66/);
    expect(setupErrors({ ...defaultAnswers(), weight: 150 }).weight).toBeUndefined();
  });
});

const body = (kg: number[]): BodyEntry[] => kg.map((w, i) => ({ date: addDays('2026-08-01', i * 7), weight: w, m: {} }));

describe('everything the app says follows the units', () => {
  it('the weight forecast speaks pounds when asked, and the same numbers in kilograms', () => {
    const d = { ...emptyData(), body: body([68, 68.3, 68.7, 69, 69.4, 69.7]), goalWeight: 75 };
    setActivePrefs({ currency: 'USD', weightUnit: 'lb' });
    const lb = weightForecast(d);
    expect(lb.headline).toMatch(/lb in 12 weeks/);
    expect(lb.detail).toMatch(/lb a week/);
    expect(lb.detail).toMatch(/165\.3 lb/);
    expect(lb.detail).not.toMatch(/\bkg\b/);
    expect(lb.chart!.unit).toBe('lb');
    expect(lb.chart!.goal).toBeCloseTo(75 * 2.20462, 1);
    setActivePrefs({ currency: 'NGN', weightUnit: 'kg' });
    const kg = weightForecast(d);
    expect(kg.headline).toMatch(/kg in 12 weeks/);
    expect(kg.detail).not.toMatch(/\blb\b/);
    // the same forecast, only relabelled
    expect(lb.chart!.mid[3].y / 2.20462).toBeCloseTo(kg.chart!.mid[3].y, 1);
  });
  it('savings milestones use round numbers in the local currency and keep their ids', () => {
    expect(savedSteps('NGN')).toEqual([10000, 50000, 100000]);
    const usd = savedSteps('USD');
    expect(usd).toEqual([10, 50, 100]);
    setActivePrefs({ currency: 'USD', weightUnit: 'lb' });
    const states = evaluateBadges(emptyData(), '2026-10-09');
    const s = states.find((b) => b.id === 'saved-10k')!;
    expect(s.name).toBe('$10 saved');
    expect(states.find((b) => b.id === 'weigh-first')!.glyph).toBe('lb');
  });
  it('the AI summary names the currency and unit, converts weights, and carries no free text', () => {
    const d = { ...emptyData(), onboarded: true, body: body([68, 68.4, 68.9]), prefs: { currency: 'GBP', weightUnit: 'lb' as const } };
    setActivePrefs(d.prefs);
    const j = summaryJson(buildSummary(d, '2026-10-09', { training: true, body: true, money: true, career: true, rewards: true }));
    const out = JSON.parse(j);
    expect(out.currency).toBe('GBP (British Pound)');
    expect(out.weightUnit).toBe('lb');
    expect(out.body.latestWeight).toBe(151.9); // 68.9 kg
    expect(out.body.weighInsLast8.map((w: { weight: number }) => w.weight)).toEqual([149.9, 150.8, 151.9]);
    expect(j).not.toMatch(/Naira|naira|Kg"/);
  });
});

describe('the choice is saved, merged and cleaned like any other setting', () => {
  it('sanitize keeps a valid choice and drops a bad one', () => {
    const ok = sanitize({ ...emptyData(), prefs: { currency: 'EUR', weightUnit: 'lb' } });
    expect(ok.prefs).toEqual({ currency: 'EUR', weightUnit: 'lb' });
    for (const bad of [{ currency: 'euro', weightUnit: 'kg' }, { currency: 'EUR', weightUnit: 'stone' }, { currency: 'ZZZ1', weightUnit: 'kg' }, 'x', 5]) {
      expect(sanitize({ ...emptyData(), prefs: bad as never }).prefs).toBeUndefined();
    }
  });
  it('the most recent choice wins when two devices disagree', () => {
    const a = { ...emptyData(), prefs: { currency: 'USD', weightUnit: 'lb' as const }, stamps: { prefs: '2026-10-10T10:00:00.000Z' } };
    const b = { ...emptyData(), prefs: { currency: 'GBP', weightUnit: 'kg' as const }, stamps: { prefs: '2026-10-11T10:00:00.000Z' } };
    expect(mergeData(a, b).prefs).toEqual({ currency: 'GBP', weightUnit: 'kg' });
    expect(mergeData(b, a).prefs).toEqual({ currency: 'GBP', weightUnit: 'kg' });
  });
  it('the active units are the ones set from the data', () => {
    setActivePrefs({ currency: 'JPY', weightUnit: 'kg' });
    expect(activePrefs().currency).toBe('JPY');
    expect(fmtMoney(1500)).toMatch(/1,500/);
  });
});
