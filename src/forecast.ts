import { weeklyRepTotals, suggestedPace } from './derive';
import { backtestWeight, predictAt, savingPaces, shipPaces, weightConfidence, weightFit } from './projection';
import type { Confidence } from './projection';
import {monthlySavingPace, survivalTarget, fundBalance, DAYS_PER_MONTH} from './money';
import { goalForecast } from './career';
import type { AppData } from './types';
import { addDays, dayNumber, fmtShort, mondayOf, round1 } from './utils';
import { fmtMoney, fmtWeight, toDisplayExact, weightUnit } from './units';

/** A picture of a forecast: what happened so far, and where it could go. Both axes are plain numbers; `xLabel` turns an x into text. */
export interface FanChartData {
  unit: string;
  history: { x: number; y: number }[];
  /** The likely path, and the edges of the range around it. */
  mid: { x: number; y: number }[];
  low: { x: number; y: number }[];
  high: { x: number; y: number }[];
  goal: number | null;
  /** What each x means, for the axis ends, e.g. a date. */
  xLabel: (x: number) => string;
}

export interface Forecast {
  id: 'weight' | 'fund' | 'portfolio' | 'strength';
  title: string;
  headline: string;
  detail: string;
  tone: 'good' | 'warn' | 'info';
  /** How much history the estimate stands on. Absent when there is no estimate yet. */
  confidence?: Confidence;
  /** How past forecasts of this kind held up, when there is enough history to check. */
  trackRecord?: string;
  chart?: FanChartData;
}

export const CONFIDENCE_WORD: Record<Confidence, string> = { low: 'Early estimate', medium: 'Fair estimate', high: 'Steady history' };

const monthsWord = (m: number) => (m < 1.5 ? 'about a month' : `about ${Math.round(m)} months`);

export function weightForecast(data: AppData): Forecast {
  const title = 'Bodyweight';
  const wf = weightFit(data.body);
  if (!wf) return { id: 'weight', title, headline: 'Needs three weigh-ins', detail: `You have ${data.body.length}. Weigh in weekly and a trend line appears after the third.`, tone: 'info' };

  const { fit, last } = wf;
  const lastWeek = dayNumber(last.date) / 7;
  const slope = fit.slope;
  const pace = suggestedPace(last.weight);
  const goal = data.goalWeight;
  const confidence = weightConfidence(wf);
  const base = predictAt(fit, lastWeek).mid;
  const ahead = predictAt(fit, lastWeek + 12, 0.4);

  // Everything is worked out in kilograms and shown in the person's own unit.
  const u = weightUnit();
  const d = toDisplayExact;
  let detail = `The line is moving ${slope >= 0 ? 'up' : 'down'} ${Math.abs(d(slope)).toFixed(2)} ${u} a week. A usual lean-gain pace for your weight is ${d(pace.low).toFixed(2)} to ${d(pace.high).toFixed(2)} ${u} a week. This is a straight line through your last ${fit.n} weigh-ins, and the range is wider the fewer weigh-ins and the more they bounce around. It is not a prediction of how your body will respond.`;
  let tone: Forecast['tone'] = 'info';
  if (slope >= pace.low && slope <= pace.high) tone = 'good';
  else if (slope < pace.low * 0.5) tone = 'warn';
  if (goal != null) {
    if (goal > base && slope > 0.01) {
      const weeks = (goal - base) / slope;
      // Quickest and slowest the goal could plausibly arrive, from the range of the slope itself.
      const se = fit.s / Math.sqrt(fit.sxx);
      const t = 1.5;
      const fast = (goal - base) / (slope + t * se);
      const slow = slope - t * se > 0.01 ? (goal - base) / (slope - t * se) : Infinity;
      const spread = slow === Infinity ? `, and it could be much longer if the trend flattens` : fast >= 1 ? `, anywhere from ${Math.round(fast)} to ${Math.round(slow)} weeks` : '';
      detail += weeks > 104 ? ` Reaching ${fmtWeight(goal)} would take over two years at this pace.` : ` Reaching ${fmtWeight(goal)} would take about ${Math.round(weeks)} weeks at this pace${weeks <= 104 ? spread : ''}.`;
    } else if (goal > base) {
      detail += ` At this pace you would not reach ${fmtWeight(goal)}, because the line is flat or falling.`;
      tone = 'warn';
    } else {
      detail += ` You are at or past your ${fmtWeight(goal)} goal.`;
    }
  }

  const bt = backtestWeight(data.body);
  const trackRecord = bt ? `Replaying your history, forecasts like this missed by about ${d(bt.mae).toFixed(1)} ${u} on average (${bt.n} checked), and ${Math.round(bt.inside * 100)}% of weigh-ins landed inside the range.` : undefined;

  const pts = (f: (w: number) => number) => [0, 4, 8, 12].map((w) => ({ x: lastWeek + w, y: d(f(w)) }));
  const hist = data.body.slice(-12).map((e) => ({ x: dayNumber(e.date) / 7, y: d(e.weight) }));
  const chart: FanChartData = {
    unit: u,
    history: hist,
    mid: pts((w) => predictAt(fit, lastWeek + w, 0.4).mid),
    low: pts((w) => predictAt(fit, lastWeek + w, 0.4).low),
    high: pts((w) => predictAt(fit, lastWeek + w, 0.4).high),
    goal: goal == null ? null : d(goal),
    xLabel: (x) => fmtShort(addDays('1970-01-01', Math.round(x * 7))),
  };
  return { id: 'weight', title, headline: `About ${round1(d(ahead.mid))} ${u} in 12 weeks (likely ${round1(d(ahead.low))} to ${round1(d(ahead.high))})`, detail, tone, confidence, trackRecord, chart };
}

