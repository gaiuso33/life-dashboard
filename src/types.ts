import type { DayDef, DayKey, MEASURES } from './program';
import { addDays, todayKey } from './utils';

export type MeasureKey = (typeof MEASURES)[number]['key'];

export interface DayLog {
  code?: boolean;
  money?: boolean;
  energy?: number; // 1-5
  mobility?: boolean;
}

export interface Session {
  date: string;
  day: DayKey;
  loads: Record<string, string>;
  reps: Record<string, (number | null)[]>;
  finished: boolean;
}

export interface BodyEntry {
  date: string;
  weight: number;
  m: Partial<Record<MeasureKey, number>>;
}

export type TxnKind = 'expense' | 'income' | 'saving';
export type FundKey = 'survival' | 'investment';

export interface Txn {
  id: string;
  date: string;
  kind: TxnKind;
  amount: number; // whole naira
  category?: string; // expenses only
  fund?: FundKey; // savings only
  note: string;
}

export interface MoneyData {
  txns: Txn[];
  savePct: number; // share of each income to move into savings
  dailyEstimate: number | null; // rough daily spend, used until a month of data exists
  survivalOpening: number; // already in the survival fund before tracking began
  categories?: string[]; // spending categories; the built-in list when absent
}

export const emptyMoney = (): MoneyData => ({ txns: [], savePct: 20, dailyEstimate: null, survivalOpening: 0 });

export type ProjectStatus = 'idea' | 'building' | 'shipped';

export interface Milestone {
  id: string;
  text: string;
  done: boolean;
}

export interface Project {
  id: string;
  name: string;
  repo: string; // owner/name, optional
  concept: string; // the course concept it puts to work
  status: ProjectStatus;
  milestones: Milestone[];
  shippedOn?: string;
}

export interface LearningEntry {
  id: string;
  date: string;
  course: string;
  note: string;
}

export interface CareerData {
  githubUser: string;
  commits: Record<string, number>; // date -> commits, from the last sync
  lastSync: string | null;
  goalCount: number;
  startDate: string;
  deadline: string;
  projects: Project[];
  learning: LearningEntry[];
}

export const emptyCareer = (): CareerData => {
  const t = todayKey();
  return { githubUser: '', commits: {}, lastSync: null, goalCount: 5, startDate: t, deadline: addDays(t, 365), projects: [], learning: [] };
};

export type Tier = 'week' | 'biweek' | 'month' | 'landmark';

export interface RewardItem {
  id: string;
  name: string;
  cost: number; // whole naira, 0 for free treats
  tier: Tier;
}

export interface Claim {
  id: string;
  tier: Tier;
  period: string; // week or block start date, or the landmark badge id
  itemId: string;
  name: string;
  cost: number;
  date: string;
  logged: boolean; // whether the cost was added to Money as a Rewards expense
}

export interface RewardsData {
  items: RewardItem[];
  claims: Claim[];
  badges: Record<string, string>; // badge id -> date first earned; only ever grows
}

export const DEFAULT_ITEMS: RewardItem[] = [
  { id: 'i-snack', name: 'Snack under ₦2,000', cost: 2000, tier: 'week' },
  { id: 'i-rest', name: 'Rest or gaming hour', cost: 0, tier: 'week' },
  { id: 'i-parfait', name: 'Parfait', cost: 7000, tier: 'biweek' },
  { id: 'i-rice', name: 'La Palace rice', cost: 7000, tier: 'biweek' },
  { id: 'i-specialw', name: 'Special W food', cost: 9500, tier: 'month' },
  { id: 'i-healthy', name: 'Healthy meal of your choice', cost: 9500, tier: 'month' },
  { id: 'i-pizza', name: 'Pizza', cost: 20000, tier: 'landmark' },
  { id: 'i-clothes', name: 'New t-shirt and trousers', cost: 13000, tier: 'landmark' },
];

export const emptyRewards = (): RewardsData => ({ items: DEFAULT_ITEMS.map((i) => ({ ...i })), claims: [], badges: {} });

export const DEFAULT_MODEL = 'claude-sonnet-5-5';

export type ShareArea = 'training' | 'body' | 'money' | 'career' | 'rewards';

export interface AdvisorSettings {
  model: string;
  /** Which areas of numbers may be sent to the AI. Never includes notes, names or other free text. */
  share: Record<ShareArea, boolean>;
}

export interface AiReview {
  week: string; // Monday of the week reviewed
  text: string;
  at: string; // ISO timestamp it was written
  model: string;
}

export interface AdvisorData {
  settings: AdvisorSettings;
  reviews: AiReview[];
}

export const emptyAdvisor = (): AdvisorData => ({
  settings: { model: DEFAULT_MODEL, share: { training: true, body: true, money: true, career: true, rewards: true } },
  reviews: [],
});

export type PlanKind = 'bill' | 'income' | 'task' | 'event';
export interface PlanItem {
  id: string;
  date: string; // first (or only) occurrence
  title: string;
  kind: PlanKind;
  amount: number; // naira, 0 when none
  repeat: 'none' | 'monthly';
  doneOn: string[]; // occurrence dates marked done
}

export interface AppData {
  version: 1;
  sample: boolean;
  money: MoneyData;
  career: CareerData;
  rewards: RewardsData;
  advisor: AdvisorData;
  plans: PlanItem[];
  /** When each single-value setting was last changed, so merging keeps the most recent one. */
  stamps?: Record<string, string>;
  program?: DayDef[]; // the person's own training programme; the built-in one when absent
  /** Ids of things the user deleted, so a merge from another device does not bring them back. */
  gone: string[];
  /** False until the first-run setup is finished or skipped. Saves from before the setup existed count as done. */
  onboarded: boolean;
  /** When the user last changed anything on this device; the newer device wins a merge conflict. */
  modified?: string;
  days: Record<string, DayLog>;
  sessions: Record<string, Session>; // key: `${date}|${day}`
  body: BodyEntry[]; // ascending by date
  goalWeight: number | null;
}

export const sessionKey = (date: string, day: DayKey) => `${date}|${day}`;

export const emptyData = (): AppData => ({
  version: 1,
  sample: false,
  money: emptyMoney(),
  career: emptyCareer(),
  rewards: emptyRewards(),
  advisor: emptyAdvisor(),
  plans: [],
  gone: [],
  onboarded: false,
  days: {},
  sessions: {},
  body: [],
  goalWeight: null,
});
