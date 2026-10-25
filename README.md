# Personal Life Dashboard

Product spec and current status. Live at https://life-dashboard-neon-ten.vercel.app (demo with made-up data: `/demo`).

## Current status (22 October 2026)

**Built and in daily use by one person:** daily plates and habits; training (push, pull, legs, mobility) with a progression flag; weekly body measurements and on-device progress photos; money (quick logger, CSV statement import, bills and income that feed Money, an income split into the survival fund, categories the app learns, savings forecasts that cope with irregular income); career (GitHub commits, a five-project tracker, learning log); rewards and badges; the Month calendar; an AI advisor (offline coach, or Claude, OpenAI, Gemini or OpenRouter with your own key); real push reminders; accounts with end-to-end encrypted cloud sync, plus file export and import; an installable app that offers its own updates; demo mode.

**Checked on real devices and services** ([milestone v1.0](https://github.com/gaiuso33/life-dashboard/milestone/1), all done by the owner, October 2026):
- [#13](https://github.com/gaiuso33/life-dashboard/issues/13) push delivery: a real scheduled reminder arrives with the app closed on Android (Chrome) and on iPhone (from the Home Screen); tapping it opens the app; changing a reminder time or the phone's time zone moves the next one; turning push off, signing out and deleting the account each stop it; two devices on one account stay independent; the scheduler and function logs show a successful run every minute.
- [#14](https://github.com/gaiuso33/life-dashboard/issues/14) real-device checklist: installing (Android prompt, iPhone Add to Home Screen), the on-screen keyboard, importing a CSV from the Files app, the calendar file, rotating the phone, working offline, and Safari keeping its storage after a week unused.
- [#15](https://github.com/gaiuso33/life-dashboard/issues/15) screen readers: VoiceOver (iPhone) and TalkBack (Android) on Today, Train, Money and Settings → Reminders; charts have text alternatives; dialogs trap and return focus; status messages are announced.
- [#16](https://github.com/gaiuso33/life-dashboard/issues/16) two-device sync against the real Supabase project, including the encrypted-only copy, password reset, staying unlocked and deleting the account.

All of v1.0 is done. Since then: [#24](https://github.com/gaiuso33/life-dashboard/issues/24), nudges worked out from your data (section 33), [#25](https://github.com/gaiuso33/life-dashboard/issues/25), reminder days, quiet hours and snooze (section 31), and [#27](https://github.com/gaiuso33/life-dashboard/issues/27), training weights that follow the weight unit (section 32).

**Later:** [v1.x improvements](https://github.com/gaiuso33/life-dashboard/milestone/2) (GitHub private repositories, more languages) and the [v2.0 pitch version](https://github.com/gaiuso33/life-dashboard/milestone/3) (security review for many users, privacy policy and onboarding for other people, own email sender, a push sender that scales, analytics, forecasts learned across people).

Sections marked **(built)** are in the app. Each "Not done" line below was checked against the code on 21 October 2026.

## 1. Vision
A dark, data-heavy personal dashboard that turns daily check-ins into visible progress across **fitness, money and career**, rewards consistency, and uses an AI advisor and forecasts to keep you on track. Built for one user first (you), structured so it can be pitched later as a general self-improvement product.

## 2. Principles
- **Daily "did I do my thing?" view first.** Everything else supports it.
- **Logging must take seconds.** Auto-pull data where possible; otherwise one-tap or keyboard-fast entry.
- **Device-first privacy.** Data lives on the device. Only a numbers-only summary leaves it (to the AI provider the person picks, with their own key), and the optional cloud copy is encrypted in the browser before it is uploaded (section 14). Progress photos never leave the device (section 30).
- **Swap-ready architecture.** A storage layer interface (`src/repository.ts`) so where data is kept can change without rewriting the app.
- **Laptop-first, phone-friendly.** Full dashboard on laptop, slim quick check-in view on phone.

## 3. Modules

### 3.1 Today (home screen)
- Progress ring for the day: workout (on gym days) or mobility (rest days), habits, money check-in, GitHub activity.
- Streak counters and current reward progress.
- Daily check-in prompt: weight-free quick questions (energy/mood optional, habits done, spending logged).

### 3.2 Fitness
- **Program:** Mon Push, Wed Pull, Fri Legs (exercises and rep ranges as you gave them).
- **Program change (confirmed equipment: dumbbells, barbells, pull-up bar, bench, mat):** replace the Romanian deadlift on pull day with pull-ups or chin-ups, 3 × 6-10 (if you can't hit 6 yet, use slow negatives: jump up, then lower over 3-5 seconds). Keep RDL on leg day.
- **Set logging:** reps per set + a **load note** (label like "blue dumbbells" or "2 plates"), since exact mass may be unknown, plus an optional **weight** per exercise in the unit chosen in Settings (section 32).
- **Progression engine:** double progression. When all sets hit the top of the rep range, the app flags "increase load next session".
- **Mobility:** ~12-minute routine on rest days (Tue/Thu/Sat or Sun) and a 5-minute pre-lift warm-up.
- **Body metrics (weekly):** weight plus measurements (neck, shoulders, chest, upper arm, waist, hips, thigh, calf). Optional progress photos, kept in this browser only (section 30).
- **Targets:** app proposes realistic targets and a gain rate from your starting numbers; you can edit them.

### 3.3 Money
- **Accounts:** OPay is the main account.
- **Ingest:**
  1. Fast manual logger: amount, tap a category, optional note (built).
  2. OPay statement import: scrapped. OPay never sent a statement to match the columns against. The generic CSV import (section 19) reads statements from any bank or wallet, and manual logging stays the main path.
  - **Bank link via Mono: dropped.** Mono asks for a registered business name and email, which doesn't fit a personal project. Revisit only if the app becomes a real product.
- **Categories:** Food, Transport, Data and airtime, Housing, Personal care, Health and gym, Giving, Entertainment, Rewards, Other (editable in Settings; savings transfers are their own kind of entry, not a category). Each transaction can be tagged and re-tagged, and the app learns from the person's own choices: a place gets the category last chosen for it (section 29).
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
- Weekly review: built, in the Advisor (section 8). It works offline from the logs, and can also be written up by the AI provider.

### 3.6 AI advisor
- Daily nudge and weekly review, generated from summarised metrics (never raw records).
- Chat for questions like "why is my weight flat?" or "can I afford this reward?".
- Sends only aggregated data to the model API; you choose what's included.

### 3.7 Forecasting
- **Phase 1 (simple, on-device):** weight trend (moving average/regression), strength trend (reps × load level), savings ETA, project completion ETA.
- **Phase 2 (ML):** not planned until there is real data from many people to learn from ([#34](https://github.com/gaiuso33/life-dashboard/issues/34)). Phase 1 is plain arithmetic with ranges and a back-test (section 23).

## 4. Data model
Everything the person logs is one object (`AppData` in `src/types.ts`), saved as one JSON entry in the browser (`life-dashboard:v1`) and checked by `src/sanitize.ts` on every load.
- `days` (each day's habit ticks and energy), `sessions` (a workout, keyed by date and day), `body` (weigh-ins and measurements), `goalWeight`
- `money`: `txns` (each is an expense, income or saving, with category, note and fund), `savePct`, `dailyEstimate`, `survivalOpening`, `categories`, `learned` (section 29)
- `career` (GitHub name and commit counts, projects with milestones, learning log), `rewards` (menu, claims, earned badges), `advisor` (settings with the share toggles, saved written reviews), `plans` (bills, income, tasks and events on the Month calendar)
- `program` (the person's own training programme), `prefs` (currency, weight and length units)
- Housekeeping: `gone` (ids of deleted things, so merges do not bring them back), `stamps` (when each single setting last changed), `onboarded`, `sample`, `modified`

Kept separately, never in that object: each AI provider's key (its own slot), whether the "getting started" card is hidden, and progress photos (IndexedDB, section 30).

## 5. Architecture
- **Frontend:** React 18 + TypeScript + Vite, built to a single inlined page. Charts are drawn as SVG (`src/Charts.tsx`, `src/FanChart.tsx`) and styled with plain CSS, so there are no chart or CSS framework dependencies. An installable PWA with a service worker (section 27).
- **Storage:** the browser's `localStorage` behind a repository interface (`src/repository.ts`), with an automatic daily backup and a recovery screen. Progress photos are in IndexedDB. JSON export and import move data between devices.
- **Accounts and cloud copy:** Supabase (optional): sign-in, one encrypted row per person, and the saved push devices (section 14, 26).
- **One serverless function:** `api/push.ts` on Vercel sends the push reminders. It holds only the push keys and Supabase service key. No AI key, bank link or personal data passes through any server: AI calls go straight from the browser to the provider the person chose.
- **Dependencies that ship:** `react`, `react-dom`, and `web-push` (server only). Everything else is a build or test tool (section 13).

## 6. Build phases
1. **Shell and design system:** dark theme, navigation, Today screen with sample data. *(done)*
2. **Fitness:** workout checklist and set logger, progression flags, weekly body metrics, charts. *(done)*
3. **Money (manual):** fast logger, categories, income split, survival fund tracking. *(done)*
4. **Career:** GitHub sync, 5-project tracker, learning log. *(done)*
5. **Gamification:** streaks, badges, reward tiers, claim flow. *(done)*
6. **OPay statement import:** scrapped (no sample statement was ever available). The generic CSV import replaces it.
7. **AI advisor and forecasts.** *(done: rules-based coach, weekly review, trend forecasts, optional Claude chat and written review)*
8. **Accounts, sync and hardening:** encrypted cloud sync, accounts, first-run setup, damaged-data recovery, security headers, real push reminders. *(done for personal use)* Onboarding and a privacy policy for other people, a multi-user security review and analytics are the v2.0 milestone.

## 7. Open items
- GitHub sync reads public commits on default branches only, for the last 90 days. Private repositories and other branches don't appear, so the Today screen keeps a manual "mark done" for coding days.
- Push notifications are built (section 26) and have been checked on Android and iPhone ([#13](https://github.com/gaiuso33/life-dashboard/issues/13)).
- Private repositories and other branches are tracked in [#26](https://github.com/gaiuso33/life-dashboard/issues/26).

## 8. Advisor (built)
- Works offline without a key: daily nudges, weekly review (this week so far or last week), trend forecasts for weight, survival fund, portfolio pace and training volume.
- Optional Claude layer: the page calls the Anthropic Messages API directly with a key you paste in. The key is kept in its own browser storage slot, never in the data or the JSON export.
- Only a numbers-only summary is sent (no notes, names, project or repo titles, GitHub username, treat names). Per-area share toggles and a "show exactly what gets sent" preview.
- Billing is through an Anthropic Console account (separate from a Claude app plan). Use a key with a low spend limit.
- Checked by hand against the live Anthropic API by the owner and it works (October 2026). Browsers can block these calls from a page opened as a saved file; use the hosted address.
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
- Installable and offline: the hosted build (dist folder) has a web app manifest, icons and a service worker (section 27). It only works when served over https, not from a saved file. The fonts are bundled, so nothing needs the internet to display (section 18).
- Limits: without an account, sync is manual (export then import). With one it is automatic (section 14). If a project's milestone is deleted on the older device, the newer device's list wins. A copy hosted at a web address has separate storage from the file opened from disk, so move existing data across once with export and import.
- Progress photos are not part of a copy unless the person ticks a box when saving it (section 30).

## 11. Settings (built)
- Settings screen (top right on every screen, and in the sidebar on laptop): training programme editor (rename, sets, rep range, reps or seconds, each side, reorder, add or remove exercises, change session name and weekday), spending categories (add, rename with past entries following, remove with entries moved to Other; Rewards and Other are fixed), reward menu (add, edit name, cost and level, remove), goals (goal weight, number of projects, career deadline), what the app has learned about spending categories (section 29), and data (sync, erase).
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
- **Accessibility**: automated axe-core audit (WCAG 2 A/AA) is clean on every screen at desktop and phone width. Checked by hand with VoiceOver (iPhone) and TalkBack (Android) on Today, Train, Money and Settings → Reminders ([#15](https://github.com/gaiuso33/life-dashboard/issues/15)); other screens have only the automated audit.
- **Security headers**: `vercel.json` sets a CSP (inline scripts are still allowed because the build is a single inlined file), nosniff, no-referrer and a restrictive Permissions-Policy.
- **Tests**: see section 16. GitHub Actions (Node 22) runs the dependency audit, both typechecks, the unit tests, the build and the browser tests on every push and pull request.
- **Dependencies**: `npm audit` reports 0 vulnerabilities (checked 18 Oct 2026, after moving to Vite 6 and Vitest 5). Before that, the 9 findings were all in dev tools (the dev server and test runner, never shipped to the app); the code that runs in people's browsers and on the server (`react`, `react-dom`, `web-push`) was clean. CI now fails if a shipped dependency gets a known vulnerability. Node 22.12 or newer is required (`engines` in `package.json`).
- **Not done**: a security review for many users ([#31](https://github.com/gaiuso33/life-dashboard/issues/31)).

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

**Limits to know.** Whole-dashboard sync (one row, up to 20 MB). Progress photos are not part of it. The two-device behaviour is tested automatically against a local mock of Supabase and has been checked by hand against the real project ([#16](https://github.com/gaiuso33/life-dashboard/issues/16)). Email confirmation uses Supabase's built-in mailer, which is rate-limited; use your own SMTP before real users. Deleting the account is in the app (section 21; it needs one extra SQL block in Supabase). The session is kept in this browser's storage, as with most web apps; the content security policy limits what scripts can run.

## 15. Demo mode (built)
Open the app at its own link, `https://life-dashboard-neon-ten.vercel.app/demo` (or with `?demo`), to show it on made-up data. On Vercel this is a rewrite in `vercel.json`, with `/demo/` redirecting to `/demo`; any other host needs the same rule, or use `?demo`. It runs in memory only: nothing is saved, nothing is uploaded, sign-in and the Claude key are switched off, and the visitor's own data on that device is never touched. Reloading resets it. A short guided tour (eight steps: Today, Month, Train, Money, Career, Rewards, Advisor, privacy) walks through the areas; "Start my own" leaves the demo for the real first-run welcome. Use `/demo?tour=0` (or `?demo&tour=0`) to skip the tour when someone is driving it live. The sample data is dated relative to today, so it always looks current.

## 16. Testing (built)
- `npm test`: 447 unit tests: the statement importer, reminders (days, quiet hours, snooze, event nudges), push scheduling and its on-screen preview, the push function itself, forecasting and units, merge, plan, advisor, setup, resilience (including a corruption fuzz), cloud crypto, learned categories, savings forecasts and progress photos and training weights.
- `npm run e2e`: builds the app twice (normal, and wired to a local mock of Supabase) and runs 98 browser tests in Chromium via Playwright: first-run setup, settings, month, file export/import merge, advisor, damaged data recovery, storage-full warning, crash isolation, two tabs, demo mode and its tour, statement import, the push notification controls in Settings, reminder days and quiet hours, the nudge switches, new versions reaching an installed app, bills and income recorded in Money, progress photos (shrinking, compare, delete, copies with and without them, refusals, nothing sent), training weights in pounds and kilograms and the weight-lifted forecast, cloud sync between two devices (sign-up, wrong passphrase, concurrent edits, offline, token refresh, password reset), the production security headers, and an automated accessibility audit (WCAG 2 A/AA) of every screen at desktop and phone width. Tests run on a fixed clock (Friday 9 Oct 2026, Lagos time) so dates never drift. Locally set `PW_CHROMIUM_PATH` if Chromium is already installed; otherwise run `npx playwright install chromium` once.
- CI runs, on every push and pull request: the audit of shipped dependencies (`npm audit --omit=dev`), the typecheck of the app and of the browser tests, the unit tests and the build; the browser tests are a separate job (the report is kept when it fails).
- Not covered by automated tests, but checked by hand by the owner: real phones (section 24), screen readers, the real Supabase project, and the live AI providers (the tests use fakes; Claude, OpenAI and Gemini work, OpenRouter has not been tried).

## 17. AI providers (built)
The advisor can use Anthropic (Claude), OpenAI, Google Gemini, or OpenRouter, which gives one key access to hundreds of models from many makers (Llama, Mistral, DeepSeek, Grok and others). Pick the provider in the Advisor screen, paste that provider's own API key, and type any model name it offers. Each provider keeps its own key (in its own slot on the device, never in the dashboard data, the export or the cloud copy) and its own last-used model, so switching back and forth loses nothing. The same numbers-only summary is sent whichever provider is chosen, and "Show exactly what gets sent" shows it.
Calls go straight from the browser to the provider, so only providers that allow that and are listed in the security policy (`vercel.json`) work. Adding another is a small change in `src/ai.ts` plus its address in `connect-src`. A fully custom address (for example a model running on your own machine) is not supported, because the policy deliberately blocks unknown destinations. Default model names are starting points; if a provider says "model not found", enter its current name.
**Checked against the live services by hand (October 2026):** Anthropic (Claude), OpenAI and Google Gemini work. **OpenRouter has not been tried against the live service.** The request and reply formats follow each provider's public documentation and are covered by unit and browser tests using fakes.

## 18. Fonts and outside requests (built)
Barlow and Barlow Condensed (SIL Open Font License) are bundled into the app, so opening it, using it or running the demo makes no request to any font service or any other site. The security policy no longer lists any font host, and a browser test fails if the app contacts anything but its own address while in use. The only outside destinations are the ones a person chooses to enable: their chosen AI provider, GitHub (for commits) and the sync service.

## 19. Statement import (built)

Money → "Import a statement" reads a CSV exported from any bank or wallet app (no bank-specific code; the OPay-specific import was scrapped).
- Detects delimiter, the header row, and the columns (separate debit/credit or one signed amount); you can correct each guess, plus day-first or month-first dates.
- Understands ₦, 1,234.56, 1.234,56, (500), 500- and DR/CR. Rows that don't fit the columns are left out and counted, never guessed.
- Review step: per-row Spent / Received / Saved / Don't import and category. The category is what the person chose before for the same place if the app has learned it (section 29), otherwise a built-in word guess. Transfers into savings are marked Saved; money returning from savings is not imported by default.
- Entries get content-based ids, so importing the same or an overlapping statement adds nothing, and entries you deleted stay deleted. Everything is parsed in the browser; the file is never uploaded.
- CSV only, up to 5 MB. PDF/Excel are rejected with a message.

## 20. Installing the app (built)

Settings → "Install on this device" (and an "Install app" link in the side rail when the browser allows it). Chrome, Edge and Samsung Internet only offer installing when they choose to, so the app catches that offer at start-up and keeps it for the button. Where no offer exists it explains why: iPhone needs Safari → Share → Add to Home Screen; Firefox on a computer can't install web apps; a page opened as a file, a private window or an in-app browser (WhatsApp, Instagram) can't install either.

## 21. Deleting an account (built)

Sync and backup → "Delete my account" removes the sign-in and the encrypted copy for good; data on the devices you've used is kept. It calls a database function, `delete_my_account()`, defined at the end of `supabase/schema.sql`. **If you set Supabase up earlier, run that last block in the SQL editor once**, or the button will report an error. The function can only delete the caller's own account.

## 22. Getting started and reminders (built)

**Getting-started checklist** on Today for new people: first plate, a money entry, a project or GitHub, reminders, install (left out where installing is impossible) and backup. Each step ticks itself from what the person has really done, has a button that goes to the right place, and the whole card can be hidden (remembered per device). It never shows in the demo or on sample data.

**Reminders** (Settings): daily check-in, training days (from the person's own programme), spending log, weekly review, each with its own time. The app makes a calendar file (`.ics`) with repeating events and an alert on each, which the person adds to their phone's calendar. The calendar then does the reminding with the app closed, and nothing is sent to any server. Times are "floating", so they stay at the same clock time when travelling. Reminders can also arrive as real push notifications, which work with the app closed and without the calendar (section 26). Using both means being reminded twice, so Settings tells the person to pick one.

## 23. Forecasting with honest ranges (built)

The Advisor's "Where you're heading" now shows how sure each estimate is, not just a single number. All of it is plain arithmetic on the person's own logs (`src/projection.ts`); nothing leaves the device.
- **Bodyweight:** a straight line through the last six weigh-ins with an 80% prediction range that widens further ahead, with fewer points, and with noisier weigh-ins (small samples use a wider multiplier). The weeks to a goal weight come as a spread, not one number. **Back-test:** the app replays the person's history, forecasts each later weigh-in using only what was known then, and reports the average miss in kg and how often reality landed inside the range. Shown only once there are enough weigh-ins to check.
- **Survival fund:** slow, typical and fast monthly saving paces. The time to the target is a range, with a fan chart.
  - **Before three whole months of history:** paces come from rolling four-week stretches of the last twelve weeks (weeks before logging began are not counted as zero). With under three stretches the range is a deliberately wide ±40-60% and labelled an early estimate.
  - **From three whole months on (`src/saving.ts`):** the estimate is made from whole calendar months (the month in progress is left out, and so is the month logging began in unless that was in its first five days), up to the last six. It uses income as well as spending: it also works out what is left after spending, so it can say "you keep about N a month, more than you are putting away" or, if nothing has been moved into the fund, show the time as a clearly labelled what-if.
  - **One-offs are left out.** An entry of a kind (income, spending or saving) is treated as a one-off when there are at least five entries of that kind in the window, it is at least 3 times the usual (median) entry, at least 10% of everything of its kind, and nothing within 25% of its size appears in any other month (rent that comes every month is not a one-off). The card names what was left out, so nothing is hidden.
  - **Lumpy income widens the range.** How uneven monthly income is (its spread as a share of its average, full at 1.0) shrinks the slow end and stretches the fast end by up to 50%, and very lumpy income lowers the confidence label by one step.
  - **Back-test:** standing at the start of each past month with only what was logged before it, the app replays the estimate and checks it against the next two months (everything counted, one-offs included). The card reports the average miss per month and how often the real pace landed inside the range, once at least three forecasts can be checked.
- **Portfolio:** if projects have ship dates, the finish date is a range that scales the headline estimate by how much faster or slower the person's quickest and slowest projects were.
- **Confidence labels** (early / fair / steady history) come from how much history there is, never from how good the news is.
- The AI advisor still receives only the numeric headline of each forecast, no free text.
- Not done: seasonality (with at most six months used, a yearly pattern such as school fees or December spending is not seen) and anything that learns across people ([#34](https://github.com/gaiuso33/life-dashboard/issues/34)).

## 24. Phone checks

`e2e/mobile.spec.ts` runs with touch at 320×568 (smallest common phone), 390×844 and 844×390 (on its side): every screen has no sideways scroll, the bottom bar buttons are all on screen, no text box is under 16px (iPhones zoom the page when such a box is focused), and a statement can be imported with taps from start to finish. It also simulates the browser's install offer (the Install button appears, asks the browser to install, then reads "Already installed") and checks that an iPhone is told to use Safari's Add to Home Screen.

**What this cannot prove** (it is Chromium pretending to be a phone): the real keyboard, the phone's file picker, the real install prompt, Safari's own behaviour, and how the calendar file opens on a given phone. These were checked by hand on an Android phone and an iPhone ([#14](https://github.com/gaiuso33/life-dashboard/issues/14)): installing, the keyboard, the calendar file, importing a CSV from the Files app, rotating the phone and working offline. Repeat them after a big change to those areas.

## 25. Currency and weight follow where you are (built)

The first-run setup suggests a **currency** and a **weight unit** (kg or lb) from where the person is, and Settings → "Currency and weight" lets them change either at any time.
- **How the location is found:** from the browser's timezone (the most reliable sign of the country), then a browser language that names a country (`en-GB`). It does not use the location permission and looks nothing up online. If neither says where they are, it starts on dollars and kilograms and says so. Pounds are suggested only where they are the norm (US, Liberia, Myanmar). Code: `src/units.ts` (detection and formatting), `src/localize.ts` (starting prices).
- **Money is relabelled, never converted.** Changing the currency changes the symbol and formatting only; no exchange rates are used anywhere, and logged amounts keep their numbers. Settings says so next to the picker. The starting reward ideas, the savings badges ("$10 saved") and the milestone amounts are priced in round numbers for the chosen currency, from rough order-of-magnitude guides that are not exchange rates. A currency the app has no sense of gets no starting rewards rather than mispriced ones.
- **Weight is stored in kilograms and shown in the chosen unit.** Switching between kg and lb is exact and changes nothing saved; what is typed is converted on the way in (to 0.01 kg). Forecasts, the chart, the coach and the setup limits all follow the unit.
- **Existing people keep naira and kilograms** until they choose otherwise, wherever they are. The sample data stays in naira (its amounts are naira-sized) but weighs in the local unit.
- **The AI advisor** is told the currency and weight unit and receives weights already in that unit, still numbers only.
- **Statement import** now reads any currency sign or code ($ £ € ₹ NGN USD Rs, etc.).
- The choice is one setting that syncs between devices like the others (the latest change wins).
- Not done: body measurements follow the same choice as weight (inches in the US, Liberia and Myanmar, centimetres elsewhere, changeable in Settings and stored in centimetres), and training weights follow the same choice (section 32), but the app is in English only ([#28](https://github.com/gaiuso33/life-dashboard/issues/28)). The built-in word lists for guessing a spending category are still Nigerian-leaning, but they are now only the fallback: see section 29.

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

**Safety and upkeep of the sender (`api/push.ts`).**
- It answers `405` to anything but POST, `503` if any server setting is missing, `401` with no or an invalid/expired session token, and a plain `500` otherwise. Responses are never cached, and error messages never contain a key, secret, address or schedule. `src/__tests__/pushhandler.test.ts` calls the real handler for every one of these cases.
- **Send a test** is limited to 5 per person per hour (`429`, "Try again in N minutes"). The count is kept on the person's own Supabase account (`app_metadata.push_tests`, written with the service role key), so no table change is needed. If recording the count fails, the test still goes out.
- Each run writes one log line to Vercel (`push tick: 3 devices, 1 due, 1 sent, 0 failed, 0 removed`). Counts only: no addresses, keys or reminder text.
- A device the push service keeps refusing (not dead, just failing) is marked in `last_sent._fail` with the time it first failed, and the mark clears when a send gets through. "Check what the server has" then shows *The server could not reach this device (first failed 3 h ago)*. Dead addresses (404 and 410) are still deleted.
- **Where it will send.** Devices are saved by each person's own phone, so the function only sends to `https` addresses on a real public host (never `localhost`, a numeric or private-network address, a custom port, or one with a login in it). An address that fails is not contacted and the device is removed. Every call the function makes (Supabase and the push services) gives up after 8 seconds, so one stuck service cannot hold a whole run until Vercel stops it.
- **Rotating `CRON_SECRET`:** (1) set a new long random value in Vercel and redeploy; (2) in the Supabase SQL editor run `select cron.unschedule('life-dashboard-push');` and then the `cron.schedule` block from `supabase/push.sql` again with the new value. Between steps 1 and 2 the clock gets `401`s and no reminders go out, so do both in one sitting. Nothing in the app or on any phone changes.
- **Rotating the VAPID keys:** only do this if the private key leaks. Generate a new pair (`npx web-push generate-vapid-keys`), set `VITE_VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in Vercel and redeploy. **Every saved device stops working**, because each subscription is tied to the key it was made with. Each device then has to open Settings -> Reminders and turn push off and on again; the old rows are removed automatically when the push service reports them dead. Rotating `SUPABASE_SERVICE_ROLE_KEY` only needs the new value in Vercel and a redeploy.

**Verified by hand ([#13](https://github.com/gaiuso33/life-dashboard/issues/13)).** On Android (Chrome) and iPhone (Home Screen) a test and a real scheduled reminder arrive with the app closed, tapping one opens the app, and the next reminder follows a changed time or time zone. Turning push off, signing out and deleting the account each stop it, two devices on one account are independent, and the Supabase scheduler and Vercel logs show a run every minute. **Not covered by an automated test:** actual delivery (a headless browser cannot create a real push subscription), and phones and browsers other than the ones tried.
- Besides the four reminders there are three nudges worked out from your data (a streak at risk, a reward ready, a bill due; section 33). Days, quiet hours and snooze are in section 31.
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

## 29. The app learns your spending categories (built)

Instead of widening a fixed list of Nigerian-leaning words, the app remembers what you chose (`src/learn.ts`).
- **What is remembered:** the category you pick for a description, under a short key made from the place or name. The key is lower case and drops bank filler ("POS", "transfer to", "purchase") and reference numbers, so "POS PURCHASE SHOPRITE LEKKI 0048213" and "Shoprite Lekki" are the same place. Digits inside names survive ("9mobile", "bet9ja"). The first four words are kept.
- **Where it is used:** the quick-add form on Money, paying a bill from the plan, and statement import (a learned category beats the built-in guess). In the import preview, a category you change is learned when you import; rows you leave alone are not mistaken for choices.
- **When it learns:** adding an expense, changing an entry's category, paying a bill under a category, and importing with a changed category. Rewards are never learned (the app enters them, you do not choose them).
- **Fallback:** the built-in word guesses are used for places nothing has been learned about. Until you teach it anything on purpose, what it knows is read from the categories already on your spending; from the first lesson or deletion on, the saved list is the only source, so something you forgot stays forgotten.
- **See and delete it:** Settings → "Categories the app has learned" lists every place and category, with a button to forget one and one to forget all (your past entries keep their categories). Deleting or renaming a category updates the list.
- **Storage:** on the device, in the same data as everything else (`money.learned`), at most 300 places (the one not used for longest goes first), and it syncs and merges like other settings. **Nothing about it goes to the AI advisor.**

## 30. Progress photos (built)

On the Body screen: add a photo (camera or a file) with a date and a note, compare any two side by side, open one large, delete one or all. Code: `src/photos.ts` (storage and shrinking) and `src/components/Photos.tsx`.
- **Kept in this browser only.** In IndexedDB, in two stores: small records (date, note, a 320 px thumbnail) and the big pictures, so the grid never loads the big ones. They are **not** in the dashboard data (so not in the automatic backup), **not** in the encrypted cloud copy, and **not synced** to other devices. The screen says so. Photos are never sent anywhere: nothing in the photo code can make a request, and the browser's security policy would refuse it anyway.
- **Shrunk on the device.** The longest side is 1280 px (never enlarged) at JPEG quality 0.8, re-drawn in a canvas. Re-drawing also drops the camera's hidden details (where it was taken, the phone model); a test checks both. A picture over 30 MB or 120 million pixels is refused before it is opened, because drawing it can crash a phone's browser.
- **Limits:** at most 200 photos (it says so and adds nothing beyond that), notes up to 80 characters. The app asks the browser not to clear them when space is short (best effort).
- **In a saved copy only if you tick the box.** Sync and backup → "Include my N progress photos". Off by default, and the box only appears when there are photos. If the photos would make a file too big for this app to open again (about 115 MB), it says so and saves nothing; the import limit is 120 MB (it was 20 MB, which a copy with photos could exceed).
- **Bringing them back.** Choosing a copy that has photos in it (on the welcome screen, in Sync and backup, or in damaged-data recovery) adds the photos this device does not have, matched by id. An import only ever adds: it never replaces or removes a photo, and **Replace** leaves existing photos alone. The preview says how many are new.
- **A file is not trusted.** Each photo in an imported file must be a plain base64 JPEG (not SVG, PNG or a web address), within a size limit, with an ordinary id, a real date and a short note; anything else is dropped and the rest of the file still imports. Notes are only ever shown as text.
- **Erase** (Settings → "Erase everything on this device") removes the photos too, and says so.
- **When the browser refuses** (private browsing, blocked site data, a full disk) the person gets a plain message saying nothing was added. A write that fails part-way is rolled back, so a thumbnail is never kept without its picture.
- **Tests:** 28 unit tests (shrink sizing, checking imported photos including hostile ones, limits, ordering, and that the photo code uses nothing that can send data and that only the screens that save or open a copy by hand can import it) and 11 browser tests (shrinking and removal of hidden details, compare, delete, offline, refusals, copies with and without photos moving between devices, tampered files, erase, no request while photos are used, phone layout). One of them, in the cloud spec, signs in on two devices, adds a photo on one and checks that the cloud copy did not grow by a picture, no request was as big as one, and the other device has none. Each safeguard was broken on purpose and a test failed.
- Not done: encrypted cloud storage of photos (they would need a separate store and key handling), editing a photo after it is added, and moving a photo to another date.

## 31. Reminder days, quiet hours and snooze (built)

Settings -> Reminders. Code: `src/reminders.ts` (the choices, `reminderDays`, `inQuiet`), `src/push.ts` (what the server is given), `api/push.ts` (sending and snoozing), `src/pushPreview.ts` (the on-screen mirror) and `public/sw.js` (the button).
- **Days.** Each switched-on reminder shows seven day buttons. Until you choose, it follows its usual days (every day; training follows your programme; the weekly review is Sunday), and the row says so. Choosing exactly the usual days again goes back to following them, and "Back to the usual days" does it in one tap. At least one day must stay on (the last one is disabled); switch the reminder off instead. Stored per reminder in the existing reminders slot, so an older save loads unchanged.
- **Quiet hours.** One window for all reminders on this device (default 22:00 to 07:00, off until switched on), which may run past midnight. The start is quiet and the end is not. Nothing is sent while the device's clock is inside it, in the device's own time zone. A reminder whose own time falls in the window is skipped, not moved, and its row says *Next: never (inside quiet hours)* so it is not a silent surprise. A reminder that is a few minutes late when quiet hours begin is also held back.
- **Snooze.** Each push reminder has a **Snooze 1 hour** button. The phone cannot keep the timer itself (a service worker is shut down within seconds), so the button asks the server. The request has no sign-in; instead every reminder carries a signature the server made (HMAC of the push address and reminder id, keyed with `CRON_SECRET`), checked before anything is read or written. A wrong, missing, borrowed (another reminder or device) or forged signature gets `401` and touches nothing. The snooze is kept in the device's existing `last_sent` map as `_snooze:<id>`, so **no table change is needed**. It comes back once, at the time asked, whatever the reminder's days; it does not use up that day's usual send; if quiet hours are in the way it waits until they end; it is dropped if it cannot be delivered within 12 hours; and switching the reminder off cancels it. The test notification has no button. If the snooze cannot be saved the phone shows "Couldn't snooze".
- **Calendar file.** Uses the same days, so the repeat rule matches. A reminder whose time is in quiet hours is left out, as push would skip it. A calendar alert cannot carry a snooze button, but calendar apps have their own, and the screen says so.
- **The server view** ("Check what the server has") shows the days, the quiet window and, when there is one, *snoozed until 10:30*. It reports the device as behind when the server's copy lacks the new days or window.
- **Kept in step with the server.** The on-screen "Next:" is a mirror of the sender; a test steps minute by minute through days and quiet-hour edge cases (at the start, at the end, wrapped past midnight, other time zones, a late reminder) and checks both agree, and another checks `inQuiet` gives the same answer on the app and the server for every minute of the day.
- **Rolling out.** Nothing to run in Supabase. After deploying, each device sends its new schedule the next time it opens the app (and the update banner brings the new service worker). Reminders already delivered before then have no button.
- **Tests:** 55 unit tests (days, window edges, server skipping, snooze timing, quiet-hours waiting, expiry, signature refusals, the service worker's button and its failures, the calendar file, saving and loading junk) and 2 browser tests. Each safeguard was broken on purpose and a test failed: quiet-hours skip, signature check, snooze expiry, snooze waiting out quiet hours, calendar quiet-hours leave-out, the button's handler, a snooze using up the day's send, and the preview's quiet-hours rule.
- **Not done:** snooze lengths other than an hour, separate quiet windows per reminder, a snooze for the calendar file, and real delivery of the button on phones (a headless browser cannot receive a real push; it needs trying by hand on Android and iPhone, where some systems show fewer than the maximum number of buttons).

## 32. Training weights follow the weight unit (built)

Train screen, one optional **Weight** box per exercise. Code: `src/units.ts` (`parseLoad`, `loadText`, `loadStep`, `nextLoadKg`), `src/components/Train.tsx`, `src/derive.ts` (`sessionVolume`, `weeklyVolume`) and `src/forecast.ts` (`strengthForecast`).
- **Stored in kilograms, typed and shown in the chosen unit.** Type 135 in pounds and 61.23 kg is saved (to 0.01 kg); switch to kilograms in Settings and it shows 61.2. Nothing saved changes when the unit does. What is being typed is held as typed ("22." on the way to "22.5" is never rewritten under the cursor), a comma works as the decimal mark, and empty, zero, negative, non-numeric and over 1000 kg values are flagged and not saved. Clearing the box removes the weight and leaves the reps.
- **Rep-only logging is unchanged.** The weight is optional everywhere. The free-text **Load note** ("blue dumbbells") stays for people who cannot weigh their lifts. Timed holds have no weight box. Older saves load as they were.
- **The "add load" hint** says how far to go: when every set hit the top of the range last time, it suggests last time's weight plus one step (2.5 kg, or 5 lb), for example "try 140 lb (last time 135 lb)", and with no weight logged it says "in steps of 2.5 kg". Last time's weight is also the box's placeholder, and **Copy last time** brings it across without overwriting one already typed.
- **The training volume forecast uses weights when there are enough.** Weight lifted is reps times weight, set by set, for exercises that have a weight (timed holds and unweighted lifts are left out). It is used once the last three finished weeks in a row each have a weight on at least half of their reps (`MIN_LOAD_COVERAGE`), so starting to log weights part-way never looks like a jump in strength; otherwise it stays on weekly reps and says how to get weight lifted. The headline is in the unit shown ("about 12 kg a week") and the detail says what share of the reps were counted.
- **Sync and backups.** Weights are sanitised on load (junk and impossible values dropped) and merge between devices keeping both sides' weights, the newer copy winning a clash. A weight cleared on one device does not clear the other's copy, the same as the load note.
- **Sample data and demo** carry weights that rise slowly, so the forecast shows weight lifted.
- **Tests:** 22 unit tests (typing in either unit, refusals, the step, switching unit, saving and merging, the Train actions, weight lifted, and the forecast's rules including the coverage run) and 3 browser tests (pounds, kilograms with rep-only logging, and the forecast), with accessibility checks. Each safeguard was broken on purpose and a test failed: the step size, the accepted range, the timed-hold exclusion, the merge, the coverage threshold and the range check when loading.
- **Not done:** the AI advisor is not sent weights lifted (it still gets numbers about reps and which lifts are ready for more load), and weights are per exercise per session, not per set.

## 33. Nudges worked out from your data (built)

Settings -> Reminders -> **Nudges from your data**. Three push notifications that depend on what you have logged, each with its own switch (all on until switched off). Code: `src/pushEvents.ts` (what applies), `src/push.ts` (`buildPushSchedule` adds them), `api/push.ts` (sends them) and `src/pushPreview.ts` (the on-screen mirror).
- **The rule that kept the server blind.** The server is never asked to read anything. This device works out, from its own data, which nudges apply in the next few days and gives the server **one-off reminders**: a local date, a time and fixed wording. No name, amount, note or count is ever in them, and a test builds data full of recognisable private strings and checks none of them appear in what is sent. The server sends them on the day like any other reminder (once, in the device's own time zone, with the same 15-minute late window, quiet hours and **Snooze 1 hour**).
- **Streak at risk** (20:30): only when you have a streak of at least 3 strong days (3 of 4 plates) ending yesterday and today is not strong yet. Logging enough to make today strong removes it.
- **Reward ready to claim** (18:00): while a reward earned this or last period, or a landmark, is still unclaimed. If today's time has passed it goes out tomorrow. Claiming removes it. While you keep opening the app without claiming it comes again the next day, and it stops once you claim it; if you stop opening the app it comes once.
- **Bill due** (08:00): on the day an unticked **bill** falls due, scheduled for today and the next two days. One nudge per day however many bills fall on it. Ticking the bill removes it. Income, tasks and events are not included.
- **Cancelling.** The device sends a fresh list whenever its data syncs and whenever Settings changes, and the server ignores a nudge once its date has passed. The old list is replaced, so a nudge that no longer applies disappears.
- **The server view** ("Check what the server has") lists them as *Streak at risk*, *Reward ready* and *Bill due* with the date, and reports the device as behind when the server's copy differs from what this device would send now.
- **No table change.** They are extra entries (with a `date`) in the device's existing schedule, which holds at most 12; the four reminders plus up to five nudges stay well within it.
- **Tests:** 31 unit tests (each rule's edges, the switches, the server's date rule, the preview agreeing with the sender minute by minute, nothing private on the wire, the limits) and 2 browser tests (the switches, remembered, phone layout, accessibility). Each safeguard was broken on purpose and a test failed: the date rule, the weekday exclusion, the streak length and today check, ticked bills, bill kind, the evening roll-over, the switches, claimed rewards, quiet hours on nudges and the preview.
- **Not done / limits:** the list is refreshed when this device syncs or Settings changes, so with several devices a nudge on a device that has not synced yet can still arrive after you logged on another (a streak warning after logging on your phone, say). The server necessarily learns that *something* is due on a date (for example that you have a bill on the 15th), never what. The times are fixed. Nudges are not in the calendar file. A real phone has not been tried.
