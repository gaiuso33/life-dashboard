import { useState } from 'react';
import { useCloud } from '../cloud/CloudProvider';
import { isDemo } from '../demo';
import { guideHidden, guideSteps, hideGuide } from '../guide';
import type { StepKey } from '../guide';
import { promptInstall, useInstall } from '../install';
import type { Tab } from '../nav';
import { remindersMade } from '../reminders';
import { useStore } from '../store';
import { lastExport } from '../sync';

/** A short checklist for people who are new. It ticks itself from what they have actually done, and goes away when finished or dismissed. */
export function GettingStarted({ go, onSync }: { go: (t: Tab) => void; onSync: () => void }) {
  const { data } = useStore();
  const cloud = useCloud();
  const install = useInstall();
  const [hidden, setHidden] = useState(guideHidden());
  if (hidden || isDemo || data.sample) return null;

  const steps = guideSteps(data, {
    installed: install === 'installed',
    canInstall: install !== 'file',
    reminders: remindersMade(),
    backedUp: !!cloud.email || !!lastExport(),
  });
  const left = steps.filter((s) => !s.done);
  if (!left.length) return null;

  const act: Record<StepKey, { label: string; run: () => void }> = {
    plates: { label: 'Open today', run: () => go('today') },
    money: { label: 'Open money', run: () => go('money') },
    career: { label: 'Open career', run: () => go('career') },
    reminders: { label: 'Set reminders', run: () => go('settings') },
    install: { label: install === 'ready' ? 'Install app' : 'How to install', run: () => (install === 'ready' ? void promptInstall() : go('settings')) },
    backup: { label: 'Back up', run: onSync },
  };

  return (
    <section className="panel guide" aria-labelledby="guide-title">
      <div className="panel-top">
        <h2 id="guide-title">Getting started</h2>
        <span className="muted-s">
          {steps.length - left.length} of {steps.length} done
        </span>
      </div>
      <ul className="rows">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? 'row is-done' : 'row'}>
            <span className="guide-tick" aria-hidden="true">
              {s.done ? '✓' : ''}
            </span>
            <div className="row-text">
              <b>
                {s.title}
                {s.done && <span className="sr-only"> (done)</span>}
              </b>
              {!s.done && <span>{s.detail}</span>}
            </div>
            {!s.done && (
              <div className="row-action">
                <button className="btn" onClick={act[s.key].run}>
                  {act[s.key].label}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      <button
        className="link-btn"
        onClick={() => {
          hideGuide();
          setHidden(true);
        }}
      >
        Hide this
      </button>
    </section>
  );
}
