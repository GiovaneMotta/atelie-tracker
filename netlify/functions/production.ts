/* ================================================================
   /api/production — linha de produção por setores (modelo SOA).
     GET    /api/production            -> { sectors[], cards[] }
     POST   /api/production            -> cria card (entra na Fila)
     PATCH  /api/production?id=<uuid>   -> avançar/devolver/mover/editar
     DELETE /api/production?id=<uuid>
   Ações no PATCH (body.action): 'advance' | 'return' | 'move' | 'start' | 'update'
   Cada movimento grava um evento (auditoria).
   Permissões: production.read / production.write.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const CARD_SELECT = '*, customer:customers(name), pedido:orders(number)';

async function loadSectors() {
  const { data } = await admin().from('production_sectors').select('*').order('position');
  return data ?? [];
}
async function logEvent(cardId: string, action: string, fromSector: string | null, toSector: string | null, actorId: string, reason?: string) {
  await admin().from('production_events').insert({
    card_id: cardId, action, from_sector: fromSector, to_sector: toSector, actor_id: actorId, reason: reason ?? null,
  });
}

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'production.read');
    if (id) {
      const { data: card, error } = await sb.from('production_cards').select(CARD_SELECT).eq('id', id).maybeSingle();
      if (error) throw badRequest(error.message);
      if (!card) throw notFound('Card não encontrado.');
      const { data: events } = await sb.from('production_events')
        .select('*, actor:staff(name)')
        .eq('card_id', id).order('created_at', { ascending: false }).limit(50);
      return json(event, 200, { card, events: events ?? [] });
    }
    const [sectors, { data: cards, error }] = await Promise.all([
      loadSectors(),
      sb.from('production_cards').select(CARD_SELECT).order('position'),
    ]);
    if (error) throw badRequest(error.message);
    return json(event, 200, { sectors, cards: cards ?? [] });
  }

  if (event.httpMethod === 'POST') {
    const ctx = await requirePermission(event, 'production.write');
    const body = parseBody<any>(event);
    if (!body.title || String(body.title).trim() === '') throw badRequest('Informe um título.');
    const sectors = await loadSectors();
    const first = sectors[0];
    const { data: card, error } = await sb.from('production_cards').insert({
      title: body.title, order_id: body.order_id ?? null, customer_id: body.customer_id ?? null,
      custom: body.custom ?? {}, priority: body.priority || 'normal', due_at: body.due_at ?? null,
      sector_id: first?.id ?? null, created_by: ctx.userId,
    }).select(CARD_SELECT).single();
    if (error) throw badRequest(error.message);
    await logEvent(card.id, 'criar', null, first?.id ?? null, ctx.userId);
    return json(event, 201, { card });
  }

  if (event.httpMethod === 'PATCH') {
    const ctx = await requirePermission(event, 'production.write');
    if (!id) throw badRequest('Informe o id do card.');
    const body = parseBody<any>(event);
    const { data: card } = await sb.from('production_cards').select('*').eq('id', id).maybeSingle();
    if (!card) throw notFound('Card não encontrado.');

    const action = body.action || 'update';
    let updates: Record<string, unknown> = {};

    if (action === 'start') {
      updates.status = 'em_andamento';
      await logEvent(id, 'iniciar', card.sector_id, card.sector_id, ctx.userId);
    } else if (action === 'advance' || action === 'return' || action === 'move') {
      const sectors = await loadSectors();
      const idx = sectors.findIndex((s: any) => s.id === card.sector_id);
      let target: any = null;
      if (action === 'move' && body.sector_id) target = sectors.find((s: any) => s.id === body.sector_id);
      else if (action === 'advance') target = sectors[idx + 1];
      else if (action === 'return') target = sectors[idx - 1];
      if (!target) throw badRequest(action === 'advance' ? 'Já está no último setor.' : action === 'return' ? 'Já está no primeiro setor.' : 'Setor inválido.');
      if (action === 'return' && !body.reason) throw badRequest('Informe o motivo da devolução.');
      updates.sector_id = target.id;
      updates.status = target.is_final ? 'concluido' : 'aguardando';
      await logEvent(id, action === 'return' ? 'devolver' : action === 'advance' ? 'concluir' : 'mover', card.sector_id, target.id, ctx.userId, body.reason);
    }

    // edição de campos (título, prioridade, custom, due, status)
    for (const k of ['title', 'priority', 'custom', 'due_at', 'status', 'order_id', 'customer_id']) if (k in body) updates[k] = body[k];

    if (Object.keys(updates).length === 0) throw badRequest('Nada para atualizar.');
    const { data: saved, error } = await sb.from('production_cards').update(updates).eq('id', id).select(CARD_SELECT).single();
    if (error) throw badRequest(error.message);
    return json(event, 200, { card: saved });
  }

  if (event.httpMethod === 'DELETE') {
    await requirePermission(event, 'production.write');
    if (!id) throw badRequest('Informe o id do card.');
    const { error } = await sb.from('production_cards').delete().eq('id', id);
    if (error) throw badRequest(error.message);
    return json(event, 200, { ok: true });
  }

  throw badRequest('Método não suportado.');
});
