import { describe, expect, it } from 'vitest';
import { buildRows, detectDateOrder, findHeaderRow, guessCategory, guessMapping, mappingProblem, parseCsv, parseDate, parseMoney, planImport } from '../statement';
import type { Mapping } from '../statement';
import { CATEGORIES } from '../money';

const CATS = [...CATEGORIES] as string[];
const TODAY = '2026-10-09';

// Layouts are typical of Nigerian bank and wallet exports, written for these tests; they are not real statements.
const BANK_A = `Account Name:,JANE DOE
Account Number:,0123456789
Period:,01/09/2026 - 30/09/2026

Trans. Date,Value Date,Description,Debit,Credit,Balance
01/09/2026,01/09/2026,"POS PURCHASE SHOPRITE, IKEJA",12500.00,,187500.00
02/09/2026,02/09/2026,TRANSFER FROM JOHN,,50000.00,237500.00
03/09/2026,03/09/2026,UBER TRIP,"3,200.50",,234299.50
25/09/2026,25/09/2026,MTN AIRTIME 0803xxxxxxx,1000,,233299.50
Total,,,"16,700.50","50,000.00",
`;
const BANK_B = `Date,Narration,Amount,Balance
2026-09-01,Chicken Republic,₦-4,500.00,100000
2026-09-02,Salary,"₦250,000.00",350000
2026-09-03,Rent,"-120000",230000
`;
const WALLET_C = `Trans. Time,Value Date,Description,Debit(₦),Credit(₦),Balance After(₦),Channel,Transaction Reference
2026-09-01 10:22:33,2026-09-01,Transfer to AMAKA,"2,000.00",--,"48,000.00",Mobile,ref1
2026-09-01 11:00:00,2026-09-01,OWealth Deposit,"10,000.00",--,"38,000.00",Mobile,ref2
2026-09-02 09:00:00,2026-09-02,Transfer from TUNDE,--,"5,000.00","43,000.00",Mobile,ref3
`;
const EURO_D = `Datum;Beschreibung;Betrag
03 Sep 2026;Bolt ride;-1.250,75
04 Sep 2026;Gift received;5.000,00
`;

describe('parseCsv', () => {
  it('handles quotes, commas inside quotes, doubled quotes, BOM and mixed line endings', () => {
    const { rows } = parseCsv('﻿a,b,c\r\n"x, y","say ""hi""",z\n\n1,2,3');
    expect(rows).toEqual([['a', 'b', 'c'], ['x, y', 'say "hi"', 'z'], ['1', '2', '3']]);
  });
  it('detects semicolons and tabs', () => {
    expect(parseCsv(EURO_D).delimiter).toBe(';');
    expect(parseCsv('a\tb\tc\n1\t2\t3').delimiter).toBe('\t');
  });
});

describe('parseDate', () => {
  it('reads the common layouts', () => {
    expect(parseDate('2026-09-01')).toBe('2026-09-01');
    expect(parseDate('2026-09-01 10:22:33')).toBe('2026-09-01');
    expect(parseDate('01/09/2026')).toBe('2026-09-01');
    expect(parseDate('01/09/2026', 'mdy')).toBe('2026-01-09');
    expect(parseDate('1-9-26')).toBe('2026-09-01');
    expect(parseDate('03 Sep 2026')).toBe('2026-09-03');
    expect(parseDate('3-September-2026')).toBe('2026-09-03');
    expect(parseDate('Sep 3, 2026')).toBe('2026-09-03');
    expect(parseDate('46269')).toBe('2026-09-03'.replace('2026-09-03', new Date(Date.UTC(1899, 11, 30) + 46269 * 86400000).toISOString().slice(0, 10)));
  });
  it('refuses impossible or unreadable dates', () => {
    for (const bad of ['', 'Total', '31/02/2026', '2026-13-01', '99/99/9999', 'yesterday', '1/1']) expect(parseDate(bad), bad).toBeNull();
  });
  it('works out day-first or month-first from the data', () => {
    expect(detectDateOrder(['01/09/2026', '25/09/2026'])).toEqual({ order: 'dmy', certain: true });
    expect(detectDateOrder(['09/25/2026', '09/01/2026'])).toEqual({ order: 'mdy', certain: true });
    expect(detectDateOrder(['01/09/2026', '02/09/2026'])).toEqual({ order: 'dmy', certain: false });
    expect(detectDateOrder(['2026-09-01'])).toEqual({ order: 'dmy', certain: true });
  });
});

