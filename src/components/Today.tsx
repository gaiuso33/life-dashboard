import { Barbell } from '../Barbell';
import { ITEMS, dayScore, dayStatus, dayStreak, nextSession, plannedFor, sessionProgress, sessionsInWeek, weekStreak } from '../derive';
import type { ItemKey } from '../derive';
import type { Tab, TrainView } from '../nav';
import { dayDef } from '../program';
import { useStore } from '../store';
import type { DayLog } from '../types';
import { WEEKDAYS } from '../dates';
import { commitsOn } from '../career';
import { CATALOG } from '../badges';
import { naira, txnsOn } from '../money';
import { periodsFor } from '../rewards';
import { dailyNudges } from '../coach';
import { addDays, fmtLong, fmtShort, mondayOf, todayKey, weekdayName } from '../utils';

const colorOf = (k: ItemKey) => ITEMS.find((i) => i.key === k)!.color;

function Row({ k, title, detail, done, children }: { k: ItemKey; title: string; detail: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className={done ? 'row is-done' : 'row'}>
      <span className="chip" style={{ background: colorOf(k) }} aria-hidden="true" />
      <div className="row-text">
        <b>{title}</b>
        <span>{detail}</span>
      </div>
      <div className="row-action">{children}</div>
    </li>
  );
}

