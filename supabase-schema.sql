-- Supabase SQL für das Kalorien-Tracking

create table if not exists entries (
  id uuid primary key,
  date text not null,
  meal text not null,
  name text not null,
  kcal numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  weight_grams integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists custom_foods (
  id uuid primary key,
  name text not null,
  weight_grams integer not null default 100,
  kcal numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0
);

alter table entries add column if not exists fiber numeric not null default 0;
alter table custom_foods add column if not exists fiber numeric not null default 0;

alter table entries enable row level security;
alter table custom_foods enable row level security;

drop policy if exists "Allow anon read/write on entries" on entries;
drop policy if exists "Allow anon read/write on custom_foods" on custom_foods;

create policy "Allow anon read/write on entries"
  on entries
  for all
  using (true)
  with check (true);

create policy "Allow anon read/write on custom_foods"
  on custom_foods
  for all
  using (true)
  with check (true);
