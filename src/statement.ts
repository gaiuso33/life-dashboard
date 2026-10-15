/**
 * Reads a bank or wallet statement saved as CSV and turns it into entries for the Money screen.
 * Everything runs on this device. Nothing here assumes one bank's layout: the person confirms which column is
 * which, and rows that can't be understood are counted and left out rather than guessed at.
 */
import type { FundKey, Txn } from './types';
import { addDays } from './utils';

/* ---------- reading the file ---------- */

export function parseCsv(input: string): { rows: string[][]; delimiter: string } {
  const text = input.replace(/^﻿/, '');
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === delimiter) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row.map((x) => x.trim()));
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row.map((x) => x.trim()));
  return { rows, delimiter };
}

function detectDelimiter(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 12);
  let best = ',';
  let bestScore = -1;
  for (const d of [',', ';', '\t', '|']) {
    const counts = lines.map((l) => {
      let n = 0;
      let q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === d && !q) n++;
      }
      return n;
    });
    const mode = counts.sort((a, b) => a - b)[Math.floor(counts.length / 2)] ?? 0;
    const score = mode * 100 + counts.filter((c) => c === mode).length;
    if (mode > 0 && score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

/* ---------- finding the columns ---------- */

export type AmountMode = 'split' | 'single';
export interface Mapping {
  date: number;
  desc: number;
  debit: number;
  credit: number;
  amount: number;
  mode: AmountMode;
  /** Single amount column: is a negative number money spent? Almost always yes. */
  negativeIsSpent: boolean;
}
export const NONE = -1;

const HEADER_WORDS = /date|time|description|narration|details|remark|particulars|debit|credit|amount|balance|reference|type|withdraw|deposit|money in|money out|channel/i;

/** Statements often start with account details; the header is the row that looks most like column names. */
export function findHeaderRow(rows: string[][]): number {
  let best = 0;
  let bestScore = 0;
  rows.slice(0, 30).forEach((r, i) => {
    const score = r.filter((c) => c !== '' && HEADER_WORDS.test(c) && !/^[\d.,\-\s₦]+$/.test(c)).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return bestScore >= 2 ? best : 0;
}

const pick = (headers: string[], tests: RegExp[], not?: RegExp): number => {
  for (const t of tests) {
    const i = headers.findIndex((h) => t.test(h) && !(not && not.test(h)));
    if (i >= 0) return i;
  }
  return NONE;
};

export function guessMapping(headers: string[]): Mapping {
  const h = headers.map((x) => x.toLowerCase());
  const date = pick(h, [/trans(action)?\.?\s*(date|time)/, /^date$/, /^date\b/, /date|time/], /value|update|balance/);
  const desc = pick(h, [/narration/, /description/, /details/, /remark/, /particulars/, /memo/, /reference|transaction$/]);
  const debit = pick(h, [/debit|money out|withdraw|paid out|outflow|spent/]);
  const credit = pick(h, [/credit|money in|deposit|paid in|inflow|received/]);
  const amount = pick(h, [/^amount|transaction amount|^value$/], /balance/);
  const mode: AmountMode = debit !== NONE && credit !== NONE ? 'split' : amount !== NONE ? 'single' : 'split';
  return { date, desc, debit, credit, amount, mode, negativeIsSpent: true };
}

export const mappingProblem = (m: Mapping): string | null => {
  if (m.date === NONE) return 'Choose the column that holds the date.';
  if (m.mode === 'split' && m.debit === NONE && m.credit === NONE) return 'Choose the money out (debit) column, or the money in (credit) column, or both.';
  if (m.mode === 'single' && m.amount === NONE) return 'Choose the column that holds the amount.';
  return null;
};

/* ---------- dates and amounts ---------- */

export type DateOrder = 'dmy' | 'mdy';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');

function valid(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${y}-${pad2(m)}-${pad2(d)}`;
}
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** Returns a YYYY-MM-DD date, or null if the text isn't a date this can read with confidence. */
export function parseDate(raw: string, order: DateOrder = 'dmy'): string | null {
  const s = raw.trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[T\s,].*)?$/.exec(s);
  if (m) return order === 'dmy' ? valid(fullYear(+m[3]), +m[2], +m[1]) : valid(fullYear(+m[3]), +m[1], +m[2]);
  m = /^(\d{1,2})[\s\-/.,]+([A-Za-z]{3,9})\.?[\s\-/.,]+(\d{2}|\d{4})(?:[T\s,].*)?$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mi < 0 ? null : valid(fullYear(+m[3]), mi + 1, +m[1]);
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:[T\s,].*)?$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return mi < 0 ? null : valid(+m[3], mi + 1, +m[2]);
  }
  // spreadsheet serial number (days since 1899-12-30)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial > 36526 && serial < 73051) return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10);
  }
  return null;
}

/** Day-first or month-first? Decided from the data when a value makes it obvious (a "25" can only be a day). */
export function detectDateOrder(values: string[]): { order: DateOrder; certain: boolean } {
  let dayFirst = false;
  let monthFirst = false;
  for (const v of values) {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/.exec(v.trim());
    if (!m) continue;
    if (+m[1] > 12) dayFirst = true;
    if (+m[2] > 12) monthFirst = true;
  }
  if (dayFirst && !monthFirst) return { order: 'dmy', certain: true };
  if (monthFirst && !dayFirst) return { order: 'mdy', certain: true };
  const numeric = values.some((v) => /^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/.test(v.trim()));
  return { order: 'dmy', certain: !numeric };
}

/** A currency sign or code next to a number: ₦ $ £ €, NGN USD, Rs, or the N / R some banks print. Only removed when touching a digit. */
const CURRENCY_MARK = /\p{Sc}|(?<![A-Za-z])(?:[A-Z]{3}|Rs\.?|[NR])(?=\s*[\d(\-.,])|(?<=[\d)]\s*)(?:[A-Z]{3}|Rs\.?)(?![A-Za-z])/gu;

/** A signed amount, or null. Ignores any currency sign or code (₦ NGN $ £ € USD Rs), and handles 1,234.56, 1.234,56, (500), 500-, "500 DR". */
export function parseMoney(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/\bDR\b/i.test(s)) negative = true;
  s = s.replace(/\b(CR|DR)\b/gi, '').replace(CURRENCY_MARK, '').replace(/\s+/g, '');
  if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let normal: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // the later separator is the decimal point
    normal = lastDot > lastComma ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  } else if (lastComma >= 0) {
    normal = /,\d{1,2}$/.test(s) && s.indexOf(',') === lastComma ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot >= 0 && s.indexOf('.') !== lastDot) {
    normal = s.replace(/\./g, ''); // 1.234.567
  } else normal = s;
  const n = Number(normal);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/* ---------- turning rows into entries ---------- */

export type RowKind = 'expense' | 'income' | 'saving' | 'skip';
export interface ImportRow {
  /** 1-based position in the file, for messages. */
  line: number;
  date: string;
  /** What the bank says happened: money out or money in. Used for the entry's identity, so it never changes. */
  direction: 'out' | 'in';
  kind: RowKind;
  amount: number;
  note: string;
  category: string;
  fund: FundKey;
  /** Identity of this row's content, for spotting the same statement imported twice. */
  sig: string;
}

export interface BuildResult {
  rows: ImportRow[];
  /** Rows that had no usable date or amount (headings, totals, blank lines). */
  unreadable: number;
  /** Rows dated in the future or too long ago to be right. */
  outOfRange: number;
}

const SAVING_WORDS = /owealth|piggy ?vest|cowrywise|safelock|savings|save ?box|target ?savings|fixed deposit|\binvest|risevest|bamboo|trove|stash|flex ?dollar|\bsafe ?lock\b|\bspend and save\b/i;

const RULES: [string, RegExp][] = [
  ['Data and airtime', /airtime|\bdata\b|bundle|\bmtn\b|\bglo\b|airtel|9mobile|etisalat|spectranet|smile|starlink|ntel|subscription data/i],
  ['Entertainment', /netflix|spotify|showmax|dstv|gotv|startimes|youtube|prime video|cinema|movie|betting|bet9ja|sportybet|1xbet|nairabet|game|apple\.com|google play|ticket/i],
  ['Transport', /\buber\b|\bbolt\b|indrive|taxi|fuel|petrol|filling station|total ?energies|oando|conoil|\bbrt\b|keke|toll|lagos ?ride|ride|transport|\bbus\b|flight|air peace|arik/i],
  ['Housing', /\brent\b|landlord|electric|\bnepa\b|ikedc|ekedc|ibedc|aedc|prepaid meter|\bdisco\b|utility|water bill|service charge|estate|\bpower\b/i],
  ['Health and gym', /pharmacy|hospital|clinic|\bgym\b|fitness|medplus|health|drug|dental|lab test|diagnostic/i],
  ['Personal care', /salon|barber|\bspa\b|cosmetic|skincare|laundry|dry ?clean|beauty|hair/i],
  ['Giving', /church|tithe|offering|donation|charity|zakat|sadaqa|\bgift\b|mosque|ministry/i],
  ['Food', /food|restaurant|chicken|shawarma|pizza|bakery|cafe|kfc|domino|mr ?biggs|sweet ?sensation|chicken republic|supermarket|shoprite|market|grocer|bukka|eatery|suya|\bfoodcourt\b|iya |mama |kitchen|bread|snack|drinks?\b|water\b/i],
];

export function guessCategory(note: string, categories: string[]): string {
  for (const [name, re] of RULES) if (re.test(note) && categories.includes(name)) return name;
  return categories.includes('Other') ? 'Other' : categories[categories.length - 1] ?? 'Other';
}

const cleanNote = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 80);
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function buildRows(table: string[][], m: Mapping, order: DateOrder, categories: string[], today: string, columns = Infinity): BuildResult {
  const rows: ImportRow[] = [];
  let unreadable = 0;
  let outOfRange = 0;
  const cell = (r: string[], i: number) => (i >= 0 && i < r.length ? r[i] : '');
  table.forEach((r, idx) => {
    // A row with more cells than the header usually has an unquoted comma inside an amount ("1,500.00"),
    // which would shift every column. Reading it anyway could import ₦1 for ₦1,500, so it is left out.
    if (r.length > columns && r.slice(columns).some((x) => x !== '')) {
      unreadable++;
      return;
    }
    const date = parseDate(cell(r, m.date), order);
    let direction: 'out' | 'in' | null = null;
    let value = 0;
    if (m.mode === 'split') {
      const d = parseMoney(cell(r, m.debit));
      const c = parseMoney(cell(r, m.credit));
      if (d != null && Math.abs(d) > 0) {
        direction = 'out';
        value = Math.abs(d);
      } else if (c != null && Math.abs(c) > 0) {
        direction = 'in';
        value = Math.abs(c);
      }
    } else {
      const a = parseMoney(cell(r, m.amount));
      if (a != null && a !== 0) {
        const spent = m.negativeIsSpent ? a < 0 : a > 0;
        direction = spent ? 'out' : 'in';
        value = Math.abs(a);
      }
    }
    const amount = Math.round(value);
    if (!date || !direction || amount < 1 || amount > 999_999_999) {
      if (r.some((x) => x !== '')) unreadable++;
      return;
    }
    if (date > addDays(today, 1) || date < '2005-01-01') {
      outOfRange++;
      return;
    }
    const note = cleanNote(cell(r, m.desc));
    const saving = SAVING_WORDS.test(note);
    const kind: RowKind = direction === 'out' ? (saving ? 'saving' : 'expense') : saving ? 'skip' : 'income';
    rows.push({ line: idx + 1, date, direction, kind, amount, note, category: direction === 'out' ? guessCategory(note, categories) : 'Other', fund: 'survival', sig: `${date}|${direction}|${amount}|${norm(note)}` });
  });
  return { rows, unreadable, outOfRange };
}

/** A short stable fingerprint (two 32-bit FNV hashes), so the same row always gets the same id. */
function fingerprint(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b + c + i, 0x85ebca6b) >>> 0;
    b ^= b >>> 13;
  }
  return a.toString(36).padStart(7, '0') + b.toString(36).padStart(7, '0');
}

export interface ImportPlan {
  add: Txn[];
  /** Already in the dashboard from an earlier import. */
  duplicates: number;
  /** Deleted earlier; stays deleted. */
  removedEarlier: number;
  skipped: number;
}

/**
 * Entries get an id made from their content, so importing the same statement (or an overlapping one) twice adds
 * nothing new, and an entry deleted on any device doesn't come back. Two identical rows on the same day (two
 * identical purchases) are told apart by their order in the file.
 */
export function planImport(rows: ImportRow[], existingIds: Set<string>, gone: Set<string>): ImportPlan {
  const seen = new Map<string, number>();
  const add: Txn[] = [];
  let duplicates = 0;
  let removedEarlier = 0;
  let skipped = 0;
  for (const r of rows) {
    const n = (seen.get(r.sig) ?? 0) + 1;
    seen.set(r.sig, n);
    if (r.kind === 'skip') {
      skipped++;
      continue;
    }
    const id = `imp-${fingerprint(`${r.sig}#${n}`)}`;
    if (gone.has(id)) {
      removedEarlier++;
      continue;
    }
    if (existingIds.has(id)) {
      duplicates++;
      continue;
    }
    add.push({
      id,
      date: r.date,
      kind: r.kind,
      amount: r.amount,
      note: r.note,
      ...(r.kind === 'expense' && { category: r.category }),
      ...(r.kind === 'saving' && { fund: r.fund }),
    });
  }
  return { add, duplicates, removedEarlier, skipped };
}
