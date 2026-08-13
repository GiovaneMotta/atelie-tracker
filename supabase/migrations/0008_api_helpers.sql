-- =====================================================================
-- 0008_api_helpers.sql — Funções auxiliares consumidas pela API
-- =====================================================================

-- Lista as permissões de um membro (usada pela API para montar o contexto
-- de autorização a cada requisição). SECURITY DEFINER: lê as tabelas de
-- papéis independentemente da RLS do chamador.
create or replace function public.staff_permissions(p_staff uuid)
returns table(permission_key text)
language sql stable security definer set search_path = public as $$
  select rp.permission_key
  from public.staff_roles sr
  join public.role_permissions rp on rp.role_id = sr.role_id
  where sr.staff_id = p_staff;
$$;
