-- =====================================================================
-- full_setup.sql — BANCO COMPLETO do CRM Ateliê da Lili (Fases 1a–1c + 6+7)
-- Gerado automaticamente juntando as migrations 0001..0009 NA ORDEM.
-- COMO USAR: no Supabase, abra SQL Editor > New query, cole TUDO e clique Run.
-- Rode UMA vez, em um projeto NOVO/vazio. (Reexecutar dá erro de 'já existe'.)
-- =====================================================================


-- ####################################################################
-- ## migrations/0001_init.sql
-- ####################################################################

-- =====================================================================
-- 0001_init.sql — Extensões, helpers, papéis e usuários (equipe)
-- Alvo: Postgres (Supabase). Fonte da verdade do banco (§55, §35, §36).
-- =====================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;      -- e-mail case-insensitive
create extension if not exists pg_trgm;     -- busca fuzzy por nome (gin_trgm_ops)

-- Trigger genérico de updated_at ------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- EQUIPE (usuários internos). Estende auth.users do Supabase.
-- O login/sessão é do Supabase Auth; aqui ficam os dados de perfil.
-- ---------------------------------------------------------------------
create table public.staff (
  id           uuid primary key references auth.users(id) on delete cascade,
  name         text not null,
  email        citext unique,
  phone        text,
  avatar_url   text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_staff_updated before update on public.staff
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- PAPÉIS e PERMISSÕES (§36). Papéis-base: ADMIN, ATENDENTE, EXPEDICAO,
-- FINANCEIRO. Um membro pode ter mais de um papel. Permissões granulares
-- por papel dão flexibilidade sem mexer no código.
-- ---------------------------------------------------------------------
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,        -- 'admin' | 'atendente' | 'expedicao' | 'financeiro'
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.permissions (
  key         text primary key,            -- ex: 'orders.read', 'labels.generate'
  description text not null
);

create table public.role_permissions (
  role_id        uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.staff_roles (
  staff_id   uuid not null references public.staff(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  primary key (staff_id, role_id)
);

-- Seed dos papéis-base ---------------------------------------------------------
insert into public.roles (key, name, description, is_system) values
  ('admin',      'Administrador', 'Acesso total ao sistema',                 true),
  ('atendente',  'Atendente',     'Conversas, leads e criação de pedidos',   true),
  ('expedicao',  'Expedição',     'Frete, etiquetas, rastreio e expedição',  true),
  ('financeiro', 'Financeiro',    'Pagamentos, reembolsos e relatórios',     true);

-- Seed do catálogo de permissões (chaves usadas pela API e pela RLS) -----------
insert into public.permissions (key, description) values
  ('customers.read',   'Ver clientes'),
  ('customers.write',  'Criar/editar clientes'),
  ('customers.cpf',    'Ver CPF completo (dado sensível)'),
  ('products.read',    'Ver produtos'),
  ('products.write',   'Criar/editar produtos e preços'),
  ('orders.read',      'Ver pedidos'),
  ('orders.write',     'Criar/editar pedidos'),
  ('orders.cancel',    'Cancelar pedidos'),
  ('payments.read',    'Ver pagamentos'),
  ('payments.refund',  'Emitir reembolso'),
  ('conversations.read',  'Ver conversas'),
  ('conversations.write', 'Responder conversas'),
  ('shipping.quote',   'Cotar frete'),
  ('labels.generate',  'Gerar etiqueta'),
  ('labels.read',      'Ver/imprimir etiquetas'),
  ('automations.read', 'Ver automações'),
  ('automations.write','Editar automações'),
  ('campaigns.write',  'Criar/enviar campanhas'),
  ('ai.configure',     'Configurar IA e base de conhecimento'),
  ('settings.write',   'Alterar configurações do sistema'),
  ('audit.read',       'Ver trilha de auditoria');

-- ADMIN recebe todas as permissões
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p where r.key = 'admin';

-- ATENDENTE: conversas, clientes, produtos (leitura), pedidos, cotação de frete
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['customers.read','customers.write','products.read','orders.read',
               'orders.write','conversations.read','conversations.write','shipping.quote']) k
where r.key = 'atendente';

-- EXPEDIÇÃO: pedidos (leitura), frete, etiquetas, rastreio
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['orders.read','shipping.quote','labels.generate','labels.read',
               'customers.read','products.read']) k
where r.key = 'expedicao';

-- FINANCEIRO: pagamentos, reembolsos, pedidos (leitura), auditoria
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['payments.read','payments.refund','orders.read','audit.read','customers.read']) k
where r.key = 'financeiro';

