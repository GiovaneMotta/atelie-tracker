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

const NESTED = 'product_categories(category), product_addons(*), '
  + 'product_variants(*, inventory(variant_id, quantity, reserved)), '
  + 'inventory(variant_id, quantity, reserved), '
  + 'product_components!product_components_parent_product_id_fkey(*)';

const PRODUCT_FIELDS = ['sku', 'name', 'slug', 'category', 'description', 'price_cash',
  'price_card', 'installments_max', 'original_price', 'weight_kg', 'length_cm', 'width_cm',
  'height_cm', 'status', 'featured', 'images', 'videos'] as const;

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
    /* Aqui NAO da para apagar e recriar, como o resto faz: inventory
       aponta para a variação com ON DELETE CASCADE, e order_items guarda
       o variant_id do que já foi vendido. Recriar perderia o estoque por
       tamanho a cada "Salvar" e desligaria o tamanho dos pedidos antigos.
       Então: casa pelo id (ou por tamanho+cor, para quem foi cadastrado
       antes de o formulário mandar o id), atualiza o que já existe e só
       apaga o que a Lili tirou da lista de verdade. */
    const { data: atuais } = await sb.from('product_variants')
      .select('id, size, color').eq('product_id', productId);
    const antigas = atuais ?? [];
    const chave = (s: unknown, c: unknown) =>
      `${String(s || '').trim().toUpperCase()}|${String(c || '').trim().toLowerCase()}`;
    const porId = new Map(antigas.map((v) => [v.id, v]));
    const porChave = new Map(antigas.map((v) => [chave(v.size, v.color), v]));
    const mantidas = new Set<string>();

    for (const v of body.variants as any[]) {
      const campos = {
        sku: v.sku || null, size: v.size || null, color: v.color || null,
        gender: v.gender || null, price_delta: Number(v.price_delta) || 0,
        is_active: v.is_active !== false,
      };
      const alvo = (v.id && porId.get(v.id)) || porChave.get(chave(v.size, v.color));
      let variantId: string | null = null;
      if (alvo) {
        await sb.from('product_variants').update(campos).eq('id', alvo.id);
        variantId = alvo.id;
      } else {
        const { data: nova } = await sb.from('product_variants')
          .insert({ product_id: productId, ...campos }).select('id').single();
        variantId = nova?.id ?? null;
      }
      if (variantId) {
        mantidas.add(variantId);
        if (v.stock !== undefined && v.stock !== null && String(v.stock).trim() !== '') {
          await gravarEstoque(productId, variantId, Number(v.stock));
        }
      }
    }

    const sobraram = antigas.filter((v) => !mantidas.has(v.id)).map((v) => v.id);
    if (sobraram.length) await sb.from('product_variants').delete().in('id', sobraram);
  }

  /* Estoque da peça sem variação: um número só, direto no produto. */
  if (body.stock !== undefined && body.stock !== null && String(body.stock).trim() !== '') {
    await gravarEstoque(productId, null, Number(body.stock));
  }

  if (Array.isArray(body.addons)) {
    await sb.from('product_addons').delete().eq('product_id', productId);
    const rows = (body.addons as any[]).map((a) => ({
      product_id: productId, name: String(a.name || '').slice(0, 120), price: Number(a.price) || 0,
      requires_text: Boolean(a.requires_text), is_active: a.is_active !== false,
      /* adicional ligado a um produto consome o estoque dele (0021) */
      addon_product_id: a.addon_product_id || null,
    })).filter((r) => r.name);
    if (rows.length) await sb.from('product_addons').insert(rows);
  }

  if (Array.isArray(body.components)) {
    await sb.from('product_components').delete().eq('parent_product_id', productId);
    const rows = (body.components as any[]).map((c) => ({
      parent_product_id: productId,
      parent_variant_id: c.parent_variant_id || null,
      child_product_id: c.child_product_id || null,
      child_variant_id: c.child_variant_id || null,
      match_size: c.match_size !== false,
      quantity: Math.max(1, Math.round(Number(c.quantity) || 1)),
    })).filter((r) => r.child_product_id && r.child_product_id !== productId);
    if (rows.length) await sb.from('product_components').insert(rows);
  }
}

/** Grava a contagem de uma peça (ou de um tamanho) sem tocar no reservado. */
async function gravarEstoque(productId: string, variantId: string | null, valor: number) {
  const sb = admin();
  const qtd = Math.max(0, Math.round(Number.isFinite(valor) ? valor : 0));
  const busca = sb.from('inventory').select('id, quantity');
  const { data: existente } = variantId
    ? await busca.eq('variant_id', variantId).maybeSingle()
    : await busca.eq('product_id', productId).is('variant_id', null).maybeSingle();

  if (existente) {
    if (Number(existente.quantity) === qtd) return;
    await sb.from('inventory').update({ quantity: qtd }).eq('id', existente.id);
  } else {
    await sb.from('inventory').insert({ product_id: productId, variant_id: variantId, quantity: qtd });
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

  if (event.httpMethod === 'DELETE') {
    const ctx = await requirePermission(event, 'products.write');
    if (!id) throw badRequest('Informe o id do produto.');
    const { data: before } = await sb.from('products').select('id, name, sku').eq('id', id).maybeSingle();
    if (!before) throw notFound('Produto não encontrado.');
    const { error } = await sb.from('products').delete().eq('id', id);
    if (error) throw badRequest(error.message);
    await writeAudit({ actorId: ctx.userId, action: 'delete', entity: 'product', entityId: id, oldValue: before });
    return json(event, 200, { ok: true });
  }

  throw badRequest('Método não suportado.');
});
