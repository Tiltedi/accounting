-- Where to download a supplier's invoices (billing portal), matched to bank
-- and card lines by name.
create table public.vendor_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  pattern text not null check (length(btrim(pattern)) >= 2),
  url text not null check (url ~* '^https?://')
);

alter table public.vendor_links enable row level security;
revoke all on public.vendor_links from anon;
grant select, insert, update, delete on public.vendor_links to authenticated;

create policy "Members can read vendor links" on public.vendor_links
  for select to authenticated using ((select private.is_member()));
create policy "Members can add vendor links" on public.vendor_links
  for insert to authenticated with check ((select private.is_member()));
create policy "Members can edit vendor links" on public.vendor_links
  for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
create policy "Members can delete vendor links" on public.vendor_links
  for delete to authenticated using ((select private.is_member()));
