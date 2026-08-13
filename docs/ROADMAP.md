# Roadmap — CRM Ateliê da Lili

Ordem de construção conforme o item 72 da especificação. Cada fase é implantável e testável
antes de avançar. Legenda: ⬜ pendente · 🟡 em andamento · ✅ concluído.

| # | Fase | Escopo | Status |
|---|------|--------|--------|
| 1a | **Fundação — arquitetura + banco** | Estrutura do monorepo, docs, `.env.example`, schema SQL normalizado (§55), RLS, auditoria, idempotência | ✅ concluído |
| 1b | **Fundação — auth + API base** | Supabase Auth, papéis (ADMIN/ATENDENTE/EXPEDIÇÃO/FINANCEIRO), client de DB, shell React com login e layout | ✅ concluído |
| 1c | **Clientes + Produtos + Pedidos** | CRUD real, múltiplos endereços, variações/adicionais, itens de pedido, máquina de estados (§53) | ✅ concluído |
| 2 | **Inbox + WaScript** | Central de conversas, `WascriptService` (envio), webhook de entrada desacoplado, histórico persistente | ⬜ |
| 3 | **IA atendente + base de conhecimento** | `AIService` (provedor trocável), tool-calling controlado, KB, regras/estados da IA, handoff humano | ⬜ |
| 4 | **Automation Builder** | Canvas de nós (reusa `flow-graph.js`), motor de execução, simulador, proteção contra loop | ⬜ |
| 5 | **Catálogo + Carrinho no CRM** | Reuso do catálogo público; carrinho/orçamento ligado ao pedido | ⬜ |
| 6 | **Frenet — cotação** | `FrenetQuoteService` (WhiteLabel `/quotes` + simples), peso/dimensões do produto | ✅ concluído |
| 7 | **Confirmação + Etiqueta + Rastreio** | Validação de endereço, confirmação, etiqueta OneClick idempotente, webhook de tracking | ✅ concluído |
| 8 | **Campanhas + recuperação de vendas** | Segmentação, variáveis, follow-up, carrinho abandonado, opt-out | ⬜ |
| 9 | **Dashboard + métricas** | KPIs (§2/§41), gráficos, filtros por período | ⬜ |
| 10 | **Segurança + testes + produção** | Revisão de RLS, rate limiting, testes com mocks, backup, hardening | ⬜ |

## Fase 1b — concluída (detalhe)

- [x] Função SQL `staff_permissions` (0008) para montar autorização por requisição
- [x] Lib do backend: `supabaseAdmin`, `http` (CORS + erros amigáveis §54), `auth`
      (valida JWT + carrega staff/permissões), `audit` (§34), `log` (§40)
- [x] Functions: `health`, `me` (prova a stack), `customers` (CRUD real com permissões +
      auditoria + máscara de CPF §43), `webhook-wascript` (entrada desacoplada §5)
- [x] Esqueletos de serviços desacoplados: `FrenetService.quote` (real), `WascriptService`
      (envio real quando houver token), `AIService` (Anthropic, provedor trocável),
      `PaymentService.createLink` (real) — pendências marcadas `TODO(integração)`
- [x] App React (`web/`): login (Supabase Auth), layout terracota responsivo, guarda de rota +
      "sem acesso", Dashboard com health-check, tela de Clientes ligada de verdade à API
- [x] `netlify.toml` (ordem de redirects corrigida), `package.json`, `.gitignore`

## Fase 1c — concluída (detalhe)

- [x] Functions: `addresses` (CRUD endereços + auditoria), `products` (CRUD agregado:
      produto + categorias + variações + adicionais; auditoria de preço), `orders`
      (lista/detalhe/criação com totais no backend + PATCH de status pela máquina de estados)
- [x] Telas React reais: ficha do cliente (`CustomerDetail`) com dados + múltiplos endereços,
      `Products` (lista + editor completo), `Orders` (lista + construtor de pedido) e
      `OrderDetail` (itens, cliente, endereço, avançar status)
