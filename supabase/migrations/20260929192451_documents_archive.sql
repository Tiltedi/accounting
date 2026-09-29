-- ---------------------------------------------------------------------------
-- Access: only people listed in private.members can sign up or see anything.
-- To add someone: insert their email here, then create their login in
-- Supabase → Authentication → Users.
-- ---------------------------------------------------------------------------
create schema if not exists private;
grant usage on schema private to authenticated;

create table private.members (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table private.members enable row level security;

create function private.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from private.members m
    where m.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke execute on function private.is_member() from public, anon;
grant execute on function private.is_member() to authenticated;

-- Block sign-ups for anyone who is not a member.
create function private.guard_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from private.members m where m.email = lower(coalesce(new.email, ''))
  ) then
    raise exception 'Sign-ups are closed';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_signup() from public, anon, authenticated;

create trigger guard_signup
  before insert on auth.users
  for each row execute function private.guard_signup();

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm with schema extensions;

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'failed')),

  -- File
  file_path text not null unique,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text unique,

  -- Details (read from the document, editable)
  doc_date date not null default current_date,
  vendor text,
  description text,
  category text not null default 'Other',
  doc_type text,
  invoice_number text,
  total numeric(14, 2),
  tax numeric(14, 2),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  notes text,
  extraction jsonb,

  search text generated always as (
    lower(
      coalesce(vendor, '') || ' ' || coalesce(description, '') || ' ' ||
      coalesce(invoice_number, '') || ' ' || coalesce(notes, '') || ' ' ||
      coalesce(category, '') || ' ' || file_name
    )
  ) stored
);

create index documents_doc_date_idx on public.documents (doc_date desc, created_at desc);
create index documents_created_by_idx on public.documents (created_by);
create index documents_search_idx on public.documents using gin (search extensions.gin_trgm_ops);

alter table public.documents enable row level security;

revoke all on public.documents from anon;
grant select, insert, update, delete on public.documents to authenticated;

create policy "Members can read documents" on public.documents
  for select to authenticated using ((select private.is_member()));
create policy "Members can add documents" on public.documents
  for insert to authenticated with check ((select private.is_member()));
create policy "Members can edit documents" on public.documents
  for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
create policy "Members can delete documents" on public.documents
  for delete to authenticated using ((select private.is_member()));

-- ---------------------------------------------------------------------------
-- File storage (private bucket)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents', 'documents', false, 26214400,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

create policy "Members can read files" on storage.objects
  for select to authenticated
  using (bucket_id = 'documents' and (select private.is_member()));
create policy "Members can upload files" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documents' and (select private.is_member()));
create policy "Members can delete files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents' and (select private.is_member()));
