-- Noche 7. SOLO base local aislada (docs/tesis/entorno-aislado.md); nunca en el original ni en testing.

-- Lectura del recibo de un lote por su identidad. La usa la carga desde la aplicacion para ofrecer, de forma
-- EXPLICITA, reintentar un lote cuyo intento anterior quedo cerrado sin publicar (equivale a --revalidate de la
-- terminal): devuelve la revision vigente de ese intento. No escribe nada, no crea eventos y no toca la cartera.

-- Sin filas. No toca tablas, politicas ni las funciones de publicacion. Reversion: db reset --version 20261110100000 (solo local).

do $$ begin
  if to_regprocedure('equitas_import_private.receipt(bigint)') is null or to_regprocedure('equitas_import_private.authorize(bigint, bigint)') is null then
    raise exception 'Requiere 20261105201716_import_batch_staging y 20261110100000_admin_user_access';
  end if;
end $$;

grant equitas_import_definer to postgres;

grant create on schema public to equitas_import_definer;

-- Mismo permiso que staging y publicacion (equitas_import_private.authorize). La identidad es la huella del lote
-- (municipio, archivos, mapeo, contrato y parametros), unica por municipio (import_publication_idempotency_key).
create function public.read_import_receipt(p_actor_user bigint, p_tenant bigint, p_idempotency_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_batch bigint;
begin
  perform equitas_import_private.authorize(p_actor_user, p_tenant);
  select j.batch_id into v_batch from public.import_publication j where j.tenant = p_tenant and j.idempotency_key = p_idempotency_key;
  if not found then raise exception 'BATCH_NOT_FOUND'; end if;
  return equitas_import_private.receipt(v_batch);
end $$;

alter function public.read_import_receipt(bigint, bigint, text) owner to equitas_import_definer;

revoke all on function public.read_import_receipt(bigint, bigint, text) from public, anon, authenticated, service_role, equitas_review_server, equitas_import_server, postgres;

grant execute on function public.read_import_receipt(bigint, bigint, text) to equitas_import_server;

revoke create on schema public from equitas_import_definer;

revoke equitas_import_definer from postgres;

notify pgrst, 'reload schema';
