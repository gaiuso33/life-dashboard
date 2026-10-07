# Personal Life Dashboard — Product Spec (v0.1)

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
- **Ingest, in order of preference:**
  1. Bank link via Mono (OPay is listed as supported; availability, approval and cost for personal use must be verified in Mono's docs).
  2. OPay statement import (CSV/XLSX).
  3. Fast manual logger: amount, tap a category, optional note.
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

### 3.5 Goals, habits and rewards
- Daily habits: gym or mobility, GitHub activity, spending logged, plus any added later.
- **Badges:** streak-based (e.g. 4 full weeks of sessions) and milestone-based (e.g. first ₦10k saved, first project shipped).
- **Reward tiers (defaults):**
  - Weekly: small, cheap or free (snack under ₦2,000, rest or gaming hour)
  - Biweekly: parfait or La Palace rice (₦7,000)
  - Monthly: Special W food (₦9,500) or a healthy meal
  - Special milestone: pizza (₦20,000)
- **Rule (confirmed):** a reward unlocks only if that period's savings transfer was made.
- Weekly review screen: summary of the week, wins, misses, next week's focus.

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
1. **Shell and design system:** dark theme, navigation, Today screen with sample data.
2. **Fitness:** workout checklist and set logger, progression flags, weekly body metrics, charts.
3. **Money (manual):** fast logger, categories, income split, survival fund tracking.
4. **Career:** GitHub sync and the 5-project tracker.
5. **Gamification:** streaks, badges, reward tiers.
6. **Bank link:** Mono/OPay (or statement import) once verified.
7. **AI advisor and forecasts.**
8. **Hardening for pitch:** sync, accounts, onboarding for other users, analytics.

## 7. Open items
- Verify Mono/OPay personal-use availability and cost (statement import and manual logging are the backups).
- Reminders: first version uses in-app prompts when the app is opened; push notifications need extra setup.
- Phone-laptop data merge approach (export/import first).
