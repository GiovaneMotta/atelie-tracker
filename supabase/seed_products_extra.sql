-- =====================================================================
-- seed_products_extra.sql — Completa a migração dos 28 produtos do site.
--
-- O seed_products.sql já traz produtos + categorias (menina/luxo).
-- Este arquivo adiciona o que faltava, SEM perder nada:
--   • TAMANHOS  → public.product_variants (RN/P/M por peça)
--   • ACESSÓRIO → public.product_addons  (Sapatinho Luxo, do SM-G004)
--   • DESTAQUE  → products.featured / sort_order (vitrine "Favoritas")
--
-- Idempotente: pode rodar quantas vezes quiser (usa NOT EXISTS / UPDATE).
-- Pré-requisitos: rodar antes  (1) as migrations incl. 0015,
--                              (2) o seed_products.sql (produtos+categorias).
-- Rodar no SQL Editor do Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) TAMANHOS  (uma variação por tamanho; sem cor). Não duplica.
-- ---------------------------------------------------------------------
insert into public.product_variants (product_id, size)
select p.id, v.size
from public.products p
join (values
  ('SM-G001','RN'),('SM-G001','P'),
  ('SM-G002','RN'),('SM-G002','P'),
  ('SM-G003','RN'),('SM-G003','P'),
  ('SM-G004','RN'),('SM-G004','P'),
  ('SM-G005','RN'),('SM-G005','P'),('SM-G005','M'),
  ('SM-G006','RN'),('SM-G006','P'),
  ('SM-G007','RN'),('SM-G007','P'),
  ('SM-G008','RN'),('SM-G008','P'),
  ('SM-G009','RN'),('SM-G009','P'),
  ('SM-G018','RN'),
  ('SM-G010','RN'),('SM-G010','P'),
  ('SM-G017','RN'),('SM-G017','P'),
  ('SM-G023','RN'),('SM-G023','P'),
  ('SM-G020','RN'),('SM-G020','P'),
  ('SM-G021','RN'),('SM-G021','P'),
  ('SM-G012','RN'),('SM-G012','P'),
  ('SM-G016','RN'),('SM-G016','P'),
  ('SM-G022','RN'),('SM-G022','P'),
  ('SM-G024','RN'),('SM-G024','P'),
  ('SM-G028','RN'),('SM-G028','P'),
  ('SM-G011','RN'),('SM-G011','P'),
  ('SM-G015','RN'),('SM-G015','P'),
  ('SM-G027','RN'),
  ('SM-G013','RN'),('SM-G013','P'),
  ('SM-G014','RN'),('SM-G014','P'),
  ('SM-G019','RN'),
  ('SM-G025','RN'),('SM-G025','P'),
  ('SM-G026','RN'),('SM-G026','P'),('SM-G026','M')
) as v(sku, size) on v.sku = p.sku
where not exists (
  select 1 from public.product_variants pv
  where pv.product_id = p.id and pv.size = v.size and pv.color is null
);

-- ---------------------------------------------------------------------
-- 2) ACESSÓRIO  (único do catálogo atual: Sapatinho Luxo no SM-G004).
-- ---------------------------------------------------------------------
insert into public.product_addons (product_id, name, price)
select p.id, 'Sapatinho Luxo', 45
from public.products p
where p.sku = 'SM-G004'
and not exists (
  select 1 from public.product_addons pa
  where pa.product_id = p.id and pa.name = 'Sapatinho Luxo'
);

-- ---------------------------------------------------------------------
-- 3) DESTAQUE  (vitrine "Favoritas do ateliê" da home) + ordem curada.
--    Mesma seleção/ordem que hoje está fixa no catalog.js.
-- ---------------------------------------------------------------------
update public.products set featured = false where sku like 'SM-G%';  -- zera só os do seed (idempotente; não mexe em produtos futuros)

update public.products p set featured = true, sort_order = o.ord
from (values
  ('SM-G001',1),('SM-G004',2),('SM-G008',3),('SM-G017',4),
  ('SM-G028',5),('SM-G014',6),('SM-G002',7),('SM-G012',8)
) as o(sku, ord)
where p.sku = o.sku;

-- ---------------------------------------------------------------------
-- Conferência (opcional): rode para validar a migração.
-- ---------------------------------------------------------------------
-- select
--   (select count(*) from public.products)            as produtos,
--   (select count(*) from public.product_categories)  as categorias,
--   (select count(*) from public.product_variants)    as tamanhos,
--   (select count(*) from public.product_addons)      as acessorios,
--   (select count(*) from public.products where featured) as destaques;
-- Esperado: produtos=28, categorias=42, tamanhos=55, acessorios>=1, destaques=8.
