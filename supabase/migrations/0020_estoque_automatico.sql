-- =====================================================================
-- 0020_estoque_automatico.sql
--
-- Ate aqui a tabela inventory era um caderninho: o numero so mudava
-- quando alguem digitava na tela Estoque. Vender nao mexia nele. Com
-- peca pronta na prateleira isso vende o que nao existe.
--
-- Esta migration faz o estoque seguir o pedido sozinho, em duas fases:
--
--   aguardando_pagamento -> RESERVADO  (a peca sai da vitrine mas ainda
--                                       esta na prateleira)
--   pago e dai em diante  -> BAIXADO   (a peca saiu de verdade)
--   rascunho / cancelado  -> NENHUM    (nao encosta no estoque)
--
-- A fase aplicada fica gravada em orders.inventory_phase, entao mover o
-- pedido para frente e para tras acerta o estoque pelos dois lados e
-- nunca conta duas vezes.
--
-- Por tamanho: o item do pedido ja guarda variant_id. A baixa procura
-- primeiro a linha daquela variacao; so se ela nao existir e que cai na
-- linha do produto. Assim o estoque por tamanho passa a funcionar sem
-- quebrar as pecas que hoje sao contadas por produto.
--
-- Peca sem nenhuma linha em inventory continua NAO controlada, como
-- hoje: vende sem limite. Isso e proposital, senao as 45 pecas ja
-- cadastradas apareceriam todas esgotadas no dia seguinte.
--
-- ADITIVA: cria 1 coluna, 5 funcoes e 3 gatilhos. Nao altera nenhuma
-- linha de estoque existente nem mexe em public_catalog.
--
-- Rodar no SQL Editor do Supabase.
-- Rollback no fim do arquivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Em que fase o estoque deste pedido ja foi aplicado
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists inventory_phase text not null default 'nenhum';

comment on column public.orders.inventory_phase is
  'Fase de estoque ja aplicada: nenhum | reservado | baixado. Mantida pelos gatilhos.';

-- ---------------------------------------------------------------------
-- 2) Qual fase cada status do pedido pede
-- ---------------------------------------------------------------------
create or replace function public.inventory_fase(p_status text)
returns text language sql immutable as $$
  select case
    when p_status in ('rascunho', 'cancelado') then 'nenhum'
    when p_status = 'aguardando_pagamento'     then 'reservado'
    else 'baixado'
  end;
$$;

-- Quanto cada fase pesa em reserved e em quantity, por unidade.
create or replace function public.inventory_peso_reserva(p_fase text)
returns integer language sql immutable as $$
  select case when p_fase = 'reservado' then 1 else 0 end;
$$;

create or replace function public.inventory_peso_baixa(p_fase text)
returns integer language sql immutable as $$
  select case when p_fase = 'baixado' then 1 else 0 end;
$$;

-- ---------------------------------------------------------------------
-- 3) Mover uma linha de item de uma fase para outra
-- ---------------------------------------------------------------------
create or replace function public.inventory_mover(
  p_product uuid,
  p_variant uuid,
  p_qty     integer,
  p_de      text,
  p_para    text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qtd  integer := greatest(coalesce(p_qty, 0), 0);
  d_res  integer;
  d_qtd  integer;
  v_hit  integer := 0;
begin
  if v_qtd = 0 or p_de = p_para then return; end if;

  d_res := (inventory_peso_reserva(p_para) - inventory_peso_reserva(p_de)) * v_qtd;
  -- baixado guarda -1 por unidade, por isso a subtracao vem invertida
  d_qtd := (inventory_peso_baixa(p_de) - inventory_peso_baixa(p_para)) * v_qtd;

  if d_res = 0 and d_qtd = 0 then return; end if;

  -- 3a) linha da variacao (tamanho), que e o controle fino
  if p_variant is not null then
    update public.inventory
       set reserved   = greatest(reserved + d_res, 0),
           quantity   = quantity + d_qtd,
           updated_at = now()
     where variant_id = p_variant;
    get diagnostics v_hit = row_count;
  end if;

  -- 3b) sem linha por tamanho, cai na linha do produto
  if v_hit = 0 and p_product is not null then
    update public.inventory
       set reserved   = greatest(reserved + d_res, 0),
           quantity   = quantity + d_qtd,
           updated_at = now()
     where product_id = p_product and variant_id is null;
  end if;

  -- nenhuma das duas existe: peca nao controlada, segue sem estoque
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Gatilhos
-- ---------------------------------------------------------------------

-- 4a) O status manda na fase. Antes de gravar, a fase acompanha.
create or replace function public.trg_order_fase() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.inventory_phase := public.inventory_fase(new.status);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_fase on public.orders;
create trigger trg_orders_fase
  before insert or update on public.orders
  for each row execute function public.trg_order_fase();

