import { createContext, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DayDef, DayKey } from './program';
import { setActiveProgram } from './program';
import { stampChanges } from './scalars';
import { categoriesOf } from './money';
import { LocalRepository } from './repository';
import type { LoadResult, Repository } from './repository';
import { mergeData } from './merge';
import { buildSetup } from './setup';
import type { SetupAnswers } from './setup';
import { emptyData, sessionKey } from './types';
import type { AdvisorSettings, PlanItem, AiReview, AppData, BodyEntry, CareerData, Claim, DayLog, MoneyData, RewardItem, Session, Txn } from './types';

type Action =
  | { t: 'load'; data: AppData }
  | { t: 'day'; date: string; patch: Partial<DayLog> }
  | { t: 'reps'; date: string; day: DayKey; ex: string; idx: number; sets: number; value: number | null }
  | { t: 'fillReps'; date: string; day: DayKey; ex: string; reps: (number | null)[]; load?: string }
  | { t: 'load-text'; date: string; day: DayKey; ex: string; value: string }
  | { t: 'finish'; date: string; day: DayKey; finished: boolean }
  | { t: 'body'; entry: BodyEntry }
  | { t: 'goal'; value: number | null }
  | { t: 'txn-add'; txn: Txn }
  | { t: 'txn-del'; id: string }
  | { t: 'txn-cat'; id: string; category: string }
  | { t: 'money-set'; patch: Partial<MoneyData> }
  | { t: 'career-set'; patch: Partial<CareerData> }
  | { t: 'claim-add'; claim: Claim }
  | { t: 'claim-del'; id: string }
  | { t: 'item-add'; item: RewardItem }
  | { t: 'item-del'; id: string }
  | { t: 'badges-earn'; earned: Record<string, string> }
  | { t: 'advisor-set'; settings: AdvisorSettings }
  | { t: 'review-save'; review: AiReview }
  | { t: 'program-set'; program?: DayDef[] }
  | { t: 'cat-add'; name: string }
  | { t: 'cat-rename'; from: string; to: string }
  | { t: 'cat-del'; name: string }
  | { t: 'item-edit'; item: RewardItem }
  | { t: 'plan-add'; item: PlanItem }
  | { t: 'plan-del'; id: string }
  | { t: 'plan-toggle'; id: string; date: string }
  | { t: 'setup'; answers: SetupAnswers }
  | { t: 'fresh' };

function blankSession(date: string, day: DayKey): Session {
  return { date, day, loads: {}, reps: {}, finished: false };
}

function withSession(data: AppData, date: string, day: DayKey, fn: (s: Session) => Session): AppData {
  const key = sessionKey(date, day);
  const current = data.sessions[key] ?? blankSession(date, day);
  return { ...data, sessions: { ...data.sessions, [key]: fn(current) } };
}

const withGone = (s: AppData, ...ids: string[]): AppData => ({ ...s, gone: [...new Set([...s.gone, ...ids])] });

/** Every change by the user stamps the data, so merging two devices knows which one is newer. Automatic actions do not. */
function reducer(state: AppData, a: Action): AppData {
  const next = apply(state, a);
  if (a.t === 'load' || a.t === 'badges-earn' || next === state) return next;
  const now = new Date().toISOString();
  const stamped = a.t === 'fresh' ? next : stampChanges(state, next, now);
  return { ...stamped, modified: now };
}

