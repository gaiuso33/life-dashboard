import { useMemo, useState } from 'react';
import { ITEMS, dayScore, dayStatus, plannedFor } from '../derive';
import { naira, newId } from '../money';
import { KIND_LABEL, monthCells, monthEnd, monthKey, monthStart, monthTitle, plansBetween, plansOn, shiftMonth } from '../plan';
import { dayDef } from '../program';
import { periodStart } from '../rewards';
import { useStore } from '../store';
import type { PlanKind } from '../types';
import { WEEKDAYS } from '../dates';
import { addDays, fmtLong, todayKey } from '../utils';

const KINDS = Object.keys(KIND_LABEL) as PlanKind[];

export function Month() {
  const { data, dispatch } = useStore();
  const today = todayKey();
  const [ym, setYm] = useState(monthKey(today));
  const [sel, setSel] = useState(today);
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<PlanKind>('task');
  const [amount, setAmount] = useState('');
  const [monthly, setMonthly] = useState(false);

  const cells = useMemo(() => monthCells(ym), [ym]);
  const first = monthStart(ym);
  const last = monthEnd(ym);
  const inMonth = (d: string) => d >= first && d <= last;
  const deadline = data.career.deadline;

  const stats = useMemo(() => {
    let sessions = 0;
    let planned = 0;
    let strong = 0;
    let past = 0;
    for (let d = first; d <= last; d = addDays(d, 1)) {
      if (plannedFor(d)) {
        planned++;
        if (data.sessions[`${d}|${plannedFor(d)}`]?.finished) sessions++;
      }
      if (d <= today) {
        past++;
        if (dayScore(data, d) >= 3) strong++;
      }
    }
    const ahead = plansBetween(data, first > today ? first : addDays(today, 0), last).filter((o) => !o.done && o.date >= today);
    return {
      sessions,
      planned,
      strong,
      past,
      billsLeft: ahead.filter((o) => o.item.kind === 'bill').reduce((n, o) => n + o.item.amount, 0),
      incomeLeft: ahead.filter((o) => o.item.kind === 'income').reduce((n, o) => n + o.item.amount, 0),
      dueCount: ahead.length,
    };
  }, [data, first, last, today]);

  const selPlans = plansOn(data, sel);
  const selStatus = dayStatus(data, sel);
  const selSession = plannedFor(sel);

  const add = () => {
    const t = title.trim();
    if (!t) return;
    const amt = Math.max(0, Math.round(Number(amount.replace(/,/g, '')) || 0));
    dispatch({ t: 'plan-add', item: { id: newId(), date: sel, title: t.slice(0, 80), kind, amount: kind === 'bill' || kind === 'income' ? amt : 0, repeat: monthly ? 'monthly' : 'none', doneOn: [] } });
    setTitle('');
    setAmount('');
    setMonthly(false);
  };

  const pick = (d: string) => {
    setSel(d);
    if (!inMonth(d)) setYm(monthKey(d));
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>{monthTitle(ym)}</h1>
        <p className="sub">Your month at a glance: training days, what you did, and bills, money due in and tasks you plan ahead.</p>
      </header>

      <div className="month-nav">
        <button className="btn" onClick={() => setYm(shiftMonth(ym, -1))} aria-label="Previous month">
          ‹ Prev
        </button>
        <button className="btn" onClick={() => { setYm(monthKey(today)); setSel(today); }}>
          This month
        </button>
        <button className="btn" onClick={() => setYm(shiftMonth(ym, 1))} aria-label="Next month">
          Next ›
        </button>
      </div>

      <dl className="stats compact month-stats">
        <div>
          <dt>Sessions</dt>
          <dd>
            {stats.sessions}
            <small>of {stats.planned}</small>
          </dd>
        </div>
        <div>
          <dt>Strong days</dt>
          <dd>
            {stats.strong}
            <small>of {stats.past}</small>
          </dd>
        </div>
        <div>
          <dt>Bills still due</dt>
          <dd>{naira(stats.billsLeft)}</dd>
        </div>
        <div>
          <dt>Income still due</dt>
          <dd>{naira(stats.incomeLeft)}</dd>
        </div>
      </dl>

      <div className="cols month-cols">
        <section className="panel cal-panel">
          <div className="cal" role="group" aria-label={monthTitle(ym)}>
            {WEEKDAYS.map((w) => (
              <div key={w} className="cal-h">
                {w}
              </div>
            ))}
            {cells.map((d) => {
              const ps = plansOn(data, d);
              const st = dayStatus(data, d);
              const session = plannedFor(d);
              const blockEnd = d === addDays(periodStart(d, 'month'), 27);
              return (
                <button
                  key={d}
                  className={`cal-d${inMonth(d) ? '' : ' out'}${d === today ? ' is-today' : ''}${d === sel ? ' is-sel' : ''}`}
                  aria-label={`${fmtLong(d)}${ps.length ? `, ${ps.length} planned` : ''}`}
                  aria-pressed={d === sel}
                  onClick={() => pick(d)}
                >
                  <span className="n">{Number(d.slice(8))}</span>
                  {session && <span className={`sess${data.sessions[`${d}|${session}`]?.finished ? ' done' : ''}`}>{dayDef(session).title}</span>}
                  {d <= today && (
                    <span className="dots">
                      {ITEMS.map((it) => (
                        <i key={it.key} className={st[it.key] ? 'on' : ''} style={{ ['--c' as string]: it.color }} />
                      ))}
                    </span>
                  )}
                  {ps.slice(0, 2).map((o) => (
                    <span key={o.item.id} className={`pl k-${o.item.kind}${o.done ? ' done' : ''}`}>
                      {o.item.title}
                    </span>
                  ))}
                  {ps.length > 2 && <span className="pl more">+{ps.length - 2}</span>}
                  {ps.length > 0 && <span className="pl-dot" aria-hidden="true" />}
                  {(blockEnd || d === deadline) && <span className="flag">{d === deadline ? 'Goal deadline' : 'Reward block ends'}</span>}
                </button>
              );
            })}
          </div>
          <p className="note">Dots are the four plates for each day. A reward block is four weeks, counted from a fixed Monday.</p>
        </section>

        <section className="panel day-panel">
          <h2>{fmtLong(sel)}</h2>
          {selSession ? <p className="note first">{dayDef(selSession).title} day{data.sessions[`${sel}|${selSession}`]?.finished ? ', finished' : ''}.</p> : <p className="note first">Rest day: mobility.</p>}
          {sel <= today && (
            <p className="note">
              Plates: {ITEMS.filter((it) => selStatus[it.key]).map((it) => it.label.toLowerCase()).join(', ') || 'none logged'}.
            </p>
          )}

          <h3>Planned</h3>
          {selPlans.length === 0 ? (
            <p className="note first">Nothing planned for this day.</p>
          ) : (
            <ul className="plan-list">
              {selPlans.map((o) => (
                <li key={o.item.id} className={o.done ? 'is-done' : ''}>
                  <label>
                    <input type="checkbox" checked={o.done} onChange={() => dispatch({ t: 'plan-toggle', id: o.item.id, date: o.date })} />
                    <span>
                      <b>{o.item.title}</b>
                      <small>
                        {KIND_LABEL[o.item.kind]}
                        {o.item.amount > 0 ? `, ${naira(o.item.amount)}` : ''}
                        {o.item.repeat === 'monthly' ? ', every month' : ''}
                      </small>
                    </span>
                  </label>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      if (o.item.repeat === 'none' || window.confirm('Delete this item from every month?')) dispatch({ t: 'plan-del', id: o.item.id });
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h3>Add to this day</h3>
          <form
            className="plan-form"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label className="field">
              <span>What</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Rent, pay data, finish login page" maxLength={80} />
            </label>
            <div className="segment small four" role="radiogroup" aria-label="Type">
              {KINDS.map((k) => (
                <button type="button" key={k} role="radio" aria-checked={kind === k} onClick={() => setKind(k)}>
                  {KIND_LABEL[k]}
                </button>
              ))}
            </div>
            {(kind === 'bill' || kind === 'income') && (
              <label className="field">
                <span>Amount (₦)</span>
                <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d,]/g, ''))} placeholder="3500" />
              </label>
            )}
            <label className="check">
              <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
              <span>Repeat every month on this date</span>
            </label>
            <button className="btn primary" disabled={!title.trim()}>
              Add
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
