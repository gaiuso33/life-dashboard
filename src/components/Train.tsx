import { useEffect, useState } from 'react';
import { AiError, askAi, loadKey, providerOf } from '../ai';
import { isDemo } from '../demo';
import { EQUIPMENT, EXPERIENCE, GOALS, PLAN_SYSTEM, PlanError, buildPlanOffline, parseAiPlan, planPrompt } from '../planBuilder';
import type { Equipment, Experience, Goal, PlanRequest } from '../planBuilder';
import { READY_PROGRAMS, matchProgram } from '../programs';
import { lastSession, plannedFor, readyForMoreLoad, sessionProgress } from '../derive';
import type { TrainView } from '../nav';
import { MOBILITY, WEEKDAY_SHORT, dayDef, getProgram } from '../program';
import type { DayDef, DayKey, ExerciseDef } from '../program';
import { useStore } from '../store';
import type { Session } from '../types';
import { MAX_LOAD_KG, fmtWeight, loadStep, loadText, nextLoadKg, parseLoad, toDisplay, weightUnit } from '../units';
import { fmtShort, todayKey, weekdayName } from '../utils';


export function Train({ view, setView, openSettings }: { view: TrainView; setView: (v: TrainView) => void; openSettings?: () => void }) {
  const { data } = useStore();
  const [picking, setPicking] = useState(false);
  const today = todayKey();
  const planned = plannedFor(today);
  if (view !== 'mobility' && !getProgram().some((d) => d.key === view)) view = getProgram()[0].key;
  return (
    <div className="page">
      <header className="page-head">
        <h1>Train</h1>
        <p className="sub">Log reps for each set. Weight is optional.</p>
      </header>

      <div className="program-line">
        <span>
          Program: <b>{matchProgram(getProgram())?.name ?? 'My own program'}</b>
          <small> · {getProgram().length} sessions a week</small>
        </span>
        <button className="btn" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
          Change program
        </button>
      </div>
      {picking && <ProgramPicker custom={data.program != null} onDone={() => { setPicking(false); setView(getProgram()[0].key); }} openSettings={openSettings} />}

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
  const timed = ex.unit === 'sec';
  const lastKg = last?.kg?.[ex.id];
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
          You hit {ex.max} on every set last time.{' '}
          {lastKg != null && !timed
            ? `Add load today: try ${toDisplay(nextLoadKg(lastKg))} ${weightUnit()} (last time ${toDisplay(lastKg)} ${weightUnit()}).`
            : `Add load today, in steps of ${loadStep()} ${weightUnit()}.`}
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
        {!timed && <LoadKg exName={ex.name} kg={session?.kg?.[ex.id]} lastKg={lastKg} onChange={(kg) => dispatch({ t: 'load-kg', date, day, ex: ex.id, kg })} />}
        <label className="load">
          <span>Load note</span>
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
            onClick={() => dispatch({ t: 'fillReps', date, day, ex: ex.id, reps: lastReps.slice(0, ex.sets), load: last?.loads[ex.id], kg: lastKg })}
          >
            Copy last time
          </button>
        )}
      </div>
    </li>
  );
}

/**
 * The optional weight for one exercise, typed in the unit shown and kept in kilograms. What is being typed is held here, so
 * "22." or "2" on the way to "22.5" is never rewritten under the cursor.
 */
