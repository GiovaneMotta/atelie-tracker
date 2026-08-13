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