function apply(state: AppData, a: Action): AppData {
  switch (a.t) {
    case 'load':
      return a.data;
    case 'day':
      return { ...state, days: { ...state.days, [a.date]: { ...state.days[a.date], ...a.patch } } };
    case 'reps':
      return withSession(state, a.date, a.day, (s) => {
        const arr = [...(s.reps[a.ex] ?? [])];
        while (arr.length < a.sets) arr.push(null);
        arr[a.idx] = a.value;
        return { ...s, reps: { ...s.reps, [a.ex]: arr } };
      });
    case 'fillReps':
      return withSession(state, a.date, a.day, (s) => ({
        ...s,
        reps: { ...s.reps, [a.ex]: a.reps },
        loads: a.load != null && !s.loads[a.ex] ? { ...s.loads, [a.ex]: a.load } : s.loads,
      }));
    case 'load-text':
      return withSession(state, a.date, a.day, (s) => ({ ...s, loads: { ...s.loads, [a.ex]: a.value } }));
    case 'finish':
      return withSession(state, a.date, a.day, (s) => ({ ...s, finished: a.finished }));
    case 'body': {
      const rest = state.body.filter((b) => b.date !== a.entry.date);
      const body = [...rest, a.entry].sort((x, y) => x.date.localeCompare(y.date));
      return { ...state, body };
    }
    case 'goal':
      return { ...state, goalWeight: a.value };
    case 'txn-add':
      return { ...state, money: { ...state.money, txns: [...state.money.txns, a.txn] } };
    case 'txn-del':
      return { ...withGone(state, a.id), money: { ...state.money, txns: state.money.txns.filter((t) => t.id !== a.id) } };
    case 'txn-cat':
      return { ...state, money: { ...state.money, txns: state.money.txns.map((t) => (t.id === a.id ? { ...t, category: a.category } : t)) } };
    case 'money-set':
      return { ...state, money: { ...state.money, ...a.patch } };
    case 'career-set': {
      const career = { ...state.career, ...a.patch };
      const kept = new Set([...career.projects.map((p) => p.id), ...career.learning.map((l) => l.id)]);
      const removed = [...state.career.projects.map((p) => p.id), ...state.career.learning.map((l) => l.id)].filter((id) => !kept.has(id));
      return { ...withGone(state, ...removed), career };
    }
    case 'claim-add': {
      const c = a.claim;
      // A paid treat is also logged as a Rewards expense so Money stays honest. The txn id is derived from the claim id so undo can find it.
      const txns = c.logged && c.cost > 0 ? [...state.money.txns, { id: `rw-${c.id}`, date: c.date, kind: 'expense' as const, amount: c.cost, category: 'Rewards', note: c.name }] : state.money.txns;
      return { ...state, money: { ...state.money, txns }, rewards: { ...state.rewards, claims: [...state.rewards.claims, c] } };
    }
    case 'claim-del':
      return {
        ...withGone(state, a.id, `rw-${a.id}`),
        money: { ...state.money, txns: state.money.txns.filter((t) => t.id !== `rw-${a.id}`) },
        rewards: { ...state.rewards, claims: state.rewards.claims.filter((c) => c.id !== a.id) },
      };
    case 'item-add':
      return { ...state, rewards: { ...state.rewards, items: [...state.rewards.items, a.item] } };
    case 'item-del':
      return { ...withGone(state, a.id), rewards: { ...state.rewards, items: state.rewards.items.filter((i) => i.id !== a.id) } };
    case 'badges-earn':
      return { ...state, rewards: { ...state.rewards, badges: { ...a.earned, ...state.rewards.badges } } };
    case 'advisor-set':
      return { ...state, advisor: { ...state.advisor, settings: a.settings } };
    case 'review-save': {
      // One saved review per week (writing it again replaces it); only the latest twelve are kept.
      const rest = state.advisor.reviews.filter((r) => r.week !== a.review.week);
      const reviews = [...rest, a.review].sort((x, y) => y.week.localeCompare(x.week)).slice(0, 12);
      return { ...state, advisor: { ...state.advisor, reviews } };
    }
    case 'program-set':
      return { ...state, program: a.program };
    case 'cat-add': {
      const cats = categoriesOf(state);
      if (cats.some((c) => c.toLowerCase() === a.name.toLowerCase())) return state;
      // New categories go before "Rewards" and "Other", which stay at the end.
      const tail: string[] = cats.filter((c) => c === 'Rewards' || c === 'Other');
      return { ...state, money: { ...state.money, categories: [...cats.filter((c) => !tail.includes(c)), a.name, ...tail] } };
    }
    case 'cat-rename': {
      const cats = categoriesOf(state);
      if (a.from === 'Rewards' || a.from === 'Other' || !cats.includes(a.from) || cats.some((c) => c.toLowerCase() === a.to.toLowerCase() && c !== a.from)) return state;
      return {
        ...state,
        money: {
          ...state.money,
          categories: cats.map((c) => (c === a.from ? a.to : c)),
          txns: state.money.txns.map((t) => (t.category === a.from ? { ...t, category: a.to } : t)),
        },
      };
    }
    case 'cat-del': {
      if (a.name === 'Rewards' || a.name === 'Other') return state;
      return {
        ...state,
        money: {
          ...state.money,
          categories: categoriesOf(state).filter((c) => c !== a.name),
          txns: state.money.txns.map((t) => (t.category === a.name ? { ...t, category: 'Other' } : t)),
        },
      };
    }
    case 'item-edit':
      return { ...state, rewards: { ...state.rewards, items: state.rewards.items.map((i) => (i.id === a.item.id ? a.item : i)) } };
    case 'plan-add':
      return { ...state, plans: [...state.plans, a.item] };
    case 'plan-del':
      return { ...withGone(state, a.id), plans: state.plans.filter((p) => p.id !== a.id) };
    case 'plan-toggle':
      return { ...state, plans: state.plans.map((p) => (p.id !== a.id ? p : { ...p, doneOn: p.doneOn.includes(a.date) ? p.doneOn.filter((d) => d !== a.date) : [...p.doneOn, a.date] })) };
    case 'setup':
      return buildSetup(state, a.answers);
    case 'fresh':
      return emptyData();
  }
}