const monthYear = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
};
const monthsRange = (a: number, b: number) => (Math.round(a) === Math.round(b) ? monthsWord(a) : `${Math.max(1, Math.round(a))} to ${Math.round(b)} months`);

export function fundForecast(data: AppData, today: string): Forecast {
  const title = 'Survival fund';
  const target = survivalTarget(data, today).target;
  if (target == null) return { id: 'fund', title, headline: 'No target yet', detail: 'Enter a rough spend per day on the Money screen, or log about four weeks of spending.', tone: 'info' };
  const balance = fundBalance(data, 'survival');
  if (balance >= target) return { id: 'fund', title, headline: 'Complete', detail: `${fmtMoney(balance)} covers six months of spending. New savings go to the investment fund.`, tone: 'good' };
  const paces = savingPaces(data, today);
  const typical = monthlySavingPace(data, today);
  if (typical <= 0 && paces.typical <= 0) return { id: 'fund', title, headline: 'No savings in the last 8 weeks', detail: `${fmtMoney(balance)} of ${fmtMoney(target)} so far. Log a transfer and an estimate appears.`, tone: 'warn' };

  const need = target - balance;
  const mid = need / (typical > 0 ? typical : paces.typical);
  const quick = paces.fast > 0 ? need / paces.fast : mid;
  const slowM = paces.slow > 0 ? need / paces.slow : Infinity;
  const when = addDays(today, Math.round(mid * DAYS_PER_MONTH));
  const range = slowM === Infinity ? `Some recent stretches had no savings, so it could be quicker or much slower.` : `It could take ${monthsRange(quick, slowM)}, depending on whether the next weeks look like your quickest or your slowest recent stretches.`;
  const stretches = paces.confidence === 'low' ? 'Only a few weeks of history, so treat the range as a rough guide.' : `Range from ${paces.windows} four-week stretches.`;

  const monthX = (m: number) => dayNumber(today) + m * DAYS_PER_MONTH;
  const horizon = Math.min(60, Math.max(3, Math.ceil(Math.min(slowM === Infinity ? mid * 2 : slowM, mid * 2.5))));
  const line = (rate: number) => [0, horizon / 3, (2 * horizon) / 3, horizon].map((m) => ({ x: monthX(m), y: Math.min(target * 1.05, balance + rate * m) }));
  const chart: FanChartData = {
    unit: 'money',
    history: [{ x: monthX(0), y: balance }],
    mid: line(typical > 0 ? typical : paces.typical),
    low: line(Math.max(0, paces.slow)),
    high: line(Math.max(paces.fast, typical)),
    goal: target,
    xLabel: (x) => monthYear(addDays('1970-01-01', Math.round(x))).replace(/^(\w{3})\w* /, '$1 '),
  };
  return {
    id: 'fund',
    title,
    headline: `${monthsWord(mid)} to go (around ${monthYear(when)})`,
    detail: `${fmtMoney(balance)} of ${fmtMoney(target)}, saving about ${fmtMoney(typical > 0 ? typical : paces.typical)} a month over the last 8 weeks. ${range} ${stretches} Irregular income means this will move around.`,
    tone: mid > 36 ? 'warn' : 'info',
    confidence: paces.confidence,
    chart,
  };
}

