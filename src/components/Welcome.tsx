import { Account } from './Account';
import { useCloud } from '../cloud/CloudProvider';
import { useState } from 'react';
import { buildSampleData } from '../sample';
import { defaultAnswers, setupErrors } from '../setup';
import type { SetupAnswers } from '../setup';
import { useStore } from '../store';
import { parseImport } from '../sync';
import { DEFAULT_ITEMS } from '../types';
import { naira } from '../money';
import { addDays, todayKey } from '../utils';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SESSIONS = ['Push', 'Pull', 'Legs'];
const STEPS = ['Training', 'Body', 'Money', 'Career', 'Rewards'] as const;

const digits = (s: string) => s.replace(/[^\d]/g, '');
const decimal = (s: string) => s.replace(/[^\d.]/g, '');
const grouped = (s: string) => (s ? Number(s).toLocaleString('en-NG') : '');

export function Welcome() {
  const cloud = useCloud();
  const [showAccount, setShowAccount] = useState(!!cloud.resetToken);
  const { dispatch, importData } = useStore();
  const [step, setStep] = useState(-1); // -1 is the welcome screen
  const [a, setA] = useState<SetupAnswers>(defaultAnswers);
  const [raw, setRaw] = useState({ weight: '', goal: '', daily: '', opening: '', pct: '20', count: '5' });
  const [importError, setImportError] = useState('');
  const err = setupErrors(a);

  const set = (patch: Partial<SetupAnswers>) => setA((x) => ({ ...x, ...patch }));
  const num = (s: string) => (s === '' ? null : Number(s));
  const stepFields: Record<number, (keyof typeof err)[]> = {
    0: ['days'],
    1: ['weight', 'goalWeight'],
    2: ['dailyEstimate', 'savePct', 'survivalOpening'],
    3: ['goalCount', 'deadline', 'githubUser'],
    4: [],
  };
  const blocked = step >= 0 && stepFields[step].some((k) => err[k]);

  const pickFile = async (file: File | undefined) => {
    setImportError('');
    if (!file) return;
    const res = parseImport(await file.text());
    if (!res.ok) return setImportError(res.error);
    importData(res.data);
  };

  if (step === -1) {
    return (
      <div className="welcome">
        <div className="welcome-card panel">
          <div className="brand welcome-brand">
            <span className="brand-mark" aria-hidden="true" />
            Life Dashboard
          </div>
          <h1>Welcome</h1>
          <p className="sub">Training, money, career and daily habits in one place. Your data stays on this device unless you choose to sync it. Setup takes about two minutes and every answer can be changed later.</p>
          <div className="welcome-actions">
            <button className="btn primary" onClick={() => setStep(0)}>
              Set up my dashboard
            </button>
            <label className="btn file-btn">
              I already have a copy from another device
              <input type="file" accept="application/json,.json" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            {cloud.configured && !showAccount && (
              <button className="btn" onClick={() => setShowAccount(true)}>
                Sign in to my account
              </button>
            )}
            <button className="btn ghost" onClick={() => importData(buildSampleData())}>
              Look around with sample data first
            </button>
          </div>
          {showAccount && <Account />}
          {importError && <p className="err" role="alert">{importError}</p>}
        </div>
      </div>
    );
  }

  const last = step === STEPS.length - 1;
  return (
    <div className="welcome">
      <form
        className="welcome-card panel"
        onSubmit={(e) => {
          e.preventDefault();
          if (blocked) return;
          if (last) dispatch({ t: 'setup', answers: a });
          else setStep(step + 1);
        }}
      >
        <p className="note first" aria-live="polite">
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>
        <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1} aria-label="Setup progress">
          <i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>

        {step === 0 && (
          <>
            <h1>Your training week</h1>
            <p className="sub">Three sessions a week: push, pull and legs. Choose the days that suit you. You can change the exercises, sets and rep ranges in Settings.</p>
            <div className="grid3">
              {SESSIONS.map((s, i) => (
                <label key={s} className="field">
                  <span>{s} day</span>
                  <select
                    value={a.days[i]}
                    onChange={(e) => {
                      const days = [...a.days] as SetupAnswers['days'];
                      days[i] = Number(e.target.value);
                      set({ days });
                    }}
                  >
                    {WEEKDAYS.map((w) => (
                      <option key={w} value={w}>
                        {WEEKDAYS_LONG[w]}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {err.days && <p className="err" role="alert">{err.days}</p>}
            <p className="note">Other days are rest days with a short mobility routine.</p>
          </>
        )}

        {step === 1 && (
          <>
            <h1>Your starting point</h1>
            <p className="sub">Weigh-ins are weekly. A first weight lets the app suggest a realistic pace. Skip anything you don’t want to enter yet.</p>
            <div className="grid2">
              <label className="field">
                <span>Weight today (kg)</span>
                <input inputMode="decimal" value={raw.weight} placeholder="Optional" onChange={(e) => { const v = decimal(e.target.value); setRaw({ ...raw, weight: v }); set({ weight: num(v) }); }} />
                {err.weight && <small className="err">{err.weight}</small>}
              </label>
              <label className="field">
                <span>Goal weight (kg)</span>
                <input inputMode="decimal" value={raw.goal} placeholder="Optional" onChange={(e) => { const v = decimal(e.target.value); setRaw({ ...raw, goal: v }); set({ goalWeight: num(v) }); }} />
                {err.goalWeight && <small className="err">{err.goalWeight}</small>}
              </label>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h1>Money</h1>
            <p className="sub">Your first goal is a survival fund of six months of spending, then an investment fund. All amounts are in naira.</p>
            <div className="grid2">
              <label className="field">
                <span>Rough daily spending (₦)</span>
                <input inputMode="numeric" value={grouped(raw.daily)} placeholder="Optional" onChange={(e) => { const v = digits(e.target.value); setRaw({ ...raw, daily: v }); set({ dailyEstimate: num(v) }); }} />
                {err.dailyEstimate && <small className="err">{err.dailyEstimate}</small>}
              </label>
              <label className="field">
                <span>Already in your survival fund (₦)</span>
                <input inputMode="numeric" value={grouped(raw.opening)} placeholder="0" onChange={(e) => { const v = digits(e.target.value); setRaw({ ...raw, opening: v }); set({ survivalOpening: Number(v) || 0 }); }} />
                {err.survivalOpening && <small className="err">{err.survivalOpening}</small>}
              </label>
              <label className="field">
                <span>Share of each income to save (%)</span>
                <input inputMode="numeric" value={raw.pct} onChange={(e) => { const v = digits(e.target.value); setRaw({ ...raw, pct: v }); set({ savePct: Number(v) }); }} />
                {err.savePct && <small className="err">{err.savePct}</small>}
              </label>
            </div>
            <p className="note">Your rough daily spending is used until you have a month of logged spending. Income is irregular, so the app suggests a split each time you log some.</p>
          </>
        )}

        {step === 3 && (
          <>
            <h1>Career goal</h1>
            <p className="sub">Ship a set of portfolio projects by a deadline. GitHub commits count towards your coding day.</p>
            <div className="grid2">
              <label className="field">
                <span>Projects to ship</span>
                <input inputMode="numeric" value={raw.count} onChange={(e) => { const v = digits(e.target.value); setRaw({ ...raw, count: v }); set({ goalCount: Number(v) }); }} />
                {err.goalCount && <small className="err">{err.goalCount}</small>}
              </label>
              <label className="field">
                <span>Deadline</span>
                <input type="date" value={a.deadline} min={addDays(todayKey(), 1)} onChange={(e) => set({ deadline: e.target.value })} />
                {err.deadline && <small className="err">{err.deadline}</small>}
              </label>
              <label className="field">
                <span>GitHub username</span>
                <input value={a.githubUser} placeholder="Optional" autoCapitalize="none" spellCheck={false} onChange={(e) => set({ githubUser: e.target.value })} />
                {err.githubUser && <small className="err">{err.githubUser}</small>}
              </label>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <h1>Rewards</h1>
            <p className="sub">Finish a week, a fortnight or a month well and unlock a treat. A reward only unlocks if that period’s savings transfer was made.</p>
            <div className="segment two" role="radiogroup" aria-label="Reward menu">
              <button type="button" role="radio" aria-checked={a.keepRewards} onClick={() => set({ keepRewards: true })}>
                Start with an example menu
              </button>
              <button type="button" role="radio" aria-checked={!a.keepRewards} onClick={() => set({ keepRewards: false })}>
                Start empty
              </button>
            </div>
            {a.keepRewards && (
              <ul className="bullets">
                {DEFAULT_ITEMS.map((i) => (
                  <li key={i.id}>
                    {i.name}, {i.cost ? naira(i.cost) : 'free'}
                  </li>
                ))}
              </ul>
            )}
            <p className="note">Edit, add or remove treats any time in Settings.</p>
          </>
        )}

        <div className="row-action welcome-nav">
          <button type="button" className="btn" onClick={() => setStep(step - 1)}>
            Back
          </button>
          <button className="btn primary" disabled={blocked}>
            {last ? 'Open my dashboard' : 'Next'}
          </button>
        </div>
      </form>
    </div>
  );
}
