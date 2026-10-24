# Acessórios — o que falta cadastrar

As fotos já estão prontas e o site já sabe mostrar a aba **Acessórios**. Falta só
cadastrar as peças: **o catálogo que vai ao ar vem do banco**, não do arquivo
`products.js` do site. Enquanto você não cadastrar, a aba não aparece para a
cliente.

## Caminho rápido: o SQL pronto

`supabase/dados/acessorios.sql` cadastra as 10 de uma vez, com nome, SKU,
categorias, descrição e foto já preenchidos.

1. **Publique o site primeiro.** As fotos só existem depois do deploy — rodar o
   SQL antes faz as peças aparecerem sem imagem.
2. Abra o arquivo e preencha os preços (`price_cash` e `price_card`) na tabela
   do topo. Pode deixar `null` e preencher depois no painel.
3. Supabase → SQL Editor → cole tudo → Run.

É seguro rodar de novo: peça que já existe é deixada como está, e tudo roda
dentro de uma transação.

## Ou na mão, uma a uma

Painel → **Produtos** → *Nova peça*. Para cada item da tabela abaixo:

1. **Nome** e **SKU** — copie da tabela.
2. **Categorias** — marque **`acessorios`** *e* a subcategoria (`sapato-faixa`
   ou `sapatinho-menino`). As duas, sempre: `acessorios` é o que cria a aba,
   a subcategoria é o que separa a segunda fila de filtros.
3. **Preço à vista / Pix** e **Preço no cartão** — você define.
4. **Descrição** — já escrita na tabela, descrevendo só o que aparece na foto.
5. **Fotos** — arraste o arquivo correspondente de
   `ateliedalili-site/images/acessorios/`. O painel converte e otimiza sozinho.
   > As fotos originais são `.HEIC` do iPhone e o navegador **não lê HEIC** —
   > por isso elas já foram convertidas para `.jpg`. Use os `.jpg`, não os HEIC.
6. **Variações** — crie o tamanho (ex.: `RN`) e o estoque, se quiser contagem.
7. **Status** — `ativo`.

## As 10 peças

| SKU | Nome | Categorias | Foto | Descrição |
|---|---|---|---|---|
| AC-001 | Conjunto Pérola Rosê Marfim | acessorios, sapato-faixa | `ac-001-1.jpg` | Conjunto de sapatinho e faixa em tricô marfim, bordado à mão com pérolas. Laço de organza e flor rosê com strass no centro, repetida na faixa sobre fita de pérolas. |
| AC-002 | Conjunto Pérola Rosê Branco | acessorios, sapato-faixa | `ac-002-1.jpg` | Igual ao AC-001, em tricô branco. |
| AC-003 | Conjunto Pérola Rubi Marfim | acessorios, sapato-faixa | `ac-003-1.jpg` | Conjunto de sapatinho e faixa em tricô marfim, bordado à mão com pérolas. Flor vermelha com strass no centro, repetida na faixa sobre fita de pérolas. |
| AC-004 | Conjunto Pérola Rubi Branco | acessorios, sapato-faixa | `ac-004-1.jpg` | Igual ao AC-003, em tricô branco. |
| AC-005 | Conjunto Laço Rosê | acessorios, sapato-faixa | `ac-005-1.jpg` | Conjunto de sapatinho e faixa em tricô rosê, com laço de organza bordado em pérolas e uma fileira de strass. Faixa de meia-malha no mesmo tom. |
| AC-006 | Conjunto Laço Rosa Bebê | acessorios, sapato-faixa | `ac-006-1.jpg` | Igual ao AC-005, em tricô rosa bebê. |
| AC-007 | Conjunto Laço Marsala | acessorios, sapato-faixa | `ac-007-1.jpg` | Conjunto de sapatinho e **arco** em tricô marsala, com laços de cetim bordados em pérolas e uma fileira de strass. |
| AC-008 | Sapatinho Leãozinho Verde | acessorios, sapatinho-menino | `ac-008-1.jpg` | Sapatinho em tricô verde eucalipto com aplicação de leãozinho em feltro, juba bordada em fio acetinado e carinha feita à mão. |
| AC-009 | Sapatinho Leãozinho Marsala | acessorios, sapatinho-menino | `ac-009-1.jpg` | Igual ao AC-008, em tricô marsala. |
| AC-010 | Sapatinho Ursinho Azul | acessorios, sapatinho-menino | `ac-010-1.jpg` + `ac-010-2.jpg` | Sapatinho em tricô azul bebê com aplicação de ursinho em feltro, coroa dourada e lacinho. Acabamento todo feito à mão. |

## Confirme comigo antes de publicar

- **Marfim × branco** — separei AC-001/003 (marfim) de AC-002/004 (branco) pela
  cor do tricô na foto. Se forem a mesma peça fotografada em luz diferente,
  cadastre só uma e me avise.
- **AC-007** — a peça que acompanha o sapatinho parece um **arco**, não uma
  faixa de meia-malha como nas outras. Confirme o nome certo.
- **Sapatinhos de menina** — não há nenhum. Os sapatinhos avulsos das fotos
  (leãozinho e ursinho) ficaram como `sapatinho-menino`. A subcategoria
  "Sapatinhos Menina" existe e só vai aparecer no site quando tiver peça.
- **Tamanhos** — nenhuma foto diz o tamanho. Preencha no painel.

## Fotos que eu NÃO usei

Seis fotos da pasta mostram o **mesmo modelo** de sapatinho de tricô com tira e
botões de madeira, em seis cores (verde, vermelho, azul-marinho, branco,
azul-bebê e azul-jeans), sempre na mesma cena — mesmo coração de madeira, mesmo
pelo branco, mesmos trigos secos:

- `Gemini_Generated_Image_cvegnucvegnucveg.jpg` (verde)
- `Gemini_Generated_Image_fe61nafe61nafe61.jpg` (vermelho)
- `Gemini_Generated_Image_ubtvg4ubtvg4ubtv.jpg` (azul-bebê)
- `Gemini_Generated_Image_vmjernvmjernvmje.jpg` (azul-jeans)
- `watermarked_img_8817062536172463267.jpg` (azul-marinho)
- `watermarked_img_9540928956244187333.jpg` (branco)

Quatro têm **"Gemini_Generated_Image"** no nome, ou seja, foram **geradas por
inteligência artificial**; as outras duas têm "watermarked" no nome e são da
mesma cena recolorida. Como você pediu para não usar foto de IA e para não
alterar cores nem detalhes dos produtos, deixei as seis de fora.

Se esse sapatinho existe de verdade no ateliê, **me manda uma foto real** dele
que eu cadastro na hora. Se você quiser usar essas mesmo assim, é só falar.

## Os dois vídeos

`IMG_2393.MP4` e `IMG_2408.MP4` são vídeos dos sapatinhos de leãozinho. O site
hoje não tem onde exibir vídeo de produto (os círculos da home apontam para o
Instagram). Me avisa se quiser que eu monte isso.
