/* ================================================================
   /webhooks/frenet-tracking — recebe atualizações de rastreio (§24).
   Regras: validar token do webhook, responder 2XX em <10s, não fazer
   processamento pesado antes de responder, registrar payload e não
   duplicar eventos. NUNCA logar o valor do token.
   (netlify.toml mapeia /webhooks/frenet-tracking -> esta função.)
   ================================================================ */
import type { Handler, HandlerEvent } from '@netlify/functions';
import { admin } from '../lib/supabaseAdmin';
import { logIntegration } from '../lib/log';
import { loadFrenetConfig, FrenetTrackingService } from '../lib/frenet';
import { persistTrackingEvents } from '../lib/shipping/trackingStore';
import { seenWebhook } from '../lib/shipping/idempotency';

function reply(status: number, body: unknown) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) };
}
function headerVal(event: HandlerEvent, name: string): string {
  const key = name.toLowerCase();
  const h = event.headers || {};
  return (h[key] || h[name] || '') as string;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return reply(204, {});
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Método não suportado.' });

  // 1) Autenticação do webhook (§24) — par nome/valor configurável.
  const config = await loadFrenetConfig();
  if (config.webhook.tokenValue) {
    const provided = headerVal(event, config.webhook.tokenName);
    if (provided !== config.webhook.tokenValue) {
      await logIntegration('WEBHOOK', 'warn', 'WEBHOOK_RECEIVED token inválido', { source: 'frenet' });
      return reply(401, { error: 'unauthorized' });
    }
  }

  let payload: any = {};
  try { payload = JSON.parse(event.body || '{}'); } catch { payload = {}; }

  await logIntegration('WEBHOOK', 'info', 'WEBHOOK_RECEIVED', {
    source: 'frenet', shipmentId: payload?.ShipmentId, tracking: payload?.TrackingNumber,
  });

  // 2) Persiste o payload cru (auditoria/retry §38) — sem headers sensíveis.
  const sb = admin();
  const { data: hookRow } = await sb.from('webhooks')
    .insert({ source: 'frenet', event: 'tracking', payload, processed: false })
    .select('id').single();

  // 3) Responde já; o processamento abaixo é leve (poucas linhas). Se algo
  //    falhar, ainda retornamos 200 e deixamos o webhook marcado p/ retry.
  try {
    const parsed = FrenetTrackingService.parseWebhook(payload);

    // Anti-duplicidade por assinatura do payload (§24).
    const sig = `webhook:frenet:${parsed.shipmentId || ''}:${parsed.trackingNumber || ''}:${parsed.events.map((e) => `${e.eventCode}@${e.occurredAt}`).join(',')}`;
    if (await seenWebhook(sig)) {
      await sb.from('webhooks').update({ processed: true, processed_at: new Date().toISOString(), error: 'duplicado (ignorado)' }).eq('id', hookRow?.id);
      return reply(200, { ok: true, duplicated: true });
    }

    // Localiza o envio: por ShipmentId (Frenet) -> tracking -> OrderId.
    let shipment: any = null;
    if (parsed.shipmentId) {
      const { data } = await sb.from('shipments').select('id, status').eq('frenet_shipment_id', String(parsed.shipmentId)).maybeSingle();
      shipment = data;
    }
    if (!shipment && parsed.trackingNumber) {
      const { data } = await sb.from('shipments').select('id, status').eq('tracking_code', parsed.trackingNumber).maybeSingle();
      shipment = data;
    }
    if (!shipment && parsed.orderId) {
      const { data } = await sb.from('shipments').select('id, status').eq('frenet_order_id', String(parsed.orderId)).maybeSingle();
      shipment = data;
    }

    if (!shipment) {
      await sb.from('webhooks').update({ processed: true, processed_at: new Date().toISOString(), error: 'envio não encontrado' }).eq('id', hookRow?.id);
      await logIntegration('WEBHOOK', 'warn', 'WEBHOOK_PROCESSED envio não encontrado', { shipmentId: parsed.shipmentId, tracking: parsed.trackingNumber });
      return reply(200, { ok: true, matched: false });
    }

    const res = await persistTrackingEvents(shipment.id, parsed.events, 'webhook', {
      trackingCode: parsed.trackingNumber, trackingUrl: parsed.trackingUrl,
    });

    await sb.from('webhooks').update({ processed: true, processed_at: new Date().toISOString() }).eq('id', hookRow?.id);
    await logIntegration('WEBHOOK', 'info', 'WEBHOOK_PROCESSED', { shipment_id: shipment.id, inserted: res.inserted, status: res.latestStatus });
    return reply(200, { ok: true, matched: true, inserted: res.inserted });

  } catch (err) {
    await sb.from('webhooks').update({ error: String(err).slice(0, 300), attempts: 1 }).eq('id', hookRow?.id).catch(() => {});
    await logIntegration('WEBHOOK', 'error', 'WEBHOOK_PROCESSED falhou', { detail: String(err).slice(0, 200) });
    // Ainda assim 200: evita retry-storm; o registro fica p/ reprocesso manual.
    return reply(200, { ok: true, deferred: true });
  }
};
