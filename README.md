# Personal Life Dashboard — Product Spec (v0.20)

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
  2. OPay statement import: scrapped. OPay never sent a statement to match the columns against. The generic CSV import (section 19) reads statements from any bank or wallet, and manual logging stays the main path.
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
6. **OPay statement import:** scrapped (no sample statement was ever available). The generic CSV import replaces it.
7. **AI advisor and forecasts.** *(done: rules-based coach, weekly review, trend forecasts, optional Claude chat and written review)*
8. **Hardening for pitch:** sync, accounts, onboarding for other users, analytics.

## 7. Open items
- GitHub sync reads public commits on default branches only, for the last 90 days. Private repositories and other branches don't appear, so the Today screen keeps a manual "mark done" for coding days.
- Push notifications are built (section 26) but have not been tried on a real phone yet.

## 8. Advisor (built)
- Works offline without a key: daily nudges, weekly review (this week so far or last week), trend forecasts for weight, survival fund, portfolio pace and training volume.
- Optional Claude layer: the page calls the Anthropic Messages API directly with a key you paste in. The key is kept in its own browser storage slot, never in the data or the JSON export.
- Only a numbers-only summary is sent (no notes, names, project or repo titles, GitHub username, treat names). Per-area share toggles and a "show exactly what gets sent" preview.
- Billing is through an Anthropic Console account (separate from a Claude app plan). Use a key with a low spend limit.
- Not yet verified against the live API (the build sandbox could not reach it). If calls from a saved file are blocked by the browser, host the page or add a small proxy.
- Forecasts show a range, a confidence label and (for weight) a back-test of past accuracy (section 23). Machine-learning forecasting is not planned until there is real multi-user data to learn from.

## 9. Month schedule (built)
- Month tab: Monday-first calendar with the push/pull/legs days, four-plate dots for past days, reward-block end and goal deadline markers, and month totals (sessions, strong days, bills and income still due).
- Plans: add a bill, income, task or event to any day, optionally repeating monthly (a 31st repeats on the last day of shorter months). Tick items off per occurrence; deleting a repeating item removes it from every month.
- Items due today or in the next two days appear as nudges. The advisor sees only counts and naira totals for the next 14 days, never titles.
- Ticking a bill or an income item with an amount offers to record it in Money (section 28). Tasks, events and items with no amount just tick.

## 10. Phone and laptop sync (built)
- Storage stays on each device. "Sync and backup" (top right on every screen, and in the sidebar on laptop) downloads a JSON copy, or opens the phone share sheet, and imports a copy from another device with a preview.
- Merge keeps anything only one device has, keeps deletions (deleted items are remembered by id so they do not come back), ORs habit flags, combines logged reps set by set, keeps the higher commit count, and the earliest badge date. Where both devices changed the same value, the more recently edited device wins. Merging the same file twice changes nothing; merging in either order gives the same result. "Replace instead" overwrites a device with the file.
- Sample data is never mixed with real data.
- Not included in exports: the Claude API key.
- Installable and offline: the hosted build (dist folder) has a web app manifest, icons and a service worker. It only works when served over https, not from a saved file. Fonts from Google need internet; offline it falls back to system fonts.
- Limits: sync is manual (export then import); there is no automatic cloud sync. If a project's milestone is deleted on the older device, the newer device's list wins. A copy hosted at a web address has separate storage from the file opened from disk, so move existing data across once with export and import.
- Next phase: hardening for the pitch version.

## 11. Settings (built)
- Settings screen (top right on every screen, and in the sidebar on laptop): training programme editor (rename, sets, rep range, reps or seconds, each side, reorder, add or remove exercises, change session name and weekday), spending categories (add, rename with past entries following, remove with entries moved to Other; Rewards and Other are fixed), reward menu (add, edit name, cost and level, remove), goals (goal weight, number of projects, career deadline), and data (sync, erase).
- A programme is checked before it can be saved (three sessions on different weekdays, each with at least one valid exercise). Logged history is never rewritten: renaming keeps history, removing an exercise hides it.
- Single-value settings (savings split, daily estimate, opening fund, goal weight, programme, categories, goals, GitHub name, advisor settings) carry their own last-changed time, so a merge keeps the most recent change to each one even from the device that was edited less recently overall. A category used by an entry from either device is always kept.
- Still on other screens: savings split and daily estimate on Money, advisor options on Advisor.

