import { useEffect, useMemo, useState } from 'react';
import {CATEGORIES, PROTECTED_CATEGORIES, categoriesOf, newId} from '../money';
import type { Tab } from '../nav';
import { DEFAULT_PROGRAM, WEEKDAY_SHORT, getProgram, programError } from '../program';
import type { DayDef, ExerciseDef } from '../program';
import { TIER_LABEL } from '../rewards';
import { promptInstall, useInstall } from '../install';
import { RegionUnits } from './RegionUnits';
import { useCloud } from '../cloud/CloudProvider';
import { currentSubscription, deviceZone, markPushOn, pushSupport, pushWanted, refreshPush, rowFrom, showLocalTest, subscribeThisDevice } from '../push';
import { describeDevices, failingText, nextForRow } from '../pushPreview';
import type { DeviceView } from '../pushPreview';
import { buildIcs, downloadIcs, loadReminders, saveReminders } from '../reminders';
import type { ReminderPlan } from '../reminders';
import { useStore } from '../store';
import type { RewardItem, Tier } from '../types';
import { todayKey } from '../utils';
import { fmtMoney } from '../units';
import { currencySymbol } from '../units';
import { fromDisplay, toDisplay, weightUnit } from '../units';

const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const TIERS: Tier[] = ['week', 'biweek', 'month', 'landmark'];
const digits = (s: string) => s.replace(/[^\d]/g, '');
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const REMINDER_ROWS: { key: keyof ReminderPlan; label: string; hint: string }[] = [
  { key: 'checkin', label: 'Daily check-in', hint: 'Every day' },
  { key: 'training', label: 'Training day', hint: 'On your programme’s gym days' },
  { key: 'money', label: 'Log spending', hint: 'Every day' },
  { key: 'review', label: 'Weekly review', hint: 'Sundays' },
];

const DENIED_TEXT = 'Notifications are blocked for this site. Allow them in your browser’s site settings, then try again.';

