/* ================================================================
   frenet/mapping — traduções entre a Frenet e nossos estados internos.
   NÃO inventar eventos/status: guardamos SEMPRE o código original e só
   acrescentamos um rótulo interno (§25). Fonte: doc oficial da Frenet.
   ================================================================ */

/** EventType do rastreio (webhook/tracking API) -> status interno (§25). */
export const TRACKING_CODE_TO_STATUS: Record<string, string> = {
  '18': 'postado',       // aguardando coleta no ponto de postagem
  '0': 'postado',        // Postado
  '1': 'em_transito',    // Em trânsito
  '2': 'problema',       // Atraso
  '3': 'problema',       // Devolvido
  '4': 'problema',       // Extraviado
  '5': 'saiu_entrega',   // Em rota / saiu para entrega
  '9': 'entregue',       // Entregue
};

/** Rótulo humano do código de rastreio original da Frenet. */
export const TRACKING_CODE_LABEL: Record<string, string> = {
  '18': 'Aguardando coleta no ponto de postagem',
  '0': 'Postado',
  '1': 'Em trânsito',
  '2': 'Atraso',
  '3': 'Devolvido',
  '4': 'Extraviado',
  '5': 'Saiu para entrega',
  '9': 'Entregue',
};

export function trackingStatus(eventType: unknown): string {
  const code = String(eventType ?? '').trim();
  return TRACKING_CODE_TO_STATUS[code] || 'em_transito';
}

/**
 * ShipmentStatus da Frenet (retorno de criação/consulta do envio):
 * 1=Created 2=PendingPayment 3=PaymentFailure 4=PaymentSuccess 5=Posted
 * 6=CancellationScheduled 7=Cancelled 9=Deleted 18=DeliveredAtPostingPoint
 * -> nosso status interno.
 */
export const SHIPMENT_STATUS_TO_INTERNAL: Record<number, string> = {
  1: 'etiqueta_gerada',
  2: 'aguardando_confirmacao',
  3: 'erro',
  4: 'etiqueta_gerada',
  5: 'postado',
  6: 'cancelado',
  7: 'cancelado',
  9: 'cancelado',
  18: 'postado',
};

export function shipmentStatusToInternal(frenetStatus: unknown): string | null {
  const n = Number(frenetStatus);
  if (!Number.isFinite(n)) return null;
  return SHIPMENT_STATUS_TO_INTERNAL[n] ?? null;
}

/** Data no formato do webhook Frenet "dd/MM/yyyy HH:mm" -> ISO. */
export function parseFrenetDate(input: unknown): string | null {
  const s = String(input ?? '').trim();
  if (!s) return null;
  // dd/MM/yyyy HH:mm  ou  dd/MM/yyyy
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (m) {
    const [, dd, mm, yyyy, hh = '00', mi = '00'] = m;
    const iso = `${yyyy}-${mm}-${dd}T${hh}:${mi}:00`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
