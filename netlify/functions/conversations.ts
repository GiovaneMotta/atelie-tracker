/* ================================================================
   /api/conversations — central de atendimento / Inbox (§4, §9, §46).
     GET   /api/conversations              -> lista (filtros: status, mine, q)
     GET   /api/conversations?id=<uuid>     -> conversa + mensagens
     POST  /api/conversations               -> abre/encontra conversa (phone|customer_id)
     PATCH /api/conversations?id=<uuid>      -> assumir/devolver IA, atribuir,
                                                status, prioridade, marcar lida
   Permissões: conversations.read / conversations.write.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound } from '../lib/http';
import { getAuth, requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { normalizePhone } from '../lib/services/WascriptService';

const LIST = '*, customer:customers(id,name)';

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'GET') {
    const ctx = await requirePermission(event, 'conversations.read');
    if (id) {
      const { data: conversation, error } = await sb.from('conversations')
        .select('*, customer:customers(id,name,whatsapp,phone,document)').eq('id', id).maybeSingle();
      if (error) throw badRequest(error.message);
      if (!conversation) throw notFound('Conversa não encontrada.');
      const { data: messages } = await sb.from('messages')
        .select('*').eq('conversation_id', id).order('created_at', { ascending: true }).limit(400);
      return json(event, 200, { conversation, messages: messages ?? [] });
    }
    let q = sb.from('conversations').select(LIST)
      .order('last_message_at', { ascending: false, nullsFirst: false }).limit(100);
    const status = event.queryStringParameters?.status;
    if (status) q = q.eq('status', status);
    if (event.queryStringParameters?.mine === '1') q = q.eq('assignee_id', ctx.userId);
    const { data, error } = await q;
    if (error) throw badRequest(error.message);
    return json(event, 200, { conversations: data ?? [] });
  }

  if (event.httpMethod === 'POST') {
    await requirePermission(event, 'conversations.write');
    const body = parseBody<{ phone?: string; customer_id?: string }>(event);
    let phone = body.phone ? normalizePhone(body.phone) : '';
    let customerId = body.customer_id ?? null;

    if (!phone && customerId) {
      const { data: c } = await sb.from('customers').select('whatsapp, phone').eq('id', customerId).maybeSingle();
      const raw = c?.whatsapp || c?.phone || '';
      phone = raw ? normalizePhone(raw) : '';
    }
    if (!phone) throw badRequest('Informe um telefone ou um cliente com WhatsApp.');

    // Encontra conversa existente por canal+telefone, senão cria.
    const { data: existing } = await sb.from('conversations')
      .select('*').eq('channel', 'whatsapp').eq('external_id', phone).maybeSingle();
    if (existing) return json(event, 200, { conversation: existing });

    // Tenta vincular a um cliente pelo telefone, se não veio explícito.
    if (!customerId) {
      const { data: match } = await sb.from('customers').select('id')
        .or(`whatsapp.eq.${phone},phone.eq.${phone}`).limit(1).maybeSingle();
      customerId = match?.id ?? null;
    }
    const { data: created, error } = await sb.from('conversations')
      .insert({ channel: 'whatsapp', external_id: phone, customer_id: customerId, status: 'aberta', ai_state: 'ativa' })
      .select('*').single();
    if (error) throw badRequest(error.message);
    return json(event, 201, { conversation: created });
  }

  if (event.httpMethod === 'PATCH') {
    const ctx = await requirePermission(event, 'conversations.write');
    if (!id) throw badRequest('Informe o id da conversa.');
    const body = parseBody<Record<string, unknown>>(event);
    const updates: Record<string, unknown> = {};
    for (const k of ['ai_state', 'status', 'priority', 'assignee_id']) if (k in body) updates[k] = body[k];
    if (body.mark_read) updates.unread_count = 0;
    if (body.assume) { updates.ai_state = 'humano'; updates.assignee_id = ctx.userId; }
    if (body.release_to_ai) updates.ai_state = 'ativa';
    if (Object.keys(updates).length === 0) throw badRequest('Nada para atualizar.');

    const { data, error } = await sb.from('conversations').update(updates).eq('id', id)
      .select('*, customer:customers(id,name,whatsapp,phone,document)').single();
    if (error) throw badRequest(error.message);
    return json(event, 200, { conversation: data });
  }

  throw badRequest('Método não suportado.');
});
