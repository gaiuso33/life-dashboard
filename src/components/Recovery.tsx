import { useState } from 'react';
import { useStore } from '../store';
import { downloadText, parseImport } from '../sync';
import { emptyData } from '../types';
import { todayKey } from '../utils';

/** Shown when saved data exists but can't be read. Nothing is overwritten until the person chooses here. */
export function Recovery() {
  const { recovery, resolveRecovery } = useStore();
  const [error, setError] = useState('');
  if (!recovery) return null;
  const when = recovery.backup?.at ? new Date(recovery.backup.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="welcome">
      <div className="welcome-card panel" role="alert">
        <h1>We couldn’t read your saved data</h1>
        <p className="sub">Nothing has been changed or deleted. Pick how to continue. Your original data stays on this device either way, so you can still download it.</p>
        <div className="welcome-actions">
          <button className="btn" onClick={() => downloadText(`life-dashboard-unreadable-${todayKey()}.json`, recovery.raw)}>
            Download the unreadable data
          </button>
          {recovery.backup && (
            <button className="btn primary" onClick={() => resolveRecovery(recovery.backup!.data)}>
              Restore the automatic backup{when ? ` from ${when}` : ''}
            </button>
          )}
          <label className="btn file-btn">
            Use a copy I downloaded earlier
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                const res = parseImport(await f.text());
                if (res.ok) resolveRecovery(res.data);
                else setError(res.error);
              }}
            />
          </label>
          <button
            className="btn ghost"
            onClick={() => {
              if (window.confirm('Start with an empty dashboard? The unreadable data stays on this device until you clear it yourself.')) resolveRecovery(emptyData());
            }}
          >
            Start with an empty dashboard
          </button>
        </div>
        {error && <p className="err" role="alert">{error}</p>}
      </div>
    </div>
  );
}