describe('parseMoney', () => {
  const cases: [string, number | null][] = [
    ['1,234.56', 1234.56], ['₦-4,500.00', -4500], ['(500)', -500], ['500-', -500], ['500 DR', -500], ['500 CR', 500], ['NGN 2,000', 2000],
    ['1.234,56', 1234.56], ['1,5', 1.5], ['1,500', 1500], ['1.234.567', 1234567], ['+75', 75], ['--', null], ['', null], ['abc', null], ['12abc', null],
  ];
  for (const [input, want] of cases) it(`${JSON.stringify(input)} → ${want}`, () => expect(parseMoney(input)).toBe(want));
});

describe('finding the columns', () => {
  it('skips account details above the header', () => {
    const { rows } = parseCsv(BANK_A);
    expect(rows[findHeaderRow(rows)][0]).toBe('Trans. Date');
  });
  it('guesses split debit/credit and single amount layouts', () => {
    const a = guessMapping(['Trans. Date', 'Value Date', 'Description', 'Debit', 'Credit', 'Balance']);
    expect(a).toMatchObject({ date: 0, desc: 2, debit: 3, credit: 4, mode: 'split' });
    const b = guessMapping(['Date', 'Narration', 'Amount', 'Balance']);
    expect(b).toMatchObject({ date: 0, desc: 1, amount: 2, mode: 'single' });
    const c = guessMapping(['Trans. Time', 'Value Date', 'Description', 'Debit(₦)', 'Credit(₦)', 'Balance After(₦)', 'Channel', 'Transaction Reference']);
    expect(c).toMatchObject({ date: 0, desc: 2, debit: 3, credit: 4, mode: 'split' });
  });
  it('says what is missing', () => {
    expect(mappingProblem({ date: -1, desc: 0, debit: 1, credit: 2, amount: -1, mode: 'split', negativeIsSpent: true })).toMatch(/date/);
    expect(mappingProblem({ date: 0, desc: 0, debit: -1, credit: -1, amount: -1, mode: 'split', negativeIsSpent: true })).toMatch(/money out/);
    expect(mappingProblem({ date: 0, desc: 0, debit: -1, credit: -1, amount: 2, mode: 'single', negativeIsSpent: true })).toBeNull();
  });
});

function run(csv: string, tweak: Partial<Mapping> = {}) {
  const { rows } = parseCsv(csv);
  const h = findHeaderRow(rows);
  const m = { ...guessMapping(rows[h]), ...tweak };
  const body = rows.slice(h + 1);
  const order = detectDateOrder(body.map((r) => r[m.date] ?? '')).order;
  return buildRows(body, m, order, CATS, TODAY, rows[h].length);
}

