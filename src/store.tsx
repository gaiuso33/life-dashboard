import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import type { DayKey } from './program';
import { LocalRepository } from './repository';
import type { Repository } from './repository';
import { buildSampleData } from './sample';
import { emptyData, sessionKey } from './types';
import type { AppData, BodyEntry, DayLog, Session } from './types';

type Action =
  | { t: 'load'; data: AppData }
  | { t: 'day'; date: string; patch: Partial<DayLog> }
  | { t: 'reps'; date: string; day: DayKey; ex: string; idx: number; sets: number; value: number | null }
  | { t: 'fillReps'; date: string; day: DayKey; ex: string; reps: (number | null)[]; load?: string }
  | { t: 'load-text'; date: string; day: DayKey; ex: string; value: string }
  | { t: 'finish'; date: string; day: DayKey; finished: boolean }
  | { t: 'body'; entry: BodyEntry }
  | { t: 'goal'; value: number | null }
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

  useEffect(() => {
    if (!loaded.current) return;
    const id = window.setTimeout(() => void repository.current.save(data), 250);
    return () => window.clearTimeout(id);
  }, [data]);

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
