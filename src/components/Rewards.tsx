import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AREA_COLOR, evaluateBadges } from '../badges';
import type { BadgeState } from '../badges';
import { naira, newId } from '../money';
import { TIER_BLURB, TIER_LABEL, itemsFor, landmarksFor, periodsFor } from '../rewards';
import type { Period, PeriodTier } from '../rewards';
import { useStore } from '../store';
import type { RewardItem, Tier } from '../types';
import { fmtShort, todayKey } from '../utils';

/** "a", "a and b", "a, b and c" */
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

const PERIOD_TIERS: PeriodTier[] = ['week', 'biweek', 'month'];
const ALL_TIERS: Tier[] = ['week', 'biweek', 'month', 'landmark'];

function Medal({ b }: { b: BadgeState }) {
  const color = AREA_COLOR[b.area];
  const size = b.glyph.length <= 2 ? 24 : b.glyph.length === 3 ? 20 : 15;
  return (
    <svg viewBox="0 0 72 72" className="medal-svg" aria-hidden="true">
      {b.landmark && <circle cx="36" cy="36" r="35" fill="none" stroke={b.earned ? 'var(--chalk)' : 'var(--faint)'} strokeWidth="1.5" strokeDasharray={b.earned ? undefined : '3 4'} />}
      <circle
        cx="36"
        cy="36"
        r="30"
        fill={b.earned ? color : 'none'}
        fillOpacity={b.earned ? 0.18 : 0}
        stroke={b.earned ? color : 'var(--faint)'}
        strokeWidth="3"
        strokeDasharray={b.earned ? undefined : '5 5'}
      />
      <text x="36" y="37" textAnchor="middle" dominantBaseline="central" fontSize={size} fontWeight="700" fontFamily="var(--display)" fill={b.earned ? 'var(--chalk)' : 'var(--faint)'}>
        {b.glyph}
      </text>
    </svg>
  );
}

function ClaimBox({ items, onClaim }: { items: RewardItem[]; onClaim: (item: RewardItem, log: boolean) => void }) {
  const [sel, setSel] = useState(items[0]?.id ?? '');
  const [log, setLog] = useState(true);
  if (items.length === 0) return <p className="note">Nothing on the menu for this tier yet. Add a treat in the reward menu below.</p>;
  const item = items.find((i) => i.id === sel) ?? items[0];
  return (
    <div className="claimbox">
      <div className="chips" role="radiogroup" aria-label="Pick your treat">
        {items.map((i) => (
          <button type="button" key={i.id} role="radio" aria-checked={item.id === i.id} onClick={() => setSel(i.id)}>
            {i.name}
            <small>{i.cost > 0 ? naira(i.cost) : 'Free'}</small>
          </button>
        ))}
      </div>
      {item.cost > 0 && (
        <label className="check">
          <input type="checkbox" checked={log} onChange={(e) => setLog(e.target.checked)} />
          <span>Log {naira(item.cost)} as spending in Money (Rewards)</span>
        </label>
      )}
      <button className="btn primary" onClick={() => onClaim(item, log)}>
        Claim {item.name}
      </button>
    </div>
  );
}

