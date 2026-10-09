import { evaluateBadges } from './badges';
import { commitStats, loggedSpendDays, plural, readyExercises, repsInWeek, sumTxns } from './coach';
import { commitStreak } from './career';
import { weekStreak, weeklyRepTotals, weightTrend, suggestedPace } from './derive';
import { forecasts } from './forecast';
import { avgMonthlySpend, fundBalance, monthTotals, monthlySavingPace, survivalTarget } from './money';
import { MEASURES } from './program';
import { periodsFor } from './rewards';
import type { AppData, ShareArea } from './types';
import { addDays, dayNumber, mondayOf, round1, weekdayName } from './utils';

/**
 * What the AI is allowed to see: numbers and counts only. There are no notes, names, project or
 * repository titles, GitHub username, reward menu text, or any other free text the user typed.
 */
export type Summary = Record<string, unknown>;

export const SHARE_LABEL: Record<ShareArea, { title: string; blurb: string }> = {
  training: { title: 'Training', blurb: 'Sessions per week, total reps, which lifts are ready for more load.' },
  body: { title: 'Body', blurb: 'Weigh-in weights, weight goal, weight trend, measurement changes.' },
  money: { title: 'Money', blurb: 'Amounts spent, received and saved, spending by category, fund balance and target. No notes.' },
  career: { title: 'Career', blurb: 'Commit counts, projects shipped, milestone totals. No project or repository names.' },
  rewards: { title: 'Rewards', blurb: 'Badge counts and this week’s reward progress. No treat names.' },
};

const r = round1;

export function buildSummary(data: AppData, today: string, share: Record<ShareArea, boolean>): Summary {
  const monday = mondayOf(today);
  const prevMonday = addDays(monday, -7);
  const out: Summary = { asOf: today, weekday: weekdayName(today), currency: 'NGN (Nigerian naira)', weekStartsOn: monday };
  const fc = forecasts(data, today);

  if (share.training) {
    const weeks = weeklyRepTotals(data, today, 8);
    out.training = {
      programme: 'push/pull/legs on Monday, Wednesday and Friday; mobility on rest days',
      sessionsThisWeek: weeks[weeks.length - 1]?.sessions ?? 0,
      sessionsLastWeek: weeks[weeks.length - 2]?.sessions ?? 0,
      fullTrainingWeeksInARow: weekStreak(data, today),
      repsPerWeekOldestToNewest: weeks.map((w) => w.reps),
      repsThisWeek: repsInWeek(data, monday),
      repsLastWeek: repsInWeek(data, prevMonday),
      liftsReadyForMoreLoad: readyExercises(data, today),
      trainingVolumeTrend: fc.find((f) => f.id === 'strength')?.headline,
    };
  }

  if (share.body) {
    const trend = weightTrend(data.body);
    const latest = data.body[data.body.length - 1];
    const first = data.body[0];
    const changes: Record<string, number> = {};
    if (latest && first && latest !== first) {
      for (const { key } of MEASURES) {
        const a = first.m[key];
        const b = latest.m[key];
        if (a != null && b != null) changes[key] = r(b - a);
      }
    }
    out.body = {
      goal: 'gain muscle mass and strength, and improve mobility',
      latestWeightKg: latest?.weight ?? null,
      goalWeightKg: data.goalWeight,
      weighInsLast8: data.body.slice(-8).map((e) => ({ daysAgo: dayNumber(today) - dayNumber(e.date), kg: e.weight })),
      trendKgPerWeek: trend ? Math.round(trend.slope * 100) / 100 : null,
      usualLeanGainRangeKgPerWeek: latest ? [Math.round(suggestedPace(latest.weight).low * 100) / 100, Math.round(suggestedPace(latest.weight).high * 100) / 100] : null,
      measurementChangeCmSinceFirst: changes,
      weightForecast: fc.find((f) => f.id === 'weight')?.headline,
    };
  }

  if (share.money) {
    const month = monthTotals(data, today.slice(0, 7));
    const target = survivalTarget(data, today);
    out.money = {
      spentThisWeek: sumTxns(data, 'expense', monday, today),
      spentLastWeek: sumTxns(data, 'expense', prevMonday, addDays(monday, -1)),
      daysSpendingLoggedThisWeek: loggedSpendDays(data, monday, today),
      receivedThisWeek: sumTxns(data, 'income', monday, today),
      savedThisWeek: sumTxns(data, 'saving', monday, today),
      spentThisMonth: month.spent,
      receivedThisMonth: month.income,
      savedThisMonth: month.saved,
      spendingByCategoryThisMonth: month.byCategory,
      averageMonthlySpendingLast90Days: avgMonthlySpend(data, today) != null ? Math.round(avgMonthlySpend(data, today)!) : null,
      survivalFund: { balance: fundBalance(data, 'survival'), targetSixMonths: target.target, targetBasedOn: target.basis },
      savingPacePerMonth: Math.round(monthlySavingPace(data, today)),
      savingsSplitPercent: data.money.savePct,
      survivalFundForecast: fc.find((f) => f.id === 'fund')?.headline,
    };
  }

  if (share.career) {
    const c = data.career;
    const milestones = c.projects.reduce((n, p) => n + p.milestones.length, 0);
    const milestonesDone = c.projects.reduce((n, p) => n + p.milestones.filter((m) => m.done).length, 0);
    const stats7 = commitStats(data, monday, today);
    out.career = {
      goal: `${c.goalCount} solid portfolio projects using course concepts, by the deadline`,
      weeksUntilDeadline: Math.max(0, Math.round((dayNumber(c.deadline) - dayNumber(today)) / 7)),
      projectsShipped: c.projects.filter((p) => p.status === 'shipped').length,
      projectsBuilding: c.projects.filter((p) => p.status === 'building').length,
      projectsIdeas: c.projects.filter((p) => p.status === 'idea').length,
      milestonesDone,
      milestonesTotal: milestones,
      commitsThisWeek: stats7.commits,
      commitDaysThisWeek: stats7.days,
      commitsLast30Days: commitStats(data, addDays(today, -29), today).commits,
      commitStreakDays: commitStreak(c, today),
      learningEntriesLast30Days: c.learning.filter((l) => l.date >= addDays(today, -29)).length,
      portfolioForecast: fc.find((f) => f.id === 'portfolio')?.headline,
    };
  }

  if (share.rewards) {
    const states = evaluateBadges(data, today);
    const wk = periodsFor(data, 'week', today).current;
    out.rewards = {
      badgesEarned: states.filter((b) => b.earned).length,
      badgesTotal: states.length,
      weeklyReward: { requirements: wk.reqs.map((q) => `${q.label} ${q.value}/${q.target}`), unlocked: wk.unlocked, claimed: !!wk.claim },
      treatsSpentThisMonthNaira: data.rewards.claims.filter((c) => c.date.startsWith(today.slice(0, 7))).reduce((n, c) => n + c.cost, 0),
    };
  }
  return out;
}

export const summaryJson = (s: Summary) => JSON.stringify(s, null, 2);

export const enabledAreas = (share: Record<ShareArea, boolean>) => (Object.keys(share) as ShareArea[]).filter((k) => share[k]);
export { plural };
