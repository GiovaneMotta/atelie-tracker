# Integração Frenet — Expedição (Fases 6 + 7)

> Módulo de **cotação → confirmação → etiqueta (OneClick) → rastreio → webhook**.
> Fonte técnica: documentação oficial **https://docs.frenet.com.br/**. Nenhum endpoint,
> header, payload ou status foi inventado — tudo abaixo veio da doc oficial.

## 1. Visão geral do fluxo

```
NOVO ENVIO → DADOS → CALCULAR FRETE → ESCOLHER SERVIÇO → CONFERIR
           → CONFIRMAR → GERAR ETIQUETA (OneClick) → ABRIR/IMPRIMIR
           → RASTREAR (API + webhook)
```

A Frenet WhiteLabel funciona assim: você **cota** (obtém `ShippingServiceCode`), depois chama
**OneClick**, que cria o pedido, **paga com o saldo da carteira Frenet** e devolve as **URLs das
etiquetas**. O rastreio chega por **webhook** (recomendado) e/ou por **consulta à API**.

## 2. Arquitetura (camada isolada — §31)

A UI nunca fala com a Frenet. Ela chama a **API interna** (Netlify Functions), que fala com a
Frenet através da camada desacoplada em `netlify/lib/frenet/`:

```
web/ (React)  ──►  /api/*  (Netlify Functions)  ──►  netlify/lib/frenet/*  ──►  Frenet
                                                     netlify/lib/shipping/* (regras)
```

| Arquivo | Papel |
|---|---|
| `frenet/config.ts` | Resolve tokens (env) + settings (banco). Tokens só no backend. |
| `frenet/client.ts` | `FrenetClient`: timeout, headers, erro amigável, log sanitizado, retry seguro. |
| `frenet/quote.ts` | `FrenetQuoteService`: cotação WhiteLabel e simples. |
| `frenet/shipment.ts` | `FrenetShipmentService`: OneClick, consultar, cancelar, carteira. |
| `frenet/label.ts` | `FrenetLabelService`: obter/reimprimir etiqueta. |
| `frenet/tracking.ts` | `FrenetTrackingService`: consulta e parsing de webhook. |
| `frenet/mapping.ts` | Códigos de status/evento da Frenet → estados internos. |
| `shipping/normalize.ts` | Normaliza CEP/telefone/CPF/valores (§8). |
| `shipping/validateAddress.ts` | Valida endereço; número obrigatório (§9). |
| `shipping/volumes.ts` | Consolida itens em volumes (§29). |
| `shipping/buildOneClick.ts` | Monta o payload OneClick (§15). |
| `shipping/idempotency.ts` | Trava/memorização anti-duplicidade (§17). |
| `shipping/trackingStore.ts` | Persiste eventos sem duplicar; avança status (§24). |

## 3. Endpoints Frenet utilizados (oficiais)

**Bases (configuráveis por ambiente):**
- Cotação/rastreio simples: `https://api.frenet.com.br`
- WhiteLabel produção: `https://whitelabel.frenet.com.br/v1`
- WhiteLabel homologação: `https://whitelabel-hml.frenet.dev/v1` *(confirme a URL exata com a Frenet no onboarding)*

**Headers:** `token` (cliente) em todas; `x-partner-token` (parceiro) nas WhiteLabel;
`x-printing-format` (A4 padrão) na etiqueta.

| Operação | Método | Caminho |
|---|---|---|
| Cotação p/ postagem | POST | `{whitelabel}/quotes` → `Quotations[].ShippingServiceCode` |
| Cotação simples (vitrine) | POST | `api.frenet.com.br/shipping/quote` |
| Gerar etiqueta (OneClick) | POST | `{whitelabel}/shipments/oneclick` |
| Obter/reimprimir etiqueta | GET | `{whitelabel}/shipments/{shipmentId}/label` |
| Consultar envio | GET | `{whitelabel}/shipments/{shipmentId}` |
| Cancelar envio | POST | `{whitelabel}/shipments/{shipmentId}/cancel` (204) |
| Saldo/limite (carteira) | GET | `{whitelabel}/wallet` → `Balance`, `LabelLimit` |
| Rastreio (API) | POST | `api.frenet.com.br/tracking/trackinginfo` |
| Webhook de tracking | POST | *(Frenet → nós)* `/webhooks/frenet-tracking` |

**Códigos de rastreio (EventType):** `0` postado · `1` em trânsito · `2` atraso · `3` devolvido ·
`4` extraviado · `5` saiu para entrega · `9` entregue · `18` aguardando coleta.

