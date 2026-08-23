-- =====================================================================
-- 0015_catalog_public.sql — Prepara o catálogo para consumo pelo SITE
-- PÚBLICO (integração Site ⇄ Supabase ⇄ CRM).
--
-- ADITIVA e segura: só ADICIONA colunas/índices. Não altera nem remove
-- nada existente. Pode rodar mais de uma vez (if not exists).
-- Rollback: `alter table public.products drop column featured, drop column sort_order;`
-- =====================================================================

-- "Destaque" (aparece nas vitrines "Favoritas" da home) + ordenação curada.
alter table public.products
  add column if not exists featured   boolean not null default false,
  add column if not exists sort_order integer;

-- Consultas do site filtram/ordenam por status + destaque + ordem.
create index if not exists idx_products_featured   on public.products(featured) where featured;
create index if not exists idx_products_sort_order  on public.products(sort_order);
create index if not exists idx_products_status_name on public.products(status, name);

comment on column public.products.featured   is 'Destaque na home do site público (vitrine "Favoritas").';
comment on column public.products.sort_order is 'Ordem de exibição curada (menor primeiro); null = pelo nome.';
