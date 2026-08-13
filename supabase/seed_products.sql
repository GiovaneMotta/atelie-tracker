-- =====================================================================
-- seed_products.sql — Popula o catálogo com os 28 produtos REAIS do
-- Ateliê da Lili (migrados de ../js/products.js).
-- Idempotente: pode rodar mais de uma vez sem duplicar (on conflict).
-- Rode no SQL Editor do Supabase (uma vez).
-- Obs.: as imagens usam caminhos relativos do catálogo público; elas
-- aparecem quando apontarmos para a URL do site/Storage (fase futura).
-- Peso/dimensões ficam vazios — preencher depois para o frete Frenet.
-- =====================================================================

insert into public.products (sku, name, price_cash, price_card, installments_max, status, images, description) values
('SM-G001','Pétala Malva',349,349,6,'ativo','["images/menina/g001-1.jpg","images/menina/g001-2.jpg","images/menina/g001-3.jpg"]','Tricô malva rosê com gola bordada à mão em flores e pérolas, laços no cinto e punhos com renda guipir. Inclui manta personalizada. Delicado e atemporal.'),
('SM-G002','Tule Malva',389,389,6,'ativo','["images/menina/g002-1.jpg","images/menina/g002-2.jpg","images/menina/g002-3.jpg"]','Tricô malva com gola de tule bordada, punhos rendados e laços no cinto com pérolas. Conjunto completo com manta personalizada e sapatinhos artesanais.'),
('SM-G003','Rouge Luxo',449,449,6,'ativo','["images/menina/g003-1.jpg","images/menina/g003-2.jpg","images/menina/g003-3.jpg"]','Tricô vermelho vinho com padrão diamante e pérolas espalhadas, gola de tule bordado com flores, punhos de renda. Peça de alto impacto para a maternidade. Manta personalizada inclusa.'),
('SM-G004','Creme Royal',459,459,6,'ativo','["images/menina/g004-1.jpg","images/menina/g004-2.jpg","images/menina/g004-3.jpg"]','Tricô amarelo creme em padrão chevron com gola de tule bordada e pérolas, laços duplos no cinto. Elegância francesa em cada detalhe. Manta personalizada inclusa.'),
('SM-G005','Rubi Clássico',319,319,6,'ativo','["images/menina/g005-1.jpg","images/menina/g005-2.jpg","images/menina/g005-3.jpg"]','Tricô vermelho com barrado branco em scallop, laços no cinto. Design clássico e refinado, perfeito para o registro na maternidade.'),
('SM-G006','Xadrez Premium',489,489,6,'ativo','["images/menina/g006-1.jpg","images/menina/g006-2.jpg","images/menina/g006-3.jpg"]','Tricô xadrez estilo europeu premium em bege, preto e vermelho, com laços e gola de renda. Coleção exclusiva inspirada nas mais sofisticadas maisons infantis da Europa.'),
('SM-G007','Esmeralda Pastel',359,359,6,'ativo','["images/menina/g007-1.jpg","images/menina/g007-2.jpg"]','Tricô verde mint com detalhes em rosa bebê, gola de renda bordada com flores e pérolas, laços no cinto. Combinação refrescante e delicada.'),
('SM-G008','Jardim Rosa',529,529,6,'ativo','["images/menina/g008-1.jpg","images/menina/g008-2.jpg","images/menina/g008-3.jpg"]','Saída em tricô rosê com saia de tule e flores 3D bordadas à mão em tons de rosa e dourado, gola bordada com pérolas. A peça mais desejada da coleção. Manta e sapatinhos inclusos.'),
('SM-G009','Jardim Branco',549,549,6,'ativo','["images/menina/g009-1.jpg","images/menina/g009-2.jpg","images/menina/g009-3.jpg"]','Versão branca da linha Jardim. Tricô branco premium com saia de tule e flores 3D bordadas em rosa e dourado, gola de tule com pérolas e laços. Pureza e luxo em cada detalhe.'),
('SM-G018','Jardim Tule Premium',579,579,6,'ativo','["images/menina/g018-1.jpg","images/menina/g018-2.jpg"]','Edição especial com flores 3D no tule, gola tule luxo e kit completo com sapatinhos e faixa de pérolas. Peça de enxoval de alto padrão. Disponível apenas em RN.'),
('SM-G010','Lavanda',419,419,6,'ativo','["images/menina/g010-1.jpg","images/menina/g010-2.jpg","images/menina/g010-3.jpg","images/menina/g010-4.jpg"]','Tricô branco com detalhes em lilás/lavanda, gola bordada com flores e pérolas, laços e barrado rendado. Sofisticação e delicadeza em tons provençais.'),
('SM-G017','Branco & Rosê',369,369,6,'ativo','["images/menina/g017-1.jpg","images/menina/g017-2.jpg","images/menina/g017-3.jpg"]','Tricô branco com barrado e detalhes em rosê antigo, laços com pérola, manta personalizada. Clássico e atemporal — uma das peças favoritas das mamães.'),
('SM-G023','Branco & Rosa',369,369,6,'ativo','["images/menina/g023-1.jpg","images/menina/g023-2.jpg","images/menina/g023-3.jpg"]','Tricô branco com detalhes em rosa bebê, gola bordada com flores e renda, laços no cinto. Conjunto com manta personalizada. Minimalista e elegante.'),
('SM-G020','Florescência',389,389,6,'ativo','["images/menina/g020-1.jpg","images/menina/g020-2.jpg"]','Tricô branco com flores lilás em tricô artesanal no cinto, manta bordada com galho florido. Design único e poético, exclusivo desta coleção.'),
('SM-G021','Mar & Rosa',359,359,6,'ativo','["images/menina/g021-1.jpg"]','Tricô azul bebê com detalhes em rosa, gola bordada, laços. Combinação inusitada e encantadora. Kit completo com sapatinhos e faixa.'),
('SM-G012','Salmão Elegance',379,379,6,'ativo','["images/menina/g012-1.jpg","images/menina/g012-2.jpg","images/menina/g012-3.jpg","images/menina/g012-4.jpg"]','Tricô salmão em padrão chevron, gola de tule rendado, laços com pérola e punhos de renda. Kit completo com manta personalizada e sapatinhos.'),
('SM-G016','Magnólia',519,519,6,'ativo','["images/menina/g016-1.jpg","images/menina/g016-2.jpg","images/menina/g016-3.jpg"]','Tricô salmão com saia de tule e flores 3D bordadas, gola de tule e laços com pérola. A versão salmão da linha Jardim. Kit completo com acessórios.'),
('SM-G022','Aurora Rosê',519,519,6,'ativo','["images/menina/g022-1.jpg","images/menina/g022-2.jpg"]','Tricô salmão profundo com flores 3D aplicadas no tule, gola de renda, kit com touquinha personalizada e sapatinhos. Edição com manta bordada especial.'),
('SM-G024','Diamante',359,359,6,'ativo','["images/menina/g024-1.jpg","images/menina/g024-2.jpg"]','Tricô salmão em padrão diamante com pérolas espalhadas, gola bordada com flores, laço com pérola. Manta personalizada com borboletas bordadas inclusa.'),
('SM-G028','Listrado Rosê',349,349,6,'ativo','["images/menina/g028-1.jpg","images/menina/g028-2.jpg"]','Tricô branco com listras em salmão, gola bordada com flores, laços. Design limpo e sofisticado, manta personalizada com bordado floral.'),
('SM-G011','Pérola Rosa',339,339,6,'ativo','["images/menina/g011-1.jpg","images/menina/g011-2.jpg","images/menina/g011-3.jpg"]','Tricô rosa bebê em padrão diamante, laços com pérola, manta personalizada. Kit com sapatinhos de pérola e faixinha. Uma das peças mais delicadas da coleção.'),
('SM-G015','Quartzo',349,349,6,'ativo','["images/menina/g015-1.jpg","images/menina/g015-2.jpg","images/menina/g015-3.jpg"]','Tricô rosa bebê com detalhes em cinza, laços com pérola. Combinação sofisticada e diferenciada — o cinza traz modernidade ao clássico rosinha.'),
('SM-G027','Coração de Flores',439,439,6,'ativo','["images/menina/g027-1.jpg"]','Tricô rosa claro com aplicação de flores em formato de coração e folhas douradas no tule, gola de renda. Peça exclusiva e ultra delicada. Apenas RN.'),
('SM-G013','Conjunto Vermelho & Branco',529,529,6,'ativo','["images/menina/g013-1.jpg","images/menina/g013-2.jpg"]','Conjunto estilo europeu: casaquinho branco com flores 3D vermelhas bordadas + macaquinho vermelho + manta bordada. Dois tons, um visual de revista.'),
('SM-G014','Conjunto Rosê & Branco',529,529,6,'ativo','["images/menina/g014-1.jpg","images/menina/g014-2.jpg","images/menina/g014-3.jpg"]','Conjunto estilo europeu: casaquinho branco com flores 3D rosê bordadas + macaquinho rosê + manta bordada. Sofisticação e charme no look de saída.'),
('SM-G019','Grand Luxe Vermelho',619,619,6,'ativo','["images/menina/g019-1.jpg"]','A peça mais luxuosa da coleção. Tricô vermelho vinho com saia de renda guipir trabalhada, gola de tule bordado, laços com pérola dourada. Disponível apenas em RN. Edição limitada.'),
('SM-G025','Jardineira Primavera',349,349,6,'ativo','["images/menina/g025-1.jpg"]','Jardineira em tricô salmão com body branco e gola de tule bordado. Estilo diferenciado e moderno. Kit com sapatinhos e faixinha incluso.'),
('SM-G026','Macacinho Rosa',279,279,6,'ativo','["images/menina/g026-1.jpg"]','Macacão em tricô rosa bebê com padrão diamante e laço com pérola. Peça coringa do enxoval — prática, elegante e confortável.')
on conflict (sku) do nothing;

-- Categorias: todas são "menina"; as de linha premium também "luxo".
insert into public.product_categories (product_id, category)
select id, 'menina' from public.products where sku like 'SM-G%'
on conflict do nothing;

insert into public.product_categories (product_id, category)
select id, 'luxo' from public.products
where sku in ('SM-G002','SM-G003','SM-G004','SM-G006','SM-G008','SM-G009','SM-G018',
              'SM-G010','SM-G016','SM-G022','SM-G027','SM-G013','SM-G014','SM-G019')
on conflict do nothing;
