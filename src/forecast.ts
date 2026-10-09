import { weeklyRepTotals, weightTrend, suggestedPace } from './derive';
import { monthlySavingPace, naira, survivalTarget, fundBalance, DAYS_PER_MONTH } from './money';
import { goalForecast } from './career';
import type { AppData } from './types';
import { addDays, dayNumber, fmtShort, mondayOf, round1 } from './utils';

export interface Forecast {
  id: 'weight' | 'fund' | 'portfolio' | 'strength';
  title: string;
  headline: string;
  detail: string;
  tone: 'good' | 'warn' | 'info';
}

const monthsWord = (m: number) => (m < 1.5 ? 'about a month' : `about ${Math.round(m)} months`);

export function weightForecast(data: AppData): Forecast {
  const title = 'Bodyweight';
  const trend = weightTrend(data.body);
  if (!trend) return { id: 'weight', title, headline: 'Needs three weigh-ins', detail: `You have ${data.body.length}. Weigh in weekly and a trend line appears after the third.`, tone: 'info' };

  const recent = data.body.slice(-6);
  const last = recent[recent.length - 1];
  const base = trend.fitAt(last.date);
  const resid = recent.map((e) => e.weight - trend.fitAt(e.date));
  const sd = Math.sqrt(resid.reduce((n, r) => n + r * r, 0) / Math.max(1, recent.length - 2));
  const band = Math.max(0.4, 1.5 * sd);
  const at = (weeks: number) => base + trend.slope * weeks;
  const pace = suggestedPace(last.weight);
  const goal = data.goalWeight;

  let detail = `The line is moving ${trend.slope >= 0 ? 'up' : 'down'} ${Math.abs(trend.slope).toFixed(2)} kg a week. A usual lean-gain pace for your weight is ${pace.low.toFixed(2)} to ${pace.high.toFixed(2)} kg a week. This is a simple trend line through your last ${recent.length} weigh-ins, not a prediction of how your body will respond.`;
  let tone: Forecast['tone'] = 'info';
  if (trend.slope >= pace.low && trend.slope <= pace.high) tone = 'good';
  else if (trend.slope < pace.low * 0.5) tone = 'warn';
  if (goal != null) {
    if (goal > base && trend.slope > 0.01) {
      const weeks = (goal - base) / trend.slope;
      detail += weeks > 104 ? ` Reaching ${goal} kg would take over two years at this pace.` : ` Reaching ${goal} kg would take about ${Math.round(weeks)} weeks at this pace.`;
    } else if (goal > base) {
      detail += ` At this pace you would not reach ${goal} kg, because the line is flat or falling.`;
      tone = 'warn';
    } else {
      detail += ` You are at or past your ${goal} kg goal.`;
    }
  }
  return { id: 'weight', title, headline: `About ${round1(at(12))} kg in 12 weeks (likely ${round1(at(12) - band)} to ${round1(at(12) + band)})`, detail, tone };
}

export function fundForecast(data: AppData, today: string): Forecast {
  const title = 'Survival fund';
  const target = survivalTarget(data, today).target;
  if (target == null) return { id: 'fund', title, headline: 'No target yet', detail: 'Enter a rough spend per day on the Money screen, or log about four weeks of spending.', tone: 'info' };
  const balance = fundBalance(data, 'survival');
  if (balance >= target) return { id: 'fund', title, headline: 'Complete', detail: `${naira(balance)} covers six months of spending. New savings go to the investment fund.`, tone: 'good' };
  const pace = monthlySavingPace(data, today);
  if (pace <= 0) return { id: 'fund', title, headline: 'No savings in the last 8 weeks', detail: `${naira(balance)} of ${naira(target)} so far. Log a transfer and an estimate appears.`, tone: 'warn' };
  const months = (target - balance) / pace;
  const when = addDays(today, Math.round(months * DAYS_PER_MONTH));
  const [y, m] = when.split('-').map(Number);
  const monthName = new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  return {
    id: 'fund',
    title,
    headline: `${monthsWord(months)} to go (around ${monthName})`,
    detail: `${naira(balance)} of ${naira(target)}, saving about ${naira(pace)} a month over the last 8 weeks. Irregular income means this will move around.`,
    tone: months > 36 ? 'warn' : 'info',
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
  return {
    id: 'portfolio',
    title,
    headline: lateDays <= 0 ? `On pace, finishing around ${fmtShort(finish)}` : `Behind pace by about ${Math.max(1, Math.round(lateDays / 7))} weeks`,
    detail: `${fc.shipped} of ${c.goalCount} shipped, one every ${Math.max(1, Math.round(fc.actualWeeksEach ?? 0))} weeks so far. Finishing by ${fmtShort(c.deadline)} needs one about every ${Math.max(1, Math.round(fc.neededWeeksEach))} weeks.`,
    tone: lateDays <= 0 ? 'good' : 'warn',
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
  };
}

export function forecasts(data: AppData, today: string): Forecast[] {
  return [weightForecast(data), strengthForecast(data, today), fundForecast(data, today), portfolioForecast(data, today)];
}
