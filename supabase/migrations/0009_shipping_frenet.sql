-- =====================================================================
-- 0009_shipping_frenet.sql — Módulo de Expedição / Frenet (Fases 6+7)
--
-- Objetivo (pedido do usuário): cotação real, confirmação, geração de
-- etiqueta (OneClick), reimpressão, rastreio e webhook — de forma ENXUTA
-- e utilizável no dia a dia, SEM depender do fluxo completo de pedido/CRM,
-- mas mantendo compatibilidade com ele (o envio PODE ou NÃO ter order_id).
--
-- Estratégia: ESTENDER as tabelas já criadas na 0004 (shipments,
-- shipping_quotes, shipping_labels, tracking_events) em vez de duplicar,
-- e acrescentar shipment_items, shipment_volumes e app_settings.
-- Idempotência/lock de etiqueta (§17) reaproveitam idempotency_keys (0006).
--
-- Cobre: §5 (config), §12 (seleção), §17 (anti-duplicidade), §18 (status),
-- §19 (etiqueta), §25 (tracking), §29 (múltiplos volumes), §30 (banco).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) ENVIO STANDALONE — o envio deixa de exigir um pedido do CRM.
--    Todos os dados necessários para postar ficam no próprio envio
--    (snapshot), para o módulo de expedição funcionar sozinho (§7, §42).
-- ---------------------------------------------------------------------
alter table public.shipments
  alter column order_id drop not null;

alter table public.shipments
  -- Snapshot do destinatário e do remetente no momento do envio (§8, §14).
  add column if not exists recipient      jsonb,               -- {name, document, phone, email, cep, street, number, complement, district, city, state, reference}
  add column if not exists sender         jsonb,               -- remetente usado na postagem (ou null se UseFrenetRegistration)
  -- Dados logísticos escolhidos (§12) — vindos DA Frenet, nunca inventados.
  add column if not exists service_code   text,                -- ShippingServiceCode (identificador de serviço postável §13)
  add column if not exists service_name   text,                -- ShippingServiceName
  add column if not exists carrier_code   text,                -- CarrierCode
  add column if not exists declared_value numeric(12,2),       -- valor declarado da mercadoria
  add column if not exists weight_kg      numeric(8,3),        -- peso total consolidado
  add column if not exists delivery_days  integer,             -- prazo estimado (dias) retornado na cotação
  -- Retorno da Frenet na geração/consulta (§19).
  add column if not exists frenet_status  integer,             -- ShipmentStatus numérico da Frenet (1..18)
  add column if not exists label_url      text,                -- LabelUrl
  add column if not exists declaration_url text,               -- DeclarationUrl (declaração de conteúdo)
  add column if not exists tracking_url   text,                -- TrackingUrl
  add column if not exists label_format   text default 'A4',   -- §20 (A4 é o padrão documentado)
  add column if not exists valid_through  timestamptz,         -- validade da etiqueta
  add column if not exists environment    text default 'homologacao',  -- ambiente em que o envio foi criado (§39)
  add column if not exists notes          text,
  add column if not exists checklist      jsonb not null default '{}',  -- §28 checklist de expedição
  add column if not exists last_error     text,                -- último erro amigável (não sensível)
  add column if not exists created_by     uuid references public.staff(id) on delete set null,
  -- Idempotência/lock da geração de etiqueta (§17). A chave forte fica em
  -- idempotency_keys; aqui guardamos o carimbo do lock para diagnóstico.
  add column if not exists generating_at  timestamptz;

-- Estados internos do envio (§18). Mantemos os já usados na 0004 e
-- acrescentamos os do fluxo enxuto de expedição. Coluna é text (flexível);
-- a API valida as transições (não há máquina rígida como no pedido).
--   rascunho | cotando | cotado | aguardando_confirmacao | gerando |
--   etiqueta_gerada | postado | em_transito | saiu_entrega | entregue |
--   problema | cancelado | erro
comment on column public.shipments.status is
  'rascunho|cotando|cotado|aguardando_confirmacao|gerando|etiqueta_gerada|postado|em_transito|saiu_entrega|entregue|problema|cancelado|erro (§18)';

create index if not exists idx_shipments_status_created on public.shipments(status, created_at desc);
create index if not exists idx_shipments_frenet on public.shipments(frenet_shipment_id) where frenet_shipment_id is not null;

-- ---------------------------------------------------------------------
-- 2) ITENS DO ENVIO (§29) — produtos/quantidades do envio. Snapshot de
--    nome/preço/peso/dimensões (o produto pode mudar depois).
-- ---------------------------------------------------------------------
create table if not exists public.shipment_items (
  id            uuid primary key default gen_random_uuid(),
  shipment_id   uuid not null references public.shipments(id) on delete cascade,
  product_id    uuid references public.products(id) on delete set null,
  name          text not null,                -- snapshot
  sku           text,
  quantity      integer not null default 1,
  unit_price    numeric(12,2) not null default 0,   -- snapshot do preço
  weight_kg     numeric(8,3),
  length_cm     numeric(8,2),
  width_cm      numeric(8,2),
  height_cm     numeric(8,2),
  created_at    timestamptz not null default now()
);
create index if not exists idx_shipment_items_shipment on public.shipment_items(shipment_id);

