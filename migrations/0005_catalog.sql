-- Remember barcodes and prices across trips
create table if not exists product_memory (
  id serial primary key,
  barcode text,
  name_key text not null,
  name text not null,
  brand text,
  category text,
  quantity_unit text,
  weight_unit text,
  last_unit_price numeric,
  last_line_price numeric,
  last_weight_value numeric,
  currency text,
  seen_count integer not null default 1,
  updated_at timestamptz not null default now()
);
create unique index if not exists product_memory_barcode_uidx
  on product_memory (barcode) where barcode is not null and barcode <> '';
create index if not exists product_memory_name_idx on product_memory (name_key);

create table if not exists price_observations (
  id serial primary key,
  trip_id integer references trips(id) on delete set null,
  barcode text,
  name_key text not null,
  name text not null,
  store_name text,
  unit_price numeric,
  line_price numeric,
  weight_value numeric,
  weight_unit text,
  currency text not null default 'AED',
  observed_at timestamptz not null default now()
);
create index if not exists price_obs_barcode_idx on price_observations (barcode, observed_at desc);
create index if not exists price_obs_name_idx on price_observations (name_key, observed_at desc);
