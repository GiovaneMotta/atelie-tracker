# Estado do Projeto — Ateliê da Lili

Guia para **continuar o projeto de qualquer computador**. Se você (ou o Claude) está
retomando daqui, **leia este arquivo primeiro** — ele resume o que é, onde está e como seguir.

_Atualizado em 25/10/2026._

> ### ⚠️ Antes de trocar de computador, leia a seção 6
> Código e dados **não** correm risco: estão no GitHub, no Supabase e no Cloudflare.
> O que corre risco são as **fotos originais**, que não estão em repositório nenhum.

---

## 1. O que é (e onde vive — tudo na nuvem)

| Parte | O que é | Repositório (GitHub) | No ar (Cloudflare Pages) |
|---|---|---|---|
| **Site público** | Catálogo + carrinho + WhatsApp. Estático (HTML/CSS/JS). | `GiovaneMotta/ateliedalili-site` | **ateliedalili-site.pages.dev** |
| **Painel (CRM/admin)** | React + Vite. Gerencia produtos, pedidos, cupons, SEO, conteúdo. | `GiovaneMotta/atelie-tracker` (pasta `atelie-crm`) | **atelie-tracker.pages.dev** |
| **Banco/backend** | Supabase (Postgres + funções). Projeto `cfwyrzvnodaqgfutbcph`. | — | dashboard em supabase.com |

- **Deploy é automático:** qualquer `git push` para a branch `main` publica sozinho em ~30–60s. Não precisa "subir" nada à mão.
- **Login do painel e do Supabase:** `giovane12motta@gmail.com` (acessa de qualquer lugar, só pelo navegador).
- **Segredos NUNCA ficam no código.** A chave mestra do banco (`SUPABASE_SERVICE_ROLE_KEY`) mora só nas variáveis do Cloudflare; a chave pública (anon) é a única que aparece no site, e ela é feita para ser pública.

---

## 2. Como continuar em OUTRO computador

**O que importa está tudo no GitHub, Cloudflare e Supabase — nada depende de um computador específico.**

Para editar o código na máquina nova:
1. Instalar **Git** e o **GitHub Desktop** (ou `git` no terminal).
2. Clonar os dois repositórios:
   ```bash
   git clone https://github.com/GiovaneMotta/ateliedalili-site.git
   git clone https://github.com/GiovaneMotta/atelie-tracker.git
   ```
3. Editar → **commit** → **push** para `main`. O Cloudflare publica sozinho.
4. **Rodar o site localmente** (opcional, para testar antes): na raiz do espaço de
   trabalho, no PowerShell, rode `.\tools\servidor.ps1` e abra `http://localhost:8790`.
   _(No Windows, o comando `python` costuma ser um atalho da Store que não funciona.)_
   _Os scripts de apoio ficam em `atelie-tracker/tools/` — copie essa pasta para a raiz
   do espaço de trabalho; o `tools/LEIA-ME.md` explica._
5. O **painel** e o **Supabase** não precisam de clone para o dia a dia: é só logar no navegador (atelie-tracker.pages.dev / supabase.com).

**Para continuar comigo (Claude):** entre na **mesma conta Claude** no app ou em claude.ai, e me peça para **ler este arquivo** (`ESTADO-DO-PROJETO.md`). Ele + o histórico do Git me dão todo o contexto na hora. _(A minha "memória" e o histórico desta conversa ficam no computador atual; por isso este guia viaja no repositório — é o que garante a continuidade em qualquer máquina.)_

---

## 3. O que já está pronto

- **Integração site ⇄ Supabase ⇄ painel:** o site lê produtos, preços e configurações do banco (com backup local se o banco cair). Editar no painel reflete no site.
- **Pedidos do site caem no CRM** (cliente, itens, endereço, origem/UTM, histórico); preço recalculado no servidor; não duplica. Finalização pelo **WhatsApp**.
- **Cupons de desconto** (criar/gerenciar no painel; validados no servidor).
- **SEO e conteúdo editáveis** pelo painel (hero, banners, "sobre", depoimentos, títulos/descrições, imagem de compartilhamento).
- **Relatórios com exportação CSV** e **Dashboard** honesto ("não conectado" onde falta integração).
- **Barra de categorias no topo** (dinâmica: só mostra categorias que têm peças; se preenche sozinha conforme o catálogo cresce).
- **Cards e títulos** mais enxutos/bonitos (ação principal + WhatsApp compacto; título com última palavra em rosé itálico + tracinho dourado).
- **Botões que dependiam de backend ausente ("Pagar no site" e "Calcular frete") estão escondidos** (ligam via flags `onlinePayEnabled` / `freteCalcEnabled` em `js/products.js` quando o pagamento/frete forem configurados).

