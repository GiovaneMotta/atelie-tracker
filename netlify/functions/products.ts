/* ================================================================
   /api/products — catálogo (§11). Agregado: produto + categorias +
   variações + adicionais numa só chamada.
     GET    /api/products                -> lista (busca ?search=, ?status=)
     GET    /api/products?id=<uuid>       -> produto completo
     POST   /api/products                 -> cria (aceita arrays aninhados)
     PATCH  /api/products?id=<uuid>        -> atualiza + sincroniza aninhados
   Permissões: products.read (ler) / products.write (criar/editar).
   Mudança de preço vai para a auditoria (§34).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';

const NESTED = 'product_categories(category), product_variants(*), product_addons(*)';

const PRODUCT_FIELDS = ['sku', 'name', 'slug', 'category', 'description', 'price_cash',
  'price_card', 'installments_max', 'original_price', 'weight_kg', 'length_cm', 'width_cm',
  'height_cm', 'status', 'images', 'videos'] as const;

function pickProduct(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of PRODUCT_FIELDS) if (k in body) out[k] = body[k];
  return out;
}

/** Regrava a lista de categorias/variações/adicionais (estratégia replace). */
async function syncNested(productId: string, body: Record<string, unknown>) {
  const sb = admin();
  if (Array.isArray(body.categories)) {
    await sb.from('product_categories').delete().eq('product_id', productId);
    const rows = (body.categories as string[]).filter(Boolean).map((category) => ({ product_id: productId, category }));
    if (rows.length) await sb.from('product_categories').insert(rows);
  }
  if (Array.isArray(body.variants)) {
    await sb.from('product_variants').delete().eq('product_id', productId);
    const rows = (body.variants as any[]).map((v) => ({
      product_id: productId, sku: v.sku || null, size: v.size || null, color: v.color || null,
      gender: v.gender || null, price_delta: Number(v.price_delta) || 0, is_active: v.is_active !== false,
    }));
    if (rows.length) await sb.from('product_variants').insert(rows);
  }
  if (Array.isArray(body.addons)) {
    await sb.from('product_addons').delete().eq('product_id', productId);
    const rows = (body.addons as any[]).map((a) => ({
      product_id: productId, name: String(a.name || '').slice(0, 120), price: Number(a.price) || 0,
      requires_text: Boolean(a.requires_text), is_active: a.is_active !== false,
    })).filter((r) => r.name);
    if (rows.length) await sb.from('product_addons').insert(rows);
  }
}

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'products.read');
    if (id) {
      const { data, error } = await sb.from('products').select(`*, ${NESTED}`).eq('id', id).maybeSingle();
      if (error) throw badRequest(error.message);
      if (!data) throw notFound('Produto não encontrado.');
      return json(event, 200, { product: data });
    }
    const search = (event.queryStringParameters?.search || '').trim().replace(/[(),]/g, ' ').trim();
    const status = event.queryStringParameters?.status;
    let q = sb.from('products').select(`*, ${NESTED}`).order('name').limit(300);
    if (status) q = q.eq('status', status);
    if (search) q = q.or(`name.ilike.%${search}%,sku.ilike.%${search}%`);
    const { data, error } = await q;
    if (error) throw badRequest(error.message);
    return json(event, 200, { products: data ?? [] });
  }

  if (event.httpMethod === 'POST') {
    const ctx = await requirePermission(event, 'products.write');
    const body = parseBody<Record<string, unknown>>(event);
    const fields = pickProduct(body);
    if (!fields.name || String(fields.name).trim() === '') throw badRequest('Nome é obrigatório.');
    const { data, error } = await sb.from('products').insert(fields).select('*').single();
    if (error) throw badRequest(error.message);
    await syncNested(data.id, body);
    await writeAudit({ actorId: ctx.userId, action: 'create', entity: 'product', entityId: data.id, newValue: fields });
    const { data: full } = await sb.from('products').select(`*, ${NESTED}`).eq('id', data.id).single();
    return json(event, 201, { product: full });
  }

  if (event.httpMethod === 'PATCH') {
    const ctx = await requirePermission(event, 'products.write');
    if (!id) throw badRequest('Informe o id do produto.');
    const body = parseBody<Record<string, unknown>>(event);
    const fields = pickProduct(body);

    const { data: before } = await sb.from('products').select('*').eq('id', id).maybeSingle();
    if (!before) throw notFound('Produto não encontrado.');

    if (Object.keys(fields).length) {
      const { error } = await sb.from('products').update(fields).eq('id', id);
      if (error) throw badRequest(error.message);
    }
    await syncNested(id, body);

    // Auditoria específica de preço (§34).
    const priceChanged = ('price_cash' in fields && Number(fields.price_cash) !== Number(before.price_cash))
      || ('price_card' in fields && Number(fields.price_card) !== Number(before.price_card));
    if (priceChanged) {
      await writeAudit({
        actorId: ctx.userId, action: 'update', entity: 'product', entityId: id, reason: 'Alteração de preço',
        oldValue: { price_cash: before.price_cash, price_card: before.price_card },
        newValue: { price_cash: fields.price_cash ?? before.price_cash, price_card: fields.price_card ?? before.price_card },
      });
    } else {
      await writeAudit({ actorId: ctx.userId, action: 'update', entity: 'product', entityId: id, newValue: fields });
    }
    const { data: full } = await sb.from('products').select(`*, ${NESTED}`).eq('id', id).single();
    return json(event, 200, { product: full });
  }

  throw badRequest('Método não suportado.');
});
