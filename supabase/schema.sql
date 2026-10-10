-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- One encrypted row per account. The server never sees readable data: `blob` is AES-GCM ciphertext made in the browser.

create table if not exists public.vaults (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  salt       text        not null,
  blob       text        not null check (length(blob) < 20000000),
  version    integer     not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.vaults enable row level security;

-- Each person can only see and change their own row.
create policy "own vault: read"   on public.vaults for select using (user_id = auth.uid());
create policy "own vault: insert" on public.vaults for insert with check (user_id = auth.uid());
create policy "own vault: update" on public.vaults for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own vault: delete" on public.vaults for delete using (user_id = auth.uid());