### Feito entre 18 e 25/10/2026

- **Meta Pixel ligado e honesto.** Os eventos descrevem o que realmente acontece
  (`Contact` no lugar de `Purchase`/`InitiateCheckout`, que o site não tem). `_fbp`/`_fbc`
  só são capturados **depois** do aceite de cookies.
- **Conversions API (CAPI) pelo painel.** O `Purchase` sai quando você registra o
  pagamento de um pedido — não do site. Fila com reenvio, idempotência por `event_id` e
  tela de acompanhamento em **Painel → Marketing**.
  ⚠️ **Desligue o `Purchase` do Waspeed**, senão a venda conta duas vezes.
- **Feed de produtos** para campanha de catálogo da Meta: `/api/feed`.
- **Aba Acessórios** com 17 peças cadastradas (7 conjuntos sapatinho+faixa, 9 sapatinhos,
  1 touca), subcategorias com segunda fila de filtros, e o SQL de cadastro versionado em
  `supabase/dados/acessorios.sql`. Detalhes em [`docs/acessorios.md`](docs/acessorios.md).
- **Campo "nome do bebê para bordar" não aparece mais em calçado.** A regra está em
  `aceitaBordado()`, no `js/produto.js` do site: quem fica de fora são as subcategorias
  `sapatinho-menino`, `sapatinho-menina` e `sapato-faixa`. A touca continua com o campo,
  porque o nome bordado é o produto dela.
- **Peça sem preço cadastrado não mostra mais "R$ 0,00".** Aparece "a combinar" no
  carrinho e na mensagem do WhatsApp, e o total avisa que falta fechar valor.
- **Home refinada:** título do banner não quebra mais palavra por palavra (era 84px numa
  coluna de 560px), foto maior, setas do carrossel ao lado do conteúdo, faixa promocional
  parada quando cabe na tela, e as categorias viraram uma fila única que rola e passeia
  sozinha (pausa no mouse, para de vez no toque, respeita "reduzir movimento").

---

## 4. Pendências e decisões (de onde retomar)

**Faça assim que puder (tem consequência):**
- **Desligar o `Purchase` do Waspeed.** O painel já manda o `Purchase` pela CAPI. Com os
  dois ligados, cada venda conta duas vezes e o ROAS das campanhas fica errado.
- **Preencher preço e tamanho dos 17 acessórios** em Painel → Produtos. Sem preço, o card
  não mostra valor e um pedido com acessório chega ao painel com R$ 0,00 naquela linha.
- **Apagar o pedido de teste #1004.**

**Decisões suas:**
- **Pix:** dar **5% de desconto de verdade** no Pix? Se sim, mostramos a economia em verde no card (hoje à vista = cartão, sem desconto real).
- **Ligar pagamento no site (InfinitePay) e frete real (Frenet)?** Hoje estão desligados de
  propósito. O frete precisa do token da Frenet; sem ele a caixa de frete fica recolhida.
- **Domínio próprio** — o site está em `ateliedalili-site.pages.dev`.
- **Pixel e catálogo estão em negócios diferentes** no Gerenciador (Pixel em "Giovane",
  catálogo "Loja da Lili" em "Elisangela Motta"). Juntar facilita campanha de catálogo.
- **Três cards de categoria apontam para o mesmo lugar:** "Personalizadas" e "Para
  presentear" levam ao catálogo inteiro, igual ao "Ver tudo". E as fotos de Luxo,
  Personalizadas e Para presentear são três vestidos rosa parecidos.
- **Filtro "Sapatinhos Menina" mostra 2 peças, não 9.** Os 7 conjuntos são de menina mas
  estão só em "Sapatinho + Faixa". Você decidiu deixar assim — fica registrado caso alguma
  cliente reclame de não achar.