function LoadKg({ exName, kg, lastKg, onChange }: { exName: string; kg?: number; lastKg?: number; onChange: (kg: number | null) => void }) {
  const unit = weightUnit();
  const [draft, setDraft] = useState(kg != null ? loadText(kg) : '');
  useEffect(() => {
    // Changed from outside (Copy last time, another device, the unit switched): show it.
    if ((parseLoad(draft) ?? null) !== (kg ?? null)) setDraft(kg != null ? loadText(kg) : '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kg, unit]);
  const bad = draft.trim() !== '' && parseLoad(draft) == null;
  return (
    <label className="load load-kg">
      <span>Weight ({unit})</span>
      <input
        type="text"
        inputMode="decimal"
        value={draft}
        placeholder={lastKg != null ? loadText(lastKg) : 'optional'}
        aria-label={`${exName}, weight in ${unit}`}
        aria-invalid={bad || undefined}
        aria-describedby={bad ? `${exName}-load-err`.replace(/\W/g, '-') : undefined}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d.,]/g, '').slice(0, 7);
          setDraft(t);
          onChange(parseLoad(t));
        }}
      />
      {bad && (
        <small id={`${exName}-load-err`.replace(/\W/g, '-')} className="field-err">
          Enter a weight between 0 and {toDisplay(MAX_LOAD_KG)} {unit}.
        </small>
      )}
    </label>
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

function ProgramPicker({ onDone, openSettings, custom }: { onDone: () => void; openSettings?: () => void; custom: boolean }) {
  const { dispatch } = useStore();
  const active = matchProgram(getProgram());
  const [building, setBuilding] = useState(false);
  if (building) return <PlanBuilder onDone={onDone} onBack={() => setBuilding(false)} openSettings={openSettings} />;
  return (
    <section className="panel picker" aria-label="Choose a program">
      <h2>Choose a program</h2>
      <div className="coach-offer">
        <div>
          <b>Have the coach build one for you</b>
          <p>Tell it your goal, days a week and equipment, and it makes a plan to fit.</p>
        </div>
        <button className="btn primary" onClick={() => setBuilding(true)}>
          Build my plan
        </button>
      </div>
      <p className="note first">Or pick a ready-made plan. Your logged sessions, reps and weights are kept; only what Train shows next changes.</p>
      <ul className="program-list">
        {READY_PROGRAMS.map((p) => (
          <li key={p.id} className={active?.id === p.id ? 'is-current' : ''}>
            <div>
              <b>{p.name}</b>
              <span className="tags">
                {p.days.length} days a week · {p.level} · {p.equipment}
              </span>
              <p>{p.blurb}</p>
              <small>{p.days.map((d) => `${d.title} ${WEEKDAY_SHORT[d.weekday]}`).join(' · ')}</small>
            </div>
            {active?.id === p.id ? (
              <span className="current-tag">In use</span>
            ) : (
              <button
                className="btn primary"
                aria-label={`Use ${p.name}`}
                onClick={() => {
                  dispatch({ t: 'program-set', program: p.id === 'ppl' ? undefined : p.days });
                  onDone();
                }}
              >
                Use this program
              </button>
            )}
          </li>
        ))}
      </ul>
      {openSettings && (
        <p className="note">
          {custom && !active ? 'You are using your own program. ' : ''}
          Want to build your own? <button className="link-btn" onClick={openSettings}>Edit sessions in Settings</button>.
        </p>
      )}
    </section>
  );
}

function PlanBuilder({ onDone, onBack, openSettings }: { onDone: () => void; onBack: () => void; openSettings?: () => void }) {
  const { data, dispatch } = useStore();
  const latest = data.body[data.body.length - 1];
  const [goal, setGoal] = useState<Goal>('muscle');
  const [days, setDays] = useState(3);
  const [equipment, setEquipment] = useState<Equipment>('full');
  const [experience, setExperience] = useState<Experience>('beginner');
  const [avoid, setAvoid] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ days: DayDef[]; by: 'ai' | 'rules'; req: PlanRequest } | null>(null);

  const { settings } = data.advisor;
  const provider = providerOf(settings.provider);
  const key = isDemo ? '' : loadKey(provider.id);

  const make = async (useAi: boolean) => {
    const req: PlanRequest = { goal, days, equipment, experience, avoid, ...(latest && { bodyKg: latest.weight }) };
    setNote(null);
    if (useAi && key) {
      setBusy(true);
      try {
        const text = await askAi({ provider: provider.id, apiKey: key, model: settings.model, system: PLAN_SYSTEM, messages: [{ role: 'user', content: planPrompt(req, weightUnit(), toDisplay) }], maxTokens: 1500 });
        setPlan({ days: parseAiPlan(text, req), by: 'ai', req });
      } catch (e) {
        setNote(`${e instanceof AiError || e instanceof PlanError ? e.message : 'Something went wrong.'} You can try again, or use the built-in rules.`);
      } finally {
        setBusy(false);
      }
      return;
    }
    setPlan({ days: buildPlanOffline(req), by: 'rules', req });
  };

  if (plan) {
    return (
      <section className="panel picker" aria-label="Review the plan">
        <h2>Review the plan</h2>
        <p className="note first">{plan.by === 'ai' ? `Made by the coach with your ${provider.name} key.` : 'Made by the built-in rules, so it works without internet or an AI key.'} Nothing changes until you use it.</p>
        <ul className="program-list">
          {plan.days.map((d) => (
            <li key={d.key}>
              <div>
                <b>
                  {d.title} · {WEEKDAY_SHORT[d.weekday]}
                </b>
                <span className="tags">{d.focus}</span>
                <small>{d.exercises.map((e) => `${e.name} ${e.sets}×${e.min}–${e.max}${e.unit === 'sec' ? 's' : ''}`).join(' · ')}</small>
              </div>
            </li>
          ))}
        </ul>
        <p className="note">This is general fitness guidance, not medical advice. If you have an injury or a health condition, check with a doctor or physio first, and stop anything that hurts.</p>
        <div className="row-action">
          <button
            className="btn primary"
            onClick={() => {
              dispatch({ t: 'program-set', program: plan.days });
              onDone();
            }}
          >
            Use this plan
          </button>
          {openSettings && (
            <button
              className="btn"
              onClick={() => {
                dispatch({ t: 'program-set', program: plan.days });
                openSettings();
              }}
            >
              Use it and edit
            </button>
          )}
          <button className="btn ghost" onClick={() => setPlan(null)}>
            Change answers
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel picker" aria-label="Build a plan">
      <h2>Coach builds a plan</h2>
      <p className="note first">Answer a few questions. Your logged sessions are always kept.</p>
      <div className="field">
        <span id="pb-goal">Main goal</span>
        <div className="chips" role="radiogroup" aria-labelledby="pb-goal">
          {GOALS.map((g) => (
            <button key={g.id} role="radio" aria-checked={goal === g.id} onClick={() => setGoal(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span id="pb-days">Days a week</span>
        <div className="chips" role="radiogroup" aria-labelledby="pb-days">
          {[2, 3, 4, 5, 6].map((n) => (
            <button key={n} role="radio" aria-checked={days === n} onClick={() => setDays(n)}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span id="pb-eq">Equipment</span>
        <div className="chips" role="radiogroup" aria-labelledby="pb-eq">
          {EQUIPMENT.map((g) => (
            <button key={g.id} role="radio" aria-checked={equipment === g.id} onClick={() => setEquipment(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span id="pb-exp">Experience</span>
        <div className="chips" role="radiogroup" aria-labelledby="pb-exp">
          {EXPERIENCE.map((g) => (
            <button key={g.id} role="radio" aria-checked={experience === g.id} onClick={() => setExperience(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
      </div>
      <p className="note">{latest ? `Your body data: ${fmtWeight(latest.weight)} from your last weigh-in on the Body screen.` : 'No weigh-in yet. Add one on the Body screen if you want the plan to take body mass into account.'}</p>
      <label className="field">
        <span>Movements to leave out (optional)</span>
        <input value={avoid} maxLength={120} placeholder="For example: squats, overhead press" onChange={(e) => setAvoid(e.target.value)} />
      </label>
      {note && <p className="err" role="alert">{note}</p>}
      <div className="row-action">
        {key ? (
          <button className="btn primary" disabled={busy} onClick={() => make(true)}>
            {busy ? 'Building…' : 'Build with my AI key'}
          </button>
        ) : null}
        <button className={key ? 'btn' : 'btn primary'} disabled={busy} onClick={() => make(false)}>
          {key ? 'Use built-in rules' : 'Build my plan'}
        </button>
        <button className="btn ghost" onClick={onBack}>
          Back
        </button>
      </div>
      {!key && <p className="note">No AI key is connected, so this uses the built-in rules. Connect one on the Advisor screen for a plan written to your answers.</p>}
    </section>
  );
}
