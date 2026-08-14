/* ================================================================
   /api/pricing — precificação: custo × preço × lucro (modelo SOA).
     GET  /api/pricing            -> lista produtos com custo/lucro/margem
     GET  /api/pricing?id=<uuid>   -> produto + ficha técnica (materiais)
     PATCH /api/pricing?id=<uuid>  -> define ficha técnica e/ou preço
   Custo do produto = Σ (custo_material × quantidade).
   Permissões: products.read / products.write.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';

const round2 = (n: number) => Math.round(n * 100) / 100;

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'products.read');
    if (id) {
      const { data: product, error } = await sb.from('products').select('id, name, sku, price_cash, price_card').eq('id', id).maybeSingle();
      if (error) throw badRequest(error.message);
      if (!product) throw notFound('Produto não encontrado.');
      const { data: lines } = await sb.from('product_materials')
        .select('material_id, quantity, material:materials(id,name,unit,cost_per_unit)')
        .eq('product_id', id);
      const items = (lines ?? []).map((l: any) => ({
        material_id: l.material_id, name: l.material?.name, unit: l.material?.unit,
        cost_per_unit: Number(l.material?.cost_per_unit || 0), quantity: Number(l.quantity || 0),
        subtotal: round2(Number(l.material?.cost_per_unit || 0) * Number(l.quantity || 0)),
      }));
      const cost = round2(items.reduce((s, it) => s + it.subtotal, 0));
      const price = Number(product.price_cash || 0);
      return json(event, 200, { product, items, cost, price, profit: round2(price - cost), margin: price > 0 ? round2(((price - cost) / price) * 100) : 0 });
    }

    const [{ data: products }, { data: pm }] = await Promise.all([
      sb.from('products').select('id, name, sku, price_cash, status').order('name').limit(300),
      sb.from('product_materials').select('product_id, quantity, material:materials(cost_per_unit)'),
    ]);
    const costByProduct: Record<string, number> = {};
    for (const l of (pm ?? []) as any[]) {
      costByProduct[l.product_id] = (costByProduct[l.product_id] || 0) + Number(l.material?.cost_per_unit || 0) * Number(l.quantity || 0);
    }
    const rows = (products ?? []).map((p) => {
      const cost = round2(costByProduct[p.id] || 0);
      const price = Number(p.price_cash || 0);
      return { ...p, cost, profit: round2(price - cost), margin: price > 0 ? round2(((price - cost) / price) * 100) : 0 };
    });
    return json(event, 200, { products: rows });
  }

  if (event.httpMethod === 'PATCH') {
    const ctx = await requirePermission(event, 'products.write');
    if (!id) throw badRequest('Informe o id do produto.');
    const body = parseBody<any>(event);

    if ('price_cash' in body) {
      const { data: before } = await sb.from('products').select('price_cash').eq('id', id).maybeSingle();
      await sb.from('products').update({ price_cash: Number(body.price_cash) || 0 }).eq('id', id);
      await writeAudit({ actorId: ctx.userId, action: 'update', entity: 'product', entityId: id, reason: 'Preço (precificação)', oldValue: { price_cash: before?.price_cash }, newValue: { price_cash: body.price_cash } });
    }
    if (Array.isArray(body.materials)) {
      await sb.from('product_materials').delete().eq('product_id', id);
      const rows = body.materials
        .filter((m: any) => m.material_id)
        .map((m: any) => ({ product_id: id, material_id: m.material_id, quantity: Number(m.quantity) || 1 }));
      if (rows.length) {
        const { error } = await sb.from('product_materials').insert(rows);
        if (error) throw badRequest(error.message);
      }
    }
    return json(event, 200, { ok: true });
  }

  throw badRequest('Método não suportado.');
});
