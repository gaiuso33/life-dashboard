import { Barbell } from '../Barbell';
import { ITEMS, dayScore, dayStatus, dayStreak, nextSession, plannedFor, sessionProgress, sessionsInWeek, strongDaysInWeek, weekStreak } from '../derive';
import type { ItemKey } from '../derive';
import type { Tab, TrainView } from '../nav';
import { dayDef } from '../program';
import { useStore } from '../store';
import type { DayLog } from '../types';
import { WEEKDAYS } from '../dates';
import { addDays, fmtLong, mondayOf, todayKey, weekdayName } from '../utils';

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
  const strongDays = strongDaysInWeek(data, monday, today);
  const patch = (p: Partial<DayLog>) => dispatch({ t: 'day', date: today, patch: p });

  const streak = dayStreak(data, today);
  const wStreak = weekStreak(data, today);

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
            <Row k="code" title="Build a project" detail="Commit, ship or study something for your portfolio." done={!!log.code}>
              <button className="btn" aria-pressed={!!log.code} onClick={() => patch({ code: !log.code })}>
                {log.code ? 'Done' : 'Mark done'}
              </button>
            </Row>
            <Row k="money" title="Log today’s spending" detail="Even a rough total counts." done={!!log.money}>
              <button className="btn" aria-pressed={!!log.money} onClick={() => patch({ money: !log.money })}>
                {log.money ? 'Done' : 'Mark done'}
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
            <Meter label="Sessions" value={sessionsThisWeek} max={3} />
            <Meter label="Strong days" value={strongDays} max={5} />
            <p className="note">Earn a small treat when both bars fill. A reward only unlocks if that week’s savings transfer is logged too, which arrives with the Money screen.</p>
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
