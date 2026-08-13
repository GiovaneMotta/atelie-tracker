-- =====================================================================
-- 0004_orders_shipping.sql — Pedidos, itens, pagamentos, frete,
-- envios, etiquetas e rastreio (§14, §15, §19, §21, §53)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PEDIDOS (§14). Número sequencial legível + máquina de estados (§53).
-- ---------------------------------------------------------------------
create sequence if not exists public.order_number_seq start 1000;

create table public.orders (
  id             uuid primary key default gen_random_uuid(),
  number         integer not null default nextval('public.order_number_seq') unique,
  customer_id    uuid references public.customers(id) on delete set null,
  lead_id        uuid references public.leads(id) on delete set null,
  address_id     uuid references public.customer_addresses(id) on delete set null,
  -- valores
  subtotal       numeric(12,2) not null default 0,
  discount       numeric(12,2) not null default 0,
  shipping_cost  numeric(12,2) not null default 0,
  total          numeric(12,2) not null default 0,
  -- pagamento
  payment_method text,                   -- pix|cartao|link|...
  payment_status text not null default 'pendente',  -- pendente|pago|estornado|falhou
  -- fluxo do pedido (§14 timeline / §53 estados)
  status         text not null default 'rascunho',
  -- rascunho|aguardando_pagamento|pago|aguardando_endereco|aguardando_etiqueta|
  -- etiqueta_gerada|postado|em_transito|entregue|pos_venda|cancelado
  channel        text,                   -- origem: catalogo|inbox|manual
  notes          text,
  -- checklist de expedição (§69)
  checklist      jsonb not null default '{}',
  created_by     uuid references public.staff(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_orders_customer on public.orders(customer_id);
create index idx_orders_status   on public.orders(status);
create index idx_orders_created  on public.orders(created_at desc);
create trigger trg_orders_updated before update on public.orders
  for each row execute function public.set_updated_at();

-- Itens do pedido (§14). Snapshot de nome/preço no momento da venda
-- (o preço do produto pode mudar depois — o pedido não muda).
create table public.order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  variant_id    uuid references public.product_variants(id) on delete set null,
  name          text not null,          -- snapshot
  sku           text,
  quantity      integer not null default 1,
  unit_price    numeric(12,2) not null default 0,   -- snapshot do preço unitário
  addons        jsonb not null default '[]',        -- [{name, price, text}] personalizações
  customization jsonb not null default '{}',        -- nome do bebê, cor, tema (§65)
  line_total    numeric(12,2) not null default 0,
  created_at    timestamptz not null default now()
);
create index idx_items_order on public.order_items(order_id);

-- ---------------------------------------------------------------------
-- PAGAMENTOS (§14). Idempotente por provider+external_id.
-- ---------------------------------------------------------------------
create table public.payments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid references public.orders(id) on delete set null,
  provider     text not null default 'infinitepay',
  external_id  text,                    -- order_nsu / id do provedor
  amount       numeric(12,2) not null,
  method       text,                    -- pix|credit|debit
  status       text not null default 'pendente',   -- pendente|pago|estornado|falhou
  link_url     text,                    -- link de pagamento gerado
  receipt_url  text,
  raw          jsonb,                   -- payload cru do webhook
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index idx_payments_provider_ext on public.payments(provider, external_id)
  where external_id is not null;
create index idx_payments_order on public.payments(order_id);
create trigger trg_payments_updated before update on public.payments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- FRETE — cotações (§16). Guardamos a cotação escolhida para auditoria.
-- ---------------------------------------------------------------------
create table public.shipping_quotes (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid references public.orders(id) on delete cascade,
  cep_origin    text,
  cep_dest      text,
  declared_value numeric(12,2),
  weight_kg     numeric(8,3),
  options       jsonb not null default '[]',   -- lista retornada pela Frenet
  chosen        jsonb,                          -- opção selecionada {carrier, service, price, days}
  created_at    timestamptz not null default now()
);
create index idx_quotes_order on public.shipping_quotes(order_id);

-- ---------------------------------------------------------------------
-- ENVIOS + ETIQUETAS (§19, §67). Impede etiqueta duplicada: unique por
-- pedido enquanto não cancelada.
-- ---------------------------------------------------------------------
create table public.shipments (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  carrier       text,
  service       text,
  price         numeric(12,2),
  tracking_code text,
  status        text not null default 'pendente',
  -- pendente|etiqueta_gerada|postado|em_transito|saiu_entrega|entregue|problema|cancelado
  frenet_shipment_id text,              -- id do envio na Frenet
  frenet_order_id    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index idx_shipment_order_active on public.shipments(order_id)
  where status <> 'cancelado';          -- 1 envio ativo por pedido (§19 anti-duplicidade)
create index idx_shipments_tracking on public.shipments(tracking_code);
create trigger trg_shipments_updated before update on public.shipments
  for each row execute function public.set_updated_at();

create table public.shipping_labels (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null references public.shipments(id) on delete cascade,
  format        text default 'A4',      -- §20
  url           text,                   -- URL/dados da etiqueta (Storage ou Frenet)
  frenet_data   jsonb,
  created_at    timestamptz not null default now()
);
create index idx_labels_shipment on public.shipping_labels(shipment_id);

-- Eventos de rastreio (§21) — histórico completo, sem duplicar evento
create table public.tracking_events (
  id           uuid primary key default gen_random_uuid(),
  shipment_id  uuid not null references public.shipments(id) on delete cascade,
  status       text not null,          -- postado|em_transito|saiu_entrega|entregue|problema|cancelado
  description  text,
  occurred_at  timestamptz,
  raw          jsonb,
  created_at   timestamptz not null default now()
);
create unique index idx_tracking_dedupe on public.tracking_events(shipment_id, status, occurred_at);

-- ---------------------------------------------------------------------
-- MÁQUINA DE ESTADOS do pedido (§53) — bloqueia transições inválidas.
-- Ex.: 'entregue' não volta para 'aguardando_pagamento' sem ação admin.
-- ---------------------------------------------------------------------
create or replace function public.enforce_order_transition()
returns trigger language plpgsql as $$
declare
  allowed text[];
begin
  if new.status = old.status then return new; end if;

  allowed := case old.status
    when 'rascunho'              then array['aguardando_pagamento','cancelado']
    when 'aguardando_pagamento' then array['pago','cancelado','rascunho']
    when 'pago'                 then array['aguardando_endereco','aguardando_etiqueta','cancelado']
    when 'aguardando_endereco'  then array['aguardando_etiqueta','cancelado']
    when 'aguardando_etiqueta'  then array['etiqueta_gerada','cancelado']
    when 'etiqueta_gerada'      then array['postado','cancelado']
    when 'postado'              then array['em_transito','entregue','problema']
    when 'em_transito'          then array['saiu_entrega','entregue','problema']
    when 'saiu_entrega'         then array['entregue','problema']
    when 'entregue'             then array['pos_venda']
    when 'problema'             then array['em_transito','entregue','cancelado']
    when 'pos_venda'            then array[]::text[]
    when 'cancelado'            then array[]::text[]
    else array[]::text[]
  end;

  -- Override administrativo: a API (service role) pode setar, na MESMA
  -- transação, `select set_config('app.allow_invalid_transition','on',true)`
  -- antes do UPDATE. É transacional (não persiste) e fica na auditoria.
  if coalesce(current_setting('app.allow_invalid_transition', true), 'off') = 'on' then
    return new;
  end if;

  if not (new.status = any(allowed)) then
    raise exception 'Transição de pedido inválida: % -> % (permitidas: %)',
      old.status, new.status, allowed;
  end if;
  return new;
end $$;

create trigger trg_order_transition before update of status on public.orders
  for each row execute function public.enforce_order_transition();
