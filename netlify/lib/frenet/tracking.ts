/* ================================================================
   frenet/tracking — FrenetTrackingService (§23, §24, §25).
   • trackByNumber(): POST api.frenet.com.br/tracking/trackinginfo
     (consulta manual; exige ShippingServiceCode + TrackingNumber).
   • parseWebhook(): normaliza o payload do webhook de tracking.
   Mantém SEMPRE o código original do evento (§25).
   ================================================================ */
import { frenetRequest, FrenetError } from './client';
import type { FrenetConfig } from './config';
import { parseFrenetDate, trackingStatus, TRACKING_CODE_LABEL } from './mapping';

export interface TrackingEvent {
  eventCode: string;        // EventType original da Frenet
  status: string;           // status interno mapeado
  label: string;            // rótulo humano
  description: string | null;
  location: string | null;
  occurredAt: string | null;  // ISO
}
export interface TrackingResult {
  trackingNumber: string | null;
  trackingUrl: string | null;
  serviceDescription: string | null;
  events: TrackingEvent[];
}

function pick(o: any, ...keys: string[]) { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; }
const s = (v: unknown) => (v == null ? null : String(v));

function mapEvents(rawEvents: any): TrackingEvent[] {
  const arr = Array.isArray(rawEvents) ? rawEvents : [];
  return arr.map((e: any): TrackingEvent => {
    const code = String(pick(e, 'EventType', 'eventType') ?? '').trim();
    return {
      eventCode: code,
      status: trackingStatus(code),
      label: TRACKING_CODE_LABEL[code] || String(pick(e, 'EventDescription', 'eventDescription') ?? 'Atualização'),
      description: s(pick(e, 'EventDescription', 'eventDescription')),
      location: s(pick(e, 'EventLocation', 'eventLocation')),
      occurredAt: parseFrenetDate(pick(e, 'EventDateTime', 'eventDateTime')),
    };
  });
}

export const FrenetTrackingService = {
  /** Consulta manual de rastreio pela API (§23). */
  async trackByNumber(config: FrenetConfig, serviceCode: string, trackingNumber: string): Promise<TrackingResult> {
    if (!config.hasClientToken) throw new FrenetError('auth', 'Token do cliente Frenet não configurado.', 409);
    if (!trackingNumber) throw new FrenetError('invalid', 'Código de rastreio ausente.', 422);

    const data = await frenetRequest({
      base: config.quoteBase, path: '/tracking/trackinginfo', method: 'POST',
      headers: { token: config.clientToken },
      body: { ShippingServiceCode: serviceCode || '', TrackingNumber: trackingNumber },
      timeoutMs: 20000, retries: 1, logLabel: 'TRACKING', logContext: { tracking: trackingNumber },
    });

    return {
      trackingNumber: s(pick(data, 'TrackingNumber', 'trackingNumber')) ?? trackingNumber,
      trackingUrl: s(pick(data, 'TrackingUrl', 'trackingUrl')),
      serviceDescription: s(pick(data, 'ServiceDescrition', 'ServiceDescription', 'serviceDescription')),
      events: mapEvents(pick(data, 'TrackingEvents', 'trackingEvents')),
    };
  },

  /** Normaliza o payload do webhook (§24). Não faz IO. */
  parseWebhook(payload: any): { orderId: string | null; shipmentId: string | null } & TrackingResult {
    return {
      orderId: s(pick(payload, 'OrderId', 'orderId')),
      shipmentId: s(pick(payload, 'ShipmentId', 'shipmentId')),
      trackingNumber: s(pick(payload, 'TrackingNumber', 'trackingNumber')),
      trackingUrl: s(pick(payload, 'TrackingUrl', 'trackingUrl')),
      serviceDescription: s(pick(payload, 'ServiceDescrition', 'ServiceDescription', 'serviceDescription')),
      events: mapEvents(pick(payload, 'TrackingEvents', 'trackingEvents')),
    };
  },
};
