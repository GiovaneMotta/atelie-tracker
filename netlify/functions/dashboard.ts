/* ================================================================
   /api/dashboard — métricas da "central de comando" (somente leitura).
   GET ?period=hoje|ontem|7d|30d|mes_atual|mes_anterior|3m|custom
       &from=&to=  (ISO, quando custom)
   Agrega dados JÁ EXISTENTES (orders, order_items, products, customers)
   com comparação vs. período anterior. NÃO cria dados fictícios: o que
   depende de integração ainda ausente volta como flag (ex.: analytics).
   Permissões: usa o que o staff pode ver (orders.read / products.read).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, badRequest } from '../lib/http';
import { getAuth } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const DAY = 24 * 3600 * 1000;
const BRT = -180; // Brasil (UTC-3), sem horário de verão
const r2 = (n: number) => Math.round(n * 100) / 100;

function brtDayStart(d: Date): Date {
  const t = new Date(d.getTime() + BRT * 60000);
  t.setUTCHours(0, 0, 0, 0);
  return new Date(t.getTime() - BRT * 60000);
}
function brtMonthStart(d: Date): Date {
  const t = new Date(d.getTime() + BRT * 60000);
  t.setUTCDate(1); t.setUTCHours(0, 0, 0, 0);
  return new Date(t.getTime() - BRT * 60000);
}

interface Range { from: Date; to: Date; prevFrom: Date; prevTo: Date; label: string; }

function resolvePeriod(p: Record<string, string | undefined>): Range {
  const now = new Date();
  const period = p.period || '30d';
  let from: Date, to: Date = now, label = '';
  switch (period) {
    case 'hoje': from = brtDayStart(now); label = 'Hoje'; break;
    case 'ontem': to = brtDayStart(now); from = new Date(to.getTime() - DAY); label = 'Ontem'; break;
    case '7d': from = new Date(now.getTime() - 7 * DAY); label = 'Últimos 7 dias'; break;
    case 'mes_atual': from = brtMonthStart(now); label = 'Mês atual'; break;
    case 'mes_anterior': to = brtMonthStart(now); from = brtMonthStart(new Date(to.getTime() - DAY)); label = 'Mês anterior'; break;
    case '3m': from = new Date(now.getTime() - 90 * DAY); label = 'Últimos 3 meses'; break;
    case 'custom':
      from = p.from ? new Date(p.from) : new Date(now.getTime() - 30 * DAY);
      to = p.to ? new Date(p.to) : now; label = 'Período personalizado'; break;
    case '30d':
    default: from = new Date(now.getTime() - 30 * DAY); label = 'Últimos 30 dias';
  }
  const len = Math.max(DAY, to.getTime() - from.getTime());
  return { from, to, prevFrom: new Date(from.getTime() - len), prevTo: from, label };
}

const CANCELLED = 'cancelado';
type OrderRow = { id: string; total: number; status: string; payment_status: string; channel: string | null; created_at: string; customer_id: string | null; utm: any };

function sumRevenue(rows: OrderRow[]): number {
  return r2(rows.filter((o) => o.status !== CANCELLED && o.payment_status === 'pago').reduce((s, o) => s + (Number(o.total) || 0), 0));
}
function countOrders(rows: OrderRow[]): number {
  return rows.filter((o) => o.status !== CANCELLED).length;
}
function paidCount(rows: OrderRow[]): number {
  return rows.filter((o) => o.status !== CANCELLED && o.payment_status === 'pago').length;
}

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'GET') throw badRequest('Método não suportado.');
  const ctx = await getAuth(event);
  const canOrders = ctx.has('orders.read');
  const canProducts = ctx.has('products.read');
  const sb = admin();
  const R = resolvePeriod(event.queryStringParameters || {});

  const out: Record<string, unknown> = {
    period: { from: R.from.toISOString(), to: R.to.toISOString(), label: R.label },
    flags: { analytics_connected: false, ga4: false, meta_ads: false, utm_available: false },
    can: { orders: canOrders, products: canProducts },
  };

  // ---------- VENDAS / PEDIDOS ----------
  if (canOrders) {
    const { data: ordersData, error } = await sb.from('orders')
      .select('id,total,status,payment_status,channel,created_at,customer_id,utm')
      .gte('created_at', R.prevFrom.toISOString()).lte('created_at', R.to.toISOString())
      .order('created_at', { ascending: false }).limit(5000);
    if (error) throw badRequest(error.message);
    const all = (ordersData ?? []) as OrderRow[];
    const cur = all.filter((o) => o.created_at >= R.from.toISOString());
    const prev = all.filter((o) => o.created_at >= R.prevFrom.toISOString() && o.created_at < R.from.toISOString());

    const revCur = sumRevenue(cur), revPrev = sumRevenue(prev);
    const ordCur = countOrders(cur), ordPrev = countOrders(prev);
    const paidCur = paidCount(cur), paidPrev = paidCount(prev);
    const ticketCur = paidCur ? r2(revCur / paidCur) : 0;
    const ticketPrev = paidPrev ? r2(revPrev / paidPrev) : 0;

    // clientes novos no período
    const custIds = new Set(cur.filter((o) => o.customer_id).map((o) => o.customer_id));

    // itens vendidos + mais vendidos (a partir dos pedidos não cancelados do período)
    const curIds = cur.filter((o) => o.status !== CANCELLED).map((o) => o.id);
    let itemsSold = 0;
    const prodMap = new Map<string, { name: string; qty: number; receita: number }>();
    if (curIds.length) {
      const { data: items } = await sb.from('order_items')
        .select('order_id,name,sku,quantity,line_total,product_id').in('order_id', curIds).limit(5000);
      for (const it of items ?? []) {
        const qty = Number(it.quantity) || 0; itemsSold += qty;
        const key = it.product_id || it.sku || it.name;
        const cur2 = prodMap.get(key) || { name: it.name, qty: 0, receita: 0 };
        cur2.qty += qty; cur2.receita = r2(cur2.receita + (Number(it.line_total) || 0));
        prodMap.set(key, cur2);
      }
    }
    const topProducts = [...prodMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 5);

    // origem das vendas (por canal) no período
    const chMap = new Map<string, { pedidos: number; receita: number }>();
    for (const o of cur) {
      if (o.status === CANCELLED) continue;
      const ch = o.channel || 'outros';
      const c = chMap.get(ch) || { pedidos: 0, receita: 0 };
      c.pedidos++; if (o.payment_status === 'pago') c.receita = r2(c.receita + (Number(o.total) || 0));
      chMap.set(ch, c);
      if (o.utm && (o.utm.source || o.utm.medium || o.utm.campaign)) (out.flags as any).utm_available = true;
    }
    const totalCh = [...chMap.values()].reduce((s, c) => s + c.pedidos, 0) || 1;
    const byChannel = [...chMap.entries()].map(([channel, c]) => ({ channel, pedidos: c.pedidos, receita: c.receita, pct: Math.round((c.pedidos / totalCh) * 100) }))
      .sort((a, b) => b.pedidos - a.pedidos);

    // série diária (faturamento) — período atual e anterior, alinhados por dia
    const days = Math.min(90, Math.max(1, Math.round((R.to.getTime() - R.from.getTime()) / DAY)));
    const serie = (rows: OrderRow[], start: Date) => {
      const buckets = new Array(days).fill(0);
      for (const o of rows) {
        if (o.status === CANCELLED || o.payment_status !== 'pago') continue;
        const idx = Math.floor((new Date(o.created_at).getTime() - start.getTime()) / DAY);
        if (idx >= 0 && idx < days) buckets[idx] = r2(buckets[idx] + (Number(o.total) || 0));
      }
      return buckets;
    };

    out.sales = {
      revenue: { value: revCur, prev: revPrev, has_prev: prev.length > 0 },
      orders: { value: ordCur, prev: ordPrev, has_prev: prev.length > 0 },
      ticket: { value: ticketCur, prev: ticketPrev, has_prev: paidPrev > 0 },
      items: { value: itemsSold },
      customers: { value: custIds.size },
    };
    out.top_products = topProducts;
    out.by_channel = byChannel;
    out.revenue_series = { days, current: serie(cur, R.from), previous: serie(prev, R.prevFrom) };

    // operação: pedidos por status (todos os abertos, não só do período)
    const { data: allStatus } = await sb.from('orders').select('status').limit(10000);
    const byStatus: Record<string, number> = {};
    for (const o of allStatus ?? []) byStatus[o.status] = (byStatus[o.status] || 0) + 1;
    out.by_status = byStatus;

    // atenção necessária
    out.attention = {
      aguardando_pagamento: byStatus['aguardando_pagamento'] || 0,
      a_enviar: (byStatus['pago'] || 0) + (byStatus['aguardando_etiqueta'] || 0) + (byStatus['etiqueta_gerada'] || 0),
    };

    // pedidos recentes (com cliente + resumo dos itens)
    const { data: recent } = await sb.from('orders')
      .select('id,number,total,status,payment_status,created_at,customer:customers(name),items:order_items(name,quantity)')
      .order('created_at', { ascending: false }).limit(6);
    out.recent_orders = (recent ?? []).map((o: any) => ({
      id: o.id, number: o.number, total: o.total, status: o.status, payment_status: o.payment_status,
      created_at: o.created_at, customer: o.customer?.name || null,
      resumo: (o.items || []).map((i: any) => i.name).slice(0, 2).join(', ') + ((o.items?.length || 0) > 2 ? '…' : ''),
      itens: (o.items || []).reduce((s: number, i: any) => s + (Number(i.quantity) || 0), 0),
    }));
  }

  // ---------- ESTOQUE / CATÁLOGO ----------
  if (canProducts) {
    const { data: prods } = await sb.from('products').select('id,status').limit(5000);
    const byPStatus: Record<string, number> = {};
    for (const p of prods ?? []) byPStatus[p.status] = (byPStatus[p.status] || 0) + 1;
    // estoque baixo depende de inventory populado
    const { count: invCount } = await sb.from('inventory').select('id', { count: 'exact', head: true });
    let low: number | null = null;
    if (invCount && invCount > 0) {
      const { data: lowRows } = await sb.from('inventory').select('id,quantity').lte('quantity', 3).gt('quantity', 0).limit(1000);
      low = (lowRows ?? []).length;
    }
    out.stock = {
      esgotados: byPStatus['esgotado'] || 0,
      disponiveis: byPStatus['ativo'] || 0,
      inativos: (byPStatus['inativo'] || 0) + (byPStatus['oculto'] || 0),
      baixo: low,                 // null = estoque (inventory) ainda não configurado
      inventory_configured: !!(invCount && invCount > 0),
      total: (prods ?? []).length,
    };
    (out.attention as any) = { ...(out.attention as any || {}), esgotados: byPStatus['esgotado'] || 0 };
  }

  return json(event, 200, out);
});
