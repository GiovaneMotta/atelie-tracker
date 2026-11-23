-- =====================================================================
-- 0031_ordem_vitrine.sql
--
-- Ordem da vitrine editável no painel (tela "Ordem da vitrine").
--
-- O site já ordena o catálogo por products.sort_order (menor primeiro;
-- vazio vai para o fim, pelo SKU) — ver public_catalog() na 0024. Faltava
-- só uma forma de a Lili DEFINIR essa ordem: o painel manda a lista
-- inteira de peças na ordem desejada e esta função grava a posição de
-- cada uma (1, 2, 3...) numa única operação.
--
-- Por que uma função e não um UPDATE por peça: o painel roda no
-- Cloudflare (plano grátis), que limita cada chamada da API a 50
-- consultas. Salvar a vitrine inteira passa disso. Aqui é UMA chamada,
-- e atômica: ou a ordem toda entra, ou nada muda (a vitrine nunca fica
-- meio reordenada).
--
-- Só o backend do painel (service role) pode chamar. Site e visitantes
-- não têm acesso.
--
-- Aditiva e idempotente. Rollback:
--   drop function if exists public.set_catalog_order(uuid[]);
-- (as posições já gravadas em sort_order continuam valendo; para voltar
--  à ordem antiga por SKU: update public.products set sort_order = null;)
-- =====================================================================
create or replace function public.set_catalog_order(p_ids uuid[])
returns integer
language plpgsql
set search_path to 'public'
as $function$
declare
  v_total    integer := coalesce(array_length(p_ids, 1), 0);
  v_alterados integer;
begin
  if v_total = 0 then
    return 0;
  end if;

  /* peça repetida = lista corrompida: recusa tudo em vez de gravar meia ordem */
  if (select count(distinct x) from unnest(p_ids) as x) <> v_total then
    raise exception 'A lista de ordem tem peça repetida.';
  end if;

  update public.products p
     set sort_order = o.ord::integer
    from unnest(p_ids) with ordinality as o(id, ord)
   where p.id = o.id
     and p.sort_order is distinct from o.ord::integer;   -- só toca o que mudou

  get diagnostics v_alterados = row_count;
  return v_alterados;
end;
$function$;

revoke all on function public.set_catalog_order(uuid[]) from public, anon, authenticated;
grant execute on function public.set_catalog_order(uuid[]) to service_role;
