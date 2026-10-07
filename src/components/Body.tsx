import { useState } from 'react';
import { BarChart, LineChart } from '../Charts';
import type { Bar, Series } from '../Charts';
import { suggestedGoal, suggestedPace, weeklyRepTotals, weightTrend } from '../derive';
import { MEASURES } from '../program';
import { useStore } from '../store';
import type { MeasureKey } from '../types';
import { dayNumber, fmtShort, round1, todayKey } from '../utils';

export function Body() {
  const { data, dispatch } = useStore();
  const today = todayKey();
  const entries = data.body;
  const latest = entries[entries.length - 1];
  const first = entries[0];

  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState('');
  const [m, setM] = useState<Partial<Record<MeasureKey, string>>>({});
  const [goalText, setGoalText] = useState('');
  const [saved, setSaved] = useState(false);

  const trend = weightTrend(entries);
  const pace = latest ? suggestedPace(latest.weight) : null;
  const goal = data.goalWeight;
  const proposed = latest ? suggestedGoal(latest.weight) : null;

  const save = () => {
    const w = parseFloat(weight);
    if (!Number.isFinite(w) || w <= 0) return;
    const measures: Partial<Record<MeasureKey, number>> = {};
    for (const { key } of MEASURES) {
      const v = parseFloat(m[key] ?? '');
      if (Number.isFinite(v) && v > 0) measures[key] = v;
    }
    dispatch({ t: 'body', entry: { date, weight: w, m: measures } });
    setWeight('');
    setM({});
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  };

  const weightSeries: Series[] = [{ name: 'Weigh-in', pts: entries.map((e) => ({ x: dayNumber(e.date), y: e.weight })), color: 'var(--plate-blue)', dots: true }];
  if (trend) weightSeries.push({ name: 'Trend', pts: entries.slice(-6).map((e) => ({ x: dayNumber(e.date), y: Math.round(trend.fitAt(e.date) * 100) / 100 })), color: 'var(--plate-yellow)', dashed: true });

  const weeks = weeklyRepTotals(data, today, 8);
  const bars: Bar[] = weeks.map((w) => ({ label: fmtShort(w.monday), value: w.reps, detail: `${w.sessions} of 3 sessions` }));

  let paceNote = '';
  if (trend && pace) {
    if (trend.slope < pace.low) paceNote = 'Below the usual lean-gain range. Keep logging; a few more weeks of data will show whether it’s a trend.';
    else if (trend.slope > pace.high) paceNote = 'Above the usual lean-gain range. Gaining faster than this tends to add more fat than muscle.';
    else paceNote = 'Inside the usual lean-gain range.';
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Body</h1>
        <p className="sub">Weigh in once a week, at the same time of day. Measurements are optional but make the trend easier to trust.</p>
      </header>

      <div className="cols">
        <section className="panel">
          <h2>Weekly weigh-in</h2>
          <div className="form">
            <label className="field">
              <span>Date</span>
              <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Weight (kg)</span>
              <input inputMode="decimal" value={weight} placeholder={latest ? String(latest.weight) : '70.0'} onChange={(e) => setWeight(e.target.value.replace(',', '.'))} />
            </label>
            <div className="measure-grid">
              {MEASURES.map(({ key, label }) => (
                <label key={key} className="field">
                  <span>{label} (cm)</span>
                  <input
                    inputMode="decimal"
                    value={m[key] ?? ''}
                    placeholder={latest?.m[key] != null ? String(latest.m[key]) : ''}
                    onChange={(e) => setM({ ...m, [key]: e.target.value.replace(',', '.') })}
                  />
                </label>
              ))}
            </div>
            <div className="finish">
              <button className="btn primary" onClick={save} disabled={!weight}>
                Save weigh-in
              </button>
              {saved && <span className="ok">Saved.</span>}
            </div>
          </div>
        </section>

        <div className="stack">
          <section className="panel">
            <h2>Where you stand</h2>
            {latest ? (
              <dl className="stats compact">
                <div>
                  <dt>Latest</dt>
                  <dd>
                    {latest.weight}
                    <small>kg</small>
                  </dd>
                </div>
                <div>
                  <dt>Since {fmtShort(first.date)}</dt>
                  <dd>
                    {round1(latest.weight - first.weight) >= 0 ? '+' : ''}
                    {round1(latest.weight - first.weight)}
                    <small>kg</small>
                  </dd>
                </div>
                <div>
                  <dt>Trend</dt>
                  <dd>
                    {trend ? `${trend.slope >= 0 ? '+' : ''}${round1(trend.slope * 100) / 100}` : '–'}
                    <small>kg/wk</small>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="empty">No weigh-ins yet. Save your first one to start the trend line.</p>
            )}
            {pace && <p className="note">Lean-gain pace for your weight: {round1(pace.low * 100) / 100} to {round1(pace.high * 100) / 100} kg per week. {paceNote}</p>}
          </section>

          <section className="panel">
            <h2>Weight goal</h2>
            {goal != null ? (
              <p>
                Target <b>{goal} kg</b>
                {latest ? `, ${round1(goal - latest.weight)} kg from now.` : '.'}
              </p>
            ) : proposed != null ? (
              <p>
                A realistic 12-week target from your latest weigh-in is <b>{proposed} kg</b>.
              </p>
            ) : (
              <p className="empty">Log a weigh-in and the app will propose a realistic target.</p>
            )}
            <div className="load-row">
              {goal == null && proposed != null && (
                <button className="btn primary" onClick={() => dispatch({ t: 'goal', value: proposed })}>
                  Use {proposed} kg
                </button>
              )}
              <label className="load">
                <span>Set your own (kg)</span>
                <input inputMode="decimal" value={goalText} placeholder={goal != null ? String(goal) : ''} onChange={(e) => setGoalText(e.target.value.replace(',', '.'))} />
              </label>
              <button
                className="btn"
                disabled={!Number.isFinite(parseFloat(goalText))}
                onClick={() => {
                  dispatch({ t: 'goal', value: parseFloat(goalText) });
                  setGoalText('');
                }}
              >
                Set
              </button>
              {goal != null && (
                <button className="btn ghost" onClick={() => dispatch({ t: 'goal', value: null })}>
                  Clear
                </button>
              )}
            </div>
          </section>
        </div>
      </div>

      <section className="panel">
        <h2>Bodyweight</h2>
        {entries.length >= 2 ? (
          <LineChart series={weightSeries} goal={goal} unit="kg" label="Bodyweight over time in kilograms with a trend line" />
        ) : (
          <p className="empty">Two weigh-ins are enough to draw the line.</p>
        )}
      </section>

      <section className="panel">
        <h2>Total reps per week</h2>
        <BarChart bars={bars} color="var(--plate-red)" unit="reps" label="Total reps logged per week over the last eight weeks" />
      </section>

      {latest && (
        <section className="panel">
          <h2>Measurements</h2>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Site</th>
                <th scope="col">Latest</th>
                <th scope="col">Change</th>
              </tr>
            </thead>
            <tbody>
              {MEASURES.filter(({ key }) => latest.m[key] != null).map(({ key, label }) => {
                const start = entries.find((e) => e.m[key] != null)!.m[key]!;
                const diff = round1(latest.m[key]! - start);
                return (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    <td>{latest.m[key]} cm</td>
                    <td>
                      {diff >= 0 ? '+' : ''}
                      {diff} cm
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
