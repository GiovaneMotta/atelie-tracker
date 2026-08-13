/* ================================================================
   /api/shipping-stats — indicadores de expedição (§26).
   GET ?from=&to=  (ISO). Sem período => últimos 30 dias.
   Cards de status, frete gasto (hoje/período/médio) e últimos envios.
   Permissão: shipments.read.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const GENERATED = new Set(['etiqueta_gerada', 'postado', 'em_transito', 'saiu_entrega', 'entregue', 'problema']);

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'GET') throw badRequest('Método não suportado.');
  await requirePermission(event, 'shipments.read');

  const p = event.queryStringParameters || {};
  const to = p.to ? new Date(p.to) : new Date();
  const from = p.from ? new Date(p.from) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const todayStart = new Date(); todayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);

  const { data, error } = await admin().from('shipments')
    .select('id, status, carrier, service, price, tracking_code, recipient, created_at, frenet_shipment_id')
    .gte('created_at', from.toISOString()).lte('created_at', to.toISOString())
    .order('created_at', { ascending: false }).limit(2000);
  if (error) throw badRequest(error.message);
  const rows = data ?? [];

  const byStatus: Record<string, number> = {};
  let freteGasto = 0, freteCount = 0, freteHoje = 0, freteMes = 0, enviosHoje = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const price = Number(r.price) || 0;
    const generated = GENERATED.has(r.status) || Boolean(r.frenet_shipment_id);
    const created = new Date(r.created_at);
    if (created >= todayStart) enviosHoje++;
    if (generated) {
      freteGasto += price; freteCount++;
      if (created >= todayStart) freteHoje += price;
      if (created >= monthStart) freteMes += price;
    }
  }

  const latest = rows.slice(0, 8).map((r) => ({
    id: r.id, recipient_name: (r.recipient as any)?.name || '—',
    carrier: r.carrier, service: r.service, price: r.price, status: r.status,
    tracking_code: r.tracking_code, created_at: r.created_at,
  }));

  return json(event, 200, {
    period: { from: from.toISOString(), to: to.toISOString() },
    total: rows.length,
    envios_hoje: enviosHoje,
    by_status: byStatus,
    labels_generated: freteCount,
    frete_gasto: Math.round(freteGasto * 100) / 100,
    frete_hoje: Math.round(freteHoje * 100) / 100,
    frete_mes: Math.round(freteMes * 100) / 100,
    frete_medio: freteCount ? Math.round((freteGasto / freteCount) * 100) / 100 : 0,
    latest,
  });
});
