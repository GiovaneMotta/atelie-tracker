-- =====================================================================
-- 0023_public_catalog.sql
--
-- A public_catalog e a funcao que alimenta o site inteiro, e ate aqui
-- ela nao existia no repositorio: foi criada direto no banco e nunca
-- foi versionada. Esta migration a traz para ca e corrige dois
-- defeitos, sem mudar mais nada da forma dela.
--
-- 1. TAMANHO DESATIVADO APARECIA NA VITRINE
--    A lista de tamanhos nao filtrava is_active. Depois da 0022, que
--    desativou o "P" de 40 pecas, o site passou a mostrar um tamanho
--    que nao existe mais — e create_site_order, que so aceita variacao
--    ativa, RECUSARIA o pedido na hora de fechar. A cliente escolheria
--    P e levaria um erro.
--
-- 2. O PRECO NO CARTAO NUNCA CHEGAVA AO SITE
--    O painel tem o campo "Preco no cartao", mas a funcao nao devolvia
--    p.price_card. O site le esse campo (mapRow em catalog-data.js) e
--    recebia sempre nulo, entao o parcelamento saia calculado em cima
--    do preco a vista. Quem preenchia o campo no painel nao via efeito
--    nenhum. Agora ele vai junto.
--
-- O resto e identico ao que ja estava no banco.
--
-- Rollback: reaplicar esta mesma funcao sem "and v.is_active" e sem
-- "p.price_card" — mas ai os dois defeitos voltam.
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
           p.price_card,          -- 2) faltava: o parcelamento sai daqui
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
                        and v.is_active), '{}') as sizes,   -- 1) so tamanho ativo
           coalesce((select jsonb_agg(jsonb_build_object('name', a.name, 'price', a.price))
                       from public.product_addons a
                      where a.product_id = p.id
                        and a.is_active), '[]'::jsonb) as accessories
      from public.products p
     where p.status in ('ativo', 'esgotado')
  ) x;
$function$;
