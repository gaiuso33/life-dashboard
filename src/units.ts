import type { AppData } from './types';

// Currency and weight follow where the person is, without asking the browser for their location: the timezone says which
// country they are in far more reliably than the language does, and the browser language is the fallback. Nothing is looked up
// online, and the person can always change it. Amounts are only relabelled when the currency changes, never converted.

export type WeightUnit = 'kg' | 'lb';
export type LengthUnit = 'cm' | 'in';
export interface Prefs {
  /** ISO 4217 code, e.g. NGN, USD. */
  currency: string;
  weightUnit: WeightUnit;
  /** Body measurements (waist, chest, arms…). Stored in centimetres whatever is shown. */
  lengthUnit: LengthUnit;
}

/** What every save from before this setting existed was using. Existing people keep it until they choose otherwise. */
export const LEGACY_PREFS: Prefs = { currency: 'NGN', weightUnit: 'kg', lengthUnit: 'cm' };

const EUR = 'EUR';
/** Country → currency. Countries not listed fall back to US dollars and kilograms until the person picks. */
const REGIONS: Record<string, string> = {
  NG: 'NGN', GH: 'GHS', KE: 'KES', ZA: 'ZAR', EG: 'EGP', ET: 'ETB', TZ: 'TZS', UG: 'UGX', RW: 'RWF', SN: 'XOF', CI: 'XOF', CM: 'XAF',
  MA: 'MAD', DZ: 'DZD', TN: 'TND', ZM: 'ZMW', BW: 'BWP', NA: 'NAD', MU: 'MUR', LR: 'USD',
  GB: 'GBP', IE: EUR, FR: EUR, DE: EUR, ES: EUR, IT: EUR, NL: EUR, BE: EUR, PT: EUR, AT: EUR, FI: EUR, GR: EUR, LU: EUR, SK: EUR, SI: EUR, EE: EUR, LV: EUR, LT: EUR, MT: EUR, CY: EUR, HR: EUR, BG: EUR,
  CH: 'CHF', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', TR: 'TRY', UA: 'UAH', RU: 'RUB',
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  IN: 'INR', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR', CN: 'CNY', JP: 'JPY', KR: 'KRW', SG: 'SGD', MY: 'MYR', TH: 'THB', VN: 'VND', ID: 'IDR', PH: 'PHP', HK: 'HKD', TW: 'TWD', MM: 'MMK',
  AU: 'AUD', NZ: 'NZD', AE: 'AED', SA: 'SAR', IL: 'ILS', QA: 'QAR', KW: 'KWD',
};

/** The few countries where people weigh themselves in pounds and measure themselves in inches. */
const POUNDS = new Set(['US', 'LR', 'MM']);

