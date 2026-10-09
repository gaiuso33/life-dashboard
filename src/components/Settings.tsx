import { useMemo, useState } from 'react';
import { CATEGORIES, PROTECTED_CATEGORIES, categoriesOf, naira, newId } from '../money';
import type { Tab } from '../nav';
import { DEFAULT_PROGRAM, WEEKDAY_SHORT, getProgram, programError } from '../program';
import type { DayDef, ExerciseDef } from '../program';
import { TIER_LABEL } from '../rewards';
import { useStore } from '../store';
import type { RewardItem, Tier } from '../types';

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIERS: Tier[] = ['week', 'biweek', 'month', 'landmark'];
const digits = (s: string) => s.replace(/[^\d]/g, '');
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

export function Settings({ go, onSync }: { go: (t: Tab) => void; onSync: () => void }) {
  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
        <p className="sub">Make the dashboard fit you. Changes apply straight away, and your logged history is never rewritten.</p>
      </header>
      <div className="settings">
        <Programme />
        <Categories />
        <Rewards />
        <Goals go={go} />
        <DataSection onSync={onSync} />
      </div>
    </div>
  );
}

/* ---------- training programme ---------- */

function Programme() {
  const { data, dispatch } = useStore();
  const saved = getProgram();
  const [draft, setDraft] = useState<DayDef[]>(() => clone(saved));
  const error = programError(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const custom = data.program != null;

  const setDay = (i: number, patch: Partial<DayDef>) => setDraft(draft.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const setEx = (i: number, k: number, patch: Partial<ExerciseDef>) => setDay(i, { exercises: draft[i].exercises.map((e, j) => (j === k ? { ...e, ...patch } : e)) });
  const move = (i: number, k: number, by: -1 | 1) => {
    const list = [...draft[i].exercises];
    const t = k + by;
    if (t < 0 || t >= list.length) return;
    [list[k], list[t]] = [list[t], list[k]];
    setDay(i, { exercises: list });
  };
  const num = (v: string) => Number(digits(v)) || 0;

  return (
    <section className="panel">
      <h2>Training programme</h2>
      <p className="note first">Edit the exercises, sets and rep ranges for each session, or move a session to a different weekday. Hit the top of the range on every set and the app tells you to add load.</p>
      {draft.map((d, i) => (
        <details key={d.key} className="prog-day">
          <summary>
            <b>{d.title || 'Session'}</b>
            <span>
              {WEEKDAYS_LONG[d.weekday]}, {d.exercises.length} {d.exercises.length === 1 ? 'exercise' : 'exercises'}
            </span>
          </summary>
          <div className="prog-head">
            <label className="field">
              <span>Session name</span>
              <input value={d.title} maxLength={20} onChange={(e) => setDay(i, { title: e.target.value })} />
            </label>
            <label className="field">
              <span>Weekday</span>
              <select value={d.weekday} onChange={(e) => setDay(i, { weekday: Number(e.target.value) })}>
                {[1, 2, 3, 4, 5, 6, 0].map((w) => (
                  <option key={w} value={w}>
                    {WEEKDAYS_LONG[w]}
                  </option>
                ))}
              </select>
            </label>
            <label className="field grow">
              <span>Focus</span>
              <input value={d.focus} maxLength={60} onChange={(e) => setDay(i, { focus: e.target.value })} />
            </label>
          </div>
          <ul className="set-ex">
            {d.exercises.map((ex, k) => (
              <li key={ex.id}>
                <label className="field name">
                  <span>Exercise</span>
                  <input value={ex.name} maxLength={60} onChange={(e) => setEx(i, k, { name: e.target.value })} />
                </label>
                <label className="field mini">
                  <span>Sets</span>
                  <input inputMode="numeric" value={ex.sets || ''} onChange={(e) => setEx(i, k, { sets: num(e.target.value) })} />
                </label>
                <label className="field mini">
                  <span>From</span>
                  <input inputMode="numeric" value={ex.min || ''} onChange={(e) => setEx(i, k, { min: num(e.target.value) })} />
                </label>
                <label className="field mini">
                  <span>To</span>
                  <input inputMode="numeric" value={ex.max || ''} onChange={(e) => setEx(i, k, { max: num(e.target.value) })} />
                </label>
                <label className="field mini">
                  <span>Counted in</span>
                  <select value={ex.unit} onChange={(e) => setEx(i, k, { unit: e.target.value as 'reps' | 'sec' })}>
                    <option value="reps">reps</option>
                    <option value="sec">seconds</option>
                  </select>
                </label>
                <label className="check side">
                  <input type="checkbox" checked={!!ex.perSide} onChange={(e) => setEx(i, k, { perSide: e.target.checked })} />
                  <span>Each side</span>
                </label>
                <div className="ex-tools">
                  <button className="btn" aria-label={`Move ${ex.name} up`} disabled={k === 0} onClick={() => move(i, k, -1)}>
                    ↑
                  </button>
                  <button className="btn" aria-label={`Move ${ex.name} down`} disabled={k === d.exercises.length - 1} onClick={() => move(i, k, 1)}>
                    ↓
                  </button>
                  <button className="btn ghost" aria-label={`Remove ${ex.name}`} onClick={() => setDay(i, { exercises: d.exercises.filter((_, j) => j !== k) })}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button className="btn" onClick={() => setDay(i, { exercises: [...d.exercises, { id: `x${newId()}`, name: '', sets: 3, min: 8, max: 12, unit: 'reps' }] })}>
            Add an exercise to {d.title || 'this session'}
          </button>
        </details>
      ))}
      {error && dirty && <p className="err" role="alert">{error}</p>}
      <div className="row-action">
        <button
          className="btn primary"
          disabled={!dirty || error != null}
          onClick={() => dispatch({ t: 'program-set', program: JSON.stringify(draft) === JSON.stringify(DEFAULT_PROGRAM) ? undefined : draft })}
        >
          Save programme
        </button>
        <button className="btn" disabled={!dirty} onClick={() => setDraft(clone(saved))}>
          Discard changes
        </button>
        <button
          className="btn ghost"
          disabled={!custom && !dirty}
          onClick={() => {
            if (window.confirm('Go back to the original push, pull and legs programme? Your logged sessions are kept.')) {
              dispatch({ t: 'program-set', program: undefined });
              setDraft(clone(DEFAULT_PROGRAM));
            }
          }}
        >
          Reset to the original
        </button>
      </div>
      <p className="note">Reps you already logged stay put. Renaming an exercise keeps its history; removing one hides it. The weekday {WEEKDAY_SHORT[saved[0].weekday]}, {WEEKDAY_SHORT[saved[1].weekday]} and {WEEKDAY_SHORT[saved[2].weekday]} pattern is what Today and the calendar follow.</p>
    </section>
  );
}

/* ---------- categories ---------- */

function Categories() {
  const { data, dispatch } = useStore();
  const cats = categoriesOf(data);
  const [name, setName] = useState('');
  const clean = name.trim().slice(0, 24);
  const taken = cats.some((c) => c.toLowerCase() === clean.toLowerCase());
  const usage = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of data.money.txns) if (t.category) m[t.category] = (m[t.category] ?? 0) + 1;
    return m;
  }, [data.money.txns]);

  return (
    <section className="panel">
      <h2>Spending categories</h2>
      <p className="note first">Rename a category and its past entries follow. Removing one moves its entries to Other. Rewards and Other are fixed.</p>
      <ul className="cat-list">
        {cats.map((c) => (
          <CategoryRow key={c} name={c} uses={usage[c] ?? 0} others={cats.filter((x) => x !== c)} />
        ))}
      </ul>
      <form
        className="inline-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean && !taken) {
            dispatch({ t: 'cat-add', name: clean });
            setName('');
          }
        }}
      >
        <label className="field">
          <span>New category</span>
          <input value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Tithes, Family, Subscriptions" />
        </label>
        <button className="btn primary" disabled={!clean || taken}>
          Add
        </button>
      </form>
      {taken && clean && <p className="err">You already have that category.</p>}
      <p className="note">Category names you add stay on this device. The advisor only sees the built-in names, and groups your own into one total.</p>
    </section>
  );
}

