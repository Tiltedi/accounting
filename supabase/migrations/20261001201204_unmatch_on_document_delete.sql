-- A bank line whose document is deleted (document_id set null by the foreign
-- key) goes back to unmatched, instead of staying "matched" to nothing.
create or replace function private.unmatch_without_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.document_id is null and old.document_id is not null and new.status = 'matched' then
    new.status := 'unmatched';
    new.matched_by := null;
  end if;
  return new;
end;
$$;

create trigger bank_transactions_unmatch_without_document
  before update on public.bank_transactions
  for each row execute function private.unmatch_without_document();
