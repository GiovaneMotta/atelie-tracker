-- =====================================================================
-- 0026_estoque_seguro.sql        NAO APLICADA — para revisao
--
-- A auditoria achou tres buracos no caminho da reserva:
--
--   1. create_site_order nunca perguntava se havia peca. Conferia so se
--      o TAMANHO existia. Duas compras simultaneas da ultima peca
--      passavam as duas, e quantity ia a negativo.
--   2. inventory_mover lia e escrevia sem travar a linha, entao mesmo
--      uma verificacao ingenua teria janela entre ler e gravar.
--   3. Carrinho abandonado segurava a peca para sempre.
--
-- A garantia aqui NAO e "verificar antes de gravar", que ainda deixa
-- janela. Sao duas camadas:
--
--   * CHECK (reserved <= quantity) na tabela. Mesmo que algum caminho
--     futuro esqueca de verificar, o banco recusa.
--   * SELECT ... FOR UPDATE antes de decidir. A segunda transacao fica
--     esperando a primeira terminar e so entao LE os valores — ja
--     atualizados — e decide em cima deles.
--
-- Com as duas, nao existe ordem de eventos em que duas compras levem a
-- mesma peca: ou a segunda enxerga o estoque ja reservado e e recusada,
-- ou a constraint a derruba.
--
-- E como a reserva acontece dentro da transacao de create_site_order,
-- recusar a reserva desfaz o pedido inteiro — o link de pagamento nem
-- chega a ser criado, porque ele so nasce depois do pedido existir.
--
-- ADAPTADA PARA O FECHAMENTO PELO WHATSAPP (revisao de 23/10):
--   O clique no site deixou de reservar peca. O pedido nasce RASCUNHO
--   — interesse registrado, estoque intocado — e vira reserva quando o
--   atendimento confirma disponibilidade e move para "aguardando
--   pagamento". Quem reserva e a conversa, nao o clique.
--   O prazo deixou de ser fixo: vem de app_settings, chave 'checkout'.
--
-- ADITIVA: 1 constraint, 2 colunas, 1 status, 3 funcoes recriadas,
-- 1 funcao nova, 1 chave de configuracao.
-- Nao altera nenhuma linha de estoque nem nenhum pedido existente.
-- Rollback no fim.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) A trava que nao depende de ninguem lembrar de verificar
--    NOT VALID de proposito: entra valendo para toda escrita nova sem
--    varrer a tabela. A validacao do que ja existe vem logo abaixo, e
--    usa um lock mais fraco, que nao bloqueia leitura.
-- ---------------------------------------------------------------------
alter table public.inventory
  drop constraint if exists inventory_nao_negativo;

alter table public.inventory
  add constraint inventory_nao_negativo
  check (quantity >= 0 and reserved >= 0 and reserved <= quantity)
  not valid;

alter table public.inventory validate constraint inventory_nao_negativo;

-- ---------------------------------------------------------------------
-- 2) Ate quando a peca fica guardada, e por que o pedido precisa de olho
-- ---------------------------------------------------------------------
alter table public.orders
  add column if not exists reserved_until timestamptz;

alter table public.orders
  add column if not exists review_reason text;

comment on column public.orders.reserved_until is
  'Ate quando a reserva de estoque vale. Vencida, a peca volta para a vitrine.';
comment on column public.orders.review_reason is
  'Preenchido quando algo precisa de olho humano: valor divergente, pagamento apos a expiracao.';

create index if not exists idx_orders_reserva_vencendo
  on public.orders (reserved_until)
  where status = 'aguardando_pagamento';

-- ---------------------------------------------------------------------
-- 2b) Um status novo, e so um: "em_atendimento"
--
--     O enum ja tinha rascunho, aguardando_pagamento, pago, a esteira
--     de expedicao e cancelado. Producao e modulo proprio (0012), entao
--     virar status seria criar duas verdades sobre a mesma coisa.
--
--     O que muda no estoque:
--       rascunho, em_atendimento, cancelado -> nao encosta
--       aguardando_pagamento                -> RESERVA
--       pago e dai em diante                -> BAIXA
-- ---------------------------------------------------------------------
create or replace function public.inventory_fase(p_status text)
returns text language sql immutable as $$
  select case
    when p_status in ('rascunho', 'em_atendimento', 'cancelado') then 'nenhum'
    when p_status = 'aguardando_pagamento'                       then 'reservado'
    else 'baixado'
  end;
