-- Supabase SQL für das Kalorien-Tracking

-- Settings table for global config like API keys
create table if not exists settings (
  id text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table settings enable row level security;
drop policy if exists "Allow anon read/write on settings" on settings;
create policy "Allow anon read/write on settings" on settings for all using (true) with check (true);

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

-- Body weight entries, keyed by day to allow one value per date.
create table if not exists weight (
  date text primary key,
  value numeric not null,
  period boolean not null default false,
  created_at timestamptz not null default now()
);

alter table entries add column if not exists fiber numeric not null default 0;
alter table custom_foods add column if not exists fiber numeric not null default 0;

alter table entries enable row level security;
alter table custom_foods enable row level security;
alter table weight enable row level security;

drop policy if exists "Allow anon read/write on entries" on entries;
drop policy if exists "Allow anon read/write on custom_foods" on custom_foods;
drop policy if exists "Allow anon read/write on weight" on weight;

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

create policy "Allow anon read/write on weight"
  on weight
  for all
  using (true)
  with check (true);