**ShipmentStatus (envio):** 1 criado · 2 aguardando pagamento · 3 falha pagamento · 4 pago ·
5 postado · 6 cancelamento agendado · 7 cancelado · 9 excluído · 18 entregue no ponto.

## 4. Variáveis de ambiente (no Netlify — nunca no código/frontend)

| Variável | Para quê |
|---|---|
| `FRENET_API_TOKEN` | Token do Cliente (todas as chamadas). |
| `FRENET_PARTNER_TOKEN` | Token do Parceiro (WhiteLabel: etiqueta/carteira). Da Frenet, após onboarding. |
| `FRENET_ENV` | `homologacao` \| `producao` (também editável na tela). |
| `FRENET_BASE_URL` | Base da cotação/rastreio simples. |
| `FRENET_WHITELABEL_BASE_URL` | Base WhiteLabel de produção. |
| `FRENET_WHITELABEL_BASE_URL_HML` | Base WhiteLabel de homologação. |
| `FRENET_CEP_ORIGEM` | CEP de origem (também editável). |
| `FRETE_PESO/ALTURA/LARGURA/COMPRIMENTO` | Caixa padrão. |
| `FRENET_WEBHOOK_TOKEN_NAME` / `_VALUE` | Par nome/valor do header de segurança do webhook. |
| `SITE_URL` | Base do site (compõe a URL do webhook). |

> Config **não-secreta** (CEP origem, ambiente, base URLs, remetente, caixa) também fica no banco
> (`app_settings.frenet`) e é editável na tela **Configurações › Frenet**. Os **tokens nunca** vão
> para o banco/tela/log.

## 5. Endpoints internos (API)

| Método | Rota | Permissão | O quê |
|---|---|---|---|
| GET/PATCH | `/api/frenet-settings` | `settings.read` / `settings.write` | Config não-secreta + status dos tokens |
| POST | `/api/frenet-test` | `settings.read` | Testar conexão (carteira ou cotação) |
| GET | `/api/frenet-env` | (staff) | Ambiente p/ faixa de homologação |
| POST | `/api/parse-recipient` | `shipping.quote` | Cola a mensagem → extrai destinatário (heurística + IA + ViaCEP) |
| GET | `/api/cep` | (staff) | Autocompletar rua/bairro/cidade/UF pelo CEP (ViaCEP) |
| POST | `/api/shipping-quote` | `shipping.quote` | Cotação real |
| GET/POST/PATCH | `/api/shipments` | `shipments.read` / `shipping.create` / `shipments.write` | Listar/detalhe/criar/editar envio |
| GET/POST | `/api/shipment-label` | `labels.read` / `labels.generate` | Reimprimir / **gerar** etiqueta |
| GET/POST | `/api/shipment-tracking` | `shipments.read` | Eventos / atualizar rastreio |
| POST | `/api/shipment-cancel` | `shipments.cancel` | Cancelar |
| GET | `/api/shipping-stats` | `shipments.read` | KPIs do dashboard |
| GET | `/api/integration-logs` | `settings.read` | Logs de integração |
| POST | `/webhooks/frenet-tracking` | (token do webhook) | Recebe tracking da Frenet |

## 6. Banco (migration `0009_shipping_frenet.sql`)

Estende a `0004` para envio **standalone** (sem exigir pedido do CRM): `shipments` ganha snapshot
de destinatário/remetente, serviço, dados da Frenet (shipment id, label/tracking url, status) e
trava de geração; novas tabelas `shipment_items`, `shipment_volumes`, `app_settings`; `shipping_quotes`
e `tracking_events` ganham colunas (session, código original, localização). Novas permissões:
`shipping.create`, `shipments.read/write/cancel`, `settings.read` (concedidas a **admin** e **expedição**).

## 7. Como configurar HOMOLOGAÇÃO

1. No Netlify, defina `FRENET_API_TOKEN` (de homologação) e, se já tiver, `FRENET_PARTNER_TOKEN`.
   Deixe `FRENET_ENV=homologacao`.
2. Aplique as migrations `0001`→`0009` no Supabase.
3. Faça login como **admin** → **Configurações › Frenet**: preencha **CEP de origem**, **remetente**
   e a **caixa padrão**; confira a base WhiteLabel de homologação. **Salvar**.
4. Clique **Testar conexão** → deve mostrar 🟢 (carteira, se houver Partner Token; senão, cotação).
5. O topo do sistema mostra **⚠️ AMBIENTE DE HOMOLOGAÇÃO**.

## 7b. Preenchimento automático (colar mensagem / CEP)

