/* ================================================================
   /api/catalog-order — ordem da vitrine do site.
     GET  /api/catalog-order  -> peças visíveis no site, NA ORDEM em
                                 que o site mostra (sort_order, depois SKU)
     POST /api/catalog-order  -> { order: [id, ...] } grava a nova ordem
   Permissões: products.read (ver) / products.write (salvar).

   O site ordena por products.sort_order (vazio = fim, pelo SKU), igual
   à public_catalog() da 0024. A tela manda SEMPRE a lista completa das
   peças visíveis — inclusive as de outras categorias, nos mesmos lugares
   —, então reordenar "Menino" não mexe na posição de "Menina".
   Grava pela função set_catalog_order (0031): uma chamada só e atômica,
   por causa do limite de 50 consultas por chamada do Cloudflare grátis.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, conflict } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';

/* mesmos status que a public_catalog() devolve para o site */
const VISIVEL = ['ativo', 'esgotado'];

interface Linha {
  id: string; sku: string | null; name: string; price_cash: number | null;
  status: string; images: unknown; sort_order: number | null; featured: boolean;
  product_categories?: { category: string }[] | null;
}

/** Peças que aparecem no site, na ordem do site. Sem SKU a peça não vai
 *  para o site (catalog-data.js descarta), então fica de fora aqui também. */
async function pecasVisiveis(): Promise<Linha[]> {
  const { data, error } = await admin().from('products')
    .select('id, sku, name, price_cash, status, images, sort_order, featured, product_categories(category)')
    .in('status', VISIVEL)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('sku', { ascending: true });
  if (error) throw badRequest(error.message);
  return ((data ?? []) as Linha[]).filter((p) => String(p.sku ?? '').trim() !== '');
}

function primeiraFoto(images: unknown): string | null {
  if (!Array.isArray(images) || !images.length) return null;
  const f = images[0];
  return typeof f === 'string' && f.trim() ? f : null;
}

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'products.read');
    const pecas = await pecasVisiveis();
    return json(event, 200, {
      items: pecas.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        price_cash: p.price_cash,
        status: p.status,
        featured: !!p.featured,
        sort_order: p.sort_order,
        image: primeiraFoto(p.images),
        categories: (p.product_categories ?? []).map((c) => c.category),
      })),
    });
  }

  if (event.httpMethod === 'POST') {
    const ctx = await requirePermission(event, 'products.write');
    const body = parseBody<{ order?: unknown }>(event);
    const ids = Array.isArray(body.order) ? body.order.map((x) => String(x)) : [];
    if (!ids.length) throw badRequest('Envie a lista com a nova ordem.');
    if (new Set(ids).size !== ids.length) throw badRequest('A lista de ordem tem peça repetida.');

    /* A lista tem de ser exatamente a vitrine de agora. Se alguém ativou,
       ocultou ou cadastrou uma peça enquanto a tela estava aberta, gravar
       por cima embaralharia quem ficou de fora: melhor pedir para recarregar. */
    const atuais = await pecasVisiveis();
    const idsAtuais = new Set(atuais.map((p) => p.id));
    const mesmaVitrine = ids.length === idsAtuais.size && ids.every((id) => idsAtuais.has(id));
    if (!mesmaVitrine) {
      throw conflict('A vitrine mudou desde que você abriu esta tela (alguma peça foi ativada, ocultada ou cadastrada). Recarregue a página e ajuste de novo.');
    }

    const { data: alterados, error } = await admin().rpc('set_catalog_order', { p_ids: ids });
    if (error) {
      if (/set_catalog_order/i.test(error.message) && /(could not find|does not exist|schema cache)/i.test(error.message)) {
        throw badRequest('Falta aplicar a migração 0031 (ordem da vitrine) no Supabase. Depois disso, é só salvar de novo.');
      }
      throw badRequest(error.message);
    }

    const n = Number(alterados) || 0;
    if (n > 0) {
      /* Guarda a ordem anterior inteira: se a vitrine ficar estranha, dá
         para ver nos Logs como estava e voltar. */
      const skuPorId = new Map(atuais.map((p) => [p.id, p.sku]));
      await writeAudit({
        actorId: ctx.userId, action: 'update', entity: 'catalog_order', reason: 'Ordem da vitrine',
        oldValue: { ordem: atuais.map((p) => p.sku) },
        newValue: { ordem: ids.map((id) => skuPorId.get(id)), alterados: n },
      });
    }
    return json(event, 200, { ok: true, alterados: n });
  }

  throw badRequest('Método não suportado.');
});
