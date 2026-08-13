-- =====================================================================
-- 0011_realtime_inbox.sql — habilita Supabase Realtime nas tabelas do
-- Inbox (e do funil), para a interface atualizar ao vivo. Idempotente.
-- Rode no SQL Editor do Supabase.
-- =====================================================================
do $$
declare
  t text;
  tbls text[] := array['conversations', 'messages', 'leads', 'notifications'];
begin
  foreach t in array tbls loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
