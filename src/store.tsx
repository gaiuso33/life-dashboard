import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import type { DayKey } from './program';
import { LocalRepository } from './repository';
import type { Repository } from './repository';
import { buildSampleData } from './sample';
import { emptyData, sessionKey } from './types';
import type { AdvisorSettings, AiReview, AppData, BodyEntry, CareerData, Claim, DayLog, MoneyData, RewardItem, Session, Txn } from './types';

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
  | { t: 'fresh' };

function blankSession(date: string, day: DayKey): Session {
  return { date, day, loads: {}, reps: {}, finished: false };
}

function withSession(data: AppData, date: string, day: DayKey, fn: (s: Session) => Session): AppData {
  const key = sessionKey(date, day);
  const current = data.sessions[key] ?? blankSession(date, day);
  return { ...data, sessions: { ...data.sessions, [key]: fn(current) } };
}

function reducer(state: AppData, a: Action): AppData {
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
      return { ...state, money: { ...state.money, txns: state.money.txns.filter((t) => t.id !== a.id) } };
    case 'txn-cat':
      return { ...state, money: { ...state.money, txns: state.money.txns.map((t) => (t.id === a.id ? { ...t, category: a.category } : t)) } };
    case 'money-set':
      return { ...state, money: { ...state.money, ...a.patch } };
    case 'career-set':
      return { ...state, career: { ...state.career, ...a.patch } };
    case 'claim-add': {
      const c = a.claim;
      // A paid treat is also logged as a Rewards expense so Money stays honest. The txn id is derived from the claim id so undo can find it.
      const txns = c.logged && c.cost > 0 ? [...state.money.txns, { id: `rw-${c.id}`, date: c.date, kind: 'expense' as const, amount: c.cost, category: 'Rewards', note: c.name }] : state.money.txns;
      return { ...state, money: { ...state.money, txns }, rewards: { ...state.rewards, claims: [...state.rewards.claims, c] } };
    }
    case 'claim-del':
      return {
        ...state,
        money: { ...state.money, txns: state.money.txns.filter((t) => t.id !== `rw-${a.id}`) },
        rewards: { ...state.rewards, claims: state.rewards.claims.filter((c) => c.id !== a.id) },
      };
    case 'item-add':
      return { ...state, rewards: { ...state.rewards, items: [...state.rewards.items, a.item] } };
    case 'item-del':
      return { ...state, rewards: { ...state.rewards, items: state.rewards.items.filter((i) => i.id !== a.id) } };
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
    case 'fresh':
      return emptyData();
  }
}

interface Ctx {
  data: AppData;
  ready: boolean;
  dispatch: (a: Action) => void;
  exportJson: () => string;
  importData: (d: AppData) => void;
}

const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children, repo }: { children: ReactNode; repo?: Repository }) {
  const repository = useRef<Repository>(repo ?? new LocalRepository());
  const [data, dispatch] = useReducer(reducer, undefined, emptyData);
  const [ready, setReady] = useReducer(() => true, false);
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    repository.current.load().then((saved) => {
      if (cancelled) return;
      dispatch({ t: 'load', data: saved ?? buildSampleData() });
      loaded.current = true;
      setReady();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const latest = useRef(data);
  latest.current = data;

  useEffect(() => {
    if (!loaded.current) return;
    const id = window.setTimeout(() => void repository.current.save(data), 250);
    return () => window.clearTimeout(id);
  }, [data]);

  // Save immediately when the page is hidden or closed, so a change made in the
  // last moments before leaving is never lost to the debounce above.
  useEffect(() => {
    const flush = () => {
      if (loaded.current) void repository.current.save(latest.current);
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
      dispatch,
      exportJson: () => JSON.stringify(data, null, 2),
      importData: (d) => dispatch({ t: 'load', data: d }),
    }),
    [data, ready],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Ctx {
  const c = useContext(StoreContext);
  if (!c) throw new Error('useStore must be used inside StoreProvider');
  return c;
}
