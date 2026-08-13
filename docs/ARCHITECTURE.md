# Arquitetura — CRM Ateliê da Lili

> Documento vivo. É a "planta" do sistema. Ler antes de qualquer alteração estrutural.
> Última revisão: Fase 1a (fundação: arquitetura + banco).

## 1. Visão geral

Sistema centralizado de **CRM + atendimento WhatsApp + automação/IA + catálogo + vendas + expedição**
para o Ateliê da Lili (saída maternidade). Substitui, de forma incremental, o CRM em
`localStorage` (`../crm/`) por um sistema **multiusuário real**, com banco de dados,
autenticação por função, tempo real e integrações externas de verdade.

**Princípio-mestre:** confiabilidade > segurança > não-duplicidade > integrações reais >
facilidade de uso > automação > IA > design. Nenhuma tela falsa; nenhuma credencial no
frontend; nenhuma informação comercial inventada pela IA.

## 2. Topologia (o que roda onde)

```
┌─────────────────────────────────────────────────────────────────────┐
│  NAVEGADOR (equipe do ateliê)                                        │
│  web/  → App React + Vite (SPA). Só UI + chamadas à API.             │
│         Autentica no Supabase (JWT). NUNCA guarda tokens de terceiros.│
└───────────────┬───────────────────────────────┬─────────────────────┘
                │ HTTPS (JWT do Supabase)        │ Realtime (websocket)
                ▼                                 ▼
┌───────────────────────────────┐   ┌─────────────────────────────────┐
│  netlify/functions/  (Node/TS)│   │  SUPABASE                       │
│  API interna + integrações:   │   │  • Postgres (banco normalizado) │
│   /api/customers /api/orders  │   │  • Auth (login, sessão, JWT)    │
│   /api/shipping /api/ai ...    │   │  • RLS (permissões por função)  │
│   Webhooks:                    │◄─►│  • Realtime (inbox, kanban)     │
│   /webhooks/wascript           │   │  • Storage (mídia, etiquetas)   │
│   /webhooks/frenet/tracking    │   │  • pg_cron (esperas/follow-ups) │
│   /webhooks/payment            │   └─────────────────────────────────┘
│  Serviços desacoplados:        │
│   FrenetService  WascriptService│──► APIs externas (Frenet, WaScript,
│   AIService  PaymentService     │     provedor de IA, pagamento)
└───────────────────────────────┘
```

**Por que este desenho:**
- O PC de desenvolvimento só tem `git` (sem Node/Python/Docker). O Netlify **compila e roda
  na nuvem** — por isso o backend não precisa de runtime local. O teste acontece no deploy,
  fluxo que a usuária já pratica.
- Supabase entrega, gerenciado e barato (free tier generoso), tudo que exigiria um servidor
  24h próprio: banco, login/RLS, tempo real (inbox), storage, e agendador (`pg_cron`).
- Netlify Functions reaproveita a base já existente (`../netlify/functions/frete.js` etc.) e
  concentra **toda operação sensível no backend** (tokens em variáveis de ambiente).

## 3. Estrutura de pastas (monorepo `atelie-crm/`)

```
atelie-crm/
  docs/
    ARCHITECTURE.md          ← este arquivo
    ROADMAP.md               ← as 10 fases e o status de cada uma
  supabase/
    migrations/              ← schema SQL versionado (fonte da verdade do banco)
  netlify/
    functions/               ← API interna + webhooks + integrações (Node/TS)
    lib/                     ← serviços desacoplados (Frenet/Wascript/AI/Payment) + db + auth
  web/                       ← App React + Vite (frontend do CRM)
  packages/shared/           ← código isomórfico (tipos, motor de fluxo, validações)
  .env.example               ← TODAS as variáveis (sem segredos reais)
  netlify.toml               ← build/deploy do novo sistema
```

O **catálogo público atual** (`../index.html`, `../produto.html`, `../js/`) e o **CRM legado**
(`../crm/`) permanecem intactos e no ar. A migração é incremental: dados e telas migram fase a
fase. O `../crm/js/flow-graph.js` (motor de fluxo isomórfico) será movido/importado por
`packages/shared/` — reuso, não reescrita.

## 4. Deploy

O novo sistema é um **deploy separado** do catálogo público (base = `atelie-crm/`), para não
arriscar o site que já vende. Recomendação: um segundo site no Netlify apontando para esta
pasta, com `netlify.toml` próprio. O catálogo público continua no deploy atual da raiz.

## 5. Camada de integração (desacoplamento — §5, §8, §15)

Cada serviço externo fica atrás de uma interface em `netlify/lib/`. Regras invioláveis:

| Serviço | Arquivo | Estado | Observação |
|---|---|---|---|
| Frenet | `lib/frenet/*` (client/quote/shipment/label/tracking) | **completo (Fases 6+7)**: cotação, etiqueta OneClick, rastreio, webhook | só endpoints documentados — ver [`frenet.md`](frenet.md) |
| WaScript | `lib/wascript/WascriptService.ts` | envio real quando houver token; entrada por webhook desacoplada | ref: api-whatsapp.wascript.com.br/api-docs |
| IA | `lib/ai/AIService.ts` | provedor trocável (default Anthropic) | tool-calling; base de conhecimento é a fonte |
| Pagamento | `lib/payment/PaymentService.ts` | reusa InfinitePay (`pagamento.js`) | webhook idempotente |

**Quando faltar credencial/endpoint documentado: implementar a estrutura, marcar `TODO(integração)`
e documentar no `.env.example` — nunca inventar.**

## 6. Segurança (resumo — detalhe no ROADMAP fase 10)

- Tokens de terceiros **só** no backend (variáveis de ambiente do Netlify).
- Autenticação e sessão via Supabase Auth; autorização via **RLS** no Postgres + checagem por
  função nas Functions (nunca confiar só no frontend).
- Idempotência em operações sensíveis (`idempotency_keys`) — etiqueta, pagamento, mensagens,
  criação de pedido, webhooks.
- Auditoria (`audit_logs`) para preço, desconto, pagamento, endereço, frete, etiqueta,
  cancelamento — quem, o quê, quando, valor antigo/novo.
- LGPD: CPF mascarado para quem não tem permissão; princípio do mínimo acesso; anonimização.

## 7. IA com ferramentas controladas (§58, §59)

A IA **não** acessa o banco diretamente. Ela chama *tools* expostas pelo backend, cada uma com
checagem de permissão. Ferramentas de leitura/rascunho são livres; ferramentas críticas
(`generate_shipping_label`, `refund_payment`, `cancel_order`, `change_price`) exigem **aprovação
humana**, salvo se explicitamente habilitadas nas configurações. Estado da IA por conversa:
`ATIVA | PAUSADA | HUMANO | TRANSFERIDA` — nunca responde automaticamente em atendimento humano.
