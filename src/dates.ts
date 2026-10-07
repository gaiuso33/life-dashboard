const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayISO(): string {
  return toISO(new Date());
}

export function addDays(s: string, n: number): string {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** Monday = 0 ... Sunday = 6 */
export function weekdayIndex(s: string): number {
  return (fromISO(s).getDay() + 6) % 7;
}

export function mondayOf(s: string): string {
  return addDays(s, -weekdayIndex(s));
}

export function fmtLong(s: string): string {
  return fromISO(s).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
}

export function fmtShort(s: string): string {
  return fromISO(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
