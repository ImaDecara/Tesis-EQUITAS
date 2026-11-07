-- ALIGN-032 / F09. La historia de 018 rechaza UPDATE, DELETE y TRUNCATE con
-- APPEND_ONLY. Una FK entrante intercepta TRUNCATE antes de ese trigger.
-- Verificar las referencias inmediatamente sin cambiar ese contrato histórico:
-- los eventos referenciados no pueden desaparecer ni cambiar de tenant.
grant equitas_import_definer to postgres;

alter table public.import_publication
  drop constraint import_publication_batch_id_fkey,
  drop constraint import_publication_head_id_fkey;

create function equitas_import_private.verify_history_links() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists(select 1 from public.import_batch where id=new.batch_id and tenant=new.tenant)
    or not exists(select 1 from public.import_batch where id=new.head_id and tenant=new.tenant) then
    raise exception 'IMPORT_HISTORY_REFERENCE_INVALID' using errcode='23503';
  end if;
  return null;
end $$;
alter function equitas_import_private.verify_history_links() owner to equitas_import_definer;
create constraint trigger import_publication_history_links
  after insert or update on public.import_publication not deferrable
  for each row execute function equitas_import_private.verify_history_links();
revoke all on function equitas_import_private.verify_history_links()
  from public, anon, authenticated, service_role, equitas_review_server, equitas_import_server, postgres;
revoke equitas_import_definer from postgres;
