-- The dedicated project ships a managed public DDL event-trigger helper. It is
-- invoked by PostgreSQL's event trigger machinery and is never an application
-- RPC, so browser roles must not be able to call it through PostgREST.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke all on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$$;