**A implementar (quando você quiser):**
- **Item 4 em diante do briefing de refinamento visual** ("Favoritas do ateliê…") — o texto
  chegou cortado; falta reenviar.
- No celular, o botão do WhatsApp **vaza 11px** para fora do card, em todos os produtos.
- A **bolinha de cor** do catálogo nunca funciona com produto vindo do banco: o
  `public_catalog` não devolve cor nenhuma. Precisaria de uma linha a mais na função.
- Tira de **categorias com ícones**; seção "Novidades"; favoritar (coração).
- **Otimização das imagens** no mobile, preservando o detalhe do tricô.
- **Migrations escritas e NÃO aplicadas:** `0027_pagamento_validado.sql` (recusa pagamento
  com valor divergente) e o teste `supabase/testes/0028_testes_checkout.sql`. Os dois
  avisam no próprio cabeçalho que não foram executados.

---

## 5. Observações técnicas úteis

- **Cloudflare Pages:** `/index.html?algumacoisa` pode vir vazio (peculiaridade de rota) — use `/` como endereço canônico.
- **Dois repositórios separados:** o site é a pasta raiz; o painel é o `atelie-tracker` (normalmente clonado como subpasta `atelie-crm`).
- **Migrações do banco (SQL):** ficam em `supabase/migrations/` do repositório do painel.
  São aplicadas **à mão** no SQL Editor do Supabase — não há runner automático.
  **Em 19/10/2026 descobrimos que 0012 (produção), 0013 (precificação) e 0014
  (financeiro) nunca tinham sido aplicadas:** as telas existiam no painel e
  quebravam com `Could not find the table ... in the schema cache`. Foram
  aplicadas nessa data, junto com as permissões que faltavam.
  **Antes de concluir que uma tela está com bug, rode `supabase/auditoria_schema.sql`**
  no SQL Editor: ele lista tabela, função ou coluna que o código espera e o banco não tem.

---

## 6. Trocar de computador — o que vem sozinho e o que não vem

### Vem sozinho (não faça nada)

| | Onde está |
|---|---|
| Todo o código do site e do painel | GitHub, nos dois repositórios |
| Produtos, pedidos, clientes, cupons | Supabase |
| Chaves e segredos (`SUPABASE_SERVICE_ROLE_KEY`, `META_CAPI_TOKEN`, …) | variáveis do Cloudflare — nunca estiveram no código |
| Os sites no ar | Cloudflare Pages, publicam sozinhos a cada `push` |
| Migrations, SQL de cadastro, documentação | repositório do painel |
| Scripts de apoio (`gerar-miniaturas.ps1` etc.) | `atelie-tracker/tools/` |

### NÃO vem — copie à mão antes de viajar

**As fotos originais.** `C:\Users\Ms10\Pictures\Acessórios` — 22 arquivos, ~40 MB,
em `.HEIC` do iPhone. São os originais dos acessórios; o repositório só tem os `.jpg`
já recortados em 3:4. Sem eles, para reenquadrar uma foto seria preciso fotografar de novo.

**Suba para o Google Drive ou OneDrive** — é onde foto de produto deve viver, e não
em repositório de código. Vale o mesmo para as fotos originais das saídas, se existirem
em outra pasta.

### Pode deixar para trás

- `atelie-da-lili-site/` — cópia do site reconstruída na mudança de PC anterior
  (parou em 18/10). A pasta boa é `ateliedalili-site/`.
- `pc-antigo/` — o script daquela mudança. Não precisa mais: agora está tudo em git.
- `.claude/launch.json` — ignorado pelo git de propósito. Para recriar, é um arquivo com
  `npx http-server . -p 8790` — ou use `tools/servidor.ps1`.

### No computador novo

```bash
git clone https://github.com/GiovaneMotta/ateliedalili-site.git
git clone https://github.com/GiovaneMotta/atelie-tracker.git
cp -r atelie-tracker/tools ./tools
```

Depois entre na **mesma conta Claude** e peça para eu **ler este arquivo**. Ele mais o
histórico do Git me dão o contexto inteiro — o histórico das nossas conversas fica no
computador antigo, mas este guia viaja junto com o repositório, que é o que importa.
