# Notificações no celular (Web Push)

Dois avisos chegam no celular, mesmo com o painel fechado:

| Quando | Título | Mensagem |
|---|---|---|
| Pedido do site é gravado no banco | **Novo pedido recebido!** | `Pedido #1024 · Mariana Souza · R$ 319,00` |
| Pedido passa para **pago** no painel | **Venda aprovada!** | a mesma linha |

Tocar na notificação abre o pedido em `/pedidos/<id>`.

**Não avisam:** pedido cancelado, rascunho criado à mão no painel (`channel`
`manual`), pedido de teste (`channel` `teste`) e tentativa de pedido que falhou
(a transação some inteira, inclusive o aviso).

---

## Como funciona

```
site → create_site_order (RPC)          painel → "Registrar pagamento"
          │                                        │
          ▼                                        ▼
    orders (INSERT)                        orders (UPDATE → pago)
          │                                        │
          └──────────► TRIGGER ◄──────────────────┘
                          │  (mesma transação do pedido)
                          ▼
                    push_outbox  ── fila durável, unique(order_id, kind)
                          │
                 push_poke() via pg_net          ← cutucão imediato
                 pg_cron, 1×/min                 ← retentativa
                 orders.ts, ao registrar pago    ← atalho, toca na hora
                          │
                          ▼
            POST /api/push-dispatch  (painel, Cloudflare)
                          │
                 trava em idempotency_keys (scope 'push')
                          │
                          ▼
            serviço de push → celular → Service Worker → notificação
```

Decisões que importam:

- **A `create_site_order` não foi tocada.** O aviso entra por um *trigger* em
  `orders`, não por dentro da função que cria o pedido. Preço, cupom,
  idempotência e validação de produto continuam exatamente como estavam, e uma
  notificação nunca pode derrubar uma venda.
- **O disparo é do servidor**, não do navegador da cliente. Ela pode fechar a
  página no mesmo segundo que o aviso sai igual.
- **A fila é durável.** Se o painel estiver fora do ar, a linha fica em
  `push_outbox` até ser entregue; o `pg_cron` tenta de novo a cada minuto, e
  desiste depois de 10 tentativas (o motivo fica em `integration_logs`).
- **Um aviso de cada tipo por pedido por aparelho.** `unique(order_id, kind)`
  na fila, mais a trava `push:<tipo>:<pedido>:<aparelho>` em `idempotency_keys`
  — gravada **antes** do envio. Reprocessar não duplica.
- **Inscrição que o navegador recusa (410/404) sai da lista sozinha.** Erro
  passageiro (500, rede) solta a trava e fica para a retentativa.
- **O site público não foi alterado.** Quem vira aplicativo instalável é o
  painel: é nele que a notificação chega e é nele que o pedido abre.

## Onde cada coisa mora

| Peça | Arquivo |
|---|---|
| Tabelas, gatilhos, pg_net/pg_cron | `supabase/migrations/0032_push_notificacoes.sql` |
| Criptografia e VAPID | `netlify/lib/webpush.ts` |
| Envio da fila | `netlify/functions/push-dispatch.ts` |
| Inscrever / listar / remover / testar | `netlify/functions/push.ts` |
| Tela | `web/src/pages/Notificacoes.tsx` + `web/src/lib/push.ts` |
| Service Worker e PWA | `web/public/sw.js`, `manifest.webmanifest`, `icons/` |

---

## Configuração (uma vez só)

### 1. Variáveis

⚠️ **As variáveis de texto deste projeto são gerenciadas pelo `wrangler.toml`.**
A dashboard da Cloudflare só aceita cadastrar **Secrets** — o campo *Type* fica
travado. Então cada chave vai num lugar:

| Nome | Onde | Para quê |
|---|---|---|
| `VAPID_PUBLIC_KEY` | `wrangler.toml`, em `[vars]` | Identifica o painel para o serviço de push. É pública por natureza — vai inteira para o navegador. |
| `VAPID_SUBJECT` | `wrangler.toml`, em `[vars]` | Contato do responsável, formato `mailto:…`. |
| `VAPID_PRIVATE_KEY` | **Secret** na dashboard | Assina os envios. **Nunca** no repositório nem no navegador. |
| `PUSH_DISPATCH_SECRET` | **Secret** na dashboard (opcional) | Se cadastrada, `/api/push-dispatch` passa a exigir o segredo. Precisa ser igual a `app_settings.push_dispatch_secret`. |

Dashboard: projeto do painel → *Settings* → *Variables and secrets*, ambiente
**Production** → *+ Add*.

A Cloudflare só injeta variável em build novo: depois de salvar, publique de
novo (qualquer commit serve).

### 2. Migration no Supabase

Rode `supabase/migrations/0032_push_notificacoes.sql` inteiro no SQL Editor.
Ele liga `pg_net` e `pg_cron` sozinho quando tem permissão; se avisar que não
conseguiu, ligue em *Database → Extensions* e rode de novo.

A última consulta do arquivo mostra se tudo subiu e imprime o
`push_dispatch_secret` (só é preciso se você quiser usar o item opcional acima).

### 3. No celular

Painel → **Configurações › Notificações** → *Ativar neste aparelho* → responder
**Permitir**. Repita em cada celular que deve ser avisado.

No **iPhone** o push só funciona com o painel instalado: *Compartilhar* →
*Adicionar à Tela de Início*, abrir por esse ícone, e então ativar.

---

## Quando não chega notificação

1. **Configurações › Notificações** diz "Falta cadastrar as chaves"? → item 1 acima.
2. O aparelho aparece na lista? Se não, ative de novo nele.
3. "Bloqueado nas configurações do navegador" → só a dona do celular resolve:
   cadeado na barra de endereço → Notificações → Permitir.
4. *Enviar teste* funciona mas pedido real não avisa? Veja a fila:
   ```sql
   select * from public.push_outbox where dispatched_at is null order by created_at;
   ```
   Fila crescendo = o cutucão não chega no painel. Confira `pg_net`:
   ```sql
   select count(*) from pg_extension where extname in ('pg_net','pg_cron');
   select * from net._http_response order by created desc limit 5;
   ```
5. Erros de envio ficam em `integration_logs` e em `push_devices.last_error`.

## Rollback

O fim da migration 0032 tem o rollback completo, comentado. Desfazer não
afeta pedidos, pagamentos nem estoque: as notificações são uma camada à parte.
