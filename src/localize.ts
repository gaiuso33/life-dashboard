import { DEFAULT_ITEMS } from './types';
import type { RewardItem } from './types';

// Starting amounts that make sense in the person's currency. These are only rough order-of-magnitude guides (units of each currency per
// US dollar), used to pick sensible default prices and savings milestones. They are not exchange rates and never convert anything.
const PER_USD: Record<string, number> = {
  USD: 1, NGN: 1500, GHS: 12, KES: 130, ZAR: 18, EGP: 48, ETB: 120, TZS: 2600, UGX: 3700, RWF: 1400, XOF: 600, XAF: 600, MAD: 10, DZD: 135, TND: 3, ZMW: 25, BWP: 13, NAD: 18, MUR: 46,
  GBP: 0.8, EUR: 0.9, CHF: 0.9, SEK: 10, NOK: 10, DKK: 7, PLN: 4, CZK: 23, HUF: 360, RON: 4.6, TRY: 40, UAH: 41, RUB: 90,
  CAD: 1.35, MXN: 18, BRL: 5.5, ARS: 1000, CLP: 950, COP: 4000, PEN: 3.75,
  INR: 84, PKR: 280, BDT: 120, LKR: 300, NPR: 135, CNY: 7.2, JPY: 150, KRW: 1350, SGD: 1.35, MYR: 4.5, THB: 35, VND: 25000, IDR: 15800, PHP: 57, HKD: 7.8, TWD: 32, MMK: 2100,
  AUD: 1.5, NZD: 1.65, AED: 3.7, SAR: 3.75, ILS: 3.7, QAR: 3.64, KWD: 0.3,
};

/** Rounds to a number people actually use: 1, 2 or 5 times a power of ten. */
export function niceRound(n: number): number {
  if (!(n > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(n));
  const m = n / p;
  return Math.max(1, Math.round((m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p));
}

export const knowsCurrency = (c: string) => c in PER_USD;
const scaled = (usd: number, c: string) => niceRound(usd * PER_USD[c]);

/** Reward ideas priced for the currency. Naira keeps the original list; a currency we have no sense of gets none, so nothing is mispriced. */
export function defaultItemsFor(currency: string): RewardItem[] {
  if (currency === 'NGN') return DEFAULT_ITEMS.map((i) => ({ ...i }));
  if (!knowsCurrency(currency)) return [];
  const mk = (id: string, name: string, usd: number, tier: RewardItem['tier']): RewardItem => ({ id, name, cost: usd === 0 ? 0 : scaled(usd, currency), tier });
  return [
    mk('i-snack', 'A favourite snack', 3, 'week'),
    mk('i-rest', 'Rest or gaming hour', 0, 'week'),
    mk('i-dessert', 'Dessert out', 6, 'biweek'),
    mk('i-takeaway', 'Favourite takeaway', 8, 'biweek'),
    mk('i-special', 'A special meal', 12, 'month'),
    mk('i-healthy', 'Healthy meal of your choice', 12, 'month'),
    mk('i-pizza', 'Pizza', 14, 'landmark'),
    mk('i-clothes', 'A new outfit', 30, 'landmark'),
  ];
}

/** Whether a reward list is still exactly the original naira defaults, so it is safe to swap for ones priced locally. */
export const isOriginalItems = (items: RewardItem[]) => JSON.stringify(items) === JSON.stringify(DEFAULT_ITEMS);

/** The three "money saved" milestones, in the person's currency. Naira keeps ₦10,000, ₦50,000 and ₦100,000. */
export function savedSteps(currency: string): [number, number, number] {
  if (currency === 'NGN') return [10000, 50000, 100000];
  if (!knowsCurrency(currency)) return [100, 500, 1000];
  return [scaled(10, currency), scaled(50, currency), scaled(100, currency)];
}
