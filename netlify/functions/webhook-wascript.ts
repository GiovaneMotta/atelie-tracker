/* ================================================================
   POST /webhooks/wascript — entrada de eventos do WaScript (§5, §38).
   ARQUITETURA DESACOPLADA: este endpoint apenas VALIDA o segredo,
   PERSISTE o payload cru na tabela `webhooks` e responde 200 rápido.
   O PROCESSAMENTO (transformar em mensagem/conversa) roda depois, na
   fila (Fase 2), quando o formato do webhook do WaScript estiver
   confirmado na documentação/conta. NÃO inventamos o parsing aqui.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody } from '../lib/http';
import { admin } from '../lib/supabaseAdmin';
import { logIntegration } from '../lib/log';

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'POST') return json(event, 405, { error: 'Método não permitido.' });

  // Validação opcional de segredo (se configurado no WaScript e no env).
  const expected = process.env.WASCRIPT_WEBHOOK_SECRET;
  if (expected) {
    const got = event.headers['x-webhook-secret'] || event.queryStringParameters?.secret;
    if (got !== expected) return json(event, 401, { error: 'Segredo inválido.' });
  }

  const payload = parseBody<Record<string, unknown>>(event);
  await admin().from('webhooks').insert({
    source: 'wascript',
    event: String((payload as any)?.event || (payload as any)?.type || 'unknown'),
    payload,
    headers: { 'user-agent': event.headers['user-agent'] ?? null },
  });
  await logIntegration('WHATSAPP', 'info', 'Webhook WaScript recebido (enfileirado para processamento).');

  // Responder 200 sempre que o payload foi guardado (evita reenvio infinito).
  return json(event, 200, { ok: true });
});