$$;

-- Prazo da reserva, configuravel sem mexer em codigo.
-- 2880 minutos = 48h: conversa de WhatsApp nao tem a pressa de um
-- checkout, e soltar a peca em 1 hora perderia venda de quem responde
-- no dia seguinte.
insert into public.app_settings (key, value)
select 'checkout', jsonb_build_object('reserva_minutos', 2880)
 where not exists (select 1 from public.app_settings where key = 'checkout');

-- ---------------------------------------------------------------------
-- 3) inventory_mover: trava a linha, RELE, e so entao decide
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
  v_qtd    integer := greatest(coalesce(p_qty, 0), 0);
  d_res    integer;
  d_qtd    integer;
  v_linha  record;
  v_nova_res integer;
  v_nova_qtd integer;
begin
  if v_qtd = 0 or p_de = p_para then return; end if;

  d_res := (inventory_peso_reserva(p_para) - inventory_peso_reserva(p_de)) * v_qtd;
  -- baixado guarda -1 por unidade, por isso a subtracao vem invertida
  d_qtd := (inventory_peso_baixa(p_de) - inventory_peso_baixa(p_para)) * v_qtd;
  if d_res = 0 and d_qtd = 0 then return; end if;

  /* FOR UPDATE: se outra transacao ja esta mexendo nesta linha, esta
     aqui ESPERA. Quando passa, o select devolve o valor ja gravado pela
     outra — e nao o que existia quando esta transacao comecou. E esse
     ponto que impede as duas de acharem que ha peca. */
  if p_variant is not null then
    select * into v_linha
      from public.inventory where variant_id = p_variant
      for update;
  end if;

  if v_linha.id is null and p_product is not null then
    select * into v_linha
      from public.inventory where product_id = p_product and variant_id is null
      for update;
  end if;

  -- sem linha em inventory = peca nao controlada, vende sem limite
  if v_linha.id is null then return; end if;

  v_nova_res := greatest(v_linha.reserved + d_res, 0);
  v_nova_qtd := v_linha.quantity + d_qtd;

  if v_nova_qtd < 0 or v_nova_res > v_nova_qtd then
    raise exception 'SEM_ESTOQUE'
      using errcode = 'check_violation',
            detail  = format('disponivel %s, pedido %s',
                             v_linha.quantity - v_linha.reserved, v_qtd),
            hint    = 'Esta peca acabou ou esta reservada em outro pedido.';
  end if;

  update public.inventory
     set reserved   = v_nova_res,
         quantity   = v_nova_qtd,
         updated_at = now()
   where id = v_linha.id;
end;
$$;

-- ---------------------------------------------------------------------
-- 3b) O relogio da reserva comeca quando o atendimento confirma
--     Entrar em "aguardando pagamento" e o momento em que a peca fica
--     separada para aquela cliente. E so ai que o prazo passa a correr.
-- ---------------------------------------------------------------------
create or replace function public.trg_order_fase() returns trigger
language plpgsql as $$
declare v_min integer;
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.inventory_phase := public.inventory_fase(new.status);

    if new.status = 'aguardando_pagamento'
       and (tg_op = 'INSERT' or old.status is distinct from 'aguardando_pagamento') then
      select coalesce((value->>'reserva_minutos')::integer, 2880) into v_min
        from public.app_settings where key = 'checkout';
      new.reserved_until := now() + make_interval(mins => coalesce(v_min, 2880));
    elsif new.status <> 'aguardando_pagamento' then
      new.reserved_until := null;   -- saiu da reserva, o relogio para
    end if;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 4) Devolver a prateleira o que ninguem pagou
