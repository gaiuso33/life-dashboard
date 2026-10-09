import { lastSession, plannedFor, readyForMoreLoad, sessionProgress } from '../derive';
import type { TrainView } from '../nav';
import { MOBILITY, WEEKDAY_SHORT, dayDef, getProgram } from '../program';
import type { DayKey, ExerciseDef } from '../program';
import { useStore } from '../store';
import type { Session } from '../types';
import { fmtShort, todayKey, weekdayName } from '../utils';


export function Train({ view, setView }: { view: TrainView; setView: (v: TrainView) => void }) {
  const today = todayKey();
  const planned = plannedFor(today);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Train</h1>
        <p className="sub">Log reps for each set and the load you used. Hit the top of the range on every set and the app tells you to add weight.</p>
      </header>

      <div className="tabs" role="tablist" aria-label="Session">
        {getProgram().map((d) => (
          <button key={d.key} role="tab" aria-selected={view === d.key} onClick={() => setView(d.key)}>
            {d.title}
            <small>
              {WEEKDAY_SHORT[d.weekday]}
              {planned === d.key ? ', today' : ''}
            </small>
          </button>
        ))}
        <button role="tab" aria-selected={view === 'mobility'} onClick={() => setView('mobility')}>
          Mobility
          <small>Rest days</small>
        </button>
      </div>

      {view === 'mobility' ? <Mobility /> : <SessionView key={view} day={view} />}
    </div>
  );
}

function SessionView({ day }: { day: DayKey }) {
  const { data, dispatch } = useStore();
  const date = todayKey();
  const def = dayDef(day);
  const session = data.sessions[`${date}|${day}`];
  const last = lastSession(data, day, date);
  const prog = sessionProgress(session, day);
  const offDay = plannedFor(date) !== day;

  return (
    <section>
      <div className="session-head panel">
        <div>
          <h2>{def.title} day</h2>
          <p className="sub">{def.focus}</p>
          <p className="sub faint">
            {last ? `Last time: ${weekdayName(last.date)} ${fmtShort(last.date)}.` : 'No finished session yet.'}
            {offDay ? ` Today isn’t a ${def.title.toLowerCase()} day, but you can still log it.` : ''}
          </p>
        </div>
        <div className="session-prog">
          <b>
            {prog.done}
            <small> of {prog.total} sets</small>
          </b>
          <div className="meter-bar" role="progressbar" aria-label="Sets logged" aria-valuenow={prog.done} aria-valuemin={0} aria-valuemax={prog.total}>
            <i style={{ width: `${(prog.done / prog.total) * 100}%` }} />
          </div>
        </div>
      </div>

      <ul className="exercises">
        {def.exercises.map((ex) => (
          <Exercise key={ex.id} ex={ex} day={day} date={date} session={session} last={last} />
        ))}
      </ul>

      <div className="finish">
        <button className={session?.finished ? 'btn' : 'btn primary'} onClick={() => dispatch({ t: 'finish', date, day, finished: !session?.finished })}>
          {session?.finished ? 'Reopen session' : 'Finish session'}
        </button>
        {session?.finished && <span className="ok">Session finished. Your training plate is loaded.</span>}
      </div>
    </section>
  );
}

function Exercise({ ex, day, date, session, last }: { ex: ExerciseDef; day: DayKey; date: string; session?: Session; last?: Session }) {
  const { dispatch } = useStore();
  const reps = session?.reps[ex.id] ?? [];
  const lastReps = last?.reps[ex.id];
  const ready = readyForMoreLoad(ex, last);
  const unit = ex.unit === 'sec' ? 'sec' : 'reps';
  const untouched = reps.every((r) => r == null);

  return (
    <li className="exercise panel">
      <div className="ex-head">
        <h3>{ex.name}</h3>
        <span className="target">
          {ex.sets} × {ex.min}–{ex.max} {unit}
          {ex.perSide ? ' per side' : ''}
        </span>
      </div>
      {ex.note && <p className="note">{ex.note}</p>}
      {ready && (
        <p className="flag" role="note">
          You hit {ex.max} on every set last time. Add load today.
        </p>
      )}

      <div className="sets">
        {Array.from({ length: ex.sets }).map((_, i) => {
          const v = reps[i];
          return (
            <label key={i} className={v != null && v >= ex.max ? 'set top' : 'set'}>
              <span>Set {i + 1}</span>
              <input
                inputMode="numeric"
                pattern="[0-9]*"
                value={v ?? ''}
                placeholder={lastReps?.[i] != null ? String(lastReps[i]) : String(ex.min)}
                aria-label={`${ex.name}, set ${i + 1}, ${unit}`}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, '').slice(0, 3);
                  dispatch({ t: 'reps', date, day, ex: ex.id, idx: i, sets: ex.sets, value: raw === '' ? null : Number(raw) });
                }}
              />
            </label>
          );
        })}
      </div>

      <div className="load-row">
        <label className="load">
          <span>Load</span>
          <input
            type="text"
            value={session?.loads[ex.id] ?? ''}
            placeholder={last?.loads[ex.id] || 'e.g. blue dumbbells, bar + 2 plates'}
            onChange={(e) => dispatch({ t: 'load-text', date, day, ex: ex.id, value: e.target.value })}
          />
        </label>
        {lastReps && untouched && (
          <button
            className="btn ghost"
            onClick={() => dispatch({ t: 'fillReps', date, day, ex: ex.id, reps: lastReps.slice(0, ex.sets), load: last?.loads[ex.id] })}
          >
            Copy last time
          </button>
        )}
      </div>
    </li>
  );
}

function Mobility() {
  const { data, dispatch } = useStore();
  const date = todayKey();
  const done = !!data.days[date]?.mobility;
  return (
    <section>
      <div className="session-head panel">
        <div>
          <h2>Mobility routine</h2>
          <p className="sub">About 12 minutes on rest days. The steps marked warm-up make a 5-minute version before lifting. Go gently and stop if anything hurts.</p>
        </div>
        <button className={done ? 'btn' : 'btn primary'} aria-pressed={done} onClick={() => dispatch({ t: 'day', date, patch: { mobility: !done } })}>
          {done ? 'Done today' : 'Mark done'}
        </button>
      </div>
      <ol className="exercises">
        {MOBILITY.map((s) => (
          <li key={s.id} className="exercise panel">
            <div className="ex-head">
              <h3>{s.name}</h3>
              <span className="target">{s.dose}</span>
            </div>
            <p className="note">{s.cue}</p>
            {s.warmup && <p className="tagline">Also in your pre-lift warm-up</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}
