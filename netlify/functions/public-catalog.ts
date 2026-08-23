/* ================================================================
   /api/public-catalog — Catálogo público (LEITURA, sem autenticação).
   Consumido pelo SITE público (ateliedalili). Devolve os produtos no
   MESMO formato que o js/products.js já usa, lendo do banco (fonte
   oficial). Nenhuma credencial vai para o site; a service role fica
   só aqui no backend. Resposta cacheada na borda (rápido).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { admin } from '../lib/supabaseAdmin';

/* IDs inteiros originais do js/products.js — preserva os links
   produto.html?id=N, o carrinho e a vitrine "Favoritas" SEM mudar o site. */
const SKU_ID: Record<string, number> = {
  'SM-G001': 1, 'SM-G002': 2, 'SM-G003': 3, 'SM-G004': 4, 'SM-G005': 5, 'SM-G006': 6,
  'SM-G007': 7, 'SM-G008': 8, 'SM-G009': 9, 'SM-G018': 10, 'SM-G010': 11, 'SM-G017': 12,
  'SM-G023': 13, 'SM-G020': 14, 'SM-G021': 15, 'SM-G012': 16, 'SM-G016': 17, 'SM-G022': 18,
  'SM-G024': 19, 'SM-G028': 20, 'SM-G011': 21, 'SM-G015': 22, 'SM-G027': 23, 'SM-G013': 24,
  'SM-G014': 25, 'SM-G019': 26, 'SM-G025': 27, 'SM-G026': 28,
};

/* Produtos novos (criados no CRM) recebem um id inteiro estável derivado
   do SKU — determinístico, não muda se outro produto for apagado. */
function stableId(sku: string): number {
  if (SKU_ID[sku]) return SKU_ID[sku];
  let h = 0;
  for (let i = 0; i < sku.length; i++) h = (h * 31 + sku.charCodeAt(i)) >>> 0;
  return 100000 + (h % 800000);
}

/* Número -> "R$ 1.234,56" (o parseBRL do site entende esse formato). */
function brl(n: number | null | undefined): string | null {
  if (n == null) return null;
  const [int, dec] = Number(n).toFixed(2).split('.');
  return 'R$ ' + int.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + dec;
}

const SIZE_RANK: Record<string, number> = { RN: 0, P: 1, M: 2, G: 3, GG: 4 };

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',            // catálogo é público (só leitura)
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=600',
  'Netlify-CDN-Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
};

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: CORS, body: '' };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Método não permitido' }) };
  }

  try {
    const sb = admin();
    const { data, error } = await sb
      .from('products')
      .select('sku,name,description,price_cash,price_card,original_price,status,images,featured,sort_order,weight_kg, product_categories(category), product_variants(size,color), product_addons(name,price,is_active)')
      .in('status', ['ativo', 'esgotado']);   // esconde oculto/inativo
    if (error) throw error;

    const products = (data || []).map((p: any) => {
      const categories = (p.product_categories || []).map((c: any) => c.category).filter(Boolean);
      const sizes = Array.from(new Set((p.product_variants || []).map((v: any) => v.size).filter(Boolean)))
        .sort((a: any, b: any) => (SIZE_RANK[a] ?? 99) - (SIZE_RANK[b] ?? 99));
      const accessories = (p.product_addons || [])
        .filter((a: any) => a.is_active !== false)
        .map((a: any) => ({ name: a.name, price: Number(a.price) || 0 }));
      const priceNum = p.price_cash ?? p.price_card ?? 0;
      return {
        id: stableId(p.sku),
        sku: p.sku,
        name: p.name,
        categories,
        sizes,
        price: brl(priceNum),
        originalPrice: brl(p.original_price),
        status: p.status,
        featured: !!p.featured,
        sort_order: p.sort_order ?? null,
        accessories,
        images: Array.isArray(p.images) ? p.images : [],
        description: p.description || '',
        weight: p.weight_kg != null ? Number(p.weight_kg) : undefined,
      };
    }).sort((a: any, b: any) =>
      (a.sort_order ?? 9999) - (b.sort_order ?? 9999) || a.id - b.id);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ source: 'db', count: products.length, ts: new Date().toISOString(), products }),
    };
  } catch (e) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Falha ao carregar o catálogo.', detail: String(e) }) };
  }
};
