import { useMemo } from 'react';
import { useStore } from '../store';
import { allCurrencies, currencyName, currencySymbol, detectPrefs, resolvePrefs } from '../units';
import type { LengthUnit, WeightUnit } from '../units';

const REGION_NAMES = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

/** Currency and weight unit pickers. In the first-run setup only the relevant one is shown. */
export function RegionUnits({ show = 'both' }: { show?: 'both' | 'currency' | 'weight' }) {
  const { data, dispatch } = useStore();
  const prefs = resolvePrefs(data);
  const detected = useMemo(() => detectPrefs(), []);
  const codes = useMemo(() => {
    const all = allCurrencies();
    return [detected.prefs.currency, ...all.filter((c) => c !== detected.prefs.currency)];
  }, [detected]);
  const set = (p: Partial<typeof prefs>) => dispatch({ t: 'prefs', value: { ...prefs, ...p } });
  const where = detected.region ? (REGION_NAMES?.of(detected.region) ?? detected.region) : null;
  const matches = detected.prefs.currency === prefs.currency && detected.prefs.weightUnit === prefs.weightUnit && detected.prefs.lengthUnit === prefs.lengthUnit;

  return (
    <div className="region">
      <div className="grid2">
        {show !== 'weight' && (
          <label className="field">
            <span>Currency</span>
            <select value={prefs.currency} onChange={(e) => set({ currency: e.target.value })}>
              {codes.includes(prefs.currency) ? null : <option value={prefs.currency}>{prefs.currency}</option>}
              {codes.map((c) => (
                <option key={c} value={c}>
                  {c} {currencySymbol(c)} · {currencyName(c)}
                  {c === detected.prefs.currency && detected.basis !== 'default' ? ' (suggested)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        {show !== 'currency' && (
          <label className="field">
            <span>Weight</span>
            <select value={prefs.weightUnit} onChange={(e) => set({ weightUnit: e.target.value as WeightUnit })}>
              <option value="kg">Kilograms (kg){detected.prefs.weightUnit === 'kg' && detected.basis !== 'default' ? ' (suggested)' : ''}</option>
              <option value="lb">Pounds (lb){detected.prefs.weightUnit === 'lb' ? ' (suggested)' : ''}</option>
            </select>
          </label>
        )}
        {show === 'both' && (
          <label className="field">
            <span>Body measurements</span>
            <select value={prefs.lengthUnit} onChange={(e) => set({ lengthUnit: e.target.value as LengthUnit })}>
              <option value="cm">Centimetres (cm){detected.prefs.lengthUnit === 'cm' && detected.basis !== 'default' ? ' (suggested)' : ''}</option>
              <option value="in">Inches (in){detected.prefs.lengthUnit === 'in' ? ' (suggested)' : ''}</option>
            </select>
          </label>
        )}
      </div>
      <p className="note">
        {detected.basis === 'default' ? 'Couldn’t tell where you are, so these start as dollars and kilograms.' : <>Suggested from your {detected.basis === 'timezone' ? 'timezone' : 'browser language'}{where ? ` (${where})` : ''}. Your location is never looked up online.</>}
        {!matches && detected.basis !== 'default' && (
          <>
            {' '}
            <button type="button" className="link-btn" onClick={() => set(detected.prefs)}>
              Use the suggestion
            </button>
          </>
        )}
      </p>
    </div>
  );
}
