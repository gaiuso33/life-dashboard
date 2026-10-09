import { useEffect, useState } from 'react';
import { newlyEarned } from './badges';
import { Advisor } from './components/Advisor';
import { Body } from './components/Body';
import { Career } from './components/Career';
import { Month } from './components/Month';
import { Money } from './components/Money';
import { Settings } from './components/Settings';
import { Sync } from './components/Sync';
import { Welcome } from './components/Welcome';
import { Rewards } from './components/Rewards';
import { Today } from './components/Today';
import { Train } from './components/Train';
import type { Tab, TrainView } from './nav';
import { nextSession, plannedFor } from './derive';
import { agoText, daysAgo, lastExport } from './sync';
import { useStore } from './store';
import { addDays, todayKey } from './utils';

const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'today', label: 'Today', icon: 'M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6v-9h-6v9zm0-16v5h6V4h-6z' },
  { key: 'month', label: 'Month', icon: 'M7 2v2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2h-2V2h-2v2H9V2H7zm-2 8h14v10H5V10z' },
  { key: 'train', label: 'Train', icon: 'M3 9v6h2V9H3zm3-2v10h2V7H6zm3 4v2h6v-2H9zm6-4v10h2V7h-2zm3 2v6h2V9h-2z' },
  { key: 'money', label: 'Money', icon: 'M12 2a10 10 0 100 20 10 10 0 000-20zm1 15.9V19h-2v-1.1c-1.4-.3-2.5-1.2-2.7-2.7h1.9c.2.7.8 1.1 1.8 1.1 1 0 1.7-.5 1.7-1.2 0-.8-.5-1.1-1.9-1.4-1.7-.4-3.1-1-3.1-2.7 0-1.3 1-2.2 2.3-2.5V7h2v1.2c1.2.3 2.1 1.1 2.3 2.4h-1.9c-.2-.6-.7-.9-1.5-.9-.9 0-1.5.4-1.5 1 0 .7.5 1 1.8 1.3 1.8.4 3.2 1 3.2 2.8 0 1.4-1 2.3-2.4 2.6z' },
  { key: 'career', label: 'Career', icon: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z' },
  { key: 'rewards', label: 'Rewards', icon: 'M19 5h-2V3H7v2H5c-1.1 0-2 .9-2 2v1c0 2.55 1.92 4.63 4.39 4.94.63 1.5 1.98 2.63 3.61 2.95V19H7v2h10v-2h-4v-3.1c1.63-.32 2.98-1.45 3.61-2.95C19.08 12.63 21 10.55 21 8V7c0-1.1-.9-2-2-2zM5 8V7h2v3.82C5.84 10.4 5 9.3 5 8zm14 0c0 1.3-.84 2.4-2 2.82V7h2v1z' },
  { key: 'advisor', label: 'Advisor', icon: 'M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zm7 11l.9 2.6L22.5 16.5l-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13zM5 14l.9 2.6 2.6.9-2.6.9L5 21l-.9-2.6L1.5 17.5l2.6-.9L5 14z' },
  { key: 'body', label: 'Body', icon: 'M4 19h16v2H4v-2zM6 10h3v8H6v-8zm5-6h3v14h-3V4zm5 4h3v10h-3V8z' },
];

function initialTrainView(): TrainView {
  const today = todayKey();
  return plannedFor(today) ?? nextSession(addDays(today, 1)).day;
}

export function App() {
  const { data, ready, dispatch } = useStore();
  const [syncOpen, setSyncOpen] = useState(false);
  const [tab, setTab] = useState<Tab>('today');
  const [view, setView] = useState<TrainView>(initialTrainView);

  // Badges are saved the moment they're earned, so a broken streak or a deleted entry never takes one back.
  useEffect(() => {
    if (!ready) return;
    const earned = newlyEarned(data, todayKey());
    if (Object.keys(earned).length > 0) dispatch({ t: 'badges-earn', earned });
  }, [data, ready, dispatch]);

  if (!ready) return <div className="boot" aria-busy="true" />;
  if (!data.onboarded) return <Welcome />;

  const go = (t: Tab, v?: TrainView) => {
    if (v) setView(v);
    setTab(t);
    window.scrollTo({ top: 0 });
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
          <button className="link-btn" onClick={() => go('settings')}>
            Settings
          </button>
          <button className="link-btn" onClick={() => setSyncOpen(true)}>
            Sync and backup
          </button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          {!data.sample && daysAgo(lastExport()) !== 0 && <span className="muted-s">Last backup: {agoText(daysAgo(lastExport()))}</span>}
          <button className="link-btn" onClick={() => go('settings')}>
            Settings
          </button>
          <button className="link-btn" onClick={() => setSyncOpen(true)}>
            Sync and backup
          </button>
        </div>
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
        {tab === 'month' && <Month />}
        {tab === 'train' && <Train view={view} setView={setView} />}
        {tab === 'money' && <Money />}
        {tab === 'career' && <Career />}
        {tab === 'rewards' && <Rewards />}
        {tab === 'advisor' && <Advisor go={go} />}
        {tab === 'body' && <Body />}
        {tab === 'settings' && <Settings go={go} onSync={() => setSyncOpen(true)} />}
      </main>
      {syncOpen && <Sync onClose={() => setSyncOpen(false)} />}
    </div>
  );
}
