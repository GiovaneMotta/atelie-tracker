/* ================================================================
   /api/reports — relatórios (somente leitura) por período.
   GET ?period=hoje|7d|30d|mes_atual|mes_anterior|3m|12m|custom&from=&to=
   Agrega dados existentes (orders, order_items, products, customers).
   Permissão: orders.read (vendas) / products.read (estoque).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const DAY = 864e5, BRT = -180, r2 = (n: number) => Math.round(n * 100) / 100;
const CANCELLED = 'cancelado';
function brtDayStart(d: Date) { const t = new Date(d.getTime() + BRT * 6e4); t.setUTCHours(0, 0, 0, 0); return new Date(t.getTime() - BRT * 6e4); }
function brtMonthStart(d: Date) { const t = new Date(d.getTime() + BRT * 6e4); t.setUTCDate(1); t.setUTCHours(0, 0, 0, 0); return new Date(t.getTime() - BRT * 6e4); }
function resolvePeriod(p: Record<string, string | undefined>) {
  const now = new Date(); const period = p.period || '30d'; let from: Date, to: Date = now, label = '';
  switch (period) {
    case 'hoje': from = brtDayStart(now); label = 'Hoje'; break;
    case '7d': from = new Date(now.getTime() - 7 * DAY); label = 'Últimos 7 dias'; break;
    case 'mes_atual': from = brtMonthStart(now); label = 'Mês atual'; break;
    case 'mes_anterior': to = brtMonthStart(now); from = brtMonthStart(new Date(to.getTime() - DAY)); label = 'Mês anterior'; break;
    case '3m': from = new Date(now.getTime() - 90 * DAY); label = 'Últimos 3 meses'; break;
    case '12m': from = new Date(now.getTime() - 365 * DAY); label = 'Últimos 12 meses'; break;
    case 'custom': from = p.from ? new Date(p.from) : new Date(now.getTime() - 30 * DAY); to = p.to ? new Date(p.to) : now; label = 'Período personalizado'; break;
    default: from = new Date(now.getTime() - 30 * DAY); label = 'Últimos 30 dias';
  }
  return { from, to, label };
}

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'GET') throw badRequest('Método não suportado.');
  const ctx = await requirePermission(event, 'orders.read');
  const sb = admin();
  const R = resolvePeriod(event.queryStringParameters || {});
  const out: Record<string, any> = { period: { from: R.from.toISOString(), to: R.to.toISOString(), label: R.label } };

  const { data: ordersData } = await sb.from('orders')
    .select('id,total,status,payment_status,channel,created_at,customer_id')
    .gte('created_at', R.from.toISOString()).lte('created_at', R.to.toISOString()).limit(10000);
  const orders = ordersData || [];
  const notCancel = orders.filter((o) => o.status !== CANCELLED);
  const paid = notCancel.filter((o) => o.payment_status === 'pago');
  const revenue = r2(paid.reduce((s, o) => s + (Number(o.total) || 0), 0));
  out.summary = { faturamento: revenue, pedidos: notCancel.length, pagos: paid.length, ticket: paid.length ? r2(revenue / paid.length) : 0, itens: 0 };

  const byStatus: Record<string, number> = {};
  for (const o of orders) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
  out.by_status = Object.entries(byStatus).map(([status, pedidos]) => ({ status, pedidos })).sort((a, b) => b.pedidos - a.pedidos);

  const ch = new Map<string, { pedidos: number; receita: number }>();
  for (const o of notCancel) { const k = o.channel || 'outros'; const c = ch.get(k) || { pedidos: 0, receita: 0 }; c.pedidos++; if (o.payment_status === 'pago') c.receita = r2(c.receita + (Number(o.total) || 0)); ch.set(k, c); }
  out.by_channel = [...ch].map(([channel, c]) => ({ channel, ...c })).sort((a, b) => b.receita - a.receita);

  const okIds = notCancel.map((o) => o.id);
  let byProduct: any[] = [], byCategory: any[] = [], itemsSold = 0;
  if (okIds.length) {
    const { data: items } = await sb.from('order_items').select('product_id,name,sku,quantity,line_total').in('order_id', okIds).limit(20000);
    const pMap = new Map<string, any>();
    for (const it of items || []) {
      itemsSold += Number(it.quantity) || 0;
      const key = it.product_id || it.sku || it.name;
      const c = pMap.get(key) || { name: it.name, sku: it.sku, product_id: it.product_id, qty: 0, receita: 0 };
      c.qty += Number(it.quantity) || 0; c.receita = r2(c.receita + (Number(it.line_total) || 0));
      pMap.set(key, c);
    }
    byProduct = [...pMap.values()].sort((a, b) => b.receita - a.receita);
    const prodIds = [...new Set(byProduct.map((p) => p.product_id).filter(Boolean))];
    const catMap = new Map<string, string>();
    if (prodIds.length) {
      const { data: pcs } = await sb.from('product_categories').select('product_id,category').in('product_id', prodIds);
      for (const pc of pcs || []) if (!catMap.has(pc.product_id)) catMap.set(pc.product_id, pc.category);
    }
    const cAgg = new Map<string, any>();
    for (const p of byProduct) {
      const cat = (p.product_id && catMap.get(p.product_id)) || 'sem categoria';
      const c = cAgg.get(cat) || { category: cat, qty: 0, receita: 0 };
      c.qty += p.qty; c.receita = r2(c.receita + p.receita); cAgg.set(cat, c);
    }
    byCategory = [...cAgg.values()].sort((a, b) => b.receita - a.receita);
  }
  out.summary.itens = itemsSold;
  out.by_product = byProduct;
  out.by_category = byCategory;

  const custAgg = new Map<string, any>();
  for (const o of notCancel) {
    if (!o.customer_id) continue;
    const c = custAgg.get(o.customer_id) || { customer_id: o.customer_id, pedidos: 0, receita: 0 };
    c.pedidos++; if (o.payment_status === 'pago') c.receita = r2(c.receita + (Number(o.total) || 0)); custAgg.set(o.customer_id, c);
  }
  const custIds = [...custAgg.keys()];
  if (custIds.length) {
    const { data: custs } = await sb.from('customers').select('id,name').in('id', custIds);
    const nameMap = new Map((custs || []).map((c) => [c.id, c.name]));
    out.by_customer = [...custAgg.values()].map((c) => ({ name: nameMap.get(c.customer_id) || '—', pedidos: c.pedidos, receita: c.receita })).sort((a, b) => b.receita - a.receita);
  } else out.by_customer = [];

  if (ctx.has('products.read')) {
    const { data: prods } = await sb.from('products').select('status').limit(5000);
    const ps: Record<string, number> = {};
    for (const p of prods || []) ps[p.status] = (ps[p.status] || 0) + 1;
    out.stock = { esgotados: ps['esgotado'] || 0, ativos: ps['ativo'] || 0, inativos: (ps['inativo'] || 0) + (ps['oculto'] || 0), total: (prods || []).length };
  }

  return json(event, 200, out);
});