## 12. First-run setup (built)
- A brand-new device opens a welcome screen instead of sample data, with three choices: set up the dashboard, import a copy from another device (so a phone can start from the laptop's data), or look around with sample data first.
- Setup has five short steps: training days (push, pull and legs on three different weekdays), starting weight and goal weight, money (rough daily spending, amount already in the survival fund, share of income to save), career goal (number of projects, deadline, GitHub username) and the reward menu (example menu or empty). Every answer is optional or has a default, is checked before moving on, and can be changed later in Settings.
- "Start fresh" from sample data and "Erase everything" in Settings lead back to the welcome screen. Anyone with data saved before this existed skips it (`onboarded` defaults to true for older saves).
- Setup values are stamped like any other setting, so they take part in device merges correctly.
- Not part of setup: the Claude API key (added later in the Advisor).

## 13. Hardening (built)
- **Damaged data**: every load passes through `sanitize.ts`, which drops invalid records instead of crashing. If the saved file cannot be parsed at all, a recovery screen offers: download the unreadable data, restore the automatic daily backup, import an earlier export, or start empty. The unreadable copy is never overwritten.
- **Storage problems**: a warning banner appears if the browser refuses to save (storage full or blocked), with a one-tap download of a copy. It clears once saving works again.
- **Several tabs**: changes from another tab are merged in via the storage event.
- **Crashes**: an error boundary around each screen keeps the rest of the app usable; an app-level boundary offers Download my data and Restore the last backup.
- **Accessibility**: automated axe-core audit (WCAG 2 A/AA) is clean on every screen at desktop width. Not yet checked with a real screen reader.
- **Security headers**: `vercel.json` sets a CSP (inline scripts are still allowed because the build is a single inlined file), nosniff, no-referrer and a restrictive Permissions-Policy.
- **Tests**: see section 16. GitHub Actions runs typecheck, tests and build on every push.
- **Not done**: real-device testing (see section 24).

## 14. Accounts and cloud sync (built, needs a Supabase project)
**What it does.** Sign in on any device and the dashboard keeps itself in step: edits go up a few seconds after you stop, other devices are checked when you return to the app, go back online, and every minute while it is open. The file export/import still works and is the fallback.

**How it stays private.** Data is encrypted in the browser (PBKDF2 → AES-GCM) with a passphrase that is never sent anywhere. The server stores one opaque row per account. A forgotten passphrase cannot be recovered by anyone; the data on your devices is unaffected. The account password (email login, resettable) and the data passphrase are separate. "Keep this device unlocked" stores a non-extractable key in the browser instead of the passphrase.

**How devices agree.** The cloud copy is a version-numbered row. A device pulls it, merges it with its own data using the same merge as file imports (nothing lost, deletions respected, newest setting wins), and pushes only if that added something. A write is refused if another device wrote first, and the device simply merges again. Sample data is never uploaded.

**Setting it up (once, about ten minutes).**
1. Create a free project at supabase.com.
2. In the SQL editor run `supabase/schema.sql` (creates the table and the row-level rules that let each person see only their own row).
3. Authentication → URL Configuration: set Site URL to your deployed address (password-reset links return there).
4. Project Settings → API: copy the Project URL and the `anon` public key.
5. In Vercel → Project → Settings → Environment Variables add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then redeploy. Locally, copy `.env.example` to `.env.local`.
Without those two values the app works exactly as before and the cloud section says it is switched off.

**Limits to know.** Whole-dashboard sync (one row, up to 20 MB). Email confirmation uses Supabase's built-in mailer, which is rate-limited; use your own SMTP before real users. Deleting the account is in the app (section 21; it needs one extra SQL block in Supabase). The session is kept in this browser's storage, as with most web apps; the content security policy limits what scripts can run.

## 15. Demo mode (built)
Open the app at its own link, `https://life-dashboard-neon-ten.vercel.app/demo` (or with `?demo`), to show it on made-up data. On Vercel this is a rewrite in `vercel.json`, with `/demo/` redirecting to `/demo`; any other host needs the same rule, or use `?demo`. It runs in memory only: nothing is saved, nothing is uploaded, sign-in and the Claude key are switched off, and the visitor's own data on that device is never touched. Reloading resets it. A short guided tour (eight steps: Today, Month, Train, Money, Career, Rewards, Advisor, privacy) walks through the areas; "Start my own" leaves the demo for the real first-run welcome. Use `/demo?tour=0` (or `?demo&tour=0`) to skip the tour when someone is driving it live. The sample data is dated relative to today, so it always looks current.

## 16. Testing (built)
- `npm test`: 226 unit tests (incl. the statement importer, reminders, push scheduling and its on-screen preview, forecasting and units) (merge, plan, advisor, setup, resilience incl. a corruption fuzz, cloud crypto and two-device sync).
- `npm run e2e`: builds the app twice (normal, and wired to a local mock of Supabase) and runs 77 browser tests in Chromium via Playwright: first-run setup, settings, month, file export/import merge, advisor, damaged data recovery, storage-full warning, crash isolation, two tabs, demo mode and its tour, statement import, the push notification controls in Settings, new versions reaching an installed app, bills and income recorded in Money, cloud sync between two devices (sign-up, wrong passphrase, concurrent edits, offline, token refresh, password reset), the production security headers, and an automated accessibility audit (WCAG 2 A/AA) of every screen at desktop and phone width. Tests run on a fixed clock (Friday 9 Oct 2026, Lagos time) so dates never drift. Locally set `PW_CHROMIUM_PATH` if Chromium is already installed; otherwise run `npx playwright install chromium` once.
- CI runs typecheck, unit tests and build on every push, and the browser tests as a separate job (the report is kept when it fails).
- Not covered: real phones, screen readers, the real Supabase service, and the live Claude API.

## 17. AI providers (built)
The advisor can use Anthropic (Claude), OpenAI, Google Gemini, or OpenRouter, which gives one key access to hundreds of models from many makers (Llama, Mistral, DeepSeek, Grok and others). Pick the provider in the Advisor screen, paste that provider's own API key, and type any model name it offers. Each provider keeps its own key (in its own slot on the device, never in the dashboard data, the export or the cloud copy) and its own last-used model, so switching back and forth loses nothing. The same numbers-only summary is sent whichever provider is chosen, and "Show exactly what gets sent" shows it.
Calls go straight from the browser to the provider, so only providers that allow that and are listed in the security policy (`vercel.json`) work. Adding another is a small change in `src/ai.ts` plus its address in `connect-src`. A fully custom address (for example a model running on your own machine) is not supported, because the policy deliberately blocks unknown destinations. Default model names are starting points; if a provider says "model not found", enter its current name.
Not verified against the live services; the request and reply formats follow each provider's public documentation and are covered by unit and browser tests using fakes.

## 18. Fonts and outside requests (built)
Barlow and Barlow Condensed (SIL Open Font License) are bundled into the app, so opening it, using it or running the demo makes no request to any font service or any other site. The security policy no longer lists any font host, and a browser test fails if the app contacts anything but its own address while in use. The only outside destinations are the ones a person chooses to enable: their chosen AI provider, GitHub (for commits) and the sync service.

## 19. Statement import

Money → "Import a statement" reads a CSV exported from any bank or wallet app (no bank-specific code; the OPay-specific import was scrapped).
- Detects delimiter, the header row, and the columns (separate debit/credit or one signed amount); you can correct each guess, plus day-first or month-first dates.
- Understands ₦, 1,234.56, 1.234,56, (500), 500- and DR/CR. Rows that don't fit the columns are left out and counted, never guessed.
- Review step: per-row Spent / Received / Saved / Don't import and category. Transfers into savings are marked Saved; money returning from savings is not imported by default.
- Entries get content-based ids, so importing the same or an overlapping statement adds nothing, and entries you deleted stay deleted. Everything is parsed in the browser; the file is never uploaded.
- CSV only, up to 5 MB. PDF/Excel are rejected with a message.

## 20. Installing the app

Settings → "Install on this device" (and an "Install app" link in the side rail when the browser allows it). Chrome, Edge and Samsung Internet only offer installing when they choose to, so the app catches that offer at start-up and keeps it for the button. Where no offer exists it explains why: iPhone needs Safari → Share → Add to Home Screen; Firefox on a computer can't install web apps; a page opened as a file, a private window or an in-app browser (WhatsApp, Instagram) can't install either.

## 21. Deleting an account

Sync and backup → "Delete my account" removes the sign-in and the encrypted copy for good; data on the devices you've used is kept. It calls a database function, `delete_my_account()`, defined at the end of `supabase/schema.sql`. **If you set Supabase up earlier, run that last block in the SQL editor once**, or the button will report an error. The function can only delete the caller's own account.

## 22. Getting started and reminders

**Getting-started checklist** on Today for new people: first plate, a money entry, a project or GitHub, reminders, install (left out where installing is impossible) and backup. Each step ticks itself from what the person has really done, has a button that goes to the right place, and the whole card can be hidden (remembered per device). It never shows in the demo or on sample data.

**Reminders** (Settings): daily check-in, training days (from the person's own programme), spending log, weekly review, each with its own time. The app makes a calendar file (`.ics`) with repeating events and an alert on each, which the person adds to their phone's calendar. The calendar then does the reminding with the app closed, and nothing is sent to any server. Times are "floating", so they stay at the same clock time when travelling. Reminders can also arrive as real push notifications, which work with the app closed and without the calendar (section 26). Using both means being reminded twice, so Settings tells the person to pick one.

## 23. Forecasting with honest ranges

The Advisor's "Where you're heading" now shows how sure each estimate is, not just a single number. All of it is plain arithmetic on the person's own logs (`src/projection.ts`); nothing leaves the device.
- **Bodyweight:** a straight line through the last six weigh-ins with an 80% prediction range that widens further ahead, with fewer points, and with noisier weigh-ins (small samples use a wider multiplier). The weeks to a goal weight come as a spread, not one number. **Back-test:** the app replays the person's history, forecasts each later weigh-in using only what was known then, and reports the average miss in kg and how often reality landed inside the range. Shown only once there are enough weigh-ins to check.
- **Survival fund:** slow, typical and fast monthly saving paces from rolling four-week stretches of the last twelve weeks (weeks before logging began are not counted as zero). The time to the target is a range, with a fan chart. With under three stretches of history the range is a deliberately wide ±40-60% and labelled an early estimate.
- **Portfolio:** if projects have ship dates, the finish date is a range that scales the headline estimate by how much faster or slower the person's quickest and slowest projects were.
- **Confidence labels** (early / fair / steady history) come from how much history there is, never from how good the news is.
- The AI advisor still receives only the numeric headline of each forecast, no free text.
- Not done: seasonality, income-aware savings forecasts, and anything that learns across people.

## 24. Phone checks

`e2e/mobile.spec.ts` runs with touch at 320×568 (smallest common phone), 390×844 and 844×390 (on its side): every screen has no sideways scroll, the bottom bar buttons are all on screen, no text box is under 16px (iPhones zoom the page when such a box is focused), and a statement can be imported with taps from start to finish. It also simulates the browser's install offer (the Install button appears, asks the browser to install, then reads "Already installed") and checks that an iPhone is told to use Safari's Add to Home Screen.

**What this cannot prove** (it is Chromium pretending to be a phone): the real keyboard, the phone's file picker, the real install prompt, Safari's own behaviour, and how the calendar file opens on a given phone. Check these on a real phone once: install it, set reminders and open the downloaded calendar file, import a CSV from the Files app, and rotate the phone.

## 25. Currency and weight follow where you are

The first-run setup suggests a **currency** and a **weight unit** (kg or lb) from where the person is, and Settings → "Currency and weight" lets them change either at any time.
- **How the location is found:** from the browser's timezone (the most reliable sign of the country), then a browser language that names a country (`en-GB`). It does not use the location permission and looks nothing up online. If neither says where they are, it starts on dollars and kilograms and says so. Pounds are suggested only where they are the norm (US, Liberia, Myanmar). Code: `src/units.ts` (detection and formatting), `src/localize.ts` (starting prices).
- **Money is relabelled, never converted.** Changing the currency changes the symbol and formatting only; no exchange rates are used anywhere, and logged amounts keep their numbers. Settings says so next to the picker. The starting reward ideas, the savings badges ("$10 saved") and the milestone amounts are priced in round numbers for the chosen currency, from rough order-of-magnitude guides that are not exchange rates. A currency the app has no sense of gets no starting rewards rather than mispriced ones.
- **Weight is stored in kilograms and shown in the chosen unit.** Switching between kg and lb is exact and changes nothing saved; what is typed is converted on the way in (to 0.01 kg). Forecasts, the chart, the coach and the setup limits all follow the unit.
- **Existing people keep naira and kilograms** until they choose otherwise, wherever they are. The sample data stays in naira (its amounts are naira-sized) but weighs in the local unit.
- **The AI advisor** is told the currency and weight unit and receives weights already in that unit, still numbers only.
- **Statement import** now reads any currency sign or code ($ £ € ₹ NGN USD Rs, etc.).
- The choice is one setting that syncs between devices like the others (the latest change wins).
- Not done: body measurements follow the same choice as weight (inches in the US, Liberia and Myanmar, centimetres elsewhere, changeable in Settings and stored in centimetres), but training loads are whatever the person types, the bank-merchant words used to guess spending categories are Nigerian-leaning, and the app is in English only.

**Also fixed here:** on phones the first-run setup card was split into two squashed columns by a rule meant for list rows; it is now one column.

## 26. Push notifications (built, needs setup)

**What it does.** Settings → Reminders has a "Push notifications" box. Once switched on for a device, the phone or laptop receives the same four reminders (check-in, training day, spending log, weekly review) at the chosen times, even with the app closed. Tapping one opens the app. Each device is switched on separately and needs an account, so the server knows where to send.

**What the server knows.** One row per device in `push_subscriptions`: the browser's push address and keys, the device's time zone, and the reminder times with fixed generic wording ("Time to check in"). It never sees the encrypted vault or anything logged, and the wording never contains an exercise name, an amount or a note. Rows are protected by row-level rules so a person can only touch their own devices. Signing out, deleting the account or turning push off removes the device's row.

**How it runs.**
- `src/push.ts` asks permission (only from a tap), subscribes the device, and keeps the server's copy current after a sync or when the times, programme days or time zone change.
- `public/sw.js` shows each push and opens the app when tapped.
- `api/push.ts` is one Vercel function with two callers. Supabase's scheduler calls it every minute with the shared `CRON_SECRET`; it works out which reminders are due in each device's *own* time zone and sends them. A signed-in person calls it with their own session token to send a test to their own devices.
- A reminder goes out once per local day. If a send fails it is retried each minute for 15 minutes, then dropped rather than arriving hours late. A push address the browser reports as dead is deleted.

**Setting it up (once).**
1. Make a key pair: `npx web-push generate-vapid-keys`.
2. In Vercel, add the environment variables: `VITE_VAPID_PUBLIC_KEY` (the public key; the app reads it at build time), and server-only `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`mailto:` your email), `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API; it bypasses all row rules, so never put it in a `VITE_` variable) and `CRON_SECRET` (a long random string).
3. Redeploy, so the public key is built into the app.
4. In the Supabase SQL editor run `supabase/push.sql`. Then enable the `pg_cron` and `pg_net` extensions (Database → Extensions) and run the commented `cron.schedule` block at the bottom of that file, with your app address and the same `CRON_SECRET`.
5. On each device: Settings → Reminders → Turn on for this device → Send a test.

**iPhone and iPad.** Push only works once the app is added to the Home Screen and opened from there; until then the browser hides the feature, and Settings explains this.

**Checked by tests.** `src/__tests__/push.test.ts` covers the scheduling (time zones, weekday rollover, once-a-day, the late window, midnight, broken data, many devices, dead addresses, retries) and the secret comparison. `e2e/push.spec.ts` covers the Settings states: not set up, demo, signed out, signed in, permission refused, and no working service worker (it gives up with a message instead of hanging). `api/` is part of the typecheck.

**Seeing what will happen (Settings -> Reminders).**
- Each switched-on reminder row ends with **Next:** and the time it will next arrive on this device ("today 17:30", "tomorrow (Monday) 17:30", "Sunday 19:00"). The training reminder only fires on the programme's days, so on a rest day it points to the next gym day instead of looking broken.
- **Check what the server has** (needs an account) lists every device saved on the account: which push service it uses, its time zone, each reminder's time and days, when it will next be sent and when it last was. This device is listed first. If the server's times differ from the screen (or its time zone does), it says so and **Update the server now** fixes it in one tap.
- The next-time wording comes from `src/pushPreview.ts`, which mirrors the sender. A unit test steps through a week minute by minute against the sender's own `dueReminders` for eight situations (different zones, gym days, already sent, just missed), so the screen cannot disagree with what the server does.
- Not covered by a browser test: the "Update the server now" button, because a headless browser cannot create a real push subscription. The comparison behind it is unit tested.

**Not verified.** Actual delivery to a real phone, the Supabase scheduler calling the deployed function, and the Vercel environment (a headless browser cannot create a real push subscription). Check these once after setup with "Send a test", then wait for a real reminder.
- Only the four reminders exist; there are no event-based notifications (for example "streak at risk").
- A device that has not opened the app since its time zone changed keeps the old zone until it does.

## 27. How a new version reaches an installed app (built)

**The problem this fixed.** The installed app kept showing the old version after a deploy. Three things caused it: the service worker showed its saved copy of the app first and only refreshed in the background, so a new version appeared on the *second* launch; a phone app is usually put away rather than closed, so there was rarely a second launch; and `sw.js` was byte-for-byte the same after an app-only deploy, so the browser had no reason to look for a new one.

**How it works now.**
- `vite.config.ts` writes a different build id into `sw.js` on every build (Vercel's commit id when there is one, otherwise the build time). A deploy therefore always changes the file, and the browser installs the new worker.
- Opening the app is network first (`public/sw.js`): the newest version is fetched every time, and the saved copy is used only when offline, when the server errors, or when the network takes longer than 4 seconds.
- `src/updates.ts` asks the browser to look for a new version when the app comes back to the front, when the phone goes back online, and every 30 minutes while it is open (never more than once a minute).
- When the new version has installed, a banner says "A new version is ready" with an **Update now** button. Nothing reloads by itself, so nobody loses what they are typing. Everything logged is kept (it lives in localStorage, which a reload never touches).
- The first ever install is not announced as an update.

**A phone that still has the old service worker** (installed before this change) needs one more launch to pick it up: close the app completely, open it, wait a few seconds, close it, and open it again. After that, updates arrive by themselves. Do **not** remove and re-add the app on an iPhone to force it, because that can clear its saved data. Use Sync and backup first if you are unsure.

**Checked by tests.** `e2e/updates.spec.ts` runs with service workers on: the build stamp is present, the first install shows no banner, a new deploy shows the banner and "Update now" loads it, the newest page is used on the very first reload, and the saved copy still opens offline. `src/__tests__/updates.test.ts` covers the once-a-minute limit.

**Not verified.** How a particular phone treats a put-away app (some keep it frozen for days). The banner appears as soon as the app is brought back to the front and the browser has had a moment to check.

## 28. Bills and income feed Money (built)

**What it does.** On the Month calendar, ticking a bill or an income item that has an amount opens a small form under it, already filled in: the amount, the category (the one last used for the same name, otherwise Other), and the date (the day it was due, or today if that day is still ahead, because nothing can be recorded in the future). **Record and tick** adds the Money entry and ticks the item in one step. **Just tick** ticks it without recording anything, for people who log elsewhere. Cancel or Escape leaves it unticked. Tasks, events and items with no amount tick straight away as before.
- A bill becomes an expense. Income becomes income, and a checkbox offers to move the usual share (the savings percentage in Money) into the survival fund, or the investment fund once the survival target is reached. That saving is what the reward rule "a savings transfer was made" looks for.
- Unticking an item that was recorded asks **Also remove it from Money?** with three choices: untick and remove, untick and keep the entry, or cancel. Entries logged by hand are never touched.
- Everything downstream uses the entry like any other: monthly totals, spending charts, the survival fund and its ETA, and the reward gate.

**How it stays correct.** The entry's id is made from the planned item and the day it was due (`plan:<item>:<date>`, plus `:save` for the savings split). That means no extra stored data, a tick that arrives twice adds nothing, each month of a repeating item has its own entry, and two devices that both tick the same bill end up with one entry after a merge, not two. An entry that was removed stays removed on every device (its id goes in the list of deleted things), so ticking again afterwards uses the next free id (`:2`, `:3`) rather than being blocked by the removed one.

**Checked by tests.** `src/__tests__/planpay.test.ts` covers the ids, what a tick creates, ticking and unticking, never doubling, removal staying removed through a merge, hand-logged entries being safe, saved copies loading, and the effect on month totals, the survival fund and the reward rule. `e2e/bills.spec.ts` covers the whole flow on a desktop and a phone, including accessibility.

**Not done.**
- A bill ticked before it is due is dated today but keeps the due day's id.
- The Today screen only reminds about bills that are coming up; it does not tick them.
- Editing the amount or date of a recorded bill is done in Money, and the Month calendar does not follow it.
