-- =====================================================================
-- 0024_catalog_parcelas.sql
--
-- Terceiro campo do cadastro que nao chegava ao site: installments_max.
-- O painel tem "Parcelas (max.)" por peca, mas a public_catalog nao
-- devolvia a coluna, entao o site parcelava tudo no mesmo numero, vindo
-- da configuracao geral. Uma peca de R$ 1.200 e uma de R$ 290 eram
-- parceladas igual.
--
-- Agora vai junto. O site usa o numero da peca quando ele existe e cai
-- na configuracao geral quando nao existe — assim nada muda para quem
-- nao preencher o campo.
--
-- Igual a 0023 no resto. Rollback: reaplicar a 0023.
-- =====================================================================
create or replace function public.public_catalog()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(to_jsonb(x) order by x.sort_order nulls last, x.sku), '[]'::jsonb)
  from (
    select p.sku,
           p.name,
           p.description,
           p.price_cash,
           p.price_card,
           p.installments_max,    -- parcelas desta peca
           p.original_price,
           p.status,
           p.images,
           p.featured,
           p.sort_order,
           p.weight_kg,
           coalesce((select array_agg(c.category)
                       from public.product_categories c
                      where c.product_id = p.id), '{}') as categories,
           coalesce((select array_agg(distinct v.size)
                       from public.product_variants v
                      where v.product_id = p.id
                        and v.size is not null
                        and v.is_active), '{}') as sizes,
           coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'price', a.price))
                       from public.product_addons a
                      where a.product_id = p.id
                        and a.is_active), '[]'::jsonb) as accessories
      from public.products p
     where p.status in ('ativo', 'esgotado')
  ) x;
$function$;
