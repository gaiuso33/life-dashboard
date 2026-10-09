# Personal Life Dashboard — Product Spec (v0.4)

## 1. Vision
A dark, data-heavy personal dashboard that turns daily check-ins into visible progress across **fitness, money and career**, rewards consistency, and uses an AI advisor and forecasts to keep you on track. Built for one user first (you), structured so it can be pitched later as a general self-improvement product.

## 2. Principles
- **Daily "did I do my thing?" view first.** Everything else supports it.
- **Logging must take seconds.** Auto-pull data where possible; otherwise one-tap or keyboard-fast entry.
- **Device-first privacy.** Data lives on-device. Only summaries leave the device (advisor), and only through a small server where secrets are needed (bank link).
- **Swap-ready architecture.** A storage layer interface so cloud sync can replace local storage without rewriting the app.
- **Laptop-first, phone-friendly.** Full dashboard on laptop, slim quick check-in view on phone.

## 3. Modules

### 3.1 Today (home screen)
- Progress ring for the day: workout (on gym days) or mobility (rest days), habits, money check-in, GitHub activity.
- Streak counters and current reward progress.
- Daily check-in prompt: weight-free quick questions (energy/mood optional, habits done, spending logged).

### 3.2 Fitness
- **Program:** Mon Push, Wed Pull, Fri Legs (exercises and rep ranges as you gave them).
- **Program change (confirmed equipment: dumbbells, barbells, pull-up bar, bench, mat):** replace the Romanian deadlift on pull day with pull-ups or chin-ups, 3 × 6-10 (if you can't hit 6 yet, use slow negatives: jump up, then lower over 3-5 seconds). Keep RDL on leg day.
- **Set logging:** reps per set + a **load level** (label like "blue dumbbells" or "2 plates", or a 1-5 scale), since exact mass may be unknown.
- **Progression engine:** double progression. When all sets hit the top of the rep range, the app flags "increase load next session".
- **Mobility:** ~12-minute routine on rest days (Tue/Thu/Sat or Sun) and a 5-minute pre-lift warm-up.
- **Body metrics (weekly):** weight plus measurements (neck, shoulders, chest, upper arm, waist, hips, thigh, calf). Optional progress photos stored on-device.
- **Targets:** app proposes realistic targets and a gain rate from your starting numbers; you can edit them.

### 3.3 Money
- **Accounts:** OPay is the main account.
- **Ingest:**
  1. Fast manual logger: amount, tap a category, optional note (built).
  2. OPay statement import (CSV/XLSX): planned. Needs one sample statement export so the column mapping can be matched exactly.
  - **Bank link via Mono: dropped.** Mono asks for a registered business name and email, which doesn't fit a personal project. Revisit only if the app becomes a real product.
- **Categories:** Food, Transport, Data/Airtime, Housing, Personal care, Health/Gym, Giving, Entertainment, Savings transfers, Rewards, Other. Each transaction can be tagged and re-tagged; rules learn from past tags (e.g. a recurring merchant maps to a category).
- **Income log:** income is irregular, so every income entry triggers a suggested savings split (percentage-based).
- **Survival fund:** target = 6 × average monthly spending (calculated once about a month of data exists), held in OPay. Progress bar and ETA.
- **Investment fund:** starts after the survival fund is complete; target set later.
- **Rewards budget:** reward treats are a budget category so they're funded, not extra.

### 3.4 Career
- **Goal:** portfolio of 5 solid projects using concepts from Coursera courses, due in 1 year (about October 2027).
- **GitHub sync:** commits per day, active repos, streaks (read-only via GitHub API).
- **Project tracker:** each of the 5 projects has milestones, a status and linked repo.
- **Learning log:** manual log of Coursera courses/modules completed.
- **Forecast:** projects-completed pace against the deadline.

### 3.5 Goals, habits and rewards (built)
- Daily habits: training or mobility, GitHub activity or manual code check, spending logged, energy check-in. Three of four plates loaded is a "strong day".
- **Savings rule (confirmed):** every reward needs a savings transfer in its period. Any amount counts.
- **Reward tiers**, all counted from fixed Mondays so blocks never shift:
  - **Weekly:** all 3 sessions, at least 5 strong days, and a savings transfer that week. Default treats: snack under ₦2,000, or a rest/gaming hour.
  - **Biweekly (2 weeks):** both weeks full (3 sessions and 5 strong days each) plus at least one transfer in the block. Parfait or La Palace rice (₦7,000 each).
  - **Monthly (4 weeks):** all four weeks full plus at least one transfer in the block. Special W food or a healthy meal (₦9,500).
  - **Landmark:** one big treat per landmark badge, and it needs a transfer in the last 4 weeks. Pizza (₦20,000) or the new t-shirt and trousers (₦13,000). Landmarks: 8 full training weeks, survival fund 50% and 100%, 3 and 5 projects shipped, target weight reached.
  - The current period and the one before it can be claimed, so a missed Monday doesn't lose a treat.
  - Claiming a paid treat can also log it in Money as a Rewards expense (checkbox, on by default). Removing the claim removes that expense.
  - The reward menu is editable (add, remove, change tier and cost).
- **Badges (31):** 14 streak badges (strong days, full training weeks, commit streak, spending-logged days, weekly weigh-ins) and 17 milestone badges (sessions, money saved, survival fund 25/50/100%, projects shipped, modules logged, first weigh-in, target weight). Earned badges are saved with their date and never taken back; locked ones show progress.
- Weekly review screen: not built yet; planned together with the AI advisor.

### 3.6 AI advisor
- Daily nudge and weekly review, generated from summarised metrics (never raw records).
- Chat for questions like "why is my weight flat?" or "can I afford this reward?".
- Sends only aggregated data to the model API; you choose what's included.

### 3.7 Forecasting
- **Phase 1 (simple, on-device):** weight trend (moving average/regression), strength trend (reps × load level), savings ETA, project completion ETA.
- **Phase 2 (ML):** once enough history exists, a proper model (e.g. gradient boosting or time-series) served separately, with confidence ranges.

## 4. Data model (core entities)
- `Habit`, `HabitLog(date, done)`
- `Workout(day, exercises[])`, `SetLog(date, exercise, setNo, reps, loadLevel)`
- `BodyMetric(date, weight, measurements{})`
- `Account`, `Transaction(date, amount, type, category, tags[], source)`
- `Income(date, amount)`, `Fund(type, target, balance)`
- `Project(name, repo, milestones[], status)`, `CommitDay(date, count)`, `LearningLog(date, course, note)`
- `Badge`, `Reward(tier, item, cost, unlockedOn)`
- `Insight(date, kind, text)`

## 5. Architecture
- **Frontend:** React + TypeScript + Vite, Tailwind, a charting library; installable PWA (offline-ready).
- **Storage:** IndexedDB (via Dexie) behind a repository interface; JSON export/import for moving data between devices.
- **Small server (serverless functions):** holds API keys for the bank link and the AI advisor; no personal data stored there.
- **Later:** encrypted cloud sync, accounts and multi-user support for the pitch version.

## 6. Build phases
1. **Shell and design system:** dark theme, navigation, Today screen with sample data. *(done)*
2. **Fitness:** workout checklist and set logger, progression flags, weekly body metrics, charts. *(done)*
3. **Money (manual):** fast logger, categories, income split, survival fund tracking. *(done)*
4. **Career:** GitHub sync, 5-project tracker, learning log. *(done)*
5. **Gamification:** streaks, badges, reward tiers, claim flow. *(done)*
6. **OPay statement import** (replaces the dropped Mono bank link).
7. **AI advisor and forecasts.**
8. **Hardening for pitch:** sync, accounts, onboarding for other users, analytics.

## 7. Open items
- OPay statement import: needs a sample statement export (with personal details removed) to match the columns.
- GitHub sync reads public commits on default branches only, for the last 90 days. Private repositories and other branches don't appear, so the Today screen keeps a manual "mark done" for coding days.
- Reminders: first version uses in-app prompts when the app is opened; push notifications need extra setup.
- Phone-laptop data merge approach (export/import first; import button not built yet).
