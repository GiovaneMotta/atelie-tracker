-- =============================================================
-- setup_operacao.sql — Producao + Calendario + Precificacao + Financeiro.
-- Cole INTEIRO no SQL Editor do Supabase e clique RUN (uma vez).
-- (Junta as migrations 0012, 0013 e 0014.)
-- =============================================================

-- >>>>> 0012_production.sql <<<<<

-- =====================================================================
-- 0012_production.sql — PRODUÇÃO POR SETORES (modelado no SOA).
-- Transforma pedidos em linha de produção: Fila → Tricô → Bordado →
-- Acabamento → Embalagem → Pronto p/ envio. Iniciar/Concluir/Devolver,
-- com histórico (quem/quando). Rode no SQL Editor do Supabase.
-- =====================================================================

-- Permissões (§36)
insert into public.permissions (key, description) values
  ('production.read',  'Ver produção'),
  ('production.write', 'Mover e editar a produção')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['production.read','production.write']) k
where r.key in ('admin','expedicao','atendente')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- SETORES (colunas da linha de produção) — customizáveis (nome/cor/ícone)
-- ---------------------------------------------------------------------
create table public.production_sectors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  color      text not null default '#c9836a',
  icon       text not null default '🧵',
  position   integer not null default 0,
  is_final   boolean not null default false,   -- último setor = pronto p/ expedição
  created_at timestamptz not null default now()
);
create index idx_sectors_pos on public.production_sectors(position);

insert into public.production_sectors (name, color, icon, position, is_final) values
  ('Fila',            '#7a6a61', '📋', 0, false),
  ('Tricô',           '#c9836a', '🧶', 1, false),
  ('Bordado',         '#9b7bb8', '🪡', 2, false),
  ('Acabamento',      '#7ba7bc', '✨', 3, false),
  ('Embalagem',       '#4b9e6b', '🎁', 4, false),
  ('Pronto p/ envio', '#d9a441', '📦', 5, true);

-- ---------------------------------------------------------------------
-- CARDS de produção — uma peça/pedido percorrendo os setores.
-- Campos custom por peça (§11/§65): nome do bebê, cor, tema, tamanho.
-- ---------------------------------------------------------------------
create table public.production_cards (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  title       text not null,
  sector_id   uuid references public.production_sectors(id) on delete set null,
  status      text not null default 'aguardando',  -- aguardando | em_andamento | concluido
  priority    text not null default 'normal',      -- baixa | normal | alta
  custom      jsonb not null default '{}',          -- {baby_name, color, theme, size, notes}
  due_at      timestamptz,
  position    integer not null default 0,
  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_pcards_sector on public.production_cards(sector_id, position);
create index idx_pcards_order  on public.production_cards(order_id);
create trigger trg_pcards_updated before update on public.production_cards
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- EVENTOS (auditoria da produção) — quem moveu, de onde p/ onde, quando.
-- ---------------------------------------------------------------------
create table public.production_events (
  id          uuid primary key default gen_random_uuid(),
  card_id     uuid not null references public.production_cards(id) on delete cascade,
  from_sector uuid references public.production_sectors(id) on delete set null,
  to_sector   uuid references public.production_sectors(id) on delete set null,
  action      text not null,                        -- criar | iniciar | concluir | devolver | mover
  reason      text,
  actor_id    uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_pevents_card on public.production_events(card_id, created_at);

-- ---------------------------------------------------------------------
-- RLS (as tabelas novas não estavam no do-block do 0007)
-- ---------------------------------------------------------------------
alter table public.production_sectors enable row level security;
alter table public.production_cards   enable row level security;
alter table public.production_events  enable row level security;

create policy psectors_read on public.production_sectors
  for select using (public.auth_has_permission('production.read'));
create policy pcards_read on public.production_cards
  for select using (public.auth_has_permission('production.read'));
create policy pevents_read on public.production_events
  for select using (public.auth_has_permission('production.read'));

-- >>>>> 0013_pricing.sql <<<<<

-- =====================================================================
-- 0013_pricing.sql — PRECIFICAÇÃO (modelo SOA): custo de materiais →
-- lucro por peça. "Vender muito ≠ lucrar."
-- Materiais + ficha técnica (materiais por produto). O custo do produto
-- = soma(custo_material × quantidade). Lucro = preço − custo.
-- Reusa permissões products.read / products.write. Rode no SQL Editor.
-- =====================================================================

create table public.materials (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  unit          text not null default 'un',       -- un, m, kg, cm…
  cost_per_unit numeric(12,2) not null default 0,
  supplier      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_materials_updated before update on public.materials
  for each row execute function public.set_updated_at();

-- Ficha técnica: quais materiais (e quanto) cada produto consome.
create table public.product_materials (
  product_id  uuid not null references public.products(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  quantity    numeric(12,3) not null default 1,
  primary key (product_id, material_id)
);
create index idx_prodmat_product on public.product_materials(product_id);

alter table public.materials         enable row level security;
alter table public.product_materials enable row level security;

create policy materials_read on public.materials
  for select using (public.auth_has_permission('products.read'));
create policy prodmat_read on public.product_materials
  for select using (public.auth_has_permission('products.read'));

-- >>>>> 0014_finance.sql <<<<<

-- =====================================================================
-- 0014_finance.sql — FINANCEIRO / CAIXA (modelo SOA).
-- Entradas e saídas, categorias, saldo do mês. "Fim do mês sabendo o
-- resultado." Rode no SQL Editor do Supabase.
-- =====================================================================

insert into public.permissions (key, description) values
  ('finance.read',  'Ver financeiro/caixa'),
  ('finance.write', 'Lançar entradas/saídas')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['finance.read','finance.write']) k
where r.key in ('admin','financeiro')
on conflict do nothing;

create table public.cash_entries (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                       -- 'entrada' | 'saida'
  amount      numeric(12,2) not null,
  category    text,
  description text,
  entry_date  date not null default current_date,
  order_id    uuid references public.orders(id) on delete set null,
  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_cash_date on public.cash_entries(entry_date);

alter table public.cash_entries enable row level security;
create policy cash_read on public.cash_entries
  for select using (public.auth_has_permission('finance.read'));
