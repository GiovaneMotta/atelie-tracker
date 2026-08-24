/* ================================================================
   /api/orders — pedidos (§14, §53).
     GET   /api/orders                 -> lista
     GET   /api/orders?id=<uuid>        -> pedido completo (itens+cliente+endereço)
     POST  /api/orders                  -> cria rascunho (calcula totais no backend)
     PATCH /api/orders?id=<uuid>         -> muda status (máquina de estados) e/ou campos
   Permissões: orders.read / orders.write / orders.cancel.
   Preços são travados no servidor: o cliente NÃO define valor.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound, conflict, forbidden } from '../lib/http';
import { requirePermission, getAuth } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';

const DETAIL = '*, customer:customers(id,name,whatsapp,phone,document), address:customer_addresses(*), items:order_items(*)';
const round2 = (n: number) => Math.round(n * 100) / 100;

interface RawItem {
  product_id: string; variant_id?: string; quantity?: number;
  addons?: { name: string; price: number; text?: string }[];
  customization?: Record<string, unknown>;
}

/** Monta os itens com preço/nome vindos do banco (snapshot) e soma o subtotal. */
async function buildItems(raw: RawItem[]): Promise<{ items: any[]; subtotal: number }> {
  const sb = admin();
  const productIds = [...new Set(raw.map((r) => r.product_id).filter(Boolean))];
  const variantIds = [...new Set(raw.map((r) => r.variant_id).filter(Boolean) as string[])];
  if (!productIds.length) throw badRequest('Inclua ao menos um item.');

  const { data: products } = await sb.from('products').select('id,name,sku,price_cash').in('id', productIds);
  const pMap = new Map((products ?? []).map((p) => [p.id, p]));
  const vMap = new Map<string, any>();
  if (variantIds.length) {
    const { data: variants } = await sb.from('product_variants').select('*').in('id', variantIds);
    for (const v of variants ?? []) vMap.set(v.id, v);
  }

  let subtotal = 0;
  const items = raw.map((r) => {
    const p = pMap.get(r.product_id);
    if (!p) throw badRequest(`Produto inexistente: ${r.product_id}`);
    const v = r.variant_id ? vMap.get(r.variant_id) : null;
    const qty = Math.max(1, Math.trunc(Number(r.quantity) || 1));
    const unit = round2(Number(p.price_cash || 0) + (v ? Number(v.price_delta || 0) : 0));
    const addons = Array.isArray(r.addons)
      ? r.addons.map((a) => ({ name: String(a.name || ''), price: round2(Number(a.price) || 0), text: a.text ?? null }))
      : [];
    const addonsSum = addons.reduce((s, a) => s + a.price, 0);
    const line = round2((unit + addonsSum) * qty);
    subtotal = round2(subtotal + line);
    const label = [p.name, v && [v.size, v.color].filter(Boolean).join(' / ')].filter(Boolean).join(' — ');
    return {
      product_id: r.product_id, variant_id: r.variant_id ?? null, name: label, sku: v?.sku || p.sku || null,
      quantity: qty, unit_price: unit, addons, customization: r.customization ?? {}, line_total: line,
    };
  });
  return { items, subtotal };
}

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;

  // ---- LEITURA ----
  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'orders.read');
    if (id) {
      const { data, error } = await sb.from('orders').select(DETAIL).eq('id', id).maybeSingle();
      if (error) throw badRequest(error.message);
      if (!data) throw notFound('Pedido não encontrado.');
      // Histórico/timeline do pedido (auditoria): criação + mudanças de status.
      const { data: history } = await sb.from('audit_logs')
        .select('action, reason, old_value, new_value, created_at, actor:staff(name)')
        .eq('entity', 'order').eq('entity_id', id)
        .order('created_at', { ascending: true });
      return json(event, 200, { order: data, history: history ?? [] });
    }
    const status = event.queryStringParameters?.status;
    let q = sb.from('orders').select('*, customer:customers(name)').order('created_at', { ascending: false }).limit(200);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw badRequest(error.message);
    return json(event, 200, { orders: data ?? [] });
  }

  // ---- CRIAÇÃO ----
  if (event.httpMethod === 'POST') {
    const ctx = await requirePermission(event, 'orders.write');
    const body = parseBody<any>(event);
    const { items, subtotal } = await buildItems(Array.isArray(body.items) ? body.items : []);
    const discount = round2(Number(body.discount) || 0);
    const shipping = round2(Number(body.shipping_cost) || 0);
    const total = round2(subtotal - discount + shipping);

    const { data: order, error } = await sb.from('orders').insert({
      customer_id: body.customer_id ?? null,
      address_id: body.address_id ?? null,
      subtotal, discount, shipping_cost: shipping, total,
      status: 'rascunho', channel: body.channel || 'manual',
      notes: body.notes ?? null, created_by: ctx.userId,
    }).select('*').single();
    if (error) throw badRequest(error.message);

    const rows = items.map((it) => ({ ...it, order_id: order.id }));
    const { error: itErr } = await sb.from('order_items').insert(rows);
    if (itErr) throw badRequest(itErr.message);

    await writeAudit({ actorId: ctx.userId, action: 'create', entity: 'order', entityId: order.id, newValue: { number: order.number, total } });
    const { data: full } = await sb.from('orders').select(DETAIL).eq('id', order.id).single();
    return json(event, 201, { order: full });
  }

  // ---- ATUALIZAÇÃO (status e/ou campos) ----
  if (event.httpMethod === 'PATCH') {
    const ctx = await getAuth(event);
    if (!ctx.has('orders.write')) throw forbidden('Sem permissão: orders.write.');
    if (!id) throw badRequest('Informe o id do pedido.');
    const body = parseBody<any>(event);

    const { data: before } = await sb.from('orders').select('*').eq('id', id).maybeSingle();
    if (!before) throw notFound('Pedido não encontrado.');

    // 1) Mudança de status: passa pela máquina de estados (trigger).
    if (typeof body.status === 'string' && body.status !== before.status) {
      if (body.status === 'cancelado' && !ctx.has('orders.cancel')) {
        throw forbidden('Sem permissão: orders.cancel.');
      }
      const { error } = await sb.from('orders').update({ status: body.status }).eq('id', id);
      if (error) {
        // O trigger lança "Transição de pedido inválida: ...".
        throw conflict(error.message.replace(/^.*?:\s*/, '') || 'Transição de status inválida.');
      }
      await writeAudit({ actorId: ctx.userId, action: 'update', entity: 'order', entityId: id, reason: 'Mudança de status', oldValue: { status: before.status }, newValue: { status: body.status } });
    }

    // 2) Campos simples (recalcula total se desconto/frete mudarem).
    const fields: Record<string, unknown> = {};
    for (const k of ['notes', 'address_id', 'payment_method', 'payment_status']) if (k in body) fields[k] = body[k];
    if ('discount' in body || 'shipping_cost' in body) {
      const discount = round2('discount' in body ? Number(body.discount) || 0 : Number(before.discount));
      const shipping = round2('shipping_cost' in body ? Number(body.shipping_cost) || 0 : Number(before.shipping_cost));
      fields.discount = discount;
      fields.shipping_cost = shipping;
      fields.total = round2(Number(before.subtotal) - discount + shipping);
    }
    if (Object.keys(fields).length) {
      const { error } = await sb.from('orders').update(fields).eq('id', id);
      if (error) throw badRequest(error.message);
      await writeAudit({ actorId: ctx.userId, action: 'update', entity: 'order', entityId: id, oldValue: before, newValue: fields });
    }

    const { data: full } = await sb.from('orders').select(DETAIL).eq('id', id).single();
    return json(event, 200, { order: full });
  }

  throw badRequest('Método não suportado.');
});