export function Rewards() {
  const { data, dispatch } = useStore();
  const today = todayKey();
  const states = useMemo(() => evaluateBadges(data, today), [data, today]);
  const lm = useMemo(() => landmarksFor(data, today, states), [data, today, states]);
  const earned = states.filter((b) => b.earned);
  const monthPrefix = today.slice(0, 7);
  const spentThisMonth = data.rewards.claims.filter((c) => c.date.startsWith(monthPrefix)).reduce((n, c) => n + c.cost, 0);

  const claim = (tier: Tier, period: string, item: RewardItem, log: boolean) =>
    dispatch({ t: 'claim-add', claim: { id: newId(), tier, period, itemId: item.id, name: item.name, cost: item.cost, date: today, logged: log && item.cost > 0 } });

  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [tier, setTier] = useState<Tier>('week');
  const addItem = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    dispatch({ t: 'item-add', item: { id: newId(), name: name.trim(), cost: Number(cost) || 0, tier } });
    setName('');
    setCost('');
  };

  const history = [...data.rewards.claims].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Rewards</h1>
        <p className="sub">Earn treats by showing up. Every reward needs a savings transfer in its period, even a small one, so the treats never come at the cost of your safety net.</p>
      </header>

      <section className="panel">
        <dl className="stats compact">
          <div>
            <dt>Badges earned</dt>
            <dd>
              {earned.length}
              <small>of {states.length}</small>
            </dd>
          </div>
          <div>
            <dt>Landmarks ready</dt>
            <dd>{lm.ready.length}</dd>
          </div>
          <div>
            <dt>Treats this month</dt>
            <dd className="money-num">{naira(spentThisMonth)}</dd>
          </div>
        </dl>
      </section>

      <div className="tiers">
        {PERIOD_TIERS.map((t) => {
          const { current, previous } = periodsFor(data, t, today);
          const waiting = previous.unlocked && !previous.claim;
          return (
            <section key={t} className="panel tier">
              <div className="tier-head">
                <h2>{TIER_LABEL[t]}</h2>
                <span className={`pill ${current.claim ? 'claimed' : current.unlocked ? 'ready' : ''}`}>{current.claim ? 'Claimed' : current.unlocked ? 'Unlocked' : 'In progress'}</span>
              </div>
              <p className="note first">{TIER_BLURB[t]}</p>
              <PeriodBody p={current} items={itemsFor(data, t)} onClaim={(item, log) => claim(t, current.start, item, log)} onUndo={(id) => dispatch({ t: 'claim-del', id })} />
              {waiting && (
                <div className="callout" key={previous.start}>
                  <p>
                    <b>Still waiting:</b> {previous.label} is unlocked and unclaimed.
                  </p>
                  <ClaimBox items={itemsFor(data, t)} onClaim={(item, log) => claim(t, previous.start, item, log)} />
                </div>
              )}
            </section>
          );
        })}

        <section className="panel tier">
          <div className="tier-head">
            <h2>{TIER_LABEL.landmark}</h2>
            <span className={`pill ${lm.ready.length ? 'ready' : ''}`}>{lm.ready.length ? `${lm.ready.length} ready` : 'In progress'}</span>
          </div>
          <p className="note first">{TIER_BLURB.landmark}</p>
          {lm.ready.length === 0 && lm.next && (
            <div className="next-lm">
              <b>Next: {lm.next.name}</b>
              <span>{lm.next.progress}</span>
              <div className="meter-bar" role="progressbar" aria-label={`Progress toward ${lm.next.name}`} aria-valuenow={Math.round(lm.next.ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${lm.next.ratio * 100}%` }} />
              </div>
            </div>
          )}
          {lm.ready.length === 0 && !lm.next && <p className="ok">Every landmark is earned and claimed.</p>}
          {lm.ready.map((b) => (
            <div className="callout" key={b.id}>
              <p>
                <b>{b.name}</b>
                {b.on ? `, earned ${fmtShort(b.on)}` : ''}
              </p>
              {lm.savedRecently ? (
                <ClaimBox items={itemsFor(data, 'landmark')} onClaim={(item, log) => claim('landmark', b.id, item, log)} />
              ) : (
                <p className="note">Locked until you move money into savings. A transfer in the last four weeks unlocks it.</p>
              )}
            </div>
          ))}
        </section>
      </div>

      <section className="panel">
        <h2>Badges</h2>
        {(['streak', 'milestone'] as const).map((g) => (
          <div key={g}>
            <h3 className="group-title">{g === 'streak' ? 'Streaks' : 'Milestones'}</h3>
            <ul className="medals">
              {states
                .filter((b) => b.group === g)
                .map((b) => (
                  <li key={b.id} className={`medal ${b.earned ? 'earned' : 'locked'}`}>
                    <Medal b={b} />
                    <b>{b.name}</b>
                    <span className="desc">{b.desc}</span>
                    {b.earned ? (
                      <span className="when">
                        {b.on ? `Earned ${fmtShort(b.on)}` : 'Earned'}
                        {b.isNew && <i className="pill ready">New</i>}
                      </span>
                    ) : (
                      <span className="when">
                        {b.progress}
                        <span className="meter-bar mini" aria-hidden="true">
                          <i style={{ width: `${b.ratio * 100}%` }} />
                        </span>
                      </span>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Claim history</h2>
        {history.length === 0 ? (
          <p className="empty">No treats claimed yet. They show up here once you pick one.</p>
        ) : (
          <ul className="txns">
            {history.map((c) => (
              <li key={c.id} className="txn learning">
                <span className="txn-date">{fmtShort(c.date)}</span>
                <span className="txn-main">
                  <b>{c.name}</b>
                  <span>
                    {TIER_LABEL[c.tier]}
                    {c.logged ? ', logged in Money' : ''}
                  </span>
                </span>
                <span className="txn-amt">{c.cost > 0 ? naira(c.cost) : 'Free'}</span>
                <button className="btn ghost" aria-label={`Remove claim ${c.name} from ${fmtShort(c.date)}`} onClick={() => dispatch({ t: 'claim-del', id: c.id })}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <details className="menu">
          <summary>
            <h2>Reward menu</h2>
            <span className="note">Edit what you can pick from</span>
          </summary>
          {ALL_TIERS.map((t) => (
            <div key={t} className="menu-tier">
              <h3 className="group-title">{TIER_LABEL[t]}</h3>
              {itemsFor(data, t).length === 0 ? (
                <p className="empty">Nothing here yet.</p>
              ) : (
                <ul className="menu-items">
                  {itemsFor(data, t).map((i) => (
                    <li key={i.id}>
                      <span>
                        {i.name} <small>{i.cost > 0 ? naira(i.cost) : 'Free'}</small>
                      </span>
                      <button className="btn ghost" aria-label={`Remove ${i.name} from the menu`} onClick={() => dispatch({ t: 'item-del', id: i.id })}>
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <form className="add-item" onSubmit={addItem}>
            <label className="field">
              <span>New treat</span>
              <input value={name} placeholder="e.g. Smoothie" onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>Cost (₦, 0 if free)</span>
              <input inputMode="numeric" value={cost} placeholder="0" onChange={(e) => setCost(e.target.value.replace(/\D/g, '').slice(0, 7))} />
            </label>
            <label className="field">
              <span>Tier</span>
              <select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
                {ALL_TIERS.map((t) => (
                  <option key={t} value={t}>
                    {TIER_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn primary" type="submit" disabled={!name.trim()}>
              Add to menu
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}

function PeriodBody({ p, items, onClaim, onUndo }: { p: Period; items: RewardItem[]; onClaim: (item: RewardItem, log: boolean) => void; onUndo: (id: string) => void }) {
  return (
    <div>
      <p className="period">{p.label}</p>
      <ul className="reqs">
        {p.reqs.map((r) => (
          <li key={r.label} className={r.value >= r.target ? 'met' : ''}>
            <div className="meter-top">
              <span>{r.label}</span>
              <b>
                {r.value} of {r.target}
              </b>
            </div>
            <div className="meter-bar" role="progressbar" aria-label={`${p.label}: ${r.label}`} aria-valuenow={r.value} aria-valuemin={0} aria-valuemax={r.target}>
              <i style={{ width: `${Math.min(100, (r.value / r.target) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {p.claim ? (
        <div className="claimed-row">
          <p className="ok">
            Claimed: {p.claim.name}
            {p.claim.cost > 0 ? `, ${naira(p.claim.cost)}` : ''}.
          </p>
          <button className="btn ghost" onClick={() => onUndo(p.claim!.id)}>
            Undo
          </button>
        </div>
      ) : p.unlocked ? (
        <ClaimBox key={p.start} items={items} onClaim={onClaim} />
      ) : (
        <p className="note">
          {listOf(p.reqs.filter((r) => r.value < r.target).map((r) => r.label.toLowerCase()))} still to go.
        </p>
      )}
    </div>
  );
}
