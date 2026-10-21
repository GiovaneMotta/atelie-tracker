/* ================================================================
   /api/inventory — estoque por produto (nível de produto).
     GET   -> lista de produtos com estoque atual, mínimo e status
     POST  -> ajusta estoque (entrada/saída) e/ou define mínimo
   Reaproveita a tabela inventory existente (variant_id null = estoque
   do produto). Histórico via audit_logs (entity='inventory').
   Permissões: products.read (ver) / products.write (ajustar).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';

function statusOf(qty: number, min: number, prodStatus: string): 'esgotado' | 'baixo' | 'ok' {
  if (qty <= 0 || prodStatus === 'esgotado') return 'esgotado';
  if (qty <= min) return 'baixo';
  return 'ok';
}

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();

  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'products.read');
    const { data: products, error } = await sb.from('products')
      .select('id, name, sku, status, images').order('name').limit(1000);
    if (error) throw badRequest(error.message);

    const { data: variants } = await sb.from('product_variants')
      .select('id, product_id, size').eq('is_active', true).limit(4000);
    const { data: inv } = await sb.from('inventory')
      .select('product_id, variant_id, quantity, min_qty, reserved').limit(4000);
    /* Kit nao se conta: o que existe dele sai das pecas de dentro. */
    const { data: comps } = await sb.from('product_components')
      .select('parent_product_id').limit(4000);

    const porVariante = new Map((inv ?? []).filter((r) => r.variant_id).map((r) => [r.variant_id, r]));
    const porProduto = new Map((inv ?? []).filter((r) => !r.variant_id).map((r) => [r.product_id, r]));
    const kits = new Set((comps ?? []).map((c) => c.parent_product_id));
    const tamanhos = new Map<string, { id: string; size: string | null }[]>();
    for (const v of variants ?? []) {
      const lista = tamanhos.get(v.product_id) ?? [];
      lista.push({ id: v.id, size: v.size });
      tamanhos.set(v.product_id, lista);
    }

    /* Uma linha por unidade de contagem: por tamanho quando a peca tem
       tamanhos, senao a peca inteira. E assim que a baixa acontece, entao
       e assim que a tela precisa mostrar. */
    const items = (products ?? []).flatMap((p: any) => {
      const image = Array.isArray(p.images) && p.images[0] ? p.images[0] : null;
      const comum = { product_id: p.id, name: p.name, sku: p.sku, product_status: p.status, image,
                      composto: kits.has(p.id) };
      const monta = (variantId: string | null, size: string | null) => {
        const r: any = variantId ? porVariante.get(variantId) : porProduto.get(p.id);
        const quantity = r ? Number(r.quantity) || 0 : 0;
        const min_qty = r ? Number(r.min_qty) || 0 : 0;
        const reserved = r ? Number(r.reserved) || 0 : 0;
        return { ...comum, key: variantId || p.id, variant_id: variantId, size,
          quantity, min_qty, reserved, tracked: !!r,
          status: statusOf(quantity - reserved, min_qty, p.status) };
      };
      const lista = tamanhos.get(p.id);
      if (kits.has(p.id)) return [{ ...comum, key: p.id, variant_id: null, size: null,
        quantity: 0, min_qty: 0, reserved: 0, tracked: false, status: 'ok' as const }];
      if (lista && lista.length) return lista.map((v) => monta(v.id, v.size));
      return [monta(null, null)];
    });
    const summary = {
      esgotados: items.filter((i) => i.status === 'esgotado').length,
      baixo: items.filter((i) => i.status === 'baixo').length,
      ok: items.filter((i) => i.status === 'ok').length,
      total: items.length,
    };
    return json(event, 200, { items, summary });
  }

  if (event.httpMethod === 'POST') {
    const ctx = await requirePermission(event, 'products.write');
    const body = parseBody<{ product_id?: string; variant_id?: string | null; delta?: number;
      set_qty?: number; min_qty?: number; reason?: string }>(event);
    const productId = (body.product_id || '').trim();
    const variantId = (body.variant_id || '').trim() || null;
    if (!productId) throw badRequest('Informe o produto.');

    const { data: prod } = await sb.from('products').select('id, name').eq('id', productId).maybeSingle();
    if (!prod) throw notFound('Produto não encontrado.');

    /* A contagem mora na variacao quando ha tamanho; so cai no produto
       inteiro quando a peca nao tem tamanhos. Igual ao inventory_mover. */
    const { data: existing } = variantId
      ? await sb.from('inventory').select('id, quantity, min_qty').eq('variant_id', variantId).maybeSingle()
      : await sb.from('inventory').select('id, quantity, min_qty').eq('product_id', productId).is('variant_id', null).maybeSingle();

    const curQty = existing ? Number(existing.quantity) || 0 : 0;
    let newQty = curQty;
    if (typeof body.set_qty === 'number') newQty = Math.max(0, Math.trunc(body.set_qty));
    else if (typeof body.delta === 'number') newQty = Math.max(0, curQty + Math.trunc(body.delta));
    const newMin = typeof body.min_qty === 'number' ? Math.max(0, Math.trunc(body.min_qty))
      : (existing ? Number(existing.min_qty) || 0 : 0);

    if (existing) {
      const { error } = await sb.from('inventory').update({ quantity: newQty, min_qty: newMin }).eq('id', existing.id);
      if (error) throw badRequest(error.message);
    } else {
      const { error } = await sb.from('inventory').insert({ product_id: productId, variant_id: variantId, quantity: newQty, min_qty: newMin });
      if (error) throw badRequest(error.message);
    }

    await writeAudit({
      actorId: ctx.userId, action: 'update', entity: 'inventory', entityId: productId,
      reason: body.reason || 'Ajuste de estoque',
      oldValue: { quantity: curQty, min_qty: existing ? existing.min_qty : 0 },
      newValue: { quantity: newQty, min_qty: newMin, produto: prod.name },
    });
    return json(event, 200, { ok: true, quantity: newQty, min_qty: newMin });
  }

  throw badRequest('Método não suportado.');
});