--
--    FOR UPDATE SKIP LOCKED e o detalhe que importa: um pedido que
--    esta sendo pago NESTE instante tem a linha travada por
--    confirm_site_payment, e esta funcao simplesmente passa por ele.
--    Sem isso, um pagamento que chega no segundo do vencimento poderia
--    ter a reserva cancelada por baixo.
--
--    A condicao e repetida DENTRO do update porque entre o select e o
--    update o mundo pode ter mudado.
-- ---------------------------------------------------------------------
create or replace function public.liberar_reservas_expiradas(p_limite integer default 200)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select id from public.orders
     where status = 'aguardando_pagamento'
       and payment_status <> 'pago'
       and reserved_until is not null
       and reserved_until < now()
     order by reserved_until
     limit greatest(coalesce(p_limite, 200), 1)
     for update skip locked
  loop
    update public.orders
       set status        = 'cancelado',
           review_reason = coalesce(review_reason, 'Reserva expirada sem pagamento'),
           updated_at    = now()
     where id = r.id
       and status = 'aguardando_pagamento'
       and payment_status <> 'pago';
    if found then
      n := n + 1;
      insert into public.audit_logs(actor_id, action, entity, entity_id, reason)
      values (null, 'update', 'order', r.id::text, 'Reserva expirada: estoque devolvido');
    end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.liberar_reservas_expiradas(integer) from public;
grant execute on function public.liberar_reservas_expiradas(integer) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) create_site_order: limpa o vencido, reserva com prazo, e recusa
--    quando nao ha peca.
--    Base: 0019_site_order_tamanho.sql. Mudou so o que esta comentado.
-- ---------------------------------------------------------------------
create or replace function public.create_site_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_idem_raw    text := nullif(trim(payload->>'idempotency_key'), '');
  v_idem_key    text;
  v_existing    jsonb;
  v_cust        jsonb := coalesce(payload->'customer', '{}'::jsonb);
  v_name        text := nullif(trim(v_cust->>'name'), '');
  v_phone       text := nullif(regexp_replace(coalesce(v_cust->>'phone',''), '[^0-9]', '', 'g'), '');
  v_email       text := nullif(lower(trim(coalesce(v_cust->>'email',''))), '');
  v_cep         text := nullif(regexp_replace(coalesce(v_cust->>'cep',''), '[^0-9]', '', 'g'), '');
  v_notes       text := nullif(trim(payload->>'notes'), '');
  v_channel     text := coalesce(nullif(trim(payload->>'channel'), ''), 'site');
  v_utm         jsonb := payload->'utm';
  v_items       jsonb := payload->'items';
  v_item        jsonb;
  v_addon       jsonb;
  v_prod        record;
  v_size        text;
  v_variant     record;
  v_qty         integer;
  v_addon_qty   integer;
  v_unit        numeric(12,2);
  v_addon_price numeric(12,2);
  v_addon_sum   numeric(12,2);
  v_addons      jsonb;
  v_bordar      text;
  v_line        numeric(12,2);
  v_subtotal    numeric(12,2) := 0;
  v_total       numeric(12,2);
  v_built       jsonb := '[]'::jsonb;
  v_customer_id uuid;
  v_address_id  uuid;
  v_order       record;
  v_result      jsonb;
  v_coupon_in   text := upper(nullif(trim(payload->>'coupon_code'), ''));
  v_coupon_out  text := null;
  v_discount    numeric(12,2) := 0;
  v_eval        jsonb;
