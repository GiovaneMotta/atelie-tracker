-- =====================================================================
-- 0021_composicao.sql
--
-- DEPENDE DA 0020. Rode a 0020_estoque_automatico.sql primeiro.
--
-- A 0020 fez cada cadastro baixar o proprio contador. Isso resolve a
-- peca avulsa, mas nao o caso real do ateliê: "Rouge Luxo" e "Rubi
-- Classico" sao a mesma saida, uma com body junto e outra sem. Com um
-- contador para cada, 13 pecas viram 26 no painel.
--
-- Aqui entram as duas pontas que faltavam:
--
--   1. COMPOSICAO — um produto pode ser feito de outros. Vendeu o kit,
--      baixa a saida e baixa o body, cada um do seu estoque. O kit em
--      si nao tem contador: quem manda sao as pecas de dentro.
--
--   2. ADICIONAL COM ESTOQUE — o adicional ganha um produto ligado.
--      "Body bordado" deixa de ser so um nome com preco e passa a
--      consumir um body de verdade quando a cliente marca.
--
-- Assim os dois modos convivem: body opcional (adicional ligado ao
-- produto body) e body junto (componente do kit). Em ambos, o body sai
-- do mesmo e unico estoque de bodies.
--
-- Tamanho: o componente normalmente acompanha o tamanho do pai — kit RN
-- consome body RN. E o que match_size faz. Para componente que nao tem
-- tamanho (um lacinho, uma caixa), aponte child_variant_id ou deixe
-- match_size falso.
--
-- ADITIVA: 1 tabela, 1 coluna, 2 funcoes novas e a troca de 2 gatilhos
-- que a 0020 criou. Nao mexe em public_catalog nem em dado existente.
--
-- Rollback no fim do arquivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Do que um produto e feito
-- ---------------------------------------------------------------------
create table if not exists public.product_components (
  id                uuid primary key default gen_random_uuid(),
  parent_product_id uuid not null references public.products(id) on delete cascade,
  -- null = a composicao vale para todos os tamanhos do pai
  parent_variant_id uuid references public.product_variants(id) on delete cascade,
  child_product_id  uuid not null references public.products(id) on delete restrict,
  -- preenchido so quando o componente e sempre a mesma variacao
  child_variant_id  uuid references public.product_variants(id) on delete restrict,
  -- o componente segue o tamanho do pai (kit RN -> body RN)
  match_size        boolean not null default true,
  quantity          integer not null default 1 check (quantity > 0),
  created_at        timestamptz not null default now()
);
create index if not exists idx_components_parent on public.product_components(parent_product_id);
create index if not exists idx_components_child  on public.product_components(child_product_id);

comment on table public.product_components is
  'Composicao: de quais produtos um kit e feito. Vender o pai baixa os filhos.';

-- RLS como no resto do schema (0007): o navegador so LE, e so quem tem
-- products.read. Escrita e sempre pela API, com a service role.
alter table public.product_components enable row level security;
drop policy if exists components_read on public.product_components;
create policy components_read on public.product_components
  for select using (public.auth_has_permission('products.read'));

-- ---------------------------------------------------------------------
-- 2) Adicional que consome um produto de verdade
-- ---------------------------------------------------------------------
alter table public.product_addons
  add column if not exists addon_product_id uuid references public.products(id) on delete set null;

comment on column public.product_addons.addon_product_id is
  'Produto que este adicional consome do estoque. Null = adicional sem estoque (ex.: bordar nome).';