describe('buildRows', () => {
  it('bank A: debits and credits, footer ignored, categories guessed', () => {
    const r = run(BANK_A);
    expect(r.rows.map((x) => [x.date, x.kind, x.amount, x.category])).toEqual([
      ['2026-09-01', 'expense', 12500, 'Food'],
      ['2026-09-02', 'income', 50000, 'Other'],
      ['2026-09-03', 'expense', 3201, 'Transport'], // 3,200.50 rounds to whole naira
      ['2026-09-25', 'expense', 1000, 'Data and airtime'],
    ]);
    expect(r.unreadable).toBe(1); // the "Total" row
    expect(r.rows[0].note).toBe('POS PURCHASE SHOPRITE, IKEJA');
  });
  it('bank B: one signed amount column', () => {
    // the first row's amount contains an unquoted comma, so it has an extra column; it is counted, not guessed
    const r = run(BANK_B);
    expect(r.rows.every((x) => x.amount !== 4)).toBe(true); // never ₦4 from a split ₦-4,500.00
    expect(r.rows.map((x) => [x.kind, x.amount])).toEqual([['income', 250000], ['expense', 120000]]);
    expect(r.unreadable).toBe(1);
  });
  it('wallet C: "--" means empty, savings deposits are saved and not spent', () => {
    const r = run(WALLET_C);
    expect(r.rows.map((x) => [x.kind, x.amount])).toEqual([['expense', 2000], ['saving', 10000], ['income', 5000]]);
    expect(r.rows[0].date).toBe('2026-09-01');
  });
  it('European numbers and month names', () => {
    const r = run(EURO_D, { date: 0, desc: 1, amount: 2, mode: 'single' });
    expect(r.rows.map((x) => [x.date, x.kind, x.amount, x.category])).toEqual([['2026-09-03', 'expense', 1251, 'Transport'], ['2026-09-04', 'income', 5000, 'Other']]);
  });
  it('the sign convention can be flipped', () => {
    const r = run('Date,Narration,Amount\n2026-09-01,Lunch,4500\n2026-09-02,Pay,-9000', { negativeIsSpent: false });
    expect(r.rows.map((x) => x.kind)).toEqual(['expense', 'income']);
  });
  it('leaves out future-dated and ancient rows instead of importing nonsense', () => {
    const r = run('Date,Narration,Amount\n2030-01-01,Later,-5\n1999-01-01,Old,-5\n2026-10-09,Today,-5000');
    expect(r.rows).toHaveLength(1);
    expect(r.outOfRange).toBe(1);
    expect(r.unreadable).toBe(1); // 1999 isn't read as a date at all
  });
  it('only uses categories the person still has', () => {
    expect(guessCategory('uber', ['Food', 'Other'])).toBe('Other');
    expect(guessCategory('uber', ['Transport', 'Other'])).toBe('Transport');
  });
  it('wrong columns give nothing rather than garbage', () => {
    const r = run(BANK_A, { date: 2 });
    expect(r.rows).toHaveLength(0);
  });
});

describe('planImport', () => {
  const rows = run(BANK_A).rows;
  it('adds everything the first time, with content-based ids', () => {
    const p = planImport(rows, new Set(), new Set());
    expect(p.add).toHaveLength(4);
    expect(new Set(p.add.map((t) => t.id)).size).toBe(4);
    expect(p.add.every((t) => t.id.startsWith('imp-'))).toBe(true);
    expect(p.add[0]).toMatchObject({ kind: 'expense', category: 'Food', amount: 12500 });
    expect(p.add[1].category).toBeUndefined();
  });
  it('importing the same statement again adds nothing', () => {
    const first = planImport(rows, new Set(), new Set());
    const again = planImport(rows, new Set(first.add.map((t) => t.id)), new Set());
    expect(again.add).toHaveLength(0);
    expect(again.duplicates).toBe(4);
  });
  it('an overlapping statement adds only the new rows', () => {
    const first = planImport(rows.slice(0, 2), new Set(), new Set());
    const later = planImport(rows, new Set(first.add.map((t) => t.id)), new Set());
    expect(later.add).toHaveLength(2);
    expect(later.duplicates).toBe(2);
  });
  it('entries deleted earlier do not come back', () => {
    const first = planImport(rows, new Set(), new Set());
    const gone = new Set([first.add[0].id]);
    const p = planImport(rows, new Set(first.add.slice(1).map((t) => t.id)), gone);
    expect(p.add).toHaveLength(0);
    expect(p.removedEarlier).toBe(1);
  });
  it('two identical purchases on one day are both kept, and stay two on re-import', () => {
    const twice = run('Date,Narration,Amount\n2026-09-01,Coffee,-1500\n2026-09-01,Coffee,-1500').rows;
    const first = planImport(twice, new Set(), new Set());
    expect(first.add).toHaveLength(2);
    expect(planImport(twice, new Set(first.add.map((t) => t.id)), new Set()).add).toHaveLength(0);
  });
  it('rows the person marked skip are not added', () => {
    const edited = rows.map((r, i) => (i === 0 ? { ...r, kind: 'skip' as const } : r));
    const p = planImport(edited, new Set(), new Set());
    expect(p.add).toHaveLength(3);
    expect(p.skipped).toBe(1);
  });
  it('changing a row’s type in the review does not change its identity', () => {
    const a = planImport(rows, new Set(), new Set()).add[0].id;
    const b = planImport(rows.map((r, i) => (i === 0 ? { ...r, kind: 'saving' as const } : r)), new Set(), new Set()).add[0].id;
    expect(a).toBe(b);
  });
});