/** Real push notifications: they arrive even when the app is closed. Needs an account, so the server knows where to send. */
function PushNotifications({ plan, onSync }: { plan: ReminderPlan; onSync: () => void }) {
  const cloud = useCloud();
  const support = pushSupport();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [view, setView] = useState<DeviceView[] | null>(null);
  // Set when the server has not been able to reach THIS device for a day or more. Looked up quietly when this screen opens.
  const [stale, setStale] = useState<DeviceView['failing']>(null);
  const signedIn = cloud.configured && !!cloud.email;

  // Is this device already subscribed (from an earlier visit)? The browser is the source of truth, not our memory of it.
  useEffect(() => {
    let alive = true;
    void currentSubscription().then((sub) => alive && setOn(!!sub && pushWanted() && Notification.permission === 'granted'));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!on || !signedIn) {
      setStale(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const rows = await cloud.listPush();
        const sub = await currentSubscription();
        const mine = describeDevices(rows, sub?.endpoint ?? null, plan, getProgram(), new Date(), deviceZone()).find((d) => d.isThis);
        if (alive) setStale(mine?.failing ?? null);
      } catch {
        /* a quiet check: nothing to say if it cannot be made */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, signedIn]);

  // Changed a time or switched a reminder? Tell the server, so what it sends matches what this screen says.
  useEffect(() => {
    if (!on || !signedIn) return;
    void refreshPush((row) => cloud.savePush(row), getProgram(), plan).catch(() => setMsg('Couldn’t update your reminder times on the server. They will retry next time the app syncs.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, signedIn, plan]);

  if (support === 'demo')
    return (
      <div className="push-box">
        <h3>Push notifications</h3>
        <p className="note first">Push notifications aren’t available in the demo.</p>
      </div>
    );

  const fail = (e: unknown) => setMsg(e instanceof Error ? e.message : 'Something went wrong.');
  const enable = async () => {
    setBusy(true);
    setMsg('');
    try {
      const res = await subscribeThisDevice(plan, getProgram());
      if (!res.ok) {
        setMsg(res.reason === 'denied' ? DENIED_TEXT : res.reason === 'dismissed' ? 'Notifications weren’t allowed, so nothing was turned on.' : 'This device couldn’t be set up for push notifications.');
        return;
      }
      await cloud.savePush(res.row);
      markPushOn(res.row);
      setOn(true);
      setMsg('Turned on. Send yourself a test to check it works.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const disable = async () => {
    setBusy(true);
    setMsg('');
    try {
      await cloud.removePush();
      setOn(false);
      setMsg('Turned off for this device.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  // What the server really holds for each device on this account, set beside what this screen says.
  const check = async () => {
    setBusy(true);
    setMsg('');
    try {
      const rows = await cloud.listPush();
      const sub = await currentSubscription();
      setView(describeDevices(rows, sub?.endpoint ?? null, plan, getProgram(), new Date(), deviceZone()));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const resync = async () => {
    setBusy(true);
    try {
      const sub = await currentSubscription();
      if (!sub) throw new Error('This device has no notification address. Turn push off and on again.');
      const row = rowFrom(sub, plan, getProgram());
      await cloud.savePush(row);
      markPushOn(row);
      setBusy(false);
      await check();
      setMsg('The server now has these times.');
    } catch (e) {
      setBusy(false);
      fail(e);
    }
  };
  const test = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await cloud.testPush();
      setMsg(r.sent > 0 ? 'Sent. It should arrive within a few seconds.' : r.devices === 0 ? 'The server has no device saved for this account yet. Turn push off and on again.' : 'The server couldn’t reach your device. Turn push off and on again.');
      if (r.sent === 0 && r.devices > 0) void showLocalTest();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="push-box">
      <h3>Push notifications</h3>
      {support === 'needs-install' && <p className="note first">On iPhone and iPad, notifications only work once the app is on your Home Screen. Add it first (see <b>Install on this device</b> above), then open it from there and come back here.</p>}
      {support === 'unsupported' && <p className="note first">This browser can’t receive push notifications. The calendar file below still works everywhere.</p>}
      {support === 'not-configured' && <p className="note first">Push notifications aren’t set up on this copy of the app yet.</p>}
      {support === 'ok' && (
        <>
          <p className="note first">
            Reminders that arrive even when the app is closed. The server is told only this device’s notification address, your time zone, and the reminder times and wording above. Nothing you have logged is ever sent.
          </p>
          {!signedIn ? (
            <div className="row-action">
              <button className="btn" onClick={onSync}>
                Sign in to turn on
              </button>
              <span className="muted-s">Push needs an account so the server knows where to send.</span>
            </div>
          ) : on ? (
            <div className="row-action">
              <span className="muted-s">On for this device.</span>
              <button className="btn" disabled={busy} onClick={() => void test()}>
                Send a test
              </button>
              <button className="btn" disabled={busy} onClick={() => void disable()}>
                Turn off
              </button>
            </div>
          ) : (
            <div className="row-action">
              <button className="btn primary" disabled={busy || !Object.values(plan).some((p) => p.on)} onClick={() => void enable()}>
                Turn on for this device
              </button>
              <span className="muted-s">Each device is turned on separately.</span>
            </div>
          )}
          {on && stale && (
            <p className="err" role="status">
              {failingText(stale, true)}
            </p>
          )}
          {signedIn && (
            <div className="row-action">
              <button className="btn" disabled={busy} onClick={() => void check()}>
                Check what the server has
              </button>
              <span className="muted-s">Shows the times and days each of your devices will really be sent.</span>
            </div>
          )}
          {view && (
            <div className="server-view" role="region" aria-label="What the server has">
              {view.length === 0 && <p className="note first">The server has no devices saved for this account yet. Turn push on for a device first.</p>}
              {view.length > 0 && !view.some((d) => d.isThis) && <p className="note first">None of these is the device you are using. Turn push on here to add it.</p>}
              {view.map((d) => (
                <div key={d.endpoint} className="server-dev">
                  <p>
                    <b>{d.isThis ? 'This device' : 'Another device'}</b>{' '}
                    <small className="muted-s">
                      {d.service} · time zone {d.tz} · updated {d.updatedAgo}
                    </small>
                  </p>
                  {d.failing && <p className="err">{failingText(d.failing, d.isThis)}</p>}
                  {d.unreachable && (
                    <p className="note" role="status">
                      The server could not reach this device (first failed {d.unreachable}). It keeps trying. If this stays, turn push off and on again on that device.
                    </p>
                  )}
                  {d.items.length === 0 ? (
                    <p className="note">No reminders are switched on for this device.</p>
                  ) : (
                    <ul className="rows">
                      {d.items.map((i) => (
                        <li key={i.id} className="row">
                          <span>
                            <b>{i.name}</b> <small className="muted-s">{i.time} · {i.daysText}</small>
                          </span>
                          <small className="muted-s">
                            Next: {i.next}
                            {i.lastSent ? ` · last sent ${i.lastSent}` : ''}
                          </small>
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.isThis && !d.inSync && (
                    <div className="row-action">
                      <span className="muted-s">The server has different times from this screen.</span>
                      <button className="btn" disabled={busy} onClick={() => void resync()}>
                        Update the server now
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {msg && (
        <p className="note" role="status">
          {msg}
        </p>
      )}
    </div>
  );
}

function Reminders({ onSync }: { onSync: () => void }) {
  const [plan, setPlan] = useState<ReminderPlan>(loadReminders);
  const program = getProgram();
  const now = new Date();
  const [made, setMade] = useState(false);
  const set = (k: keyof ReminderPlan, p: Partial<ReminderPlan[typeof k]>) => {
    const next = { ...plan, [k]: { ...plan[k], ...p } };
    setPlan(next);
    saveReminders(next);
    setMade(false);
  };
  return (
    <section className="panel" id="reminders">
      <h2>Reminders</h2>
      <p className="note first">Pick what you want to be reminded of and the time for each. Then choose how: push notifications, a calendar file, or both.</p>
      <ul className="rows">
        {REMINDER_ROWS.map((r) => (
          <li key={r.key} className="row rem-row">
            <label className="check">
              <input type="checkbox" checked={plan[r.key].on} onChange={(e) => set(r.key, { on: e.target.checked })} />
              <span>
                <b>{r.label}</b>{' '}
                <small className="muted-s">
                  {r.hint}
                  {(() => {
                    const next = nextForRow(r.key, plan, program, deviceZone(), now);
                    return next ? ` · Next: ${next}` : '';
                  })()}
                </small>
              </span>
            </label>
            <div className="row-action">
              <input type="time" aria-label={`${r.label} time`} value={plan[r.key].time} disabled={!plan[r.key].on} onChange={(e) => e.target.value && set(r.key, { time: e.target.value })} />
            </div>
          </li>
        ))}
      </ul>
      <PushNotifications plan={plan} onSync={onSync} />
      <h3>Calendar file</h3>
      <p className="note first">Your phone’s calendar does the reminding, even when this app is closed, and nothing is sent anywhere.</p>
      <div className="row-action">
        <button
          className="btn primary"
          disabled={!Object.values(plan).some((p) => p.on)}
          onClick={() => {
            downloadIcs(buildIcs(plan, getProgram(), todayKey()));
            setMade(true);
          }}
        >
          Download calendar file
        </button>
      </div>
      {made && (
        <p className="note" role="status">
          Open the downloaded file. On iPhone choose Add All; on Android it opens in Google Calendar. Changing the times later? Download again, and delete the old “Life Dashboard” events first so they don’t double up. Using push notifications as well? Pick one or the other, or you will be reminded twice.
        </p>
      )}
    </section>
  );
}

function Region() {
  return (
    <section className="panel" id="region">
      <h2>Currency and weight</h2>
      <RegionUnits />
      <p className="note">
        Changing the currency only changes the symbol and formatting. It does <b>not</b> convert amounts you have already logged. Weights are stored in kilograms, so switching between kg and lb is exact and changes nothing you have saved.
      </p>
    </section>
  );
}

function Install() {
  const state = useInstall();
  return (
    <section className="panel" id="install">
      <h2>Install on this device</h2>
      {state === 'installed' && <p className="note first">Already installed. You’re using it as an app.</p>}
      {state === 'ready' && (
        <>
          <p className="note first">Add it to your home screen or desktop. It opens full-screen and works offline.</p>
          <button className="btn primary" onClick={() => void promptInstall()}>
            Install app
          </button>
        </>
      )}
      {state === 'ios' && (
        <p className="note first">
          On iPhone and iPad there is no install button. In <strong>Safari</strong>, tap the Share icon, then <strong>Add to Home Screen</strong>. Other iPhone browsers can’t do this.
        </p>
      )}
      {state === 'file' && <p className="note first">Installing needs the web address of the app. It doesn’t work when the page is opened as a file from your computer or phone.</p>}
      {state === 'manual' && (
        <p className="note first">
          Your browser hasn’t offered an install button. In <strong>Chrome or Edge</strong>, open the browser menu (⋮) and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>. On the desktop it is also an icon at the right end of the address bar. Firefox on a computer can’t install web apps. If it isn’t listed, use the page’s normal address (not a private window or an in-app browser such as WhatsApp or Instagram) and reload once.
        </p>
      )}
    </section>
  );
}

export function Settings({ go, onSync }: { go: (t: Tab) => void; onSync: () => void }) {
  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
        <p className="sub">Make the dashboard fit you. Changes apply straight away, and your logged history is never rewritten.</p>
      </header>
      <div className="settings">
        <Install />
        <Region />
        <Reminders onSync={onSync} />
        <Programme />
        <Categories />
        <Rewards />
        <Goals key={weightUnit()} go={go} />
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
      <p className="note first">What you can pick when a reward unlocks. Prices are what you expect to pay; free treats can be 0.</p>
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
          <span>Cost ({currencySymbol()})</span>
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
  const [weight, setWeight] = useState(data.goalWeight != null ? String(toDisplay(data.goalWeight)) : '');
  const [count, setCount] = useState(String(c.goalCount));
  return (
    <section className="panel">
      <h2>Goals</h2>
      <div className="goal-grid">
        <label className="field">
          <span>Goal body weight ({weightUnit()})</span>
          <input
            inputMode="decimal"
            value={weight}
            placeholder="Not set"
            onChange={(e) => setWeight(e.target.value.replace(/[^\d.]/g, ''))}
            onBlur={() => {
              const kg = fromDisplay(parseFloat(weight));
              const ok = Number.isFinite(kg) && kg >= 30 && kg <= 250;
              dispatch({ t: 'goal', value: ok ? kg : null });
              if (!ok) setWeight('');
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
        Savings split ({data.money.savePct}%), your rough daily spend ({data.money.dailyEstimate != null ? fmtMoney(data.money.dailyEstimate) : 'not set'}) and your starting survival fund are edited on the Money screen, and the AI advisor settings are on the Advisor screen.
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
