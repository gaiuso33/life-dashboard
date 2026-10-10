import { useEffect, useMemo, useRef, useState } from 'react';
import { describeGains, mergeData } from '../merge';
import { agoText, canShareFile, daysAgo, downloadData, lastExport, parseImport, shareData } from '../sync';
import { useStore } from '../store';
import type { AppData } from '../types';
import { Account } from './Account';

export function Sync({ onClose }: { onClose: () => void }) {
  const { data, importData } = useStore();
  const [incoming, setIncoming] = useState<AppData | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [exported, setExported] = useState(lastExport());
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const merged = useMemo(() => (incoming ? mergeData(data, incoming) : null), [data, incoming]);
  const gains = useMemo(() => (merged ? describeGains(data, merged) : []), [data, merged]);
  const mixed = incoming != null && incoming.sample !== data.sample;
  const canShare = useMemo(() => canShareFile(data), [data]);

  const pick = async (file: File | undefined) => {
    setError('');
    setDone('');
    setIncoming(null);
    if (!file) return;
    if (file.size > 20_000_000) return setError('That file is too large to be a dashboard export.');
    const res = parseImport(await file.text());
    if (!res.ok) return setError(res.error);
    setName(file.name);
    setIncoming(res.data);
  };

  const doExport = () => {
    downloadData(data);
    setExported(lastExport());
  };

  return (
    <div className="modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal panel" role="dialog" aria-modal="true" aria-labelledby="sync-title">
        <div className="panel-top">
          <h2 id="sync-title">Sync and backup</h2>
          <button ref={closeRef} className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <h3>Cloud sync</h3>
        <Account />

        <h3>Backup and moving by hand</h3>
        <p className="note first">Without an account your data lives only on this device. A file copy works anywhere, and merging combines both sides and never loses entries.</p>

        <h4>1. Save a copy from this device</h4>
        <p className="note first">
          Last saved: {agoText(daysAgo(exported))}. {data.sample ? 'This is sample data.' : ''}
        </p>
        <div className="row-action">
          <button className="btn primary" onClick={doExport}>
            Download copy
          </button>
          {canShare && (
            <button
              className="btn"
              onClick={async () => {
                if (await shareData(data)) setExported(lastExport());
              }}
            >
              Share to another app
            </button>
          )}
        </div>
        <p className="note">Send it to yourself on WhatsApp, Telegram or email, or save it to a cloud drive. It doesn’t include your Claude API key.</p>

        <h4>2. Bring in a copy from another device</h4>
        <label className="btn file-btn">
          Choose a .json file
          <input type="file" accept="application/json,.json" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {error && <p className="err" role="alert">{error}</p>}

        {incoming && merged && (
          <div className="preview-box">
            <p>
              <b>{name}</b>
            </p>
            {mixed ? (
              <p className="note first">
                {data.sample ? 'This device only has sample data, so the imported data will replace it.' : 'The imported file only has sample data, so merging would change nothing. Nothing will be imported.'}
              </p>
            ) : gains.length > 0 ? (
              <>
                <p className="note first">Merging adds to this device:</p>
                <ul className="bullets">{gains.map((g) => <li key={g}>{g}</li>)}</ul>
              </>
            ) : (
              <p className="note first">Nothing new in this file. This device already has all of it.</p>
            )}
            <div className="row-action">
              <button
                className="btn primary"
                disabled={mixed && !data.sample}
                onClick={() => {
                  importData(merged);
                  setDone(`Merged. ${gains.length ? 'This device now has everything from both.' : 'Nothing changed.'}`);
                  setIncoming(null);
                }}
              >
                Merge
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (window.confirm('Replace everything on this device with this file? Anything only on this device is lost.')) {
                    importData(incoming);
                    setDone('Replaced. This device now matches the file.');
                    setIncoming(null);
                  }
                }}
              >
                Replace instead
              </button>
            </div>
          </div>
        )}
        {done && <p className="ok" role="status">{done}</p>}

        <details className="preview">
          <summary>How to use it on your phone</summary>
          <ol className="bullets steps">
            <li>Open the hosted address of the dashboard on your phone and add it to your home screen.</li>
            <li>On the laptop, choose Download copy and send the file to yourself.</li>
            <li>On the phone, open Sync and backup, choose the file, then Merge.</li>
            <li>After logging on the phone, do the same in the other direction. Do this every few days, or whenever you log on both.</li>
          </ol>
          <p className="note">If you changed the same thing on both devices, the device you edited most recently wins for that item. Everything else is combined.</p>
        </details>
      </div>
    </div>
  );
}
