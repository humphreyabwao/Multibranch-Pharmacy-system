create table if not exists public.fallback_records (
  id uuid primary key default gen_random_uuid(),
  business_id text not null,
  collection_name text not null,
  document_id text,
  source_path text,
  operation text not null check (operation in ('add', 'set', 'update', 'delete')),
  merge_write boolean not null default false,
  payload jsonb,
  firebase_error jsonb,
  sync_status text not null default 'pending_firebase',
  sync_attempts integer not null default 0,
  last_sync_error text,
  actor_uid text,
  actor_email text,
  actor_role text,
  client_created_at timestamptz,
  received_at timestamptz not null default now(),
  synced_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists fallback_records_pending_idx
  on public.fallback_records (sync_status, received_at);

create index if not exists fallback_records_business_collection_idx
  on public.fallback_records (business_id, collection_name, received_at desc);

alter table public.fallback_records enable row level security;

drop policy if exists "deny direct fallback access" on public.fallback_records;
create policy "deny direct fallback access"
  on public.fallback_records
  for all
  using (false)
  with check (false);
