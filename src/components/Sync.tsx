import { useEffect, useMemo, useRef, useState } from 'react';
import { describeGains, mergeData } from '../merge';
import { agoText, canShareFile, daysAgo, downloadData, fileTooLargeText, lastExport, MAX_IMPORT_BYTES, parseImport, photosFitInCopy, shareData } from '../sync';
import { MAX_PHOTOS, idbStore, importPhotos, photoErrorText } from '../photos';
import type { Photo } from '../photos';
import { useStore } from '../store';
import type { AppData } from '../types';
import { Account } from './Account';

export function Sync({ onClose }: { onClose: () => void }) {
  const { data, importData } = useStore();
  const [incoming, setIncoming] = useState<AppData | null>(null);
  const store = useMemo(() => idbStore(), []);
  // Photos carried by a chosen file, and how many of them this device does not have yet.
  const [incomingPhotos, setIncomingPhotos] = useState<Photo[]>([]);
  const [newPhotos, setNewPhotos] = useState(0);
  const [photoCount, setPhotoCount] = useState(0);
  const [withPhotos, setWithPhotos] = useState(false);
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

  useEffect(() => {
    store.list().then((l) => setPhotoCount(l.length), () => setPhotoCount(0));
  }, [store]);

  const merged = useMemo(() => (incoming ? mergeData(data, incoming) : null), [data, incoming]);
  const gains = useMemo(() => (merged ? describeGains(data, merged) : []), [data, merged]);
  const mixed = incoming != null && incoming.sample !== data.sample;
  const canShare = useMemo(() => canShareFile(data), [data]);

  const pick = async (file: File | undefined) => {
    setError('');
    setDone('');
    setIncoming(null);
    setIncomingPhotos([]);
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) return setError(fileTooLargeText);
    const res = parseImport(await file.text());
    if (!res.ok) return setError(res.error);
    const have = new Set(await store.list().then((l) => l.map((p) => p.id), () => []));
    setName(file.name);
    setIncomingPhotos(res.photos);
    setNewPhotos(res.photos.filter((p) => !have.has(p.id)).length);
    setIncoming(res.data);
  };

  /** Photos from the chosen file are added to this device's; none are ever removed by an import. */
  const bringInPhotos = async (): Promise<string> => {
    if (!newPhotos) return '';
    try {
      const r = await importPhotos(store, incomingPhotos);
      setPhotoCount((n) => n + r.added);
      return r.skipped > r.added || r.added < newPhotos ? ` ${r.added} of ${newPhotos} new photos were added (this device keeps at most ${MAX_PHOTOS}).` : ` ${r.added} photo${r.added === 1 ? '' : 's'} added.`;
    } catch (e) {
      return ` The photos could not be saved: ${photoErrorText(e)}`;
    }
  };

  // Photos go into the copy only when the box is ticked, and only if the file would still be small enough to open again.
  const photosForCopy = async (): Promise<Photo[] | undefined | null> => {
    if (!withPhotos || photoCount === 0) return undefined;
    try {
      const all = await store.all();
      if (!photosFitInCopy(all)) {
        setError('Your photos are too big to fit in one copy. Save the copy without photos, or delete some photos first.');
        return null;
      }
      return all;
    } catch (e) {
      setError(photoErrorText(e));
      return null;
    }
  };

  const doExport = async () => {
    setError('');
    const photos = await photosForCopy();
    if (photos === null) return;
    downloadData(data, photos);
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
          <button className="btn primary" onClick={() => void doExport()}>
            Download copy
          </button>
          {canShare && (
            <button
              className="btn"
              onClick={async () => {
                setError('');
                const photos = await photosForCopy();
                if (photos === null) return;
                if (await shareData(data, photos)) setExported(lastExport());
              }}
            >
              Share to another app
            </button>
          )}
        </div>
        {photoCount > 0 && (
          <label className="check">
            <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
            <span>Include my {photoCount} progress photo{photoCount === 1 ? '' : 's'} (the file will be much bigger)</span>
          </label>
        )}
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
            {incomingPhotos.length > 0 && <p className="note">The file also has {incomingPhotos.length} progress photo{incomingPhotos.length === 1 ? '' : 's'}; {newPhotos} {newPhotos === 1 ? 'is' : 'are'} new to this device. Photos are only ever added, never removed.</p>}
            <div className="row-action">
              <button
                className="btn primary"
                disabled={mixed && !data.sample}
                onClick={async () => {
                  importData(merged);
                  const photoNote = await bringInPhotos();
                  setDone(`Merged. ${gains.length ? 'This device now has everything from both.' : 'Nothing changed.'}${photoNote}`);
                  setIncoming(null);
                }}
              >
                Merge
              </button>
              <button
                className="btn"
                onClick={async () => {
                  if (window.confirm('Replace everything on this device with this file? Anything only on this device is lost. Photos already on this device are kept.')) {
                    importData(incoming);
                    const photoNote = await bringInPhotos();
                    setDone(`Replaced. This device now matches the file.${photoNote}`);
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
