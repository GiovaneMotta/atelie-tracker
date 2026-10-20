-- =====================================================================
-- 0019_site_order_tamanho.sql
--
-- O site mostrava os tamanhos como enfeite: a cliente nao escolhia, o
-- carrinho nao carregava e create_site_order nem aceitava o campo. Todo
-- pedido vindo do site gravava order_items.variant_id nulo - o mesmo
-- defeito que o painel tinha e que ja foi corrigido la.
--
-- Esta migration recria create_site_order aceitando "size" por item:
--   * resolve a variante ativa daquele produto (erro se o tamanho nao
--     existir - melhor recusar que gravar pedido ambiguo);
--   * cobra price_cash + price_delta da variante, sempre do banco;
--   * grava variant_id e rotula o item como "Nome — RN", igual ao painel.
--
-- Compativel com o site antigo: item sem "size" continua funcionando e
-- grava variant_id nulo, como antes.
--
-- Rodar no SQL Editor do Supabase.
-- Rollback: reaplicar a funcao da 0018_coupons.sql.
-- =====================================================================
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
  v_size        text;        -- tamanho escolhido pela cliente (RN, P, M...)
  v_variant     record;      -- variante correspondente, quando existir
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
  -- 0) validações básicas
  if v_name is null then
    raise exception 'Informe o nome do cliente.';
  end if;
  if v_items is null or jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'O pedido não tem itens.';
  end if;
  if v_idem_raw is null then
    raise exception 'Requisição inválida (sem chave de idempotência).';
  end if;

  -- 1) idempotência
  v_idem_key := 'order:site:' || v_idem_raw;
  insert into public.idempotency_keys(key, scope) values (v_idem_key, 'order')
    on conflict (key) do nothing;
  if not found then
    select result into v_existing from public.idempotency_keys where key = v_idem_key;
    return coalesce(v_existing, jsonb_build_object('ok', true, 'duplicate', true));
  end if;

  -- 2) itens: preço/nome vêm do BANCO (snapshot). Ignora preços do cliente.
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

    -- Tamanho: ate aqui o site nao mandava, e todo pedido gravava variant_id
    -- nulo. O preco sai do banco (price_cash + price_delta da variante),
    -- nunca do cliente.
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

  -- 2b) cupom (opcional): recalcula o desconto no servidor e conta o uso.
  if v_coupon_in is not null then
    v_eval := public.coupon_eval(v_coupon_in, v_subtotal);
    if (v_eval->>'valid')::boolean then
      v_discount   := round(coalesce((v_eval->>'discount')::numeric, 0), 2);
      v_coupon_out := v_eval->>'code';
      update public.coupons set uses_count = uses_count + 1, updated_at = now()
       where upper(code) = v_coupon_out;
    end if;   -- cupom inválido: ignora (não falha o pedido)
  end if;

  v_total := round(greatest(v_subtotal - v_discount, 0), 2);

  -- 3) cliente: dedup por telefone, senão por e-mail; senão cria.
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

  -- 4) endereço (se veio CEP)
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

  -- 5) pedido
  insert into public.orders(
    customer_id, address_id, subtotal, discount, shipping_cost, total,
    payment_status, status, channel, notes, utm, coupon_code
  ) values (
    v_customer_id, v_address_id, v_subtotal, v_discount, 0, v_total,
    'pendente', 'aguardando_pagamento', v_channel, v_notes, v_utm, v_coupon_out
  ) returning * into v_order;

  -- 6) itens do pedido
  insert into public.order_items(
    order_id, product_id, variant_id, name, sku, quantity, unit_price, addons, customization, line_total)
  select v_order.id,
         (e->>'product_id')::uuid, nullif(e->>'variant_id','')::uuid, e->>'name', e->>'sku',
         (e->>'quantity')::int, (e->>'unit_price')::numeric,
         e->'addons', e->'customization', (e->>'line_total')::numeric
    from jsonb_array_elements(v_built) e;

  -- 7) histórico/timeline
  insert into public.audit_logs(actor_id, action, entity, entity_id, new_value, reason)
  values (null, 'create', 'order', v_order.id::text,
          jsonb_build_object('number', v_order.number, 'total', v_total, 'discount', v_discount,
                             'coupon', v_coupon_out, 'channel', v_channel, 'source', 'site'),
          'Pedido criado pelo site');

  -- 8) resultado + memoriza na idempotência
  v_result := jsonb_build_object(
    'ok', true, 'order_id', v_order.id, 'number', v_order.number,
    'subtotal', v_subtotal, 'discount', v_discount, 'coupon', v_coupon_out, 'total', v_total);
  update public.idempotency_keys set result = v_result where key = v_idem_key;

  return v_result;
end;
$$;
