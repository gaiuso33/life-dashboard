import type { AppData } from './types';
import { dayScore } from './derive';

export type StepKey = 'plates' | 'money' | 'career' | 'reminders' | 'install' | 'backup';
export interface GuideStep {
  key: StepKey;
  title: string;
  detail: string;
  done: boolean;
}
export interface GuideFlags {
  installed: boolean;
  /** False where installing is impossible (a file opened from disk), so the step is left out. */
  canInstall: boolean;
  reminders: boolean;
  backedUp: boolean;
}

const HIDDEN = 'life-dashboard:v1:guide-hidden';
export const guideHidden = (): boolean => {
  try {
    return localStorage.getItem(HIDDEN) === '1';
  } catch {
    return false;
  }
};
export const hideGuide = () => {
  try {
    localStorage.setItem(HIDDEN, '1');
  } catch {
    /* storage unavailable */
  }
};

export function guideSteps(data: AppData, f: GuideFlags): GuideStep[] {
  const touched = Object.keys(data.days).some((d) => dayScore(data, d) > 0) || Object.values(data.sessions).some((s) => s.finished);
  const steps: GuideStep[] = [
    { key: 'plates', title: 'Complete your first plate', detail: 'Log a session, a check-in, a spend or a commit. Four plates make a full day.', done: touched },
    { key: 'money', title: 'Add a money entry', detail: 'Log one thing you spent or received, or import a bank statement.', done: data.money.txns.length > 0 },
    { key: 'career', title: 'Add a project or connect GitHub', detail: 'So the career goal has something to count.', done: data.career.projects.length > 0 || !!data.career.githubUser },
    { key: 'reminders', title: 'Set up reminders', detail: 'Repeating calendar alerts on your phone. They work with the app closed.', done: f.reminders },
  ];
  if (f.canInstall) steps.push({ key: 'install', title: 'Install it on your phone', detail: 'It opens full-screen and works offline.', done: f.installed });
  steps.push({ key: 'backup', title: 'Back up your data', detail: 'Download a copy, or sign in to sync between devices.', done: f.backedUp });
  return steps;
}