function CategoryRow({ name, uses, others }: { name: string; uses: number; others: string[] }) {
  const { dispatch } = useStore();
  const [value, setValue] = useState(name);
  const fixed = PROTECTED_CATEGORIES.includes(name);
  const commit = () => {
    const v = value.trim().slice(0, 24);
    if (!v || v === name || others.some((o) => o.toLowerCase() === v.toLowerCase())) return setValue(name);
    dispatch({ t: 'cat-rename', from: name, to: v });
  };
  return (
    <li>
      <input aria-label={`Category name: ${name}`} value={value} disabled={fixed} maxLength={24} onChange={(e) => setValue(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      <small>
        {uses} {uses === 1 ? 'entry' : 'entries'}
        {(CATEGORIES as readonly string[]).includes(name) ? '' : ', yours'}
      </small>
      {!fixed && (
        <button
          className="btn ghost"
          onClick={() => {
            if (uses === 0 || window.confirm(`Remove ${name}? Its ${uses} ${uses === 1 ? 'entry moves' : 'entries move'} to Other.`)) dispatch({ t: 'cat-del', name });
          }}
        >
          Remove
        </button>
      )}
    </li>
  );
}

/* ---------- reward menu ---------- */

function Rewards() {
  const { data, dispatch } = useStore();
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [tier, setTier] = useState<Tier>('week');
  const items = data.rewards.items;

  return (
    <section className="panel">
      <h2>Reward menu</h2>
      <p className="note first">What you can pick when a reward unlocks. Prices are what you expect to pay in naira; free treats can be 0.</p>
      {TIERS.map((t) => (
        <div key={t} className="tier-group">
          <h3>{TIER_LABEL[t]}</h3>
          {items.filter((i) => i.tier === t).length === 0 ? (
            <p className="note first">Nothing here yet. Add something below.</p>
          ) : (
            <ul className="item-list">
              {items.filter((i) => i.tier === t).map((i) => (
                <ItemRow key={i.id} item={i} />
              ))}
            </ul>
          )}
        </div>
      ))}
      <form
        className="inline-add wide"
        onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim().slice(0, 50);
          if (!n) return;
          dispatch({ t: 'item-add', item: { id: `i-${newId()}`, name: n, cost: Number(digits(cost)) || 0, tier } });
          setName('');
          setCost('');
        }}
      >
        <label className="field grow">
          <span>New treat</span>
          <input value={name} maxLength={50} onChange={(e) => setName(e.target.value)} placeholder="Cinema night" />
        </label>
        <label className="field mini">
          <span>Cost (₦)</span>
          <input inputMode="numeric" value={cost} onChange={(e) => setCost(digits(e.target.value))} placeholder="0" />
        </label>
        <label className="field mini">
          <span>Level</span>
          <select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
            {TIERS.map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" disabled={!name.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

function ItemRow({ item }: { item: RewardItem }) {
  const { dispatch } = useStore();
  const [name, setName] = useState(item.name);
  const [cost, setCost] = useState(String(item.cost));
  const save = (patch: Partial<RewardItem>) => dispatch({ t: 'item-edit', item: { ...item, ...patch } });
  return (
    <li>
      <input
        aria-label={`Name of ${item.name}`}
        value={name}
        maxLength={50}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => (name.trim() ? name.trim() !== item.name && save({ name: name.trim() }) : setName(item.name))}
      />
      <input aria-label={`Cost of ${item.name}`} className="cost" inputMode="numeric" value={cost} onChange={(e) => setCost(digits(e.target.value))} onBlur={() => save({ cost: Number(cost) || 0 })} />
      <select aria-label={`Level of ${item.name}`} value={item.tier} onChange={(e) => save({ tier: e.target.value as Tier })}>
        {TIERS.map((t) => (
          <option key={t} value={t}>
            {TIER_LABEL[t]}
          </option>
        ))}
      </select>
      <button className="btn ghost" aria-label={`Remove ${item.name}`} onClick={() => dispatch({ t: 'item-del', id: item.id })}>
        Remove
      </button>
    </li>
  );
}

/* ---------- goals ---------- */

function Goals({ go }: { go: (t: Tab) => void }) {
  const { data, dispatch } = useStore();
  const c = data.career;
  const [weight, setWeight] = useState(data.goalWeight != null ? String(data.goalWeight) : '');
  const [count, setCount] = useState(String(c.goalCount));
  return (
    <section className="panel">
      <h2>Goals</h2>
      <div className="goal-grid">
        <label className="field">
          <span>Goal body weight (kg)</span>
          <input
            inputMode="decimal"
            value={weight}
            placeholder="Not set"
            onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={() => {
              const v = parseFloat(weight);
              dispatch({ t: 'goal', value: Number.isFinite(v) && v >= 30 && v <= 250 ? v : null });
              if (!(Number.isFinite(v) && v >= 30 && v <= 250)) setWeight('');
            }}
          />
        </label>
        <label className="field">
          <span>Portfolio projects to ship</span>
          <input
            inputMode="numeric"
            value={count}
            onChange={(e) => setCount(digits(e.target.value))}
            onBlur={() => {
              const v = Number(count);
              if (v >= 1 && v <= 20) dispatch({ t: 'career-set', patch: { goalCount: v } });
              else setCount(String(c.goalCount));
            }}
          />
        </label>
        <label className="field">
          <span>Career deadline</span>
          <input type="date" value={c.deadline} min={c.startDate} onChange={(e) => e.target.value && e.target.value >= c.startDate && dispatch({ t: 'career-set', patch: { deadline: e.target.value } })} />
        </label>
      </div>
      <p className="note">
        Savings split ({data.money.savePct}%), your rough daily spend ({data.money.dailyEstimate != null ? naira(data.money.dailyEstimate) : 'not set'}) and your starting survival fund are edited on the Money screen, and the AI advisor settings are on the Advisor screen.
      </p>
      <div className="row-action">
        <button className="btn" onClick={() => go('money')}>
          Open Money
        </button>
        <button className="btn" onClick={() => go('advisor')}>
          Open Advisor
        </button>
      </div>
    </section>
  );
}

/* ---------- data ---------- */

function DataSection({ onSync }: { onSync: () => void }) {
  const { dispatch } = useStore();
  return (
    <section className="panel">
      <h2>Your data</h2>
      <p className="note first">Everything is stored in this browser on this device. Save a copy before you clear anything.</p>
      <div className="row-action">
        <button className="btn primary" onClick={onSync}>
          Sync and backup
        </button>
        <button
          className="btn"
          onClick={() => {
            if (window.confirm('Erase everything on this device and start empty? Download a copy first if you might want it back.')) dispatch({ t: 'fresh' });
          }}
        >
          Erase everything on this device
        </button>
      </div>
    </section>
  );
}
