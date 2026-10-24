-- =====================================================================
-- acessorios.sql — cadastra as 10 pecas da aba Acessorios.
--
-- Isto NAO e uma migration: nao muda estrutura nenhuma, so insere
-- produto. Por isso mora em supabase/dados/ e nao entra na numeracao
-- das migrations.
--
-- ORDEM IMPORTA
--   1. Publique o site primeiro. As fotos citadas aqui
--      (images/acessorios/*.jpg) so existem depois do deploy; se voce
--      rodar este script antes, as pecas aparecem no catalogo com a
--      imagem cinza de "sem foto" ate o site subir.
--   2. So depois rode este script.
--
-- COMO RODAR
--   Supabase -> SQL Editor -> cole tudo -> Run.
--   E seguro rodar de novo: produto que ja existe (mesmo SKU) e
--   deixado como esta, entao reexecutar nunca apaga preco nem
--   descricao que voce tenha ajustado no painel.
--   Tudo roda dentro de uma transacao: se alguma coisa falhar, nada e
--   gravado pela metade.
--
-- ANTES DE RODAR: preencha os precos na tabela abaixo, nas colunas
-- price_cash (a vista/Pix) e price_card (cartao). Deixar null tambem
-- funciona — a peca entra sem preco, o site mostra "a combinar" e voce
-- preenche depois no painel. So lembre que, sem preco, um pedido que
-- inclua a peca chega ao painel com R$ 0,00 nessa linha.
--
-- As fotos ficam no repositorio do site, em images/acessorios/. Elas
-- precisam estar publicadas junto com o deploy para aparecerem.
-- =====================================================================
begin;

create temporary table _acessorios (
  sku        text primary key,
  name       text not null,
  slug       text not null,
  descr      text not null,
  imgs       jsonb not null,
  price_cash numeric(12,2),
  price_card numeric(12,2),
  subcat     text not null
) on commit drop;

--                sku    | nome                          | slug                           | descricao                                                                                                                                                             | fotos                                                            | a vista | cartao | subcategoria
insert into _acessorios values
  ('AC-001', 'Conjunto Pérola Rosê Marfim',  'conjunto-perola-rose-marfim',  'Conjunto de sapatinho e faixa em tricô marfim, bordado à mão com pérolas. Laço de organza e flor rosê com strass no centro, repetida na faixa sobre fita de pérolas.', '["images/acessorios/ac-001-1.jpg"]',                                 null, null, 'sapato-faixa'),
  ('AC-002', 'Conjunto Pérola Rosê Branco',  'conjunto-perola-rose-branco',  'Conjunto de sapatinho e faixa em tricô branco, bordado à mão com pérolas. Laço de organza e flor rosê com strass no centro, repetida na faixa sobre fita de pérolas.', '["images/acessorios/ac-002-1.jpg"]',                                 null, null, 'sapato-faixa'),
  ('AC-003', 'Conjunto Pérola Rubi Marfim',  'conjunto-perola-rubi-marfim',  'Conjunto de sapatinho e faixa em tricô marfim, bordado à mão com pérolas. Flor vermelha com strass no centro, repetida na faixa sobre fita de pérolas.',            '["images/acessorios/ac-003-1.jpg"]',                                 null, null, 'sapato-faixa'),
  ('AC-004', 'Conjunto Pérola Rubi Branco',  'conjunto-perola-rubi-branco',  'Conjunto de sapatinho e faixa em tricô branco, bordado à mão com pérolas. Flor vermelha com strass no centro, repetida na faixa sobre fita de pérolas.',            '["images/acessorios/ac-004-1.jpg"]',                                 null, null, 'sapato-faixa'),
  ('AC-005', 'Conjunto Laço Rosê',           'conjunto-laco-rose',           'Conjunto de sapatinho e faixa em tricô rosê, com laço de organza bordado em pérolas e uma fileira de strass. Faixa de meia-malha no mesmo tom.',                      '["images/acessorios/ac-005-1.jpg"]',                                 null, null, 'sapato-faixa'),
  ('AC-006', 'Conjunto Laço Rosa Bebê',      'conjunto-laco-rosa-bebe',      'Conjunto de sapatinho e faixa em tricô rosa bebê, com laço de organza bordado em pérolas e uma fileira de strass. Faixa de meia-malha no mesmo tom.',                 '["images/acessorios/ac-006-1.jpg"]',                                 null, null, 'sapato-faixa'),
  ('AC-007', 'Conjunto Laço Marsala',        'conjunto-laco-marsala',        'Conjunto de sapatinho e arco em tricô marsala, com laços de cetim bordados em pérolas e uma fileira de strass.',                                                    '["images/acessorios/ac-007-1.jpg"]',                                 null, null, 'sapato-faixa'),
  ('AC-008', 'Sapatinho Leãozinho Verde',    'sapatinho-leaozinho-verde',    'Sapatinho em tricô verde eucalipto com aplicação de leãozinho em feltro, juba bordada em fio acetinado e carinha feita à mão.',                                    '["images/acessorios/ac-008-1.jpg"]',                                 null, null, 'sapatinho-menino'),
  ('AC-009', 'Sapatinho Leãozinho Marsala',  'sapatinho-leaozinho-marsala',  'Sapatinho em tricô marsala com aplicação de leãozinho em feltro, juba bordada em fio acetinado e carinha feita à mão.',                                            '["images/acessorios/ac-009-1.jpg"]',                                 null, null, 'sapatinho-menino'),
  ('AC-010', 'Sapatinho Ursinho Azul',       'sapatinho-ursinho-azul',       'Sapatinho em tricô azul bebê com aplicação de ursinho em feltro, coroa dourada e lacinho. Acabamento todo feito à mão.',                                            '["images/acessorios/ac-010-1.jpg","images/acessorios/ac-010-2.jpg"]', null, null, 'sapatinho-menino');

-- ---------------------------------------------------------------------
-- 1) Os produtos.
--    "do nothing" de proposito: se voce ja cadastrou alguma peca no
--    painel, este script nao encosta nela.
-- ---------------------------------------------------------------------
insert into public.products (sku, name, slug, description, images, price_cash, price_card, status)
select a.sku, a.name, a.slug, a.descr, a.imgs, a.price_cash, a.price_card, 'ativo'
  from _acessorios a
 on conflict (sku) do nothing;

-- ---------------------------------------------------------------------
-- 2) As categorias.
--    "acessorios" e o que cria a aba no site; a subcategoria e o que
--    separa a segunda fila de filtros (Sapatinho + Faixa / Sapatinhos
--    Menino). As duas juntas, sempre.
-- ---------------------------------------------------------------------
insert into public.product_categories (product_id, category)
select p.id, c.category
  from _acessorios a
  join public.products p on p.sku = a.sku
 cross join lateral (values ('acessorios'), (a.subcat)) as c(category)
 on conflict (product_id, category) do nothing;

commit;

-- ---------------------------------------------------------------------
-- Conferencia — deve listar as 10 com as duas categorias cada.
-- ---------------------------------------------------------------------
select p.sku,
       p.name,
       p.price_cash,
       p.status,
       jsonb_array_length(p.images)                       as fotos,
       (select string_agg(c.category, ', ' order by c.category)
          from public.product_categories c
         where c.product_id = p.id)                       as categorias
  from public.products p
 where p.sku like 'AC-%'
 order by p.sku;


-- =====================================================================
-- OPCIONAL — tamanho
--
-- Nenhuma foto diz o tamanho, entao as pecas entram SEM variacao. Isso
-- funciona: o pedido e fechado sem tamanho e a peca vende sem limite de
-- estoque, como as pecas que voce ainda nao conta.
--
-- Quando decidir o tamanho, troque 'RN' abaixo pelo certo, tire os
-- comentarios e rode so este bloco. Dai a peca passa a mostrar o selo
-- do tamanho no card e pode entrar na contagem de estoque.
-- =====================================================================
-- insert into public.product_variants (product_id, sku, size, is_active)
-- select p.id, p.sku || '-RN', 'RN', true
--   from public.products p
--  where p.sku like 'AC-%'
--    and not exists (select 1 from public.product_variants v
--                     where v.product_id = p.id and upper(v.size) = 'RN')
--  on conflict (sku) do nothing;


-- =====================================================================
-- OPCIONAL — parcelamento
--
-- Toda peca nasce com installments_max = 6 (o padrao da coluna). Num
-- acessorio barato isso vira "ate 6x de R$ 7,50", que fica estranho.
-- Para o acessorio ser so a vista, rode:
-- =====================================================================
-- update public.products set installments_max = 1 where sku like 'AC-%';
