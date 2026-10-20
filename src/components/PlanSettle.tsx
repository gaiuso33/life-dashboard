import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { learnedCategory } from '../learn';
import { activeFundOf, categoriesOf, suggestedSave } from '../money';
import { freshLinkBase, linkedTxns, payTxns } from '../plan';
import type { Occurrence } from '../plan';
import { useStore } from '../store';
import { fmtMoney, currencySymbol } from '../units';
import { todayKey } from '../utils';

// What happens when a bill or an income item on the Month calendar is ticked: offer to record it in Money, with the amount,
// category and date already filled in, so it takes one tap. "Just tick" skips the entry for people who track elsewhere.

const onEscape = (close: () => void) => (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    e.stopPropagation();
    close();
  }
};

export function PayForm({ occ, onClose }: { occ: Occurrence; onClose: () => void }) {
  const { data, dispatch } = useStore();
  const today = todayKey();
  const item = occ.item;
  const isBill = item.kind === 'bill';
  const cats = categoriesOf(data);
  const guess = learnedCategory(data, item.title);
  const [amount, setAmount] = useState(String(item.amount));
  const [category, setCategory] = useState(guess && cats.includes(guess) ? guess : cats.includes('Other') ? 'Other' : cats[0]);
  // The day it was due, unless that is still ahead: nothing can be recorded in the future.
  const [date, setDate] = useState(occ.date <= today ? occ.date : today);
  const [split, setSplit] = useState(data.money.savePct > 0);
  const fund = activeFundOf(data, today);

  const value = Math.round(Number(amount.replace(/,/g, '')) || 0);
  const valid = value > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
  const save = suggestedSave(value, data.money.savePct);

  const record = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const base = freshLinkBase(data, item.id, occ.date);
    dispatch({ t: 'plan-pay', id: item.id, date: occ.date, txns: payTxns(item, base, { amount: value, category, date, split, fund }, data.money.savePct) });
    onClose();
  };
  const justTick = () => {
    dispatch({ t: 'plan-toggle', id: item.id, date: occ.date });
    onClose();
  };

  return (
    <form className="plan-confirm" role="group" aria-label={`Record ${item.title} in Money`} onSubmit={record} onKeyDown={onEscape(onClose)}>
      <p>
        <b>{isBill ? 'Record this payment in Money?' : 'Record this income in Money?'}</b>
      </p>
      <label className="field">
        <span>
          {isBill ? 'Amount paid' : 'Amount received'} ({currencySymbol()})
        </span>
        <input autoFocus inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d,]/g, ''))} />
      </label>
      {isBill && (
        <label className="field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      )}
      <label className="field">
        <span>Date</span>
        <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
      </label>
      {!isBill && data.money.savePct > 0 && (
        <label className="check">
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
          <span>
            Also move {data.money.savePct}% ({fmtMoney(save)}) into your {fund} fund
          </span>
        </label>
      )}
      <div className="row-action">
        <button className="btn primary" disabled={!valid}>
          Record and tick
        </button>
        <button type="button" className="btn" onClick={justTick}>
          Just tick
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const LABEL = { expense: 'spent', income: 'received', saving: 'saved' } as const;

export function UntickForm({ occ, onClose }: { occ: Occurrence; onClose: () => void }) {
  const { data, dispatch } = useStore();
  const entries = linkedTxns(data, occ.item.id, occ.date);
  const untick = (removeEntries: boolean) => {
    dispatch({ t: 'plan-toggle', id: occ.item.id, date: occ.date, removeEntries });
    onClose();
  };
  return (
    <div className="plan-confirm" role="group" aria-label={`Untick ${occ.item.title}`} onKeyDown={onEscape(onClose)}>
      <p>
        <b>Also remove it from Money?</b> Ticking recorded {entries.map((t) => `${fmtMoney(t.amount)} ${LABEL[t.kind]}`).join(' and ')}.
      </p>
      <div className="row-action">
        <button autoFocus className="btn primary" onClick={() => untick(true)}>
          Untick and remove
        </button>
        <button className="btn" onClick={() => untick(false)}>
          Untick, keep the entry
        </button>
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
