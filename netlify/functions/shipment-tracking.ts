/* ================================================================
   /api/shipment-tracking — rastreamento (§23).
     GET  ?id=<uuid>  -> eventos salvos + status atual
     POST ?id=<uuid>  -> ATUALIZA consultando a Frenet (getShipment +
                         tracking/trackinginfo quando há código) e persiste.
   Permissão: shipments.read.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, badRequest, notFound } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import {
  loadFrenetConfig, FrenetError, FrenetShipmentService, FrenetTrackingService, shipmentStatusToInternal,
} from '../lib/frenet';
import { persistTrackingEvents } from '../lib/shipping/trackingStore';

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;
  if (!id) throw badRequest('Informe o id do envio.');
  await requirePermission(event, 'shipments.read');

  const { data: shipment } = await sb.from('shipments').select('*').eq('id', id).maybeSingle();
  if (!shipment) throw notFound('Envio não encontrado.');

  if (event.httpMethod === 'GET') {
    const { data: events } = await sb.from('tracking_events').select('*').eq('shipment_id', id)
      .order('occurred_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });
    return json(event, 200, { status: shipment.status, tracking_code: shipment.tracking_code, tracking_url: shipment.tracking_url, events: events ?? [] });
  }

  if (event.httpMethod !== 'POST') throw badRequest('Método não suportado.');

  const config = await loadFrenetConfig();
  const notes: string[] = [];

  // 1) Consulta o envio na Frenet (status/label/tracking) quando temos o ShipmentId.
  if (shipment.frenet_shipment_id && config.hasPartnerToken) {
    try {
      const s = await FrenetShipmentService.getShipment(config, shipment.frenet_shipment_id);
      const patch: Record<string, unknown> = {};
      if (s.trackingUrl) patch.tracking_url = s.trackingUrl;
      if (s.labelUrl) patch.label_url = s.labelUrl;
      if (s.shipmentStatus != null) {
        patch.frenet_status = s.shipmentStatus;
        const mapped = shipmentStatusToInternal(s.shipmentStatus);
        if (mapped && !['entregue', 'cancelado'].includes(shipment.status) && mapped !== 'erro') patch.status = mapped;
      }
      if (Object.keys(patch).length) await sb.from('shipments').update(patch).eq('id', id);
    } catch (err) {
      notes.push(err instanceof FrenetError ? err.message : 'Falha ao consultar o envio na Frenet.');
    }
  }

  // 2) Eventos detalhados via tracking (precisa do código de rastreio).
  if (shipment.tracking_code) {
    try {
      const res = await FrenetTrackingService.trackByNumber(config, shipment.service_code || '', shipment.tracking_code);
      await persistTrackingEvents(id, res.events, 'api', { trackingUrl: res.trackingUrl });
    } catch (err) {
      notes.push(err instanceof FrenetError ? err.message : 'Falha ao consultar o rastreio na Frenet.');
    }
  } else {
    notes.push('Sem código de rastreio ainda. Ele chega pela postagem/webhook da Frenet.');
  }

  const { data: fresh } = await sb.from('shipments').select('status, tracking_code, tracking_url').eq('id', id).single();
  const { data: events } = await sb.from('tracking_events').select('*').eq('shipment_id', id)
    .order('occurred_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false });

  return json(event, 200, { status: fresh?.status, tracking_code: fresh?.tracking_code, tracking_url: fresh?.tracking_url, events: events ?? [], notes });
});
