/* ================================================================
   /api/messages — envio manual de mensagens (§4).
     POST /api/messages   body { conversation_id, body, type? }
   Grava a mensagem (direction 'out'), envia pelo WaScript e atualiza o
   status (queued -> sent | failed). Ao enviar manualmente, a IA da conversa
   passa a 'humano' (§9/§46 — humano assumiu). Idempotência simples por
   Idempotency-Key opcional evita envio duplicado no double-click.
   Permissão: conversations.write.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { WascriptService } from '../lib/services/WascriptService';

export const handler: Handler = withHttp(async (event) => {
  const ctx = await requirePermission(event, 'conversations.write');
  const sb = admin();
  const body = parseBody<{ conversation_id?: string; body?: string; type?: string }>(event);
  const conversationId = body.conversation_id;
  const text = (body.body || '').trim();
  if (!conversationId) throw badRequest('conversation_id é obrigatório.');
  if (!text) throw badRequest('Mensagem vazia.');

  const { data: conv } = await sb.from('conversations').select('*').eq('id', conversationId).maybeSingle();
  if (!conv) throw notFound('Conversa não encontrada.');
  if (!conv.external_id) throw badRequest('Conversa sem telefone de destino.');

  // Idempotência opcional (evita duplicar no clique-duplo).
  const idem = event.headers['idempotency-key'];
  if (idem) {
    const { data: hit } = await sb.from('idempotency_keys').select('result').eq('key', `msg:${idem}`).maybeSingle();
    if (hit?.result) return json(event, 200, hit.result);
    await sb.from('idempotency_keys').insert({ key: `msg:${idem}`, scope: 'message' }).select().maybeSingle();
  }

  // 1) grava a mensagem como "enfileirada"
  const { data: msg, error: insErr } = await sb.from('messages').insert({
    conversation_id: conversationId, direction: 'out', sender: 'human',
    sender_staff_id: ctx.userId, type: body.type || 'text', body: text, status: 'queued',
  }).select('*').single();
  if (insErr) throw badRequest(insErr.message);

  // 2) tenta enviar pelo WaScript
  let status = 'sent';
  let errText: string | null = null;
  try {
    await WascriptService.sendText(conv.external_id, text);
  } catch (e) {
    status = 'failed';
    errText = e instanceof Error ? e.message : 'Falha no envio.';
  }
  await sb.from('messages').update({ status, error: errText }).eq('id', msg.id);

  // 3) atualiza a conversa (preview + IA passa a humano)
  await sb.from('conversations').update({
    last_message_at: new Date().toISOString(),
    last_message_preview: text.slice(0, 120),
    ai_state: 'humano',
  }).eq('id', conversationId);

  const result = { message: { ...msg, status, error: errText } };
  if (idem) await sb.from('idempotency_keys').update({ result }).eq('key', `msg:${idem}`);
  return json(event, status === 'failed' ? 502 : 201, result);
});
