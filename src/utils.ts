export const pad = (n: number) => String(n).padStart(2, '0');
export const toKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fromKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const todayKey = () => toKey(new Date());
export const addDays = (k: string, n: number) => {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
};
export const weekday = (k: string) => fromKey(k).getDay();
export const mondayOf = (k: string) => addDays(k, -((weekday(k) + 6) % 7));
export const dayNumber = (k: string) => Math.round(fromKey(k).getTime() / 86400000);
export const keyFromDayNumber = (n: number) => toKey(new Date(n * 86400000 + 12 * 3600000));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const weekdayName = (k: string) => WEEKDAYS[weekday(k)];
export const fmtShort = (k: string) => {
  const d = fromKey(k);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
export const fmtLong = (k: string) => {
  const d = fromKey(k);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${['January','February','March','April','May','June','July','August','September','October','November','December'][d.getMonth()]}`;
};

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
