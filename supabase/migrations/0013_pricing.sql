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
