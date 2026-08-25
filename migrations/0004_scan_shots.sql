-- Full capture history, independent of cart rows (collate may replace items).
create table if not exists scan_shots (
  id serial primary key,
  user_id text not null,
  trip_id integer not null references trips(id) on delete cascade,
  kind text not null default 'label',
  image_data text not null,
  thumbnail_data text,
  barcode text,
  item_id integer references trip_items(id) on delete set null,
  capture_id integer references receipt_captures(id) on delete set null,
  last_read_json text,
  created_at timestamptz not null default now()
);
create index if not exists scan_shots_trip_idx on scan_shots (trip_id, created_at desc);
create index if not exists scan_shots_user_idx on scan_shots (user_id, created_at desc);