const ZONES: Record<string, string> = {
  'Africa/Lagos': 'NG', 'Africa/Accra': 'GH', 'Africa/Nairobi': 'KE', 'Africa/Johannesburg': 'ZA', 'Africa/Cairo': 'EG', 'Africa/Addis_Ababa': 'ET',
  'Africa/Dar_es_Salaam': 'TZ', 'Africa/Kampala': 'UG', 'Africa/Kigali': 'RW', 'Africa/Dakar': 'SN', 'Africa/Abidjan': 'CI', 'Africa/Douala': 'CM',
  'Africa/Casablanca': 'MA', 'Africa/Algiers': 'DZ', 'Africa/Tunis': 'TN', 'Africa/Lusaka': 'ZM', 'Africa/Gaborone': 'BW', 'Africa/Windhoek': 'NA',
  'Indian/Mauritius': 'MU', 'Africa/Monrovia': 'LR', 'Asia/Yangon': 'MM', 'Asia/Rangoon': 'MM',
  'Europe/London': 'GB', 'Europe/Dublin': 'IE', 'Europe/Paris': 'FR', 'Europe/Berlin': 'DE', 'Europe/Madrid': 'ES', 'Europe/Rome': 'IT', 'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE', 'Europe/Lisbon': 'PT', 'Europe/Vienna': 'AT', 'Europe/Helsinki': 'FI', 'Europe/Athens': 'GR', 'Europe/Luxembourg': 'LU',
  'Europe/Zurich': 'CH', 'Europe/Stockholm': 'SE', 'Europe/Oslo': 'NO', 'Europe/Copenhagen': 'DK', 'Europe/Warsaw': 'PL', 'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU', 'Europe/Bucharest': 'RO', 'Europe/Sofia': 'BG', 'Europe/Istanbul': 'TR', 'Europe/Kyiv': 'UA', 'Europe/Kiev': 'UA', 'Europe/Moscow': 'RU',
  'Europe/Zagreb': 'HR', 'Europe/Bratislava': 'SK', 'Europe/Ljubljana': 'SI', 'Europe/Tallinn': 'EE', 'Europe/Riga': 'LV', 'Europe/Vilnius': 'LT', 'Europe/Malta': 'MT',
  'America/Toronto': 'CA', 'America/Vancouver': 'CA', 'America/Edmonton': 'CA', 'America/Winnipeg': 'CA', 'America/Halifax': 'CA', 'America/Montreal': 'CA', 'America/St_Johns': 'CA',
  'America/Mexico_City': 'MX', 'America/Sao_Paulo': 'BR', 'America/Argentina/Buenos_Aires': 'AR', 'America/Buenos_Aires': 'AR', 'America/Santiago': 'CL', 'America/Bogota': 'CO', 'America/Lima': 'PE',
  'Asia/Kolkata': 'IN', 'Asia/Calcutta': 'IN', 'Asia/Karachi': 'PK', 'Asia/Dhaka': 'BD', 'Asia/Colombo': 'LK', 'Asia/Kathmandu': 'NP', 'Asia/Shanghai': 'CN',
  'Asia/Tokyo': 'JP', 'Asia/Seoul': 'KR', 'Asia/Singapore': 'SG', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Bangkok': 'TH', 'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN',
  'Asia/Jakarta': 'ID', 'Asia/Manila': 'PH', 'Asia/Hong_Kong': 'HK', 'Asia/Taipei': 'TW', 'Pacific/Auckland': 'NZ', 'Asia/Dubai': 'AE', 'Asia/Riyadh': 'SA',
  'Asia/Jerusalem': 'IL', 'Asia/Qatar': 'QA', 'Asia/Kuwait': 'KW', 'Pacific/Honolulu': 'US',
};

export function regionOfZone(zone: string): string | null {
  if (ZONES[zone]) return ZONES[zone];
  if (/^Australia\//.test(zone)) return 'AU';
  if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Boise|Juneau|Adak|Indiana\/|Kentucky\/|North_Dakota\/)/.test(zone) || /^US\//.test(zone)) return 'US';
  return null;
}

/** The country a language tag names outright ("en-GB" → GB). A bare "en" says nothing about where the person is. */
export function regionOfLanguage(tag: string): string | null {
  const m = /^[a-z]{2,3}(?:-[A-Za-z]{4})?-([A-Za-z]{2})(?:-|$)/.exec(tag);
  return m ? m[1].toUpperCase() : null;
}

export interface Detected {
  prefs: Prefs;
  region: string | null;
  /** Where the guess came from, for the settings screen to say plainly. */
  basis: 'timezone' | 'language' | 'default';
}

export interface Env {
  timeZone: string;
  languages: readonly string[];
}

export const browserEnv = (): Env => {
  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    /* no timezone available */
  }
  const languages = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language].filter(Boolean)) : [];
  return { timeZone, languages };
};

const prefsFor = (region: string): Prefs => ({ currency: REGIONS[region], weightUnit: POUNDS.has(region) ? 'lb' : 'kg', lengthUnit: POUNDS.has(region) ? 'in' : 'cm' });

export function detectPrefs(env: Env = browserEnv()): Detected {
  const zone = regionOfZone(env.timeZone);
  if (zone && REGIONS[zone]) return { prefs: prefsFor(zone), region: zone, basis: 'timezone' };
  for (const l of env.languages) {
    const r = regionOfLanguage(l);
    if (r && REGIONS[r]) return { prefs: prefsFor(r), region: r, basis: 'language' };
  }
  return { prefs: { currency: 'USD', weightUnit: 'kg', lengthUnit: 'cm' }, region: null, basis: 'default' };
}

/** What the person is actually using: their choice, else the old default for existing saves, else what their location suggests. */
export function resolvePrefs(data: Pick<AppData, 'prefs' | 'onboarded'> & { sample?: boolean }, env?: Env): Prefs {
  if (data.prefs) return data.prefs;
  // The sample data's amounts are naira-sized, so they stay naira, but weights follow where the person is.
  if (data.sample) { const d = detectPrefs(env).prefs; return { currency: LEGACY_PREFS.currency, weightUnit: d.weightUnit, lengthUnit: d.lengthUnit }; }
  return data.onboarded ? LEGACY_PREFS : detectPrefs(env).prefs;
}

