# Estado do Projeto — Ateliê da Lili

Guia para **continuar o projeto de qualquer computador**. Se você (ou o Claude) está
retomando daqui, **leia este arquivo primeiro** — ele resume o que é, onde está e como seguir.

_Atualizado em 16/10/2026._

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
4. **Rodar o site localmente** (opcional, para testar antes): dentro da pasta do site, no PowerShell, rode `./serve.ps1` e abra `http://localhost:8080`.
   _(No Windows, o comando `python` costuma ser um atalho da Store que não funciona — use o `serve.ps1`.)_
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

---

## 4. Pendências e decisões (de onde retomar)

**Decisões suas:**
- **Pix:** dar **5% de desconto de verdade** no Pix? Se sim, mostramos a economia em verde no card (hoje à vista = cartão, sem desconto real).
- **Imagem do banner (sugestão do Gemini):** é **foto real** de uma peça ou **gerada por IA**? Imagem de produto por IA **não pode** ser usada (engana a cliente).
- **Ligar pagamento no site (InfinitePay) e frete real (Frenet)?** Hoje estão desligados de propósito.

**A implementar (quando você quiser):**
- Tira de **categorias com ícones** (só nas categorias reais) + texto do aviso "Fale com uma especialista no WhatsApp".
- Preço no Pix em verde + parcelamento mais legível no card (depende da decisão do Pix).
- Seção "Novidades / Acabaram de chegar"; favoritar (coração).
- **Otimização das imagens** no mobile (velocidade), preservando o detalhe do tricô.
- **Analytics (Fase H):** colar os IDs de **Meta Pixel / GA4** em Painel → Marketing (a infra já existe; só falta o ID).
- **Expandir o catálogo** (menino, acessórios, enxoval, batizado…): a barra de categorias se preenche sozinha conforme você cadastra.

---

## 5. Observações técnicas úteis

- **Cloudflare Pages:** `/index.html?algumacoisa` pode vir vazio (peculiaridade de rota) — use `/` como endereço canônico.
- **Dois repositórios separados:** o site é a pasta raiz; o painel é o `atelie-tracker` (normalmente clonado como subpasta `atelie-crm`).
- **Migrações do banco (SQL):** ficam em `atelie-crm/supabase/migrations/`. São aplicadas no SQL Editor do Supabase (a última foi a `0018_coupons.sql`).
