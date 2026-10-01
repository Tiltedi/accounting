-- Email inbox: the mailbox the app reads (Gmail, read-only) and the emails
-- waiting for the user to import or skip their attachments.
create table public.mail_connections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  email text not null unique,
  -- Google refresh token, encrypted by the server (AES-GCM); never stored in plain text.
  refresh_token text not null,
  last_checked_at timestamptz
);

create table public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  mailbox text not null,
  gmail_id text not null unique,
  received_at timestamptz not null,
  sender text,
  subject text,
  snippet text,
  -- [{ part, filename, mime, size, suggested }]
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'imported', 'skipped')),
  decided_at timestamptz,
  document_ids uuid[] not null default '{}'
);

create index inbox_items_status_idx on public.inbox_items (status, received_at desc);

alter table public.mail_connections enable row level security;
alter table public.inbox_items enable row level security;
revoke all on public.mail_connections, public.inbox_items from anon;
grant select, insert, update, delete on public.mail_connections, public.inbox_items to authenticated;

create policy "Members can read mail connections" on public.mail_connections
  for select to authenticated using ((select private.is_member()));
create policy "Members can add mail connections" on public.mail_connections
  for insert to authenticated with check ((select private.is_member()));
create policy "Members can edit mail connections" on public.mail_connections
  for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
create policy "Members can remove mail connections" on public.mail_connections
  for delete to authenticated using ((select private.is_member()));

create policy "Members can read inbox items" on public.inbox_items
  for select to authenticated using ((select private.is_member()));
create policy "Members can add inbox items" on public.inbox_items
  for insert to authenticated with check ((select private.is_member()));
create policy "Members can edit inbox items" on public.inbox_items
  for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
create policy "Members can delete inbox items" on public.inbox_items
  for delete to authenticated using ((select private.is_member()));