Para **não digitar tudo à mão**, a tela **Novo envio** tem:

- **Colar dados do cliente:** cola a mensagem (ex.: WhatsApp) e clica **Extrair e preencher**.
  O backend usa **heurística grátis** (CEP/CPF/telefone/nome/número) sempre, e a **IA**
  (Anthropic, `ANTHROPIC_API_KEY`) quando configurada — que lê mensagens bagunçadas com bem mais
  precisão. O endereço (rua/bairro/cidade/UF) é confirmado pelo **ViaCEP** a partir do CEP.
  A IA é instruída a **não inventar** dados ausentes.
- **Autocompletar por CEP:** digitando o CEP, o sistema preenche rua/bairro/cidade/UF sozinho.

Sem `ANTHROPIC_API_KEY`, o modo grátis funciona normalmente (mensagens muito bagunçadas podem
exigir ajustar nome/número). Ativar a IA depois é só cadastrar a chave — nada muda no código.

## 8. Como testar a COTAÇÃO

1. **Expedição › Novo envio** → preencha um destinatário com **número** (obrigatório) e um CEP válido.
2. Adicione um produto (puxa peso/dimensões) ou informe o valor da mercadoria.
3. **Calcular frete** → aparecem os serviços **retornados pela Frenet** (PAC/SEDEX/…), com destaque
   de **menor preço** e **menor prazo**. Nada é simulado.

## 9. Como testar a GERAÇÃO REAL da etiqueta

> Exige **Partner Token** + **saldo/limite** na carteira Frenet. Em homologação, use os dados de teste
> fornecidos pela Frenet.

1. Escolha um serviço → **Conferir** → revise tudo → **Confirmar e gerar etiqueta**.
2. O backend: valida endereço (§9) → checa saldo (§16) → adquire **trava de idempotência** (§17) →
   chama **OneClick** → salva `ShipmentId`, etiqueta e rastreio → status `etiqueta_gerada`.
3. Na tela do envio: **Abrir etiqueta**, **Imprimir**, **Copiar rastreio**.
4. **Clique duplo / repetição não gera 2 etiquetas** nem cobra de novo — a trava devolve o resultado
   já gerado. Reimpressão usa a etiqueta existente (§20), nunca gera outra.
5. Erros (saldo, dados, indisponibilidade) aparecem de forma amigável e **não** marcam como gerada.

## 10. Como configurar o WEBHOOK de tracking

1. Defina `SITE_URL` e o par `FRENET_WEBHOOK_TOKEN_NAME`/`FRENET_WEBHOOK_TOKEN_VALUE` no Netlify.
2. No painel da Frenet, registre a URL: `https://SEU-SITE-CRM.netlify.app/webhooks/frenet-tracking`
   e o **mesmo** header nome/valor.
3. A Frenet chama via **POST**; o endpoint valida o token, responde **2XX em <10s**, localiza o envio
   (por `ShipmentId`/`TrackingNumber`/`OrderId`), grava o payload, **não duplica eventos** e atualiza
   o status (sem regredir `entregue`/`cancelado`).
4. Também é possível atualizar manualmente pelo botão **↻ Rastreio** (consulta a API).

## 11. Como migrar para PRODUÇÃO

1. Conclua o **onboarding/homologação** com a Frenet; receba os **tokens e endpoints de produção**.
2. No Netlify, troque `FRENET_API_TOKEN`/`FRENET_PARTNER_TOKEN` pelos de produção e confirme as
   bases (`whitelabel.frenet.com.br/v1`).
3. Em **Configurações › Frenet**, mude o **Ambiente** para **Produção** e **Salvar**. A faixa de
   homologação some.
4. Garanta **saldo e limite** na carteira. Faça **1 envio real** de teste antes de operar em volume.

## 12. Limitações conhecidas (transparência — §45)

- **OneClick depende de conta WhiteLabel + Partner Token + saldo/limite**, liberados pela Frenet
  após onboarding. Sem isso, a **cotação funciona** e a **geração de etiqueta fica indisponível**
  com mensagem clara — nada é simulado.
- A **URL exata de homologação WhiteLabel** deve ser confirmada com a Frenet; deixamos configurável.
- O **número de rastreio** costuma chegar pela **postagem/webhook** (assíncrono). Antes disso, o
  refresh atualiza o **status** do envio (getShipment), mas não há eventos detalhados.
- **NF-e** (Invoice) é opcional e não é o foco desta versão; a estrutura já aceita os campos.
- O PC de desenvolvimento não roda backend local; **build/teste é no deploy** (Netlify) e via `npm test`
  onde houver Node.