/** Set when something is saved but can't be read: the app waits for the person to choose before saving anything. */
export interface Recovery {
  raw: string;
  backup: { data: AppData; at: string } | null;
}

interface Ctx {
  data: AppData;
  ready: boolean;
  /** True when the latest changes could not be written to this device (storage full or blocked). */
  saveFailed: boolean;
  recovery: Recovery | null;
  resolveRecovery: (data: AppData) => void;
  dispatch: (a: Action) => void;
  exportJson: () => string;
  importData: (d: AppData) => void;
}

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children, repo }: { children: ReactNode; repo?: Repository }) {
  const repository = useRef<Repository>(repo ?? new LocalRepository());
  const [data, dispatch] = useReducer(reducer, undefined, emptyData);
  const [ready, setReady] = useReducer(() => true, false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    repository.current.load().then((res: LoadResult) => {
      if (cancelled) return;
      if (res.status === 'damaged') {
        // Saving stays off until the person decides, so unreadable data is never overwritten.
        setRecovery({ raw: res.raw, backup: res.backup });
        dispatch({ t: 'load', data: emptyData() });
      } else {
        dispatch({ t: 'load', data: res.status === 'ok' ? res.data : emptyData() });
        loaded.current = true;
      }
      setReady();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The programme is read through plain functions all over the app, so it is set from the data before anything renders.
  setActiveProgram(data.program);

  const latest = useRef(data);
  latest.current = data;

  const persist = (d: AppData) =>
    repository.current.save(d).then((r) => {
      setSaveFailed(!r.ok);
    });

  useEffect(() => {
    if (!loaded.current) return;
    const id = window.setTimeout(() => void persist(data), 250);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, recovery]);

  // Another tab of the app saved something newer: fold it in rather than overwrite it with this tab's older copy.
  useEffect(
    () =>
      repository.current.subscribe?.((incoming) => {
        if ((incoming.modified ?? '') > (latest.current.modified ?? '')) dispatch({ t: 'load', data: mergeData(latest.current, incoming) });
      }),
    [],
  );

  // Save immediately when the page is hidden or closed, so a change made in the
  // last moments before leaving is never lost to the debounce above.
  useEffect(() => {
    const flush = () => {
      if (loaded.current) void persist(latest.current);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      data,
      ready,
      saveFailed,
      recovery,
      resolveRecovery: (d) => {
        dispatch({ t: 'load', data: d });
        loaded.current = true;
        setRecovery(null);
      },
      dispatch,
      exportJson: () => JSON.stringify(data, null, 2),
      importData: (d) => dispatch({ t: 'load', data: d }),
    }),
    [data, ready, saveFailed, recovery],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreContext);
  if (!c) throw new Error('useStore must be used inside StoreProvider');
  return c;
}
