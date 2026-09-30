-- Card statement lines live next to bank lines; `source` tells them apart.
alter table public.bank_transactions
  add column source text not null default 'bank' check (source in ('bank', 'card')),
  add column statement_id uuid references public.documents (id) on delete cascade,
  add column note text;

create index bank_transactions_statement_id_idx on public.bank_transactions (statement_id);

-- Lines that never need a receipt (bank fees, salary, rent, e-invoiced suppliers).
create table public.bank_rules (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  field text not null check (field in ('counterparty', 'description')),
  pattern text not null check (length(btrim(pattern)) >= 2),
  exact boolean not null default false,
  label text
);

alter table public.bank_rules enable row level security;
revoke all on public.bank_rules from anon;
grant select, insert, update, delete on public.bank_rules to authenticated;

create policy "Members can read rules" on public.bank_rules
  for select to authenticated using ((select private.is_member()));
create policy "Members can add rules" on public.bank_rules
  for insert to authenticated with check ((select private.is_member()));
create policy "Members can edit rules" on public.bank_rules
  for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
create policy "Members can delete rules" on public.bank_rules
  for delete to authenticated using ((select private.is_member()));

insert into public.bank_rules (field, pattern, exact, label) values
  ('counterparty', 'ING', true, 'Bank fees'),
  ('counterparty', 'SD Worx', false, 'Peppol'),
  ('description', 'Category Purpose: Salary payment', false, 'Salary'),
  ('counterparty', 'Radius Business Solutions', false, 'Peppol'),
  ('counterparty', 'Marijke Van Laeken', false, 'Rent'),
  ('description', 'Reimbursement Car loan', false, 'Car loan');
