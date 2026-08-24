-- Tillwise grocery trips, scanned items, and receipt portions
create table if not exists trips (
  id serial primary key,
  user_id text not null,
  store_name text,
  store_location text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  status text not null default 'shopping',
  receipt_subtotal numeric,
  receipt_tax numeric,
  receipt_total numeric,
  currency text not null default 'AED',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists trips_user_id_idx on trips (user_id);
create index if not exists trips_user_status_idx on trips (user_id, status);

create table if not exists trip_items (
  id serial primary key,
  user_id text not null,
  trip_id integer not null references trips(id) on delete cascade,
  source text not null default 'label',
  name text not null,
  brand text,
  description text,
  barcode text,
  category text,
  quantity numeric,
  quantity_unit text,
  weight_value numeric,
  weight_unit text,
  unit_price numeric,
  line_price numeric,
  currency text,
  raw_text text,
  thumbnail_data text,
  match_status text not null default 'unmatched',
  match_confidence numeric,
  created_at timestamptz not null default now()
);
create index if not exists trip_items_trip_idx on trip_items (trip_id);
create index if not exists trip_items_user_idx on trip_items (user_id);

create table if not exists receipt_captures (
  id serial primary key,
  user_id text not null,
  trip_id integer not null references trips(id) on delete cascade,
  sequence integer not null default 0,
  extracted_json text,
  thumbnail_data text,
  created_at timestamptz not null default now()
);
create index if not exists receipt_captures_trip_idx on receipt_captures (trip_id);
