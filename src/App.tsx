import { useState } from 'react';
import { Body } from './components/Body';
import { Today } from './components/Today';
import { Train } from './components/Train';
import type { Tab, TrainView } from './nav';
import { nextSession, plannedFor } from './derive';
import { useStore } from './store';
import { addDays, todayKey } from './utils';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'today', label: 'Today', icon: 'M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z' },
  { key: 'train', label: 'Train', icon: 'M3 9v6h2V9H3zm3-2v10h2V7H6zm3 4v2h6v-2H9zm6-4v10h2V7h-2zm3 2v6h2V9h-2z' },
  { key: 'body', label: 'Body', icon: 'M4 19h16v2H4v-2zM6 10h3v8H6v-8zm5-6h3v14h-3V4zm5 4h3v10h-3V8z' },
];

function initialTrainView(): TrainView {
  const today = todayKey();
  return plannedFor(today) ?? nextSession(addDays(today, 1)).day;
}

export function App() {
  const { data, ready, dispatch, exportJson } = useStore();
  const [tab, setTab] = useState<Tab>('today');
  const [view, setView] = useState<TrainView>(initialTrainView);

  if (!ready) return <div className="boot" aria-busy="true" />;

  const go = (t: Tab, v?: TrainView) => {
    if (v) setView(v);
    setTab(t);
    window.scrollTo({ top: 0 });
  };

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `life-dashboard-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          Life Dashboard
        </div>
        <nav aria-label="Main">
          {TABS.map((t) => (
            <button key={t.key} className="nav-btn" aria-current={tab === t.key ? 'page' : undefined} onClick={() => go(t.key)}>
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path d={t.icon} fill="currentColor" />
              </svg>
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-foot">
          <button className="link-btn" onClick={download}>
            Export data (JSON)
          </button>
        </div>
      </aside>

      <main className="main">
        {data.sample && (
          <div className="banner" role="status">
            <p>You’re looking at sample data. Start fresh to log your own.</p>
            <button
              className="btn"
              onClick={() => {
                if (window.confirm('Remove the sample data and start with an empty dashboard?')) dispatch({ t: 'fresh' });
              }}
            >
              Start fresh
            </button>
          </div>
        )}
        {tab === 'today' && <Today go={go} />}
        {tab === 'train' && <Train view={view} setView={setView} />}
        {tab === 'body' && <Body />}
      </main>
    </div>
  );
}