-- ---------------------------------------------------------------------
-- Helper de permissão (usado na RLS e pela API). SECURITY DEFINER para
-- poder ler as tabelas de papéis independentemente da RLS do chamador.
-- ---------------------------------------------------------------------
create or replace function public.auth_has_permission(perm text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.staff_roles sr
    join public.role_permissions rp on rp.role_id = sr.role_id
    where sr.staff_id = auth.uid()
      and rp.permission_key = perm
  );
$$;

create or replace function public.auth_is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where id = auth.uid() and is_active);
$$;

-- ####################################################################
-- ## migrations/0002_customers_catalog.sql
-- ####################################################################

-- =====================================================================
-- 0002_customers_catalog.sql — Clientes, endereços, tags, notas,
-- produtos, variações, adicionais e estoque (§3, §11, §31, §61)
-- =====================================================================

-- ---------------------------------------------------------------------
-- TAGS / ETIQUETAS (§31) — reutilizadas por clientes, conversas e leads
-- ---------------------------------------------------------------------
create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  color      text not null default '#c9836a',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- CLIENTES (§3)
-- ---------------------------------------------------------------------
create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  phone              text,                       -- telefone principal (E.164 sem +, ex: 5599...)
  whatsapp           text,                       -- pode diferir do telefone
  email              citext,
  document           text,                       -- CPF/CNPJ (somente dígitos). Mascarado por RLS/coluna.
  birth_date         date,
  origin             text,                       -- §42: whatsapp|instagram|anuncio|catalogo|link|indicacao|manual
  utm                jsonb,                      -- parâmetros UTM quando houver
  owner_id           uuid references public.staff(id) on delete set null,  -- responsável
  status             text not null default 'ativo',
  do_not_contact     boolean not null default false,  -- opt-out (§49)
  notes_summary      text,                       -- observações livres
  first_contact_at   timestamptz default now(),
  last_interaction_at timestamptz,
  -- métricas materializadas (recalculadas por trigger/job — evita recomputo caro)
  total_spent        numeric(12,2) not null default 0,
  orders_count       integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index idx_customers_phone    on public.customers(phone);
create index idx_customers_whatsapp on public.customers(whatsapp);
create index idx_customers_owner    on public.customers(owner_id);
create index idx_customers_name_trgm on public.customers using gin (name gin_trgm_ops);
create trigger trg_customers_updated before update on public.customers
  for each row execute function public.set_updated_at();

-- Múltiplos endereços por cliente (§3)
create table public.customer_addresses (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  label       text,                     -- "Casa", "Trabalho"
  recipient   text,                     -- destinatário (pode diferir do cliente)
  cep         text,
  street      text,
  number      text,
  complement  text,
  district    text,                     -- bairro
  city        text,
  state       text,                     -- UF
  reference   text,                     -- ponto de referência
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_addresses_customer on public.customer_addresses(customer_id);
create trigger trg_addresses_updated before update on public.customer_addresses
  for each row execute function public.set_updated_at();

create table public.customer_tags (
  customer_id uuid not null references public.customers(id) on delete cascade,
  tag_id      uuid not null references public.tags(id) on delete cascade,
  primary key (customer_id, tag_id)
);

-- Notas / histórico manual por cliente (§3)
create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  author_id   uuid references public.staff(id) on delete set null,
  body        text not null,
  created_at  timestamptz not null default now()
);
create index idx_notes_customer on public.notes(customer_id);

-- Memória estruturada da IA por cliente (§61) — fatos curtos, não sensíveis
create table public.ai_customer_memory (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  key         text not null,             -- ex: 'procura', 'preferencia'
  value       text not null,             -- ex: 'saída para menina', 'gosta de personalização'
  confidence  numeric(3,2) default 0.8,
  created_at  timestamptz not null default now(),
  unique (customer_id, key)
);

