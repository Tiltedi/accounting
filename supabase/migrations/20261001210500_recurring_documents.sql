-- Documents that cover several payments (insurance policy, contract, loan):
-- they stay available for matching after their first payment.
alter table public.documents add column recurring boolean not null default false;