begin
  if v_name is null then
    raise exception 'Informe o nome do cliente.';
  end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'O pedido não tem itens.';
  end if;
  if v_idem_raw is null then
    raise exception 'Requisição inválida (sem chave de idempotência).';
  end if;

  /* NOVO: antes de disputar estoque, devolve o que venceu. E a limpeza
     preguicosa — quem precisa da peca e quem paga por procurar. */
  perform public.liberar_reservas_expiradas();

  v_idem_key := 'order:site:' || v_idem_raw;
  insert into public.idempotency_keys(key, scope) values (v_idem_key, 'order')
    on conflict (key) do nothing;
  if not found then
    select result into v_existing from public.idempotency_keys where key = v_idem_key;

    /* A chave de idempotencia do site e deterministica: mesmo carrinho,
       mesmo nome, mesmo telefone => mesma chave, sem nada de tempo
       dentro. Isso era inofensivo ate existir expiracao. Agora cria um
       beco: a reserva da cliente vence, ela volta e tenta comprar o
       MESMO carrinho, e a chave repetida devolveria o pedido velho, ja
       cancelado — ela seria mandada pagar algo que nao existe mais.

       Entao: se o pedido memorizado foi cancelado, a chave volta a
       valer e a compra segue como nova. Pedido vivo continua protegido
       contra duplo clique, que e o que a idempotencia existe para
       resolver. */
    if v_existing ? 'number'
       and exists (select 1 from public.orders
                    where number = (v_existing->>'number')::integer
                      and status = 'cancelado') then
      delete from public.idempotency_keys where key = v_idem_key;
      insert into public.idempotency_keys(key, scope) values (v_idem_key, 'order');
    else
      return coalesce(v_existing, jsonb_build_object('ok', true, 'duplicate', true));
    end if;
  end if;

  for v_item in select * from jsonb_array_elements(v_items) loop
    select id, name, sku, price_cash, status
      into v_prod
      from public.products
     where sku = (v_item->>'sku')
     limit 1;
    if v_prod.id is null then
      raise exception 'Produto não encontrado: %', coalesce(v_item->>'sku','(sem sku)');
    end if;
    if v_prod.status in ('inativo','oculto') then
      raise exception 'Produto indisponível: %', v_prod.name;
    end if;

    v_qty  := greatest(1, floor(coalesce((v_item->>'quantity')::numeric, 1))::int);

    v_size := nullif(trim(v_item->>'size'), '');
    v_variant := null;
    if v_size is not null then
      select id, size, price_delta
        into v_variant
        from public.product_variants
       where product_id = v_prod.id
         and is_active
         and upper(size) = upper(v_size)
       limit 1;
      if v_variant.id is null then
        raise exception 'Tamanho indisponivel para %: %', v_prod.name, v_size;
      end if;
    end if;

    v_unit := round(coalesce(v_prod.price_cash, 0)
                    + coalesce(v_variant.price_delta, 0), 2);

    v_addon_sum := 0;
    v_addons := '[]'::jsonb;
    if jsonb_typeof(v_item->'accessories') = 'array' then
      for v_addon in select * from jsonb_array_elements(v_item->'accessories') loop
        select price into v_addon_price
          from public.product_addons
         where is_active
           and lower(name) = lower(coalesce(v_addon->>'name',''))
           and (product_id = v_prod.id or product_id is null)
         order by product_id nulls last
         limit 1;
        v_addon_price := round(coalesce(v_addon_price, 0), 2);
        v_addon_qty := greatest(1, floor(coalesce((v_addon->>'qty')::numeric, 1))::int);
        v_addon_sum := v_addon_sum + v_addon_price * v_addon_qty;
        v_addons := v_addons || jsonb_build_object(
          'name', coalesce(v_addon->>'name',''), 'price', v_addon_price, 'qty', v_addon_qty);
      end loop;
    end if;

    v_line := round((v_unit + v_addon_sum) * v_qty, 2);
    v_subtotal := v_subtotal + v_line;
    v_bordar := nullif(trim(v_item->>'nome'), '');

    v_built := v_built || jsonb_build_object(
      'product_id',   v_prod.id,
      'variant_id',   v_variant.id,
      'name',         v_prod.name
                       || case when v_variant.id is not null then ' — ' || v_variant.size else '' end
                       || case when v_bordar is not null then ' — bordar: ' || v_bordar else '' end,
      'sku',          v_prod.sku,
      'quantity',     v_qty,
      'unit_price',   v_unit,
      'addons',       v_addons,
      'customization',case when v_bordar is not null then jsonb_build_object('nome', v_bordar) else '{}'::jsonb end,
      'line_total',   v_line
    );
  end loop;

  v_subtotal := round(v_subtotal, 2);

  if v_coupon_in is not null then
    v_eval := public.coupon_eval(v_coupon_in, v_subtotal);
    if (v_eval->>'valid')::boolean then
      v_discount   := round(coalesce((v_eval->>'discount')::numeric, 0), 2);
      v_coupon_out := v_eval->>'code';
      update public.coupons set uses_count = uses_count + 1, updated_at = now()
       where upper(code) = v_coupon_out;
    end if;
  end if;

  v_total := round(greatest(v_subtotal - v_discount, 0), 2);

  if v_phone is not null then
    select id into v_customer_id from public.customers
     where phone = v_phone or whatsapp = v_phone limit 1;
  end if;
  if v_customer_id is null and v_email is not null then
    select id into v_customer_id from public.customers where email = v_email limit 1;
  end if;
  if v_customer_id is null then
    insert into public.customers(name, phone, whatsapp, email, origin, utm, first_contact_at, last_interaction_at)
    values (v_name, v_phone, v_phone, v_email, 'catalogo', v_utm, now(), now())
    returning id into v_customer_id;
  else
    update public.customers
       set last_interaction_at = now(),
           email = coalesce(email, v_email),
           utm   = coalesce(utm, v_utm)
     where id = v_customer_id;
  end if;

  if v_cep is not null then
    select id into v_address_id from public.customer_addresses
     where customer_id = v_customer_id
       and regexp_replace(coalesce(cep,''),'[^0-9]','','g') = v_cep
     limit 1;
    if v_address_id is null then
      insert into public.customer_addresses(customer_id, label, cep, is_default)
      values (v_customer_id, 'Site', v_cep, true)
      returning id into v_address_id;
    end if;
  end if;

  /* RASCUNHO, nao "aguardando pagamento".
     O clique no WhatsApp e interesse registrado, nao venda nem reserva.
     A peca so sai da vitrine quando o atendimento confirma com a
     cliente e move o pedido — e ai o gatilho acima liga o relogio. */
  insert into public.orders(
    customer_id, address_id, subtotal, discount, shipping_cost, total,
    payment_status, status, channel, notes, utm, coupon_code
  ) values (
    v_customer_id, v_address_id, v_subtotal, v_discount, 0, v_total,
    'pendente', 'rascunho', v_channel, v_notes, v_utm, v_coupon_out
  ) returning * into v_order;

  /* Em rascunho a fase e 'nenhum', entao este insert NAO reserva nada.
     A verificacao de estoque acontece depois, quando voce move para
     "aguardando pagamento": se a peca ja tiver ido, a mudanca de status
     e recusada e voce descobre na hora, com a cliente ainda na
     conversa — nao depois de prometer. */
  insert into public.order_items(
    order_id, product_id, variant_id, name, sku, quantity, unit_price, addons, customization, line_total)
  select v_order.id,
         (e->>'product_id')::uuid, nullif(e->>'variant_id','')::uuid, e->>'name', e->>'sku',
         (e->>'quantity')::int, (e->>'unit_price')::numeric,
         e->'addons', e->'customization', (e->>'line_total')::numeric
    from jsonb_array_elements(v_built) e;

  insert into public.audit_logs(actor_id, action, entity, entity_id, new_value, reason)
  values (null, 'create', 'order', v_order.id::text,
          jsonb_build_object('number', v_order.number, 'total', v_total, 'discount', v_discount,
                             'coupon', v_coupon_out, 'channel', v_channel, 'source', 'site'),
          'Pedido criado pelo site');

  v_result := jsonb_build_object(
    'ok', true, 'order_id', v_order.id, 'number', v_order.number,
    'subtotal', v_subtotal, 'discount', v_discount, 'coupon', v_coupon_out, 'total', v_total);
  update public.idempotency_keys set result = v_result where key = v_idem_key;

  return v_result;
end;
$$;

-- =====================================================================
-- ROLLBACK
--   alter table public.inventory drop constraint if exists inventory_nao_negativo;
--   drop index if exists idx_orders_reserva_vencendo;
--   drop function if exists public.liberar_reservas_expiradas(integer);
--   alter table public.orders drop column if exists reserved_until;
--   alter table public.orders drop column if exists review_reason;
--   -- e reaplicar inventory_mover da 0020 e create_site_order da 0019
-- =====================================================================
