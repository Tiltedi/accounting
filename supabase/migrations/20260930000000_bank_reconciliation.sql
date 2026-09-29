-- Documents: accounting-tool status and reading cost
alter table public.documents
  add column booked_at timestamptz,
  add column ai_cost_usd numeric(10, 5);

-- Bank statement lines imported from CSV (no bank connection).
create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  import_id uuid not null,
  account text,
  booked_on date not null,
  amount numeric(14, 2) not null, -- negative = money out
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  counterparty text,
  description text,
  fingerprint text not null unique,
  document_id uuid references public.documents (id) on delete set null,
  status text not null default 'unmatched' check (status in ('unmatched', 'matched', 'no_receipt')),
  matched_by text check (matched_by in ('auto', 'manual'))
);

create index bank_transactions_booked_on_idx on public.bank_transactions (booked_on desc);
create index bank_transactions_document_id_idx on public.bank_transactions (document_id);

alter table public.bank_transactions enable row level security;
revoke all on public.bank_transactions from anon;
grant select, insert, update, delete on public.bank_transactions to authenticated;

create policy "Members can read transactions" on public.bank_transactions
  for select to authenticated using ((select private.is_member()));
create policy "Members can add transactions" on public.bank_transactions
  for insert to authenticated with check ((select private.is_member()));
create policy "Members can edit transactions" on public.bank_transactions
  for update to authenticated
  using ((select private.is_member())) with check ((select private.is_member()));
create policy "Members can delete transactions" on public.bank_transactions
  for delete to authenticated using ((select private.is_member()));