-- ---------------------------------------------------------------------
-- 3) O que uma linha de pedido realmente tira da prateleira
--    Devolve (produto, variacao, quantidade) ja explodido.
-- ---------------------------------------------------------------------
create or replace function public.inventory_consumo(
  p_product uuid,
  p_variant uuid,
  p_qty     integer,
  p_addons  jsonb
) returns table (produto uuid, variacao uuid, qtd integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_size     text;
  v_tem_comp boolean;
begin
  select v.size into v_size
    from public.product_variants v where v.id = p_variant;

  select exists (
    select 1 from public.product_components c
     where c.parent_product_id = p_product
       and (c.parent_variant_id is null or c.parent_variant_id = p_variant)
  ) into v_tem_comp;

  if v_tem_comp then
    -- kit: quem sai da prateleira sao as pecas de dentro
    return query
      select c.child_product_id,
             coalesce(
               c.child_variant_id,
               case when c.match_size and v_size is not null then (
                 select cv.id from public.product_variants cv
                  where cv.product_id = c.child_product_id
                    and cv.is_active
                    and upper(cv.size) = upper(v_size)
                  limit 1
               ) end),
             (c.quantity * p_qty)::integer
        from public.product_components c
       where c.parent_product_id = p_product
         and (c.parent_variant_id is null or c.parent_variant_id = p_variant);
  else
    -- peca avulsa: ela mesma
    return query select p_product, p_variant, p_qty;
  end if;

  -- adicionais marcados que apontam para um produto
  if jsonb_typeof(p_addons) = 'array' then
    return query
      select x.addon_product_id,
             case when v_size is not null then (
               select av.id from public.product_variants av
                where av.product_id = x.addon_product_id
                  and av.is_active
                  and upper(av.size) = upper(v_size)
                limit 1
             ) end,
             (greatest(coalesce((e->>'qty')::integer, 1), 1) * p_qty)::integer
        from jsonb_array_elements(p_addons) e
        cross join lateral (
          select a.addon_product_id
            from public.product_addons a
           where a.is_active
             and a.addon_product_id is not null
             and lower(a.name) = lower(coalesce(e->>'name', ''))
             and (a.product_id = p_product or a.product_id is null)
           order by a.product_id nulls last
           limit 1
        ) x;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Os gatilhos da 0020 passam a usar o consumo explodido
-- ---------------------------------------------------------------------
create or replace function public.trg_order_estoque() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare it record; c record;
begin
  if new.inventory_phase is distinct from old.inventory_phase then
    for it in select product_id, variant_id, quantity, addons
                from public.order_items where order_id = new.id loop
      for c in select * from public.inventory_consumo(
                 it.product_id, it.variant_id, it.quantity, it.addons) loop
        perform public.inventory_mover(c.produto, c.variacao, c.qtd,
                                       old.inventory_phase, new.inventory_phase);
      end loop;
    end loop;
  end if;
  return null;
end;
$$;

create or replace function public.trg_item_estoque() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_fase text; c record;
begin
  if tg_op = 'INSERT' then
    select inventory_phase into v_fase from public.orders where id = new.order_id;
    for c in select * from public.inventory_consumo(
               new.product_id, new.variant_id, new.quantity, new.addons) loop
      perform public.inventory_mover(c.produto, c.variacao, c.qtd,
                                     'nenhum', coalesce(v_fase, 'nenhum'));
    end loop;
    return new;

  elsif tg_op = 'DELETE' then
    select inventory_phase into v_fase from public.orders where id = old.order_id;
    for c in select * from public.inventory_consumo(
               old.product_id, old.variant_id, old.quantity, old.addons) loop
      perform public.inventory_mover(c.produto, c.variacao, c.qtd,
                                     coalesce(v_fase, 'nenhum'), 'nenhum');
    end loop;
    return old;

  else
    select inventory_phase into v_fase from public.orders where id = new.order_id;
    -- devolve o item como estava e aplica como ficou: cobre troca de
    -- tamanho, de quantidade e de adicionais
    for c in select * from public.inventory_consumo(
               old.product_id, old.variant_id, old.quantity, old.addons) loop
      perform public.inventory_mover(c.produto, c.variacao, c.qtd,
                                     coalesce(v_fase, 'nenhum'), 'nenhum');
    end loop;
    for c in select * from public.inventory_consumo(
               new.product_id, new.variant_id, new.quantity, new.addons) loop
      perform public.inventory_mover(c.produto, c.variacao, c.qtd,
                                     'nenhum', coalesce(v_fase, 'nenhum'));
    end loop;
    return new;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 5) public_stock passa a saber responder por kit
--    Kit nao tem contador proprio: o disponivel dele e quantas vezes da
--    para montar com o que existe das pecas de dentro.
-- ---------------------------------------------------------------------
create or replace function public.public_stock()
returns table (sku text, size text, disponivel integer)
language sql
stable
security definer
set search_path = public
as $$
  with controlado as (
    -- o que existe contado, por variacao e por produto inteiro
    select i.variant_id, v.product_id, v.size,
           greatest(i.quantity - i.reserved, 0)::integer as disp
      from public.inventory i
      join public.product_variants v on v.id = i.variant_id
     where i.variant_id is not null
    union all
    select null::uuid, i.product_id, null::text,
           greatest(i.quantity - i.reserved, 0)::integer
      from public.inventory i
     where i.variant_id is null and i.product_id is not null
  ),
  -- toda combinacao de produto e tamanho que o site pode pedir
  alvos as (
    select p.id as product_id, p.sku, v.id as variant_id, v.size
      from public.products p
      left join public.product_variants v
             on v.product_id = p.id and v.is_active
     where p.status not in ('inativo', 'oculto')
       and p.sku is not null
  )
  -- O disponivel sai do MESMO caminho que a venda percorre
  -- (inventory_consumo), entao vitrine e baixa nunca divergem: para a
  -- peca avulsa e ela mesma; para o kit, quantas vezes da para montar,
  -- mandada pelo componente mais escasso.
  select a.sku,
         a.size,
         min(case when d.disp is null then 999999
                  else floor(d.disp::numeric / greatest(k.qtd, 1))::integer end)::integer
    from alvos a
    cross join lateral public.inventory_consumo(a.product_id, a.variant_id, 1, '[]'::jsonb) k
    left join lateral (
      -- igual ao inventory_mover: a linha da variacao manda; sem ela, a do produto
      select c.disp from controlado c
       where (k.variacao is not null and c.variant_id = k.variacao)
          or (c.variant_id is null and c.product_id = k.produto)
       order by (c.variant_id is null)
       limit 1
    ) d on true
   group by a.sku, a.size
  -- tudo sem contagem = peca nao controlada: nao entra, e o site a trata
  -- como sempre disponivel
  having min(case when d.disp is null then 999999
                  else floor(d.disp::numeric / greatest(k.qtd, 1))::integer end) < 999999;
$$;

revoke all on function public.public_stock() from public;
grant execute on function public.public_stock() to anon, authenticated;

-- =====================================================================
-- ROLLBACK (volta ao estado da 0020)
--   drop function if exists public.inventory_consumo(uuid, uuid, integer, jsonb);
--   drop table if exists public.product_components;
--   alter table public.product_addons drop column if exists addon_product_id;
--   -- e reaplicar trg_order_estoque, trg_item_estoque e public_stock
--   -- da 0020_estoque_automatico.sql
-- =====================================================================
