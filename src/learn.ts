import { categoriesOf } from './money';
import type { AppData } from './types';

/** What the app has learned: a merchant or description (as `merchantKey` writes it) and the category the person chose for it. */
export type Learned = Record<string, string>;

/** The most it keeps. When full, the entry not used for the longest time goes first. */
export const LEARN_MAX = 300;

// Words banks put in front of the real name. They say how the money moved, not who it went to.
const FILLER = new Set([
  'pos', 'web', 'nip', 'trf', 'transfer', 'to', 'from', 'purchase', 'payment', 'pymt', 'pay', 'ref', 'debit', 'credit', 'ussd', 'mobile', 'via', 'the', 'and', 'for', 'of', 'at', 'on', 'in', 'by',
  'nibss', 'instant', 'inward', 'outward', 'charge', 'charges', 'fee', 'fees', 'vat', 'txn', 'transaction', 'card', 'atm', 'wdl', 'withdrawal', 'dep', 'deposit',
]);

/**
 * Who a description is about, written so the same place gets the same key every time: lower case, without the bank's filler words
 * and without reference numbers. "POS PURCHASE SHOPRITE LEKKI 0048213" and "Shoprite Lekki" both become "shoprite lekki".
 * Null when nothing is left (a description that is only numbers, or empty), because there is nothing to learn from.
 */
export function merchantKey(note: string): string | null {
  const words = note
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    // A run of three or more digits is a reference number. Short ones stay, so "9mobile" and "bet9ja" survive.
    .filter((w) => w.length > 1 && !/^\d+$/.test(w) && !/\d{3,}/.test(w) && !FILLER.has(w));
  if (!words.length) return null;
  return words.slice(0, 4).join(' ').slice(0, 60);
}

/**
 * Until the person has taught the app anything on purpose, what it knows is read from the categories already on their spending
 * (the latest one used for each description). From the first lesson or deletion on, the saved list is the only source, so
 * forgetting something stays forgotten.
 */
export function learnedFromHistory(data: AppData): Learned {
  const out: Learned = {};
  for (const t of data.money.txns) {
    if (t.kind !== 'expense' || !t.category || t.category === 'Rewards' || t.id.startsWith('rw-')) continue;
    const key = merchantKey(t.note);
    if (!key) continue;
    delete out[key];
    out[key] = t.category;
  }
  return trim(out);
}

export const learnedOf = (data: AppData): Learned => data.money.learned ?? learnedFromHistory(data);

/** The category the person chose before for this description, if it still exists. */
export function learnedCategory(data: AppData, note: string): string | null {
  const key = merchantKey(note);
  if (!key) return null;
  const c = learnedOf(data)[key];
  return c && categoriesOf(data).includes(c) ? c : null;
}

function trim(l: Learned): Learned {
  const keys = Object.keys(l);
  if (keys.length <= LEARN_MAX) return l;
  const out: Learned = {};
  for (const k of keys.slice(keys.length - LEARN_MAX)) out[k] = l[k];
  return out;
}

/** The list after the person chose `category` for `note`. Rewards are never learned: they are entered by the app, not chosen. */
export function teach(current: Learned, note: string, category: string): Learned {
  const key = merchantKey(note);
  if (!key || !category || category === 'Rewards') return current;
  if (current[key] === category && Object.keys(current).pop() === key) return current;
  const next = { ...current };
  delete next[key]; // so the newest lesson sits last and the oldest is the one dropped when the list is full
  next[key] = category;
  return trim(next);
}

/** The list with every entry for a category removed (the category was deleted). */
export const forgetCategory = (l: Learned, category: string): Learned => Object.fromEntries(Object.entries(l).filter(([, c]) => c !== category));

/** The list with a category renamed. */
export const renameCategory = (l: Learned, from: string, to: string): Learned => Object.fromEntries(Object.entries(l).map(([k, c]) => [k, c === from ? to : c]));
