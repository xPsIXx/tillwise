-- Canonical products + aliases built up from scans and collation
create table if not exists products (
  id serial primary key,
  name text not null,
  brand text,
  category text,
  unit text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists product_aliases (
  id serial primary key,
  product_id integer not null references products(id) on delete cascade,
  alias_key text not null,
  barcode text,
  source text not null default 'auto'
);
create unique index if not exists product_aliases_key_uidx on product_aliases (alias_key);
create index if not exists product_aliases_barcode_idx
  on product_aliases (barcode) where barcode is not null and barcode <> '';
create index if not exists product_aliases_product_idx on product_aliases (product_id);

alter table trip_items add column if not exists product_id integer references products(id) on delete set null;
create index if not exists trip_items_product_idx on trip_items (product_id);

alter table price_observations add column if not exists product_id integer references products(id) on delete set null;
create index if not exists price_obs_product_idx on price_observations (product_id, observed_at desc);

alter table product_memory add column if not exists product_id integer references products(id) on delete set null;
