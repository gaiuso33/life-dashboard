-- Push notifications. Run in the Supabase SQL editor (after schema.sql).
--
-- This whole file is safe to run again. If you set push up earlier, run it once more to add the newer parts (marked "added
-- later" below): the note of when a device stopped being reachable, and the record that limits "Send a test". Until you do,
-- everything keeps working; Settings just cannot show that note, and tests are not limited.
--
-- The server needs to know WHEN to send and WHAT the notification says, and nothing else about you. A row holds the
-- browser's push address, the time zone, and the reminder times and wording (generic text such as "Time to check in").
-- Your logged data stays in the encrypted vault and is never readable here.

create table if not exists public.push_subscriptions (
  endpoint   text primary key check (length(endpoint) between 20 and 2000),
  user_id    uuid not null references auth.users (id) on delete cascade,
  p256dh     text not null check (length(p256dh) < 500),
  auth       text not null check (length(auth) < 200),
  tz         text not null check (length(tz) < 100),
  schedule   jsonb not null default '[]'::jsonb
             check (jsonb_typeof(schedule) = 'array' and octet_length(schedule::text) < 6000),
  -- Which reminder was last sent on which local date, so each one goes out once a day. Written by the sender only.
  last_sent  jsonb not null default '{}'::jsonb check (octet_length(last_sent::text) < 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Added later: when sending to this device started failing and with what error code (cleared on the next success).
-- Written by the sender; Settings shows it once it has lasted a day.
alter table public.push_subscriptions add column if not exists failing_since timestamptz;
alter table public.push_subscriptions add column if not exists last_error text check (length(last_error) < 40);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- Each person can only see and change their own devices.
drop policy if exists "own push: read" on public.push_subscriptions;
create policy "own push: read"   on public.push_subscriptions for select using (user_id = auth.uid());
drop policy if exists "own push: insert" on public.push_subscriptions;
create policy "own push: insert" on public.push_subscriptions for insert with check (user_id = auth.uid());
drop policy if exists "own push: update" on public.push_subscriptions;
create policy "own push: update" on public.push_subscriptions for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own push: delete" on public.push_subscriptions;
create policy "own push: delete" on public.push_subscriptions for delete using (user_id = auth.uid());

-- Added later: how often each person has asked for a test, so "Send a test" can be limited to a few an hour.
-- Only the server reads or writes this. Row-level security is on and there are deliberately NO policies, so a signed-in
-- person cannot see or change it from the app.
create table if not exists public.push_test_log (
  user_id uuid not null references auth.users (id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists push_test_log_user_idx on public.push_test_log (user_id, at desc);
alter table public.push_test_log enable row level security;

-- ---------------------------------------------------------------------------------------------------------------------
-- The clock. Something has to wake the sender every minute. Supabase can do it for free with two built-in extensions.
-- (Dashboard -> Database -> Extensions: switch on "pg_cron" and "pg_net", then run the block below.)
--
-- Replace the two placeholders:
--   YOUR-APP-ADDRESS  the address of the deployed app, e.g. life-dashboard-neon-ten.vercel.app
--   YOUR-CRON-SECRET  the same long random string you set as CRON_SECRET in Vercel
--
-- select cron.schedule(
--   'life-dashboard-push',
--   '* * * * *',
--   $$ select net.http_post(
--        url     := 'https://YOUR-APP-ADDRESS/api/push',
--        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer YOUR-CRON-SECRET'),
--        body    := '{}'::jsonb,
--        timeout_milliseconds := 20000
--      ) $$
-- );
--
-- To stop it later:  select cron.unschedule('life-dashboard-push');
