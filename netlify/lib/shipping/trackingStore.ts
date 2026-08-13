/* ================================================================
   shipping/trackingStore — persiste eventos de rastreio sem duplicar
   (§24) e avança o status do envio sem regredir estados finais.
   Reusado pelo refresh manual (§23) e pelo webhook (§24).
   ================================================================ */
import { admin } from '../supabaseAdmin';
import type { TrackingEvent } from '../frenet/tracking';

const FINAL = new Set(['entregue', 'cancelado']);

export interface PersistResult { inserted: number; latestStatus: string | null; }

export async function persistTrackingEvents(
  shipmentId: string,
  events: TrackingEvent[],
  source: 'api' | 'webhook',
  extra?: { trackingCode?: string | null; trackingUrl?: string | null },
): Promise<PersistResult> {
  const sb = admin();
  if (!events.length && !extra) return { inserted: 0, latestStatus: null };

  const { data: existing } = await sb.from('tracking_events')
    .select('event_code, occurred_at, description').eq('shipment_id', shipmentId);
  const seen = new Set((existing || []).map((e: any) => `${e.event_code}|${e.occurred_at}|${e.description}`));

  const rows = [];
  for (const ev of events) {
    const k = `${ev.eventCode}|${ev.occurredAt}|${ev.description}`;
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({
      shipment_id: shipmentId, status: ev.status, event_code: ev.eventCode,
      description: ev.description ?? ev.label, location: ev.location,
      occurred_at: ev.occurredAt, source, raw: ev as any,
    });
  }
  if (rows.length) {
    // upsert ignora duplicados pelo índice (shipment_id,status,occurred_at) — não quebra o lote.
    await sb.from('tracking_events').upsert(rows, { onConflict: 'shipment_id,status,occurred_at', ignoreDuplicates: true });
  }

  // Evento mais recente (por data) define o status atual.
  const sorted = [...events].filter((e) => e.occurredAt).sort((a, b) => String(a.occurredAt).localeCompare(String(b.occurredAt)));
  const latest = sorted.length ? sorted[sorted.length - 1] : (events.length ? events[events.length - 1] : null);
  const latestStatus = latest?.status ?? null;

  // Atualiza o envio (sem regredir 'entregue'/'cancelado').
  const patch: Record<string, unknown> = {};
  if (extra?.trackingCode) patch.tracking_code = extra.trackingCode;
  if (extra?.trackingUrl) patch.tracking_url = extra.trackingUrl;
  if (latestStatus) {
    const { data: cur } = await sb.from('shipments').select('status').eq('id', shipmentId).maybeSingle();
    if (cur && !FINAL.has(cur.status)) patch.status = latestStatus;
  }
  if (Object.keys(patch).length) await sb.from('shipments').update(patch).eq('id', shipmentId);

  return { inserted: rows.length, latestStatus };
}
