-- The bank's own id for a line (e.g. ING's entry number), when the export has one.
-- Fingerprints are built from it, so they no longer depend on how descriptions are read.
alter table public.bank_transactions add column bank_ref text;