-- ---------------------------------------------------------------------
-- PRODUTOS (§11). Migra o modelo de ../js/products.js para o banco.
-- Preços em numeric (reais). Peso/dimensões alimentam a Frenet (§16).
-- ---------------------------------------------------------------------
create table public.products (
  id            uuid primary key default gen_random_uuid(),
  sku           text unique,
  name          text not null,
  slug          text unique,
  category      text,                    -- menina|menino|luxo|manta|... (multivalor em product_categories abaixo)
  description   text,
  price_cash    numeric(12,2),           -- preço à vista
  price_card    numeric(12,2),           -- preço no cartão
  installments_max integer default 6,
  original_price numeric(12,2),          -- preço "de" (riscado)
  weight_kg     numeric(8,3),            -- peso p/ frete
  length_cm     numeric(8,2),
  width_cm      numeric(8,2),
  height_cm     numeric(8,2),
  status        text not null default 'ativo',  -- ativo|inativo|esgotado|oculto
  images        jsonb not null default '[]',    -- ["images/menina/g001-1.jpg", ...]
  videos        jsonb not null default '[]',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_products_status on public.products(status);
create trigger trg_products_updated before update on public.products
  for each row execute function public.set_updated_at();

-- Categorias/atributos multivalorados (sexo/tema) — filtro da IA (§64)
create table public.product_categories (
  product_id uuid not null references public.products(id) on delete cascade,
  category   text not null,             -- 'menina','menino','unissex','luxo','manta','cueiro'...
  primary key (product_id, category)
);

-- Variações: tamanho / cor / sexo (§11)
create table public.product_variants (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  sku          text unique,
  size         text,                    -- RN, P, M...
  color        text,
  gender       text,                    -- menina|menino|unissex
  price_delta  numeric(12,2) not null default 0,   -- ajuste sobre o preço-base
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);
create index idx_variants_product on public.product_variants(product_id);

-- Adicionais/personalizações (§11) — ex: "Bordar nome" R$ 19,90
create table public.product_addons (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid references public.products(id) on delete cascade,  -- null = adicional global
  name        text not null,
  price       numeric(12,2) not null default 0,
  requires_text boolean not null default false,   -- ex: precisa do nome do bebê
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index idx_addons_product on public.product_addons(product_id);

-- Estoque (§11) — por produto ou por variação
create table public.inventory (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid references public.products(id) on delete cascade,
  variant_id  uuid references public.product_variants(id) on delete cascade,
  quantity    integer not null default 0,
  reserved    integer not null default 0,          -- reservado em pedidos-rascunho
  updated_at  timestamptz not null default now(),
  check (product_id is not null or variant_id is not null)
);
create unique index idx_inventory_variant on public.inventory(variant_id) where variant_id is not null;
create unique index idx_inventory_product on public.inventory(product_id) where variant_id is null;
create trigger trg_inventory_updated before update on public.inventory
  for each row execute function public.set_updated_at();

-- ####################################################################
-- ## migrations/0003_crm_core.sql
-- ####################################################################

-- =====================================================================
-- 0003_crm_core.sql — Funil (pipelines/etapas/leads) e Inbox
-- (conversas/mensagens) (§4, §10, §46, §60)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PIPELINES e ETAPAS (§10) — kanban. Etapas configuráveis.
-- ---------------------------------------------------------------------
create table public.pipelines (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  key         text not null,             -- 'novo','primeiro_contato',...
  name        text not null,
  position    integer not null default 0,
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  color       text,
  unique (pipeline_id, key)
);
create index idx_stages_pipeline on public.pipeline_stages(pipeline_id, position);

-- Seed do funil padrão (§10)
insert into public.pipelines (id, name, is_default)
values ('00000000-0000-0000-0000-0000000000f1', 'Funil de vendas', true);

insert into public.pipeline_stages (pipeline_id, key, name, position, is_won, is_lost) values
  ('00000000-0000-0000-0000-0000000000f1','novo','Novo lead',0,false,false),
  ('00000000-0000-0000-0000-0000000000f1','primeiro_contato','Primeiro contato',1,false,false),
  ('00000000-0000-0000-0000-0000000000f1','interessado','Interessado',2,false,false),
  ('00000000-0000-0000-0000-0000000000f1','produto_escolhido','Produto escolhido',3,false,false),
  ('00000000-0000-0000-0000-0000000000f1','orcamento_enviado','Orçamento enviado',4,false,false),
  ('00000000-0000-0000-0000-0000000000f1','aguardando_pagamento','Aguardando pagamento',5,false,false),
  ('00000000-0000-0000-0000-0000000000f1','pago','Pago',6,false,false),
  ('00000000-0000-0000-0000-0000000000f1','aguardando_endereco','Aguardando endereço',7,false,false),
  ('00000000-0000-0000-0000-0000000000f1','aguardando_expedicao','Aguardando expedição',8,false,false),
  ('00000000-0000-0000-0000-0000000000f1','enviado','Enviado',9,false,false),
  ('00000000-0000-0000-0000-0000000000f1','entregue','Entregue',10,false,false),
  ('00000000-0000-0000-0000-0000000000f1','pos_venda','Pós-venda',11,true,false),
  ('00000000-0000-0000-0000-0000000000f1','perdido','Perdido',12,false,true);

-- ---------------------------------------------------------------------
-- LEADS (§10) — oportunidade de venda. Vinculado a um cliente (opcional
-- no primeiro contato) e a uma etapa do funil.
-- ---------------------------------------------------------------------
create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid references public.customers(id) on delete set null,
  pipeline_id  uuid not null references public.pipelines(id) on delete restrict,
  stage_id     uuid not null references public.pipeline_stages(id) on delete restrict,
  title        text,
  interest     text,                     -- ex: 'saída para menina'
  value        numeric(12,2),
  origin       text,
  owner_id     uuid references public.staff(id) on delete set null,
  next_followup_at timestamptz,          -- §26 follow-up agendado
  position     integer not null default 0,  -- ordem dentro da coluna do kanban
  won_at       timestamptz,
  lost_at      timestamptz,
  lost_reason  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_leads_stage    on public.leads(stage_id, position);
create index idx_leads_customer  on public.leads(customer_id);
create index idx_leads_followup  on public.leads(next_followup_at);
create trigger trg_leads_updated before update on public.leads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- CONVERSAS (§4). Uma por canal+contato. Estado da IA por conversa (§46).
-- ---------------------------------------------------------------------
create table public.conversations (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid references public.customers(id) on delete set null,
  channel       text not null default 'whatsapp',
  external_id   text,                    -- id/telefone do contato no WaScript
  assignee_id   uuid references public.staff(id) on delete set null,
  status        text not null default 'aberta',   -- aberta|pendente|resolvida
  ai_state      text not null default 'ativa',    -- ativa|pausada|humano|transferida (§46)
  priority      text not null default 'normal',   -- baixa|normal|alta
  unread_count  integer not null default 0,
  last_message_at   timestamptz,
  last_message_preview text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index idx_conv_channel_external on public.conversations(channel, external_id)
  where external_id is not null;
create index idx_conv_assignee on public.conversations(assignee_id);
create index idx_conv_status   on public.conversations(status, last_message_at desc);
create trigger trg_conv_updated before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.conversation_tags (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  tag_id          uuid not null references public.tags(id) on delete cascade,
  primary key (conversation_id, tag_id)
);

-- ---------------------------------------------------------------------
-- MENSAGENS (§4). Histórico persistente. direction: in|out. type cobre
-- os formatos suportados (texto, imagem, áudio, doc, localização).
-- ---------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  external_id     text,                  -- id da mensagem no WaScript (dedupe/idempotência)
  direction       text not null,         -- 'in' (recebida) | 'out' (enviada)
  sender          text not null default 'customer',  -- customer|human|ai|automation|system
  sender_staff_id uuid references public.staff(id) on delete set null,
  type            text not null default 'text',      -- text|image|video|audio|document|location
  body            text,                  -- texto/legenda
  media_url       text,                  -- URL no Storage
  media_mime      text,
  payload         jsonb,                 -- dados crus do provedor (localização, etc.)
  status          text not null default 'received',  -- received|queued|sent|delivered|read|failed
  error           text,
  created_at      timestamptz not null default now()
);
create unique index idx_messages_external on public.messages(external_id) where external_id is not null;
create index idx_messages_conv on public.messages(conversation_id, created_at);

-- ####################################################################
-- ## migrations/0004_orders_shipping.sql
-- ####################################################################

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

-- ####################################################################
-- ## migrations/0005_automation_ai.sql
-- ####################################################################

-- =====================================================================
-- 0005_automation_ai.sql — Automações (grafo), campanhas, tarefas,
-- base de conhecimento e configurações da IA (§7, §8, §23, §28, §32)
-- =====================================================================

-- ---------------------------------------------------------------------
-- AUTOMAÇÕES (§23) — modelo de GRAFO (nós + arestas), compatível com o
-- motor isomórfico ../crm/js/flow-graph.js (será movido p/ packages/shared).
-- ---------------------------------------------------------------------
create table public.automations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  trigger     jsonb not null default '{}',   -- {type:'keyword'|'new_conversation'|'stage'|'manual', ...}
  is_active   boolean not null default false,
  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_automations_updated before update on public.automations
  for each row execute function public.set_updated_at();

create table public.automation_nodes (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  node_key      text not null,          -- id do nó dentro do grafo
  type          text not null,          -- message|image|condition|wait|ai|ask|action|... (NODE_DEFS)
  data          jsonb not null default '{}',
  pos_x         real not null default 0,
  pos_y         real not null default 0,
  unique (automation_id, node_key)
);

create table public.automation_edges (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  source_key    text not null,
  target_key    text not null,
  handle        text,                   -- ramo (ex: opção do menu / sim/não da condição)
  unique (automation_id, source_key, target_key, handle)
);

-- Execuções (§39, §47) — estado de cada rodada + proteção contra loop
create table public.automation_runs (
  id             uuid primary key default gen_random_uuid(),
  automation_id  uuid not null references public.automations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_id    uuid references public.customers(id) on delete set null,
  current_node   text,
  session        jsonb not null default '{}',   -- variáveis/contexto da sessão
  status         text not null default 'running',  -- running|waiting|done|error|stopped
  steps_count    integer not null default 0,       -- limite anti-loop (§47)
  next_wake_at   timestamptz,                       -- p/ nós de espera (§26)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_runs_wake on public.automation_runs(next_wake_at) where status = 'waiting';
create trigger trg_runs_updated before update on public.automation_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- CAMPANHAS (§28) — segmentadas, com variáveis. Respeitam opt-out (§49).
-- ---------------------------------------------------------------------
create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  template    text not null,            -- mensagem com {{variaveis}}
  filters     jsonb not null default '{}',  -- segmentação (cidade, tag, etapa, etc.)
  status      text not null default 'rascunho',  -- rascunho|agendada|enviando|concluida|cancelada
  scheduled_at timestamptz,
  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_campaigns_updated before update on public.campaigns
  for each row execute function public.set_updated_at();

create table public.campaign_messages (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  rendered    text,
  status      text not null default 'pendente',  -- pendente|enviada|falhou|pulada(optout)
  error       text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_campmsg_campaign on public.campaign_messages(campaign_id, status);

-- ---------------------------------------------------------------------
-- TAREFAS (§32) — para a equipe.
-- ---------------------------------------------------------------------
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  assignee_id uuid references public.staff(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  order_id    uuid references public.orders(id) on delete set null,
  priority    text not null default 'normal',   -- baixa|normal|alta
  status      text not null default 'aberta',   -- aberta|fazendo|concluida
  due_at      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_tasks_assignee on public.tasks(assignee_id, status);
create trigger trg_tasks_updated before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- BASE DE CONHECIMENTO da IA (§7) — a IA consulta ANTES de responder.
-- ---------------------------------------------------------------------
create table public.knowledge_base (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,            -- produtos|precos|pagamentos|fretes|prazos|trocas|faq|empresa|scripts
  title       text not null,
  content     text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_kb_category on public.knowledge_base(category) where is_active;
create trigger trg_kb_updated before update on public.knowledge_base
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- CONFIGURAÇÕES da IA (§8) — singleton (uma linha). Regras/limites.
-- ---------------------------------------------------------------------
create table public.ai_settings (
  id              boolean primary key default true check (id),  -- garante 1 linha
  agent_name      text not null default 'Lili',
  persona         text,                 -- personalidade/tom
  formality       text default 'cordial',
  business_hours  jsonb not null default '{}',
  handoff_rules   jsonb not null default '{}',   -- quando transferir p/ humano
  forbidden_topics jsonb not null default '[]',
  max_discount_pct numeric(5,2) not null default 0,
  allowed_products jsonb not null default 'null',
  -- ferramentas críticas que a IA pode executar SEM humano (default: nenhuma) (§58)
  enabled_critical_tools jsonb not null default '[]',
  updated_at      timestamptz not null default now()
);
insert into public.ai_settings (id) values (true) on conflict do nothing;
create trigger trg_aisettings_updated before update on public.ai_settings
  for each row execute function public.set_updated_at();

-- ####################################################################
-- ## migrations/0006_infra.sql
-- ####################################################################

-- =====================================================================
-- 0006_infra.sql — Webhooks, logs de integração, auditoria, notificações,
-- idempotência, fila (jobs) e aprovações (§34, §37, §38, §39, §40, §66)
-- =====================================================================

-- ---------------------------------------------------------------------
-- IDEMPOTÊNCIA (§37) — evita duplicidade em etiqueta, pagamento, mensagem,
-- pedido e webhook. A API grava a chave ANTES de executar a operação.
-- ---------------------------------------------------------------------
create table public.idempotency_keys (
  key         text primary key,         -- ex: 'label:order:<uuid>' ou hash do webhook
  scope       text not null,            -- 'label'|'payment'|'message'|'order'|'webhook'
  result      jsonb,                    -- resposta memorizada p/ repetir sem reexecutar
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- WEBHOOKS (§38) — registra todo evento recebido (wascript/frenet/payment)
-- com payload, data, processamento e erro. Base p/ retry seguro.
-- ---------------------------------------------------------------------
create table public.webhooks (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,           -- 'wascript'|'frenet'|'payment'
  event        text,
  payload      jsonb not null default '{}',
  headers      jsonb,
  processed    boolean not null default false,
  processed_at timestamptz,
  attempts     integer not null default 0,
  error        text,
  created_at   timestamptz not null default now()
);
create index idx_webhooks_unprocessed on public.webhooks(source, created_at) where not processed;

-- ---------------------------------------------------------------------
-- LOGS DE INTEGRAÇÃO (§40) — estruturados por categoria. NÃO gravar
-- tokens/dados sensíveis desnecessários (a API sanitiza antes de gravar).
-- ---------------------------------------------------------------------
create table public.integration_logs (
  id         uuid primary key default gen_random_uuid(),
  category   text not null,             -- AI|WHATSAPP|FRENET|PAYMENT|WEBHOOK|AUTOMATION|ERROR
  level      text not null default 'info',   -- info|warn|error
  message    text not null,
  context    jsonb,
  created_at timestamptz not null default now()
);
create index idx_intlogs_category on public.integration_logs(category, created_at desc);

-- ---------------------------------------------------------------------
-- AUDITORIA (§34) — quem alterou, o quê, quando, valor antigo/novo.
-- Especial p/ preço, desconto, pagamento, endereço, frete, etiqueta,
-- cancelamento. Preenchida pela API (não por trigger genérico, p/ manter
-- o "quem" = usuário autenticado da requisição).
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.staff(id) on delete set null,
  action      text not null,            -- 'update'|'create'|'delete'|'approve'|...
  entity      text not null,            -- 'order'|'payment'|'product'|'address'|'label'...
  entity_id   text,
  old_value   jsonb,
  new_value   jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);
create index idx_audit_entity on public.audit_logs(entity, entity_id, created_at desc);

-- ---------------------------------------------------------------------
-- NOTIFICAÇÕES INTERNAS (§33) — para a equipe.
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid references public.staff(id) on delete cascade,  -- null = broadcast
  type        text not null,            -- ai_needs_help|human_requested|payment_ok|address_invalid|label_ready|frenet_error|...
  title       text not null,
  body        text,
  link        text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index idx_notifications_staff on public.notifications(staff_id, is_read, created_at desc);

-- ---------------------------------------------------------------------
-- CONFIG DE NOTIFICAÇÕES AO CLIENTE (§22) — liga/desliga cada mensagem
-- automática. Anti-duplicidade via sent_customer_notifications abaixo.
-- ---------------------------------------------------------------------
create table public.customer_notification_settings (
  key        text primary key,          -- 'payment_confirmed'|'order_confirmed'|'shipped'|'tracking'|'out_for_delivery'|'delivered'
  label      text not null,
  template   text not null,
  is_enabled boolean not null default true
);
insert into public.customer_notification_settings (key, label, template) values
  ('payment_confirmed','Pagamento confirmado','Oi {{nome}}! Recebemos seu pagamento do pedido #{{pedido}} 💛'),
  ('order_confirmed','Pedido confirmado','Seu pedido #{{pedido}} foi confirmado e já entrou na fila de produção.'),
  ('in_production','Pedido em produção','Boas notícias, {{nome}}! Seu pedido #{{pedido}} está sendo preparado com carinho.'),
  ('shipped','Pedido enviado','Seu pedido #{{pedido}} foi enviado! 🚚'),
  ('tracking','Código de rastreio','Rastreio do pedido #{{pedido}}: {{rastreio}}'),
  ('out_for_delivery','Saiu para entrega','Seu pedido #{{pedido}} saiu para entrega hoje! 🎉'),
  ('delivered','Pedido entregue','Seu pedido #{{pedido}} foi entregue. Esperamos que ame! 💛')
on conflict do nothing;

-- Registro do que já foi enviado (anti-duplicidade §22/§48)
create table public.sent_customer_notifications (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references public.orders(id) on delete cascade,
  key         text not null,
  sent_at     timestamptz not null default now(),
  unique (order_id, key)
);

-- ---------------------------------------------------------------------
-- FILA / JOBS (§39) — operações demoradas (IA, envio, etiqueta, campanha,
-- tracking) processadas fora da requisição. Netlify Scheduled Functions
-- ou pg_cron consomem esta fila.
-- ---------------------------------------------------------------------
create table public.jobs (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,           -- 'send_message'|'ai_reply'|'generate_label'|'campaign_send'|'track_update'
  payload      jsonb not null default '{}',
  status       text not null default 'queued',  -- queued|running|done|failed
  run_after    timestamptz not null default now(),
  attempts     integer not null default 0,
  max_attempts integer not null default 5,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_jobs_ready on public.jobs(run_after) where status = 'queued';
create trigger trg_jobs_updated before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- APROVAÇÕES HUMANAS (§66) — etiqueta, desconto, cancelamento, reembolso.
-- Registra quem aprovou e quando.
-- ---------------------------------------------------------------------
create table public.approvals (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,           -- 'label'|'discount'|'cancel'|'refund'|'price_change'
  entity       text,                    -- 'order'|'payment'
  entity_id    text,
  requested_by text,                    -- 'ai' | staff_id
  payload      jsonb not null default '{}',
  status       text not null default 'pendente',  -- pendente|aprovado|rejeitado
  decided_by   uuid references public.staff(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index idx_approvals_pending on public.approvals(status, created_at) where status = 'pendente';

-- ####################################################################
-- ## migrations/0007_rls.sql
-- ####################################################################

-- =====================================================================
-- 0007_rls.sql — Row Level Security (§35, §36, §43)
-- Modelo de acesso:
--  • Escritas passam pela API (Netlify Functions) usando a SERVICE ROLE
--    key, que ignora RLS — lá ficam as checagens de permissão + auditoria.
--  • O app React lê via ANON key + JWT do usuário. RLS abaixo controla o
--    que cada membro da equipe consegue LER (inclui Realtime).
--  • Sem política de INSERT/UPDATE/DELETE = negado por padrão para o
--    frontend. Isso é intencional: nada de escrita direta do navegador.
--  • Mascaramento de CPF (§43) é feito na API conforme 'customers.cpf'
--    (RLS é por linha, não por coluna).
-- =====================================================================

-- Habilita RLS em todas as tabelas do schema public -----------------------------
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;

-- Perfil próprio (não-recursivo: os helpers de permissão dependem desta
-- leitura, então ela NÃO pode chamar auth_has_permission). A visão de
-- "admin lê todos os membros" é servida pela API (service role).
create policy staff_self_read on public.staff
  for select using (id = auth.uid());

create policy staff_self_update on public.staff
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Tabelas de referência de papéis: qualquer staff ativo lê --------------------
create policy roles_read       on public.roles            for select using (public.auth_is_staff());
create policy perms_read       on public.permissions      for select using (public.auth_is_staff());
create policy roleperm_read    on public.role_permissions for select using (public.auth_is_staff());
create policy staffroles_read  on public.staff_roles      for select using (public.auth_is_staff());

-- Helper macro via política: leitura por permissão -----------------------------
-- CLIENTES / ENDEREÇOS / TAGS / NOTAS
create policy customers_read on public.customers
  for select using (public.auth_has_permission('customers.read'));
create policy addresses_read on public.customer_addresses
  for select using (public.auth_has_permission('customers.read'));
create policy custtags_read on public.customer_tags
  for select using (public.auth_has_permission('customers.read'));
create policy tags_read on public.tags
  for select using (public.auth_is_staff());
create policy notes_read on public.notes
  for select using (public.auth_has_permission('customers.read'));
create policy aimem_read on public.ai_customer_memory
  for select using (public.auth_has_permission('customers.read'));

-- CATÁLOGO
create policy products_read on public.products
  for select using (public.auth_has_permission('products.read'));
create policy prodcat_read on public.product_categories
  for select using (public.auth_has_permission('products.read'));
create policy variants_read on public.product_variants
  for select using (public.auth_has_permission('products.read'));
create policy addons_read on public.product_addons
  for select using (public.auth_has_permission('products.read'));
create policy inventory_read on public.inventory
  for select using (public.auth_has_permission('products.read'));

-- FUNIL
create policy pipelines_read on public.pipelines
  for select using (public.auth_is_staff());
create policy stages_read on public.pipeline_stages
  for select using (public.auth_is_staff());
create policy leads_read on public.leads
  for select using (public.auth_is_staff());

-- INBOX
create policy conversations_read on public.conversations
  for select using (public.auth_has_permission('conversations.read'));
create policy convtags_read on public.conversation_tags
  for select using (public.auth_has_permission('conversations.read'));
create policy messages_read on public.messages
  for select using (public.auth_has_permission('conversations.read'));

-- PEDIDOS / FRETE / ENVIO
create policy orders_read on public.orders
  for select using (public.auth_has_permission('orders.read'));
create policy orderitems_read on public.order_items
  for select using (public.auth_has_permission('orders.read'));
create policy quotes_read on public.shipping_quotes
  for select using (public.auth_has_permission('orders.read'));
create policy shipments_read on public.shipments
  for select using (public.auth_has_permission('orders.read') or public.auth_has_permission('labels.read'));
create policy labels_read on public.shipping_labels
  for select using (public.auth_has_permission('labels.read'));
create policy tracking_read on public.tracking_events
  for select using (public.auth_has_permission('orders.read'));

-- PAGAMENTOS (sensível — só quem tem payments.read)
create policy payments_read on public.payments
  for select using (public.auth_has_permission('payments.read'));

-- AUTOMAÇÕES
create policy automations_read on public.automations
  for select using (public.auth_has_permission('automations.read'));
create policy autonodes_read on public.automation_nodes
  for select using (public.auth_has_permission('automations.read'));
create policy autoedges_read on public.automation_edges
  for select using (public.auth_has_permission('automations.read'));
create policy autoruns_read on public.automation_runs
  for select using (public.auth_has_permission('automations.read'));

-- CAMPANHAS / TAREFAS / KB / IA
create policy campaigns_read on public.campaigns
  for select using (public.auth_is_staff());
create policy campmsg_read on public.campaign_messages
  for select using (public.auth_is_staff());
create policy tasks_read on public.tasks
  for select using (public.auth_is_staff());
create policy kb_read on public.knowledge_base
  for select using (public.auth_is_staff());
create policy aisettings_read on public.ai_settings
  for select using (public.auth_is_staff());

-- INFRA
create policy notifications_read on public.notifications
  for select using (staff_id = auth.uid() or staff_id is null);
create policy custnotif_read on public.customer_notification_settings
  for select using (public.auth_is_staff());
create policy approvals_read on public.approvals
  for select using (public.auth_is_staff());
create policy audit_read on public.audit_logs
  for select using (public.auth_has_permission('audit.read'));
create policy intlogs_read on public.integration_logs
  for select using (public.auth_has_permission('audit.read'));

-- (webhooks, jobs, idempotency_keys, sent_customer_notifications ficam SEM
--  política = invisíveis ao frontend. Só a SERVICE ROLE os acessa.)

-- ####################################################################
-- ## migrations/0008_api_helpers.sql
-- ####################################################################

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

-- ####################################################################
-- ## migrations/0009_shipping_frenet.sql
-- ####################################################################

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
