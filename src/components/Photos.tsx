import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MAX_PHOTOS, NOTE_MAX, addPhoto, askToKeepPhotos, byDate, daysBetween, idbStore, newPhotoId, photoErrorText, shrinkImage } from '../photos';
import type { PhotoMeta } from '../photos';
import { fmtShort, todayKey } from '../utils';

const label = (p: PhotoMeta) => `${fmtShort(p.date)}${p.note ? `, ${p.note}` : ''}`;

/** Progress photos: kept in this browser only. Added, compared and deleted here; see src/photos.ts for where and how. */
export function Photos() {
  const store = useMemo(() => idbStore(), []);
  const today = todayKey();
  const [photos, setPhotos] = useState<PhotoMeta[] | null>(null);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [viewId, setViewId] = useState<string | null>(null);
  const [beforeId, setBeforeId] = useState('');
  const [afterId, setAfterId] = useState('');
  const [pictures, setPictures] = useState<Record<string, string>>({});
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const refresh = useCallback(async () => {
    try {
      const list = byDate(await store.list());
      if (mounted.current) setPhotos(list);
    } catch (e) {
      if (mounted.current) {
        setPhotos([]);
        setError(photoErrorText(e));
      }
    }
  }, [store]);
  useEffect(() => void refresh(), [refresh]);

  // Compare starts on the oldest and the newest photo, and moves if the one chosen is deleted.
  useEffect(() => {
    if (!photos) return;
    const has = (id: string) => photos.some((p) => p.id === id);
    if (photos.length >= 2) {
      if (!has(beforeId)) setBeforeId(photos[0].id);
      if (!has(afterId)) setAfterId(photos[photos.length - 1].id);
    } else {
      setBeforeId('');
      setAfterId('');
    }
    if (viewId && !has(viewId)) setViewId(null);
  }, [photos, beforeId, afterId, viewId]);

  // Big pictures are read only when they are on screen.
  const wanted = useMemo(() => [...new Set([viewId, beforeId, afterId].filter((x): x is string => !!x))], [viewId, beforeId, afterId]);
  useEffect(() => {
    let live = true;
    for (const id of wanted) {
      if (pictures[id]) continue;
      store.full(id).then(
        (full) => live && full && setPictures((cur) => ({ ...cur, [id]: full })),
        () => live && setError(photoErrorText(null)),
      );
    }
    return () => void (live = false);
  }, [wanted, pictures, store]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    setStatus('');
    setBusy(true);
    try {
      const { full, thumb } = await shrinkImage(file);
      await addPhoto(store, { id: newPhotoId(), date, note: note.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX), full, thumb });
      setNote('');
      setStatus('Photo saved on this device.');
      void askToKeepPhotos();
      await refresh();
    } catch (e) {
      setError(photoErrorText(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const remove = async (p: PhotoMeta) => {
    if (!window.confirm(`Delete the photo from ${label(p)}? This cannot be undone.`)) return;
    try {
      await store.remove(p.id);
      setPictures(({ [p.id]: _gone, ...rest }) => rest);
      setStatus('Photo deleted.');
      await refresh();
    } catch (e) {
      setError(photoErrorText(e));
    }
  };

  const removeAll = async () => {
    if (!window.confirm(`Delete all ${photos?.length ?? 0} progress photos from this device? This cannot be undone.`)) return;
    try {
      await store.clear();
      setPictures({});
      setViewId(null);
      setStatus('All photos deleted.');
      await refresh();
    } catch (e) {
      setError(photoErrorText(e));
    }
  };

  const list = photos ?? [];
  const before = list.find((p) => p.id === beforeId);
  const after = list.find((p) => p.id === afterId);
  const viewing = list.find((p) => p.id === viewId);

  return (
    <section className="panel" aria-labelledby="photos-title">
      <h2 id="photos-title">Progress photos</h2>
      <p className="note first">
        Photos stay in this browser on this device. They are not saved with your dashboard data, not uploaded, and <b>not synced</b> to your other devices. They are shrunk when added, and the camera’s hidden details (such as where it was taken) are removed. They are in a downloaded copy only if you tick the box when saving one.
      </p>

      <div className="form photo-form">
        <label className="field">
          <span>Date</span>
          <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value || today)} />
        </label>
        <label className="field">
          <span>Note (optional)</span>
          <input value={note} maxLength={NOTE_MAX} placeholder="Front, relaxed" onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="row-action photo-add">
          <label className={`btn primary file-btn${busy || list.length >= MAX_PHOTOS ? ' disabled' : ''}`}>
            {busy ? 'Saving…' : 'Take a photo'}
            <input type="file" accept="image/*" capture="user" disabled={busy || list.length >= MAX_PHOTOS} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
          <label className={`btn file-btn${busy || list.length >= MAX_PHOTOS ? ' disabled' : ''}`}>
            Choose a picture
            <input type="file" accept="image/*" aria-label="Choose a picture from this device" disabled={busy || list.length >= MAX_PHOTOS} onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
      </div>
      {error && <p className="err" role="alert">{error}</p>}
      {status && !error && <p className="ok" role="status">{status}</p>}

      {photos == null ? null : list.length === 0 ? (
        <p className="empty">No photos yet. Take the first one in the same light and pose each time so the comparison is fair.</p>
      ) : (
        <>
          {list.length >= 2 && (
            <div className="photo-compare">
              <h3>Compare</h3>
              <div className="photo-pickers">
                <label className="field">
                  <span>Before</span>
                  <select value={beforeId} onChange={(e) => setBeforeId(e.target.value)}>
                    {list.map((p) => (
                      <option key={p.id} value={p.id}>{label(p)}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>After</span>
                  <select value={afterId} onChange={(e) => setAfterId(e.target.value)}>
                    {list.map((p) => (
                      <option key={p.id} value={p.id}>{label(p)}</option>
                    ))}
                  </select>
                </label>
              </div>
              {before && after && (
                <>
                  <div className="photo-pair">
                    {[before, after].map((p, i) => (
                      <figure key={`${i}-${p.id}`}>
                        {pictures[p.id] ? <img src={pictures[p.id]} alt={`${i === 0 ? 'Before' : 'After'}: progress photo from ${label(p)}`} /> : <div className="photo-wait" aria-hidden="true" />}
                        <figcaption>
                          <b>{i === 0 ? 'Before' : 'After'}</b> {fmtShort(p.date)}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                  <p className="note" data-testid="photo-gap">
                    {before.id === after.id ? 'The same photo is chosen on both sides.' : `${daysBetween(before.date, after.date)} days apart.`}
                  </p>
                </>
              )}
            </div>
          )}

          {viewing && (
            <figure className="photo-view">
              {pictures[viewing.id] ? <img src={pictures[viewing.id]} alt={`Progress photo from ${label(viewing)}`} /> : <div className="photo-wait" aria-hidden="true" />}
              <figcaption>{label(viewing)}</figcaption>
              <button className="btn" onClick={() => setViewId(null)}>
                Close photo
              </button>
            </figure>
          )}

          <ul className="photo-grid" aria-label="Your progress photos, oldest first">
            {list.map((p) => (
              <li key={p.id} className="photo-card">
                <img src={p.thumb} alt="" />
                <span className="photo-date">{fmtShort(p.date)}</span>
                {p.note && <small>{p.note}</small>}
                <span className="row-action photo-actions">
                  <button className="btn" onClick={() => setViewId(p.id)} aria-label={`Open the photo from ${label(p)}`}>
                    Open
                  </button>
                  <button className="btn ghost" onClick={() => void remove(p)} aria-label={`Delete the photo from ${label(p)}`}>
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <div className="row-action photo-bulk">
            <small className="muted-s">{list.length} of {MAX_PHOTOS} kept on this device</small>
            <button className="btn ghost" onClick={() => void removeAll()}>
              Delete all photos
            </button>
          </div>
        </>
      )}
    </section>
  );
}
