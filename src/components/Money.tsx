import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { BarChart } from '../Charts';
import type { Bar } from '../Charts';
import {
  categoriesOf,
  DAYS_PER_MONTH,
  HISTORY_NEEDED,
  compact,
  fundBalance,
  lastCategoryForNote,
  monthTotals,
  monthlySavingPace,
  naira,
  newId,
  spendByWeek,
  suggestedSave,
  survivalTarget,
} from '../money';
import { useStore } from '../store';
import type { FundKey, TxnKind } from '../types';
import { addDays, fmtShort, todayKey } from '../utils';

const KINDS: { key: TxnKind; label: string }[] = [
  { key: 'expense', label: 'Spent' },
  { key: 'income', label: 'Received' },
  { key: 'saving', label: 'Saved' },
];

const digits = (s: string) => s.replace(/\D/g, '').slice(0, 9);
const grouped = (d: string) => (d ? Number(d).toLocaleString('en-NG') : '');

export function Money() {
  const { data, dispatch } = useStore();
  const today = todayKey();
  const money = data.money;

  const [kind, setKind] = useState<TxnKind>('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<string>('Food');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today);
  const [split, setSplit] = useState<{ income: number; amount: number } | null>(null);
  const [flash, setFlash] = useState('');

  const survival = survivalTarget(data, today);
  const survivalNow = fundBalance(data, 'survival');
  const survivalDone = survival.target != null && survivalNow >= survival.target;
  const investNow = fundBalance(data, 'investment');
  const activeFund: FundKey = survivalDone ? 'investment' : 'survival';
  const pace = monthlySavingPace(data, today);

  const month = monthTotals(data, today.slice(0, 7));
  const cats = Object.entries(month.byCategory).sort((a, b) => b[1] - a[1]);
  const topCat = cats[0]?.[1] ?? 1;
  const weeks = spendByWeek(data, today, 8);
  const bars: Bar[] = weeks.map((w) => ({ label: fmtShort(w.monday), value: w.spent, detail: `Week of ${fmtShort(w.monday)}` }));

  const recent = useMemo(() => {
    const withIndex = money.txns.map((t, i) => ({ t, i }));
    withIndex.sort((a, b) => (a.t.date === b.t.date ? b.i - a.i : b.t.date.localeCompare(a.t.date)));
    return withIndex.slice(0, 20).map((x) => x.t);
  }, [money.txns]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!value) return;
    dispatch({
      t: 'txn-add',
      txn: {
        id: newId(),
        date,
        kind,
        amount: value,
        category: kind === 'expense' ? category : undefined,
        fund: kind === 'saving' ? activeFund : undefined,
        note: note.trim(),
      },
    });
    if (kind === 'income') setSplit({ income: value, amount: suggestedSave(value, money.savePct) });
    else setSplit(null);
    setFlash(`${KINDS.find((k) => k.key === kind)!.label} ${naira(value)} logged.`);
    setAmount('');
    setNote('');
    setDate(today);
  };

  const moveToSavings = () => {
    if (!split) return;
    dispatch({ t: 'txn-add', txn: { id: newId(), date: today, kind: 'saving', amount: split.amount, fund: activeFund, note: 'From income split' } });
    setFlash(`Saved ${naira(split.amount)} to your ${activeFund} fund.`);
    setSplit(null);
  };

  // ETA for the survival fund
  let eta = '';
  if (survival.target != null && !survivalDone) {
    const remaining = survival.target - survivalNow;
    if (pace <= 0) eta = 'Log a savings transfer and an estimate will appear here.';
    else {
      const months = remaining / pace;
      const when = new Date(addDaysDate(today, Math.round(months * DAYS_PER_MONTH)));
      eta = `At ${naira(pace)} saved a month, about ${months < 1.5 ? '1 month' : `${Math.round(months)} months`} to go (around ${when.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}).`;
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Money</h1>
        <p className="sub">Log each spend in a few taps. Your survival fund target is six months of what you actually spend, so every entry makes it more accurate.</p>
      </header>

      <div className="cols">
        <div className="stack">
          <section className="panel">
            <h2>Log</h2>
            <form className="form" onSubmit={submit}>
              <div className="segment" role="radiogroup" aria-label="Type of entry">
                {KINDS.map((k) => (
                  <button type="button" key={k.key} role="radio" aria-checked={kind === k.key} onClick={() => setKind(k.key)}>
                    {k.label}
                  </button>
                ))}
              </div>

              <label className="field amount">
                <span>Amount</span>
                <div className="amount-box">
                  <i aria-hidden="true">₦</i>
                  <input inputMode="numeric" autoComplete="off" value={grouped(amount)} placeholder="0" onChange={(e) => setAmount(digits(e.target.value))} aria-label="Amount in naira" />
                </div>
              </label>

              {kind === 'expense' && (
                <div className="field">
                  <span>Category</span>
                  <div className="chips" role="radiogroup" aria-label="Category">
                    {categoriesOf(data).map((c) => (
                      <button type="button" key={c} role="radio" aria-checked={category === c} onClick={() => setCategory(c)}>
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="two">
                <label className="field">
                  <span>Note (optional)</span>
                  <input
                    value={note}
                    placeholder={kind === 'expense' ? 'e.g. Lunch' : kind === 'income' ? 'e.g. Project payment' : 'e.g. Weekly top-up'}
                    onChange={(e) => setNote(e.target.value)}
                    onBlur={() => {
                      if (kind !== 'expense') return;
                      const known = lastCategoryForNote(data, note);
                      if (known) setCategory(known);
                    }}
                  />
                </label>
                <label className="field">
                  <span>Date</span>
                  <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
                </label>
              </div>

              <div className="finish">
                <button className="btn primary" type="submit" disabled={!Number(amount)}>
                  Save entry
                </button>
                {flash && (
                  <span className="ok" role="status">
                    {flash}
                  </span>
                )}
              </div>
            </form>

            {split && (
              <div className="callout" role="status">
                <p>
                  Income logged. Your {money.savePct}% split is <b>{naira(split.amount)}</b>. Move it into your {activeFund} fund now?
                </p>
                <div className="row-action">
                  <button className="btn primary" onClick={moveToSavings}>
                    Save {naira(split.amount)}
                  </button>
                  <button className="btn ghost" onClick={() => setSplit(null)}>
                    Not now
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="panel">
            <h2>Recent entries</h2>
            {recent.length === 0 ? (
              <p className="empty">Nothing logged yet. Your first entry goes in the form above.</p>
            ) : (
              <ul className="txns">
                {recent.map((t) => (
                  <li key={t.id} className={`txn ${t.kind}`}>
                    <span className="txn-date">{fmtShort(t.date)}</span>
                    <span className="txn-main">
                      <b>{t.note || (t.kind === 'expense' ? t.category : t.kind === 'income' ? 'Income' : 'Savings transfer')}</b>
                      {t.kind === 'expense' ? (
                        <select value={t.category} aria-label={`Category for ${t.note || 'entry'}`} onChange={(e) => dispatch({ t: 'txn-cat', id: t.id, category: e.target.value })}>
                          {categoriesOf(data).map((c) => (
                            <option key={c}>{c}</option>
                          ))}
                        </select>
                      ) : (
                        <span>{t.kind === 'saving' ? `To ${t.fund ?? 'survival'} fund` : 'Received'}</span>
                      )}
                    </span>
                    <span className="txn-amt">
                      {t.kind === 'expense' ? '−' : t.kind === 'income' ? '+' : '→'}
                      {naira(t.amount)}
                    </span>
                    <button className="btn ghost" aria-label={`Remove ${t.note || 'entry'} of ${naira(t.amount)}`} onClick={() => dispatch({ t: 'txn-del', id: t.id })}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <h2>Survival fund</h2>
            <p className="big">
              {naira(survivalNow)}
              {survival.target != null && <small> of {naira(survival.target)}</small>}
            </p>
            {survival.target != null && (
              <div className="meter-bar fund" role="progressbar" aria-label="Survival fund progress" aria-valuenow={Math.min(100, Math.round((survivalNow / survival.target) * 100))} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${Math.min(100, (survivalNow / survival.target) * 100)}%` }} />
              </div>
            )}
            {survival.target == null ? (
              <p className="note">
                No target yet. Enter a rough daily spend below to set one now, or log about {HISTORY_NEEDED} days of spending and it calculates itself.
              </p>
            ) : survival.basis === 'estimate' ? (
              <p className="note">
                Based on your rough estimate of {naira(money.dailyEstimate ?? 0)} a day (six months is {naira(survival.target)}). It switches to your real spending after {HISTORY_NEEDED} days of logging; you have {survival.daysTracked} so far.
              </p>
            ) : (
              <p className="note">Six months of your average spending of {naira(survival.monthly ?? 0)} a month, from your last 90 days. Held in OPay.</p>
            )}
            {survivalDone ? <p className="ok">Survival fund complete. New savings now go to the investment fund.</p> : eta && <p className="note">{eta}</p>}
          </section>

          <section className="panel">
            <h2>Investment fund</h2>
            {survivalDone || investNow > 0 ? (
              <p className="big">{naira(investNow)}</p>
            ) : (
              <p className="empty">Starts once the survival fund is full. Until then, every transfer goes to survival.</p>
            )}
          </section>

          <section className="panel">
            <h2>This month</h2>
            <dl className="stats compact">
              <div>
                <dt>Received</dt>
                <dd className="money-num">{naira(month.income)}</dd>
              </div>
              <div>
                <dt>Spent</dt>
                <dd className="money-num">{naira(month.spent)}</dd>
              </div>
              <div>
                <dt>Saved</dt>
                <dd className="money-num">{naira(month.saved)}</dd>
              </div>
            </dl>
            {cats.length > 0 ? (
              <ul className="catbars" aria-label="Spending by category this month">
                {cats.map(([c, v]) => (
                  <li key={c}>
                    <span className="cb-label">{c}</span>
                    <span className="cb-track">
                      <i style={{ width: `${(v / topCat) * 100}%` }} />
                    </span>
                    <span className="cb-val">{naira(v)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty">No spending logged this month yet.</p>
            )}
          </section>
        </div>
      </div>

      <section className="panel">
        <h2>Spending per week</h2>
        <BarChart bars={bars} color="var(--plate-yellow)" unit="₦" label="Total spending per week over the last eight weeks" fmtValue={naira} fmtTick={compact} />
      </section>

      <section className="panel">
        <h2>Settings</h2>
        <div className="three">
          <label className="field">
            <span>Share of each income to save (%)</span>
            <input
              inputMode="numeric"
              value={money.savePct}
              onChange={(e) => dispatch({ t: 'money-set', patch: { savePct: Math.min(100, Number(digits(e.target.value)) || 0) } })}
            />
          </label>
          <label className="field">
            <span>Rough spend per day (₦)</span>
            <input
              inputMode="numeric"
              value={grouped(money.dailyEstimate != null ? String(money.dailyEstimate) : '')}
              placeholder="e.g. 1,500"
              onChange={(e) => {
                const d = digits(e.target.value);
                dispatch({ t: 'money-set', patch: { dailyEstimate: d ? Number(d) : null } });
              }}
            />
          </label>
          <label className="field">
            <span>Already in survival fund (₦)</span>
            <input
              inputMode="numeric"
              value={grouped(money.survivalOpening ? String(money.survivalOpening) : '')}
              placeholder="0"
              onChange={(e) => dispatch({ t: 'money-set', patch: { survivalOpening: Number(digits(e.target.value)) || 0 } })}
            />
          </label>
        </div>
        <p className="note">Your income varies, so the app suggests a percentage of each payment instead of a fixed monthly amount.</p>
      </section>
    </div>
  );
}

function addDaysDate(iso: string, n: number): number {
  const [y, m, d] = addDays(iso, n).split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}