export const isCurrency = (c: unknown): c is string => typeof c === 'string' && /^[A-Z]{3}$/.test(c) && currencyOk(c);
function currencyOk(c: string): boolean {
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: c });
    return true;
  } catch {
    return false;
  }
}

// ---------- the units in use right now ----------
// Money and weights are formatted by plain functions all over the app, so the active choice is set from the data before anything
// renders (the same way the training programme is).

let active: Prefs = LEGACY_PREFS;
let moneyFmt: Intl.NumberFormat | null = null;
export const setActivePrefs = (p: Prefs) => {
  if (p.currency !== active.currency) moneyFmt = null;
  active = p;
};
export const activePrefs = (): Prefs => active;

/** Number grouping follows the device's language, except for naira, which keeps the grouping it always had. */
const numberLocale = (currency: string): string => {
  if (currency === 'NGN') return 'en-NG';
  const l = typeof navigator !== 'undefined' ? navigator.language : '';
  try {
    return l ? Intl.NumberFormat.supportedLocalesOf(l)[0] ?? 'en' : 'en';
  } catch {
    return 'en';
  }
};

const formatter = (): Intl.NumberFormat =>
  (moneyFmt ??= new Intl.NumberFormat(numberLocale(active.currency), { style: 'currency', currency: active.currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0, minimumFractionDigits: 0 }));

/** A whole amount of the current currency, e.g. ₦12,500 or $1,250. */
export const fmtMoney = (n: number): string => formatter().format(Math.round(n));

/** Just the symbol, for field labels: ₦, $, £, €. */
export const currencySymbol = (code: string = active.currency): string => {
  try {
    return new Intl.NumberFormat(numberLocale(code), { style: 'currency', currency: code, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
};

export function currencyName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function allCurrencies(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('currency');
    if (list?.length) return list;
  } catch {
    /* older browsers */
  }
  return [...new Set(Object.values(REGIONS))].sort();
}

// ---------- weight: always stored in kilograms ----------

const LB_PER_KG = 2.2046226218;
export const weightUnit = (): WeightUnit => active.weightUnit;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** A stored weight (kg) in the unit the person uses, to one decimal. */
export const toDisplay = (kg: number): number => (active.weightUnit === 'lb' ? r1(kg * LB_PER_KG) : r1(kg));
/** An unrounded conversion, for charts and trend maths. */
export const toDisplayExact = (kg: number): number => (active.weightUnit === 'lb' ? kg * LB_PER_KG : kg);
/** What the person typed, in their unit, as kilograms to store (to the nearest 0.01 kg so it reads back the same). */
export const fromDisplay = (v: number): number => Math.round((active.weightUnit === 'lb' ? v / LB_PER_KG : v) * 100) / 100;
export const fmtWeight = (kg: number): string => `${toDisplay(kg)} ${active.weightUnit}`;
/** A change in weight, signed: +0.8 kg. */
export const fmtWeightDelta = (kg: number): string => {
  const v = r1(toDisplayExact(kg));
  return `${v > 0 ? '+' : ''}${v} ${active.weightUnit}`;
};
/** The sensible limits for a person's own weight (30 to 250 kg), in their unit, for messages. */
export const weightLimits = () => ({ lo: toDisplay(30), hi: toDisplay(250), unit: active.weightUnit });

/** A whole number grouped the way the device groups digits (naira keeps its familiar commas). */
export const fmtNumber = (n: number): string => n.toLocaleString(numberLocale(active.currency));

// ---------- body measurements: always stored in centimetres ----------

const CM_PER_IN = 2.54;
export const lengthUnit = (): LengthUnit => active.lengthUnit;
/** A stored measurement (cm) in the unit the person uses, to one decimal. */
export const toLength = (cm: number): number => r1(active.lengthUnit === 'in' ? cm / CM_PER_IN : cm);
/** What the person typed, in their unit, as centimetres to store (to 0.01 cm so it reads back the same). */
export const fromLength = (v: number): number => Math.round((active.lengthUnit === 'in' ? v * CM_PER_IN : v) * 100) / 100;
export const fmtLength = (cm: number): string => `${toLength(cm)} ${active.lengthUnit}`;
/** A change in a measurement, signed. */
export const fmtLengthDelta = (cm: number): string => {
  const v = r1(active.lengthUnit === 'in' ? cm / CM_PER_IN : cm);
  return `${v >= 0 ? '+' : ''}${v} ${active.lengthUnit}`;
};
