-- Optional private portfolio storage for later.
-- Run this in Supabase SQL editor if you want authenticated users to save positions.

create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  type text not null check (type in ('call', 'put')),
  strike numeric not null,
  expiry date not null,
  premium numeric not null,
  qty integer not null default 1,
  created_at timestamptz not null default now()
);

alter table public.positions enable row level security;

create policy "Users can read their own positions"
on public.positions for select
to authenticated
using (auth.uid() = user_id);

create policy "Users can insert their own positions"
on public.positions for insert
to authenticated
with check (auth.uid() = user_id);

create policy "Users can delete their own positions"
on public.positions for delete
to authenticated
using (auth.uid() = user_id);
