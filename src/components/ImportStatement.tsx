import { useEffect, useMemo, useRef, useState } from 'react';
import { categoriesOf, naira } from '../money';
import { buildRows, detectDateOrder, findHeaderRow, guessMapping, mappingProblem, NONE, parseCsv, planImport } from '../statement';
import type { DateOrder, ImportRow, Mapping, RowKind } from '../statement';
import { useStore } from '../store';
import { fmtShort, todayKey } from '../utils';

const MAX_BYTES = 5_000_000;
const SHOWN = 60;
const KIND_LABEL: Record<RowKind, string> = { expense: 'Spent', income: 'Received', saving: 'Saved', skip: 'Don’t import' };

type Step = 'pick' | 'map' | 'review' | 'done';

export function ImportStatement({ onClose }: { onClose: () => void }) {
  const { data, dispatch } = useStore();
  const today = todayKey();
  const categories = categoriesOf(data);
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState('');
  const [paste, setPaste] = useState('');
  const [table, setTable] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [map, setMap] = useState<Mapping | null>(null);
  const [order, setOrder] = useState<DateOrder>('dmy');
  const [certain, setCertain] = useState(true);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [added, setAdded] = useState<{ n: number; from: string; to: string } | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const load = (text: string) => {
    setError('');
    const { rows: all } = parseCsv(text);
    if (all.length < 2) return setError('That doesn’t look like a statement. It needs a row of column names and at least one entry. Save it as CSV and try again.');
    const h = findHeaderRow(all);
    const body = all.slice(h + 1);
    const m = guessMapping(all[h]);
    const d = detectDateOrder(body.map((r) => r[m.date] ?? ''));
    setHeaders(all[h]);
    setTable(body);
    setMap(m);
    setOrder(d.order);
    setCertain(d.certain);
    setStep('map');
  };

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) return setError('That file is too large to be a statement. Try a shorter date range.');
    if (/\.(xlsx?|pdf)$/i.test(file.name)) return setError('This needs a CSV file. In your bank or wallet app choose CSV when exporting, or open the Excel file and use Save As, CSV. PDF statements can’t be read reliably.');
    load(await file.text());
  };

  const problem = map ? mappingProblem(map) : null;
  const built = useMemo(() => (map && !problem ? buildRows(table, map, order, categories, today, headers.length) : null), [table, map, order, categories, today, headers.length, problem]);

  const existing = useMemo(() => new Set(data.money.txns.map((t) => t.id)), [data.money.txns]);
  const gone = useMemo(() => new Set(data.gone), [data.gone]);
  const plan = useMemo(() => planImport(rows, existing, gone), [rows, existing, gone]);

  const totals = useMemo(() => {
    const t = { expense: 0, income: 0, saving: 0 };
    for (const x of plan.add) t[x.kind] += x.amount;
    return t;
  }, [plan]);
  const range = useMemo(() => {
    const ds = plan.add.map((t) => t.date).sort();
    return ds.length ? { from: ds[0], to: ds[ds.length - 1] } : null;
  }, [plan]);

  const set = (patch: Partial<Mapping>) => setMap((m) => (m ? { ...m, ...patch } : m));
  const edit = (i: number, patch: Partial<ImportRow>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const colOptions = (allowNone: boolean) => (
    <>
      {allowNone && <option value={NONE}>None</option>}
      {headers.map((h, i) => (
        <option key={i} value={i}>
          {h || `Column ${i + 1}`}
        </option>
      ))}
    </>
  );

  return (
    <div className="modal-back" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal wide panel" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="panel-top">
          <h2 id="import-title">Import a statement</h2>
          <button ref={closeRef} className="btn" onClick={onClose}>
            Close
          </button>
        </div>

        {step === 'pick' && (
          <>
            <p className="note first">Bring in past spending from your bank or wallet statement, so the survival fund target uses real history. The file is read on this device and never uploaded.</p>
            <ol className="bullets steps">
              <li>In your bank or wallet app, export your statement as <b>CSV</b>.</li>
              <li>Choose the file below, or paste the rows.</li>
              <li>Check that the columns were matched correctly, review the entries, then import.</li>
            </ol>
            <label className="btn file-btn">
              Choose a CSV file
              <input type="file" accept=".csv,text/csv,text/plain,.txt" onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <label className="field">
              <span>Or paste the rows here</span>
              <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)} spellCheck={false} />
            </label>
            {paste.trim() && (
              <button className="btn" onClick={() => load(paste)}>
                Use pasted rows
              </button>
            )}
            {error && <p className="err" role="alert">{error}</p>}
            <p className="note">Importing the same statement twice, or two statements that overlap, never creates duplicates. Entries you remove stay removed.</p>
          </>
        )}

        {step === 'map' && map && (
          <>
            <p className="note first">
              Match the columns. The first guess is usually right, but check the example rows below. {table.length} row{table.length === 1 ? '' : 's'} found.
            </p>
            <div className="map-grid">
              <label className="field">
                <span>Date column</span>
                <select value={map.date} onChange={(e) => set({ date: Number(e.target.value) })}>{colOptions(true)}</select>
              </label>
              <label className="field">
                <span>Description column</span>
                <select value={map.desc} onChange={(e) => set({ desc: Number(e.target.value) })}>{colOptions(true)}</select>
              </label>
              <label className="field">
                <span>Amounts are in</span>
                <select value={map.mode} onChange={(e) => set({ mode: e.target.value as Mapping['mode'] })}>
                  <option value="split">Separate money out and money in columns</option>
                  <option value="single">One amount column</option>
                </select>
              </label>
              {map.mode === 'split' ? (
                <>
                  <label className="field">
                    <span>Money out (debit) column</span>
                    <select value={map.debit} onChange={(e) => set({ debit: Number(e.target.value) })}>{colOptions(true)}</select>
                  </label>
                  <label className="field">
                    <span>Money in (credit) column</span>
                    <select value={map.credit} onChange={(e) => set({ credit: Number(e.target.value) })}>{colOptions(true)}</select>
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Amount column</span>
                    <select value={map.amount} onChange={(e) => set({ amount: Number(e.target.value) })}>{colOptions(true)}</select>
                  </label>
                  <label className="field">
                    <span>Money spent shows as</span>
                    <select value={map.negativeIsSpent ? 'neg' : 'pos'} onChange={(e) => set({ negativeIsSpent: e.target.value === 'neg' })}>
                      <option value="neg">Negative numbers (−1,500)</option>
                      <option value="pos">Positive numbers (1,500)</option>
                    </select>
                  </label>
                </>
              )}
              <label className="field">
                <span>Dates are written</span>
                <select value={order} onChange={(e) => setOrder(e.target.value as DateOrder)}>
                  <option value="dmy">Day first (25/12/2026)</option>
                  <option value="mdy">Month first (12/25/2026)</option>
                </select>
              </label>
            </div>
            {!certain && <p className="note">These dates could be read either way (for example 03/04/2026). Day first is assumed. Change it above if the dates in the next step look wrong.</p>}
            {problem && <p className="err" role="alert">{problem}</p>}

            <div className="table-wrap" tabIndex={0} role="region" aria-label="First rows of the file">
              <table className="mini">
                <caption className="sr-only">First rows of the file</caption>
                <thead>
                  <tr>{headers.map((h, i) => <th key={i} scope="col">{h || `Column ${i + 1}`}</th>)}</tr>
                </thead>
                <tbody>
                  {table.slice(0, 4).map((r, i) => (
                    <tr key={i}>{headers.map((_, c) => <td key={c}>{r[c] ?? ''}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            {built && (
              <p className="note" role="status">
                {built.rows.length} of {table.length} rows can be read.
                {built.unreadable > 0 && ` ${built.unreadable} left out (headings, totals or rows that don’t fit the columns).`}
                {built.outOfRange > 0 && ` ${built.outOfRange} left out for being dated in the future.`}
              </p>
            )}
            <div className="row-action">
              <button className="btn" onClick={() => setStep('pick')}>Back</button>
              <button
                className="btn primary"
                disabled={!built || built.rows.length === 0}
                onClick={() => {
                  setRows(built!.rows);
                  setShowAll(false);
                  setStep('review');
                }}
              >
                Review entries
              </button>
            </div>
          </>
        )}

        {step === 'review' && built && (
          <>
            <div className="import-summary" role="status">
              <p>
                <b>{plan.add.length}</b> new entr{plan.add.length === 1 ? 'y' : 'ies'}{range ? `, ${fmtShort(range.from)} to ${fmtShort(range.to)}` : ''}
              </p>
              <p className="note first">
                Spent {naira(totals.expense)} · Received {naira(totals.income)} · Saved {naira(totals.saving)}
              </p>
              {plan.duplicates > 0 && <p className="note first">{plan.duplicates} already imported before, so they’re skipped.</p>}
              {plan.removedEarlier > 0 && <p className="note first">{plan.removedEarlier} you removed earlier stay removed.</p>}
              {plan.skipped > 0 && <p className="note first">{plan.skipped} marked “Don’t import”.</p>}
              {(built.unreadable > 0 || built.outOfRange > 0) && <p className="note first">{built.unreadable + built.outOfRange} {built.unreadable + built.outOfRange === 1 ? 'row' : 'rows'} in the file couldn’t be read and {built.unreadable + built.outOfRange === 1 ? 'is' : 'are'} left out.</p>}
            </div>
            <p className="note">Transfers into your own savings are marked <b>Saved</b>, and money coming back out of savings is marked <b>Don’t import</b>, so they don’t count as spending or income. Change anything that looks wrong.</p>
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Entries to import">
              <table className="mini review">
                <caption className="sr-only">Entries to import</caption>
                <thead>
                  <tr>
                    <th scope="col">Date</th>
                    <th scope="col">Description</th>
                    <th scope="col" className="num">Amount</th>
                    <th scope="col">Type</th>
                    <th scope="col">Category</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, showAll ? undefined : SHOWN).map((r, i) => (
                    <tr key={i} className={r.kind === 'skip' ? 'dim' : undefined}>
                      <td>{fmtShort(r.date)}</td>
                      <td>{r.note || <span className="muted-s">No description</span>}</td>
                      <td className="num">{r.direction === 'out' ? '−' : '+'}{naira(r.amount)}</td>
                      <td>
                        <select value={r.kind} aria-label={`Type for ${r.note || 'entry'} on ${r.date}`} onChange={(e) => edit(i, { kind: e.target.value as RowKind })}>
                          {(Object.keys(KIND_LABEL) as RowKind[]).map((k) => (
                            <option key={k} value={k} disabled={(k === 'expense' || k === 'saving') && r.direction === 'in'}>
                              {KIND_LABEL[k]}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {r.kind === 'expense' ? (
                          <select value={r.category} aria-label={`Category for ${r.note || 'entry'} on ${r.date}`} onChange={(e) => edit(i, { category: e.target.value })}>
                            {categories.map((c) => <option key={c}>{c}</option>)}
                          </select>
                        ) : (
                          <span className="muted-s">{r.kind === 'saving' ? 'Survival fund' : ''}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.length > SHOWN && !showAll && (
              <button className="btn ghost" onClick={() => setShowAll(true)}>
                Show all {rows.length}
              </button>
            )}
            <div className="row-action">
              <button className="btn" onClick={() => setStep('map')}>Back</button>
              <button
                className="btn primary"
                disabled={plan.add.length === 0}
                onClick={() => {
                  dispatch({ t: 'txn-import', txns: plan.add });
                  setAdded({ n: plan.add.length, from: range?.from ?? '', to: range?.to ?? '' });
                  setStep('done');
                }}
              >
                Import {plan.add.length} entr{plan.add.length === 1 ? 'y' : 'ies'}
              </button>
            </div>
          </>
        )}

        {step === 'done' && added && (
          <>
            <p className="ok" role="status">
              Imported {added.n} entr{added.n === 1 ? 'y' : 'ies'} ({fmtShort(added.from)} to {fmtShort(added.to)}).
            </p>
            <p className="note">They’re in Recent entries and counted in your monthly totals and survival fund target. To take one out, use Remove next to it.</p>
            <button className="btn primary" onClick={onClose}>Done</button>
          </>
        )}
      </div>
    </div>
  );
}
