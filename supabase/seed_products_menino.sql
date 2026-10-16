-- =====================================================================
-- seed_products_menino.sql — Linha MASCULINA (menino).
-- 17 modelos a partir das fotos do ateliê (flat-lays, sem bebê).
-- PREÇOS PROVISÓRIOS = R$ 299 em todos. AJUSTAR cada um no painel.
-- Imagens: images/menino/m01-1.jpg ... m17-1.jpg (no repo do site).
-- Idempotente: on conflict (sku) do nothing / not exists.
-- Rodar no SQL Editor do Supabase.
-- =====================================================================

insert into public.products (sku, name, price_cash, price_card, installments_max, status, images, description) values
('SM-M001','Leãozinho Verde',299,299,6,'ativo','["images/menino/m01-1.jpg"]','Saída de maternidade em tricô verde com faixa listrada, touca e sapatinhos de leãozinho. Acabamento à mão. Pode ser personalizada com o nome do bebê.'),
('SM-M002','Jardineira Sage',299,299,6,'ativo','["images/menino/m02-1.jpg"]','Jardineira em tricô verde sage com body de golinha branca e sapatinhos. Conjunto completo, acabamento artesanal. Pode ser personalizada com o nome do bebê.'),
('SM-M003','Jardineira Trançada Verde',299,299,6,'ativo','["images/menino/m03-1.jpg"]','Jardineira em tricô verde com ponto trançado, body branco e sapatinhos. Acabamento à mão. Pode ser personalizada com o nome do bebê.'),
('SM-M004','Macacão Verde',299,299,6,'ativo','["images/menino/m04-1.jpg"]','Macacão em tricô verde sage com ponto trançado. Peça única, confortável e elegante. Pode ser personalizada com o nome do bebê.'),
('SM-M005','Verde Marinho Listrado',299,299,6,'ativo','["images/menino/m05-1.jpg"]','Conjunto em tricô verde com listras e detalhes em azul marinho. Acabamento à mão. Pode ser personalizada com o nome do bebê.'),
('SM-M006','Azul Clássico',299,299,6,'ativo','["images/menino/m06-1.jpg"]','Saída de maternidade em tricô azul com body de golinha branca, touca e sapatinhos. Acabamento artesanal. Pode ser personalizada com o nome do bebê.'),
('SM-M007','Jardineira Azul',299,299,6,'ativo','["images/menino/m07-1.jpg"]','Jardineira em tricô azul com body branco e sapatinhos de ursinho. Conjunto completo. Pode ser personalizada com o nome do bebê.'),
('SM-M008','Azul Equestre',299,299,6,'ativo','["images/menino/m08-1.jpg"]','Conjunto em tricô azul com detalhe bordado e touca. Estilo clássico. Pode ser personalizada com o nome do bebê.'),
('SM-M009','Marinho Nobre',299,299,6,'ativo','["images/menino/m09-1.jpg"]','Jardineira em tricô azul marinho com body de golinha branca. Sóbrio e elegante. Pode ser personalizada com o nome do bebê.'),
('SM-M010','Vermelho Tradicional',299,299,6,'ativo','["images/menino/m10-1.jpg"]','Saída de maternidade em tricô vermelho com body branco, manta e sapatinhos de ursinho. Acabamento à mão. Pode ser personalizada com o nome do bebê.'),
('SM-M011','Vermelho e Cinza',299,299,6,'ativo','["images/menino/m11-1.jpg"]','Conjunto em tricô vermelho com detalhes em cinza e branco. Moderno e sofisticado. Pode ser personalizada com o nome do bebê.'),
('SM-M012','Equestre Vermelho',299,299,6,'ativo','["images/menino/m12-1.jpg"]','Conjunto em tricô listrado em vermelho, marinho e cru, com detalhe bordado e touca. Estilo clássico. Pode ser personalizada com o nome do bebê.'),
('SM-M013','Cinza Listrado',299,299,6,'ativo','["images/menino/m13-1.jpg"]','Conjunto em tricô cinza com listras e detalhes em vermelho, com manta. Acabamento artesanal. Pode ser personalizada com o nome do bebê.'),
('SM-M014','Xadrez Europeu',299,299,6,'ativo','["images/menino/m14-1.jpg"]','Conjunto em tricô xadrez estilo europeu em bege, com body de golinha branca e sapatinhos. Sofisticado. Pode ser personalizada com o nome do bebê.'),
('SM-M015','Bege Clássico',299,299,6,'ativo','["images/menino/m15-1.jpg"]','Jardineira em tricô bege com body de golinha branca e sapatinhos. Clássico e atemporal. Pode ser personalizada com o nome do bebê.'),
('SM-M016','Branco Nobre',299,299,6,'ativo','["images/menino/m16-1.jpg"]','Saída de maternidade em tricô branco com manta personalizada. Puro e elegante. Pode ser personalizada com o nome do bebê.'),
('SM-M017','Caramelo',299,299,6,'ativo','["images/menino/m17-1.jpg"]','Jardineira em tricô caramelo com body de golinha branca e sapatinhos de ursinho. Quentinho e charmoso. Pode ser personalizada com o nome do bebê.')
on conflict (sku) do nothing;

-- categoria "menino" para todos
insert into public.product_categories (product_id, category)
select id, 'menino' from public.products where sku like 'SM-M%'
on conflict do nothing;

-- tamanhos RN e P para todos (idempotente)
insert into public.product_variants (product_id, size)
select p.id, v.size
from public.products p
join (values
  ('SM-M001','RN'),('SM-M001','P'),('SM-M002','RN'),('SM-M002','P'),
  ('SM-M003','RN'),('SM-M003','P'),('SM-M004','RN'),('SM-M004','P'),
  ('SM-M005','RN'),('SM-M005','P'),('SM-M006','RN'),('SM-M006','P'),
  ('SM-M007','RN'),('SM-M007','P'),('SM-M008','RN'),('SM-M008','P'),
  ('SM-M009','RN'),('SM-M009','P'),('SM-M010','RN'),('SM-M010','P'),
  ('SM-M011','RN'),('SM-M011','P'),('SM-M012','RN'),('SM-M012','P'),
  ('SM-M013','RN'),('SM-M013','P'),('SM-M014','RN'),('SM-M014','P'),
  ('SM-M015','RN'),('SM-M015','P'),('SM-M016','RN'),('SM-M016','P'),
  ('SM-M017','RN'),('SM-M017','P')
) as v(sku, size) on v.sku = p.sku
where not exists (
  select 1 from public.product_variants pv where pv.product_id = p.id and pv.size = v.size
);