export function portfolioForecast(data: AppData, today: string): Forecast {
  const title = 'Portfolio goal';
  const c = data.career;
  const fc = goalForecast(c, today);
  if (fc.remaining === 0) return { id: 'portfolio', title, headline: 'Goal reached', detail: `All ${c.goalCount} projects are shipped.`, tone: 'good' };
  if (fc.shipped === 0) {
    return { id: 'portfolio', title, headline: 'Ship your first project for an estimate', detail: `To finish ${c.goalCount} by ${fmtShort(c.deadline)}, you need to ship one about every ${Math.max(1, Math.round(fc.neededWeeksEach))} weeks.`, tone: 'info' };
  }
  const weeksToFinish = fc.remaining * (fc.actualWeeksEach ?? 0);
  const finish = addDays(today, Math.round(weeksToFinish * 7));
  const lateDays = dayNumber(finish) - dayNumber(c.deadline);
  const sp = shipPaces(data);
  // The range scales the headline estimate by how much faster or slower the person's quickest and slowest projects were than their average.
  const quick = sp ? Math.min(1, sp.fast / sp.typical) : 1;
  const slow = sp ? Math.max(1, sp.slow / sp.typical) : 1;
  const spread = sp ? ` With the spread in how long your projects have taken, finishing could fall between ${fmtShort(addDays(today, Math.round(weeksToFinish * quick * 7)))} and ${fmtShort(addDays(today, Math.round(weeksToFinish * slow * 7)))}.` : '';
  return {
    id: 'portfolio',
    title,
    headline: lateDays <= 0 ? `On pace, finishing around ${fmtShort(finish)}` : `Behind pace by about ${Math.max(1, Math.round(lateDays / 7))} weeks`,
    detail: `${fc.shipped} of ${c.goalCount} shipped, one every ${Math.max(1, Math.round(fc.actualWeeksEach ?? 0))} weeks so far. Finishing by ${fmtShort(c.deadline)} needs one about every ${Math.max(1, Math.round(fc.neededWeeksEach))} weeks.${spread}`,
    tone: lateDays <= 0 ? 'good' : 'warn',
    confidence: sp?.confidence ?? 'low',
  };
}

export function strengthForecast(data: AppData, today: string): Forecast {
  const title = 'Training volume';
  const currentMonday = mondayOf(today);
  const weeks = weeklyRepTotals(data, today, 8).filter((w) => w.monday < currentMonday && w.sessions > 0);
  if (weeks.length < 3) return { id: 'strength', title, headline: 'Needs three finished weeks', detail: 'Finish sessions for a few weeks and the volume trend appears.', tone: 'info' };
  const xs = weeks.map((_, i) => i);
  const ys = weeks.map((w) => w.reps);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0;
  let den = 0;
  xs.forEach((x, i) => {
    num += (x - mx) * (ys[i] - my);
    den += (x - mx) ** 2;
  });
  const slope = den === 0 ? 0 : num / den;
  const rel = my > 0 ? slope / my : 0;
  const dir = rel > 0.015 ? 'rising' : rel < -0.015 ? 'falling' : 'flat';
  return {
    id: 'strength',
    title,
    headline: `Weekly reps are ${dir}${dir === 'flat' ? '' : `, about ${Math.round(Math.abs(slope))} a week`}`,
    detail: `Based on ${weeks.length} finished weeks. More reps at the same load means you are getting stronger; when every set reaches the top of its range, add load.`,
    tone: dir === 'rising' ? 'good' : dir === 'falling' ? 'warn' : 'info',
    confidence: weeks.length >= 6 ? 'high' : weeks.length >= 4 ? 'medium' : 'low',
  };
}

export function forecasts(data: AppData, today: string): Forecast[] {
  return [weightForecast(data), strengthForecast(data, today), fundForecast(data, today), portfolioForecast(data, today)];
}