- [x] Helpers `format.ts` (BRL, datas, rótulos e transições de status espelhando o §53)

## Fases 6 + 7 — concluídas (detalhe)

Módulo de **Expedição / Frenet** entregue fora de ordem (a pedido da usuária), como primeira
versão enxuta e utilizável no dia a dia:

- [x] Camada Frenet desacoplada (§31): `frenet/{config,client,quote,shipment,label,tracking,mapping}`
      + `shipping/{normalize,validateAddress,volumes,buildOneClick,idempotency,trackingStore}`.
- [x] Migration `0009_shipping_frenet.sql`: envio standalone, `shipment_items`/`shipment_volumes`,
      `app_settings`, permissões novas, RLS das novas tabelas.
- [x] Functions: `frenet-settings`, `frenet-test`, `frenet-env`, `shipping-quote`, `shipments`,
      `shipment-label`, `shipment-tracking`, `shipment-cancel`, `shipping-stats`,
      `integration-logs`, `webhook-frenet-tracking`.
- [x] Telas React: Dashboard (KPIs), **Expedição** (board), **Envios** (histórico + filtros),
      **Novo envio** (assistente cotar→escolher→conferir→gerar), **Detalhe** (timeline, etiqueta,
      rastreio, checklist), **Configurações › Frenet**, **Logs**; faixa de homologação.
- [x] Segurança: tokens só em env; idempotência/lock na etiqueta (§17); saldo/limite (§16);
      webhook autenticado com resposta <10s; logs sanitizados; auditoria.
- [x] Testes unitários (mocks) da camada Frenet/expedição. Detalhe em [`frenet.md`](frenet.md).

> ⚠️ Nada testado localmente (sem Node no PC). Buildável na nuvem. A geração real de etiqueta
> depende de **Partner Token + saldo** (WhiteLabel), liberados pela Frenet no onboarding.

## Próximo — Fase 2 (Inbox + WaScript)
Central de conversas com tempo real (Supabase Realtime), envio via `WascriptService`,
processamento do webhook de entrada (`webhook-wascript` já recebe e enfileira), histórico
persistente.

> Pendência opcional útil: seed dos 28 produtos reais de `../js/products.js` para o banco
> (dados reais em vez de catálogo vazio). Pode entrar como migration `0009_seed_products.sql`.

## Fase 1a (detalhe)

- [x] Análise do projeto existente e definição de stack
- [x] Arquitetura validada com a usuária (React+Vite / Supabase+Netlify)
- [x] `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`
- [x] `.env.example` com todas as variáveis documentadas
- [x] Schema SQL normalizado (§55) em `supabase/migrations/` (0001–0007)
- [x] Políticas RLS e funções auxiliares de permissão (`auth_has_permission`)
- [x] `README.md` do sistema com passo a passo de setup
- [x] Máquina de estados do pedido (§53) + idempotência (§37) + auditoria (§34)

## Pré-requisitos da usuária (contas/credenciais — em paralelo, não bloqueiam a construção)

| Item | Para quê | Custo | Status |
|---|---|---|---|
| Conta **Supabase** | banco, login, tempo real, storage, cron | free tier | ⬜ |
| Segundo site **Netlify** (base `atelie-crm/`) | hospedar API + app do CRM | free tier | ⬜ |
| Token **WaScript/WaSpeed** | enviar/receber WhatsApp | plano pago do gateway | ⬜ |
| Chave de **API de IA** (Anthropic) | IA de atendimento | uso medido | ⬜ |
| Credenciais **Frenet** (`FRENET_API_TOKEN`, `FRENET_PARTNER_TOKEN`) | etiqueta/rastreio | conta Frenet | ⬜ |

> Cotação Frenet e pagamento InfinitePay já têm código real em `../netlify/functions/`.
> Serão reaproveitados; a etiqueta/rastreio da Frenet depende dos endpoints/credenciais acima.