-- ---------------------------------------------------------------------
-- 3) VOLUMES DO ENVIO (§29) — a Frenet cota e posta por volume. Uma
--    primeira versão pode ter 1 volume, mas o banco suporta vários.
-- ---------------------------------------------------------------------
create table if not exists public.shipment_volumes (
  id             uuid primary key default gen_random_uuid(),
  shipment_id    uuid not null references public.shipments(id) on delete cascade,
  weight_kg      numeric(8,3) not null default 0,
  length_cm      numeric(8,2),
  width_cm       numeric(8,2),
  height_cm      numeric(8,2),
  declared_value numeric(12,2),
  quantity       integer not null default 1,
  frenet_volume_id  text,                     -- VolumeId retornado
  frenet_label_id   text,                     -- LabelId do volume (etiqueta por volume)
  created_at     timestamptz not null default now()
);
create index if not exists idx_shipment_volumes_shipment on public.shipment_volumes(shipment_id);

-- ---------------------------------------------------------------------
-- 4) COTAÇÕES — liga a cotação ao envio (mesmo sem pedido) e guarda o
--    SessionId/ambiente. As colunas base já existem na 0004.
-- ---------------------------------------------------------------------
alter table public.shipping_quotes
  add column if not exists shipment_id uuid references public.shipments(id) on delete cascade,
  add column if not exists provider    text not null default 'frenet',
  add column if not exists session_id  text,               -- SessionId do whitelabel /quotes
  add column if not exists environment text,
  add column if not exists recipient   jsonb;              -- snapshot p/ auditoria quando não há envio ainda
create index if not exists idx_quotes_shipment on public.shipping_quotes(shipment_id);

-- ---------------------------------------------------------------------
-- 5) EVENTOS DE RASTREIO — guardar o código original da Frenet (§25) e a
--    localização, além do status interno já existente.
-- ---------------------------------------------------------------------
alter table public.tracking_events
  add column if not exists event_code text,      -- EventType original da Frenet (0,1,2,5,9,18...)
  add column if not exists location   text,      -- EventLocation
  add column if not exists source     text not null default 'api';  -- 'api' | 'webhook'

-- ---------------------------------------------------------------------
-- 6) CONFIGURAÇÕES DO SISTEMA (§5) — apenas dados NÃO sensíveis.
--    Os TOKENS ficam SEMPRE em variáveis de ambiente (nunca aqui).
--    Guardamos: CEP de origem, ambiente, base URLs, formato de etiqueta,
--    caixa padrão e dados do remetente (para a postagem).
-- ---------------------------------------------------------------------
create table if not exists public.app_settings (
  key         text primary key,             -- ex: 'frenet'
  value       jsonb not null default '{}',
  updated_by  uuid references public.staff(id) on delete set null,
  updated_at  timestamptz not null default now()
);
create trigger trg_app_settings_updated before update on public.app_settings
  for each row execute function public.set_updated_at();

-- Seed de configuração Frenet (valores default seguros de homologação).
-- ambiente: 'homologacao' | 'producao'. Base URLs configuráveis por ambiente.
insert into public.app_settings (key, value) values
  ('frenet', jsonb_build_object(
     'environment', 'homologacao',
     'cep_origem', '',
     'label_format', 'A4',
     'use_frenet_registration', false,
     'box', jsonb_build_object('weight_kg', 0.5, 'length_cm', 30, 'width_cm', 25, 'height_cm', 10),
     'sender', jsonb_build_object(
        'name','', 'document','', 'phone','', 'email','',
        'cep','', 'street','', 'number','', 'complement','', 'district','', 'city','', 'state',''),
     'base_urls', jsonb_build_object(
        'whitelabel_prod', 'https://whitelabel.frenet.com.br/v1',
        'whitelabel_hml',  'https://whitelabel-hml.frenet.dev/v1',
        'quote',           'https://api.frenet.com.br')
   ))
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 7) PERMISSÕES (§36/§37) — novas chaves para o módulo de expedição.
--    Reusa as já existentes: shipping.quote, labels.generate, labels.read.
-- ---------------------------------------------------------------------
insert into public.permissions (key, description) values
  ('shipping.create',  'Criar envios e gerar postagem'),
  ('shipments.read',   'Ver envios e rastreio'),
  ('shipments.write',  'Editar envios (rascunho/checklist)'),
  ('shipments.cancel', 'Cancelar envios'),
  ('settings.read',    'Ver configurações do sistema')
on conflict (key) do nothing;

-- ADMIN recebe as novas permissões.
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['shipping.create','shipments.read','shipments.write','shipments.cancel','settings.read']) k
where r.key = 'admin'
on conflict do nothing;

-- EXPEDIÇÃO: opera todo o fluxo de frete/etiqueta/rastreio.
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['shipping.create','shipments.read','shipments.write','shipments.cancel','settings.read']) k
where r.key = 'expedicao'
on conflict do nothing;

-- ATENDENTE: pode cotar e ver envios (sem gerar/cancelar etiqueta).
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['shipments.read']) k
where r.key = 'atendente'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 8) RLS das novas tabelas (§35). Criadas DEPOIS da 0007, então habilitamos
--    aqui. Sem política de leitura = invisíveis ao frontend (anon): todo o
--    acesso passa pela API com service role. app_settings guarda o
--    remetente (semi-sensível) — idem, só service role.
-- ---------------------------------------------------------------------
alter table public.shipment_items   enable row level security;
alter table public.shipment_volumes enable row level security;
alter table public.app_settings     enable row level security;
