-- Key/value settings for self-hosted LLM endpoints (unowned)
create table if not exists app_settings (
  key text primary key,
  value text not null
);