export function Today({ go }: { go: (t: Tab, v?: TrainView) => void }) {
  const { data, dispatch } = useStore();
  const today = todayKey();
  const log = data.days[today] ?? {};
  const status = dayStatus(data, today);
  const score = dayScore(data, today);
  const planned = plannedFor(today);
  const upcoming = nextSession(addDays(today, 1));
  const session = planned ? data.sessions[`${today}|${planned}`] : undefined;
  const prog = planned ? sessionProgress(session, planned) : null;
  const monday = mondayOf(today);
  const sessionsThisWeek = sessionsInWeek(data, monday);
  const patch = (p: Partial<DayLog>) => dispatch({ t: 'day', date: today, patch: p });

  const spentToday = txnsOn(data, today).filter((t) => t.kind === 'expense');
  const spentTotal = spentToday.reduce((n, t) => n + t.amount, 0);
  const wk = periodsFor(data, 'week', today);
  const latestBadge = Object.entries(data.rewards.badges).sort((a, b) => b[1].localeCompare(a[1]))[0];
  const latestDef = latestBadge ? CATALOG.find((b) => b.id === latestBadge[0]) : undefined;
  const commitsToday = commitsOn(data.career, today);
  const streak = dayStreak(data, today);
  const wStreak = weekStreak(data, today);
  const extras = dailyNudges(data, today).filter((n) => n.kind === 'extra').slice(0, 2);

  return (
    <div className="page">
      <header className="page-head">
        <h1>{fmtLong(today)}</h1>
        <p className="sub">{score === 4 ? 'All four plates are on the bar.' : `${score} of 4 plates loaded. Three or more counts as a strong day.`}</p>
      </header>

      <section className="hero panel">
        <Barbell status={status} />
        <dl className="stats">
          <div>
            <dt>Strong-day streak</dt>
            <dd>
              {streak}
              <small>{streak === 1 ? 'day' : 'days'}</small>
            </dd>
          </div>
          <div>
            <dt>Full training weeks in a row</dt>
            <dd>
              {wStreak}
              <small>{wStreak === 1 ? 'week' : 'weeks'}</small>
            </dd>
          </div>
          <div>
            <dt>Sessions this week</dt>
            <dd>
              {sessionsThisWeek}
              <small>of 3</small>
            </dd>
          </div>
        </dl>
      </section>

      <div className="cols">
        <section className="panel">
          <h2>Today’s plates</h2>
          <ul className="rows">
            {planned ? (
              <Row
                k="training"
                title={`${dayDef(planned).title} session`}
                detail={session?.finished ? 'Finished' : `${prog!.done} of ${prog!.total} sets logged`}
                done={status.training}
              >
                <button className="btn" onClick={() => go('train', planned)}>
                  {session?.finished ? 'Review' : 'Open session'}
                </button>
              </Row>
            ) : (
              <Row
                k="training"
                title="Rest day mobility"
                detail={`About 12 minutes. Next session: ${dayDef(upcoming.day).title} on ${weekdayName(upcoming.date)}.`}
                done={!!log.mobility}
              >
                <button className="btn ghost" onClick={() => go('train', 'mobility')}>
                  See routine
                </button>
                <button className="btn" aria-pressed={!!log.mobility} onClick={() => patch({ mobility: !log.mobility })}>
                  {log.mobility ? 'Done' : 'Mark done'}
                </button>
              </Row>
            )}
            <Row
              k="code"
              title="Build a project"
              detail={commitsToday > 0 ? `${commitsToday} ${commitsToday === 1 ? 'commit' : 'commits'} from GitHub today.` : 'Commit, ship or study something for your portfolio.'}
              done={status.code}
            >
              {commitsToday === 0 && (
                <button className="btn" aria-pressed={!!log.code} onClick={() => patch({ code: !log.code })}>
                  {log.code ? 'Done' : 'Mark done'}
                </button>
              )}
              <button className="btn ghost" onClick={() => go('career')}>
                Career
              </button>
            </Row>
            <Row
              k="money"
              title="Log today’s spending"
              detail={spentToday.length ? `${naira(spentTotal)} across ${spentToday.length} ${spentToday.length === 1 ? 'entry' : 'entries'}.` : log.money ? 'Marked as no spending today.' : 'Even a rough total counts.'}
              done={status.money}
            >
              {!spentToday.length && (
                <button className="btn ghost" aria-pressed={!!log.money} onClick={() => patch({ money: !log.money })}>
                  {log.money ? 'Undo' : 'Spent nothing'}
                </button>
              )}
              <button className="btn" onClick={() => go('money')}>
                {spentToday.length ? 'Add more' : 'Log spending'}
              </button>
            </Row>
            <Row k="checkin" title="Energy check-in" detail={log.energy != null ? `You logged ${log.energy} of 5.` : 'How do you feel today? 1 is drained, 5 is great.'} done={log.energy != null}>
              <div className="scale" role="group" aria-label="Energy, 1 to 5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} aria-pressed={log.energy === n} onClick={() => patch({ energy: log.energy === n ? undefined : n })}>
                    {n}
                  </button>
                ))}
              </div>
            </Row>
          </ul>
        </section>

        <div className="stack">
          {extras.length > 0 && (
            <section className="panel">
              <h2>Coach</h2>
              <ul className="nudges">
                {extras.map((n) => (
                  <li key={n.id}>
                    <span>{n.text}</span>
                  </li>
                ))}
              </ul>
              <button className="btn ghost" onClick={() => go('advisor')}>
                Open advisor
              </button>
            </section>
          )}
          <section className="panel">
            <h2>This week</h2>
            <ol className="week">
              {WEEKDAYS.map((label, i) => {
                const date = addDays(monday, i);
                const st = dayStatus(data, date);
                const future = date > today;
                return (
                  <li key={date} className={`${date === today ? 'is-today' : ''} ${future ? 'is-future' : ''}`} aria-label={`${label}: ${dayScore(data, date)} of 4 plates`}>
                    <span className="wd">{label}</span>
                    <span className="dots">
                      {ITEMS.map((it) => (
                        <i key={it.key} className={st[it.key] ? 'on' : ''} style={{ ['--c' as string]: it.color }} />
                      ))}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="panel">
            <h2>Weekly reward</h2>
            {wk.current.reqs.map((r) => (
              <Meter key={r.label} label={r.label} value={r.value} max={r.target} />
            ))}
            {wk.current.claim ? (
              <p className="ok">Claimed this week: {wk.current.claim.name}.</p>
            ) : wk.current.unlocked ? (
              <p className="ok">Unlocked. Pick this week’s treat.</p>
            ) : (
              <p className="note">Earn a small treat when all three bars fill. A reward only unlocks if that week’s savings transfer is logged.</p>
            )}
            {wk.previous.unlocked && !wk.previous.claim && <p className="ok">Last week’s treat is still waiting.</p>}
            <div className="row-action reward-actions">
              {((wk.current.unlocked && !wk.current.claim) || (wk.previous.unlocked && !wk.previous.claim)) && (
                <button className="btn primary" onClick={() => go('rewards')}>
                  Choose a treat
                </button>
              )}
              <button className="btn ghost" onClick={() => go('rewards')}>
                All rewards and badges
              </button>
            </div>
            {latestDef && latestBadge && (
              <p className="note">
                Latest badge: {latestDef.name}, {fmtShort(latestBadge[1])}.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Meter({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="meter">
      <div className="meter-top">
        <span>{label}</span>
        <b>
          {value} of {max}
        </b>
      </div>
      <div className="meter-bar" role="progressbar" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