-- 4b) Fase mudou: corre os itens e acerta o estoque.
--     Pedido nasce sem itens (create_site_order grava os itens depois),
--     entao no INSERT nao ha nada a fazer: quem reserva e o 4c.
create or replace function public.trg_order_estoque() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare r record;
begin
  if new.inventory_phase is distinct from old.inventory_phase then
    for r in select product_id, variant_id, quantity
               from public.order_items where order_id = new.id loop
      perform public.inventory_mover(
        r.product_id, r.variant_id, r.quantity,
        old.inventory_phase, new.inventory_phase);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_orders_estoque on public.orders;
create trigger trg_orders_estoque
  after update on public.orders
  for each row execute function public.trg_order_estoque();

-- 4c) Item entrou, saiu ou mudou de quantidade: aplica a fase do pedido.
create or replace function public.trg_item_estoque() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_fase text;
begin
  if tg_op = 'INSERT' then
    select inventory_phase into v_fase from public.orders where id = new.order_id;
    perform public.inventory_mover(new.product_id, new.variant_id, new.quantity,
                                   'nenhum', coalesce(v_fase, 'nenhum'));
    return new;
  elsif tg_op = 'DELETE' then
    select inventory_phase into v_fase from public.orders where id = old.order_id;
    perform public.inventory_mover(old.product_id, old.variant_id, old.quantity,
                                   coalesce(v_fase, 'nenhum'), 'nenhum');
    return old;
  else
    select inventory_phase into v_fase from public.orders where id = new.order_id;
    -- devolve o item antigo e aplica o novo: cobre troca de tamanho tambem
    perform public.inventory_mover(old.product_id, old.variant_id, old.quantity,
                                   coalesce(v_fase, 'nenhum'), 'nenhum');
    perform public.inventory_mover(new.product_id, new.variant_id, new.quantity,
                                   'nenhum', coalesce(v_fase, 'nenhum'));
    return new;
  end if;
end;
$$;

drop trigger if exists trg_items_estoque on public.order_items;
create trigger trg_items_estoque
  after insert or update or delete on public.order_items
  for each row execute function public.trg_item_estoque();

-- ---------------------------------------------------------------------
-- 5) Pedidos que ja existem: marca a fase SEM aplicar nada.
--    O numero de hoje foi conferido na mao e vale; aplicar o historico
--    agora baixaria de novo o que ja saiu da prateleira meses atras.
--    Por isso o update desliga o gatilho 4b enquanto roda.
-- ---------------------------------------------------------------------
alter table public.orders disable trigger trg_orders_estoque;
update public.orders
   set inventory_phase = public.inventory_fase(status)
 where inventory_phase is distinct from public.inventory_fase(status);
alter table public.orders enable trigger trg_orders_estoque;

-- ---------------------------------------------------------------------
-- 6) O que o site pode perguntar: disponivel por SKU e tamanho.
--    Funcao nova, de proposito: nao encosta em public_catalog.
--    Devolve so o que esta controlado; peca sem linha em inventory nao
--    aparece, e o site a trata como sempre disponivel.
-- ---------------------------------------------------------------------
create or replace function public.public_stock()
returns table (sku text, size text, disponivel integer)
language sql
stable
security definer
set search_path = public
as $$
  -- por tamanho
  select p.sku,
         v.size,
         greatest(i.quantity - i.reserved, 0)::integer
    from public.inventory i
    join public.product_variants v on v.id = i.variant_id
    join public.products p         on p.id = v.product_id
   where i.variant_id is not null
     and p.status not in ('inativo', 'oculto')
  union all
  -- peca inteira (sem controle por tamanho)
  select p.sku,
         null::text,
         greatest(i.quantity - i.reserved, 0)::integer
    from public.inventory i
    join public.products p on p.id = i.product_id
   where i.variant_id is null
     and p.status not in ('inativo', 'oculto');
$$;

revoke all on function public.public_stock() from public;
grant execute on function public.public_stock() to anon, authenticated;

-- =====================================================================
-- ROLLBACK
--   drop trigger if exists trg_items_estoque  on public.order_items;
--   drop trigger if exists trg_orders_estoque on public.orders;
--   drop trigger if exists trg_orders_fase    on public.orders;
--   drop function if exists public.trg_item_estoque();
--   drop function if exists public.trg_order_estoque();
--   drop function if exists public.trg_order_fase();
--   drop function if exists public.inventory_mover(uuid, uuid, integer, text, text);
--   drop function if exists public.inventory_peso_baixa(text);
--   drop function if exists public.inventory_peso_reserva(text);
--   drop function if exists public.inventory_fase(text);
--   drop function if exists public.public_stock();
--   alter table public.orders drop column if exists inventory_phase;
-- =====================================================================
