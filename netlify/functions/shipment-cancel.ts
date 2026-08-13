/* ================================================================
   /api/shipment-cancel — cancela um envio (§15, §35).
   POST ?id=<uuid>. Se houver etiqueta na Frenet, chama o cancelamento
   oficial; senão apenas marca como cancelado localmente. Idempotente.
   Permissão: shipments.cancel.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, badRequest, notFound, ApiError } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';
import { loadFrenetConfig, FrenetError, FrenetShipmentService } from '../lib/frenet';

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'POST') throw badRequest('Método não suportado.');
  const sb = admin();
  const id = event.queryStringParameters?.id;
  if (!id) throw badRequest('Informe o id do envio.');
  const ctx = await requirePermission(event, 'shipments.cancel');

  const { data: shipment } = await sb.from('shipments').select('*').eq('id', id).maybeSingle();
  if (!shipment) throw notFound('Envio não encontrado.');
  if (shipment.status === 'cancelado') return json(event, 200, { ok: true, status: 'cancelado', already: true });

  const config = await loadFrenetConfig();

  if (shipment.frenet_shipment_id) {
    if (!config.hasPartnerToken) throw badRequest('Cancelamento na Frenet indisponível: configure o Partner Token.');
    try {
      await FrenetShipmentService.cancelShipment(config, shipment.frenet_shipment_id);
    } catch (err) {
      if (err instanceof FrenetError) throw new ApiError(err.httpStatus, err.message);
      throw err;
    }
  }

  await sb.from('shipments').update({ status: 'cancelado' }).eq('id', id);
  await sb.from('tracking_events').insert({ shipment_id: id, status: 'cancelado', event_code: 'CANCEL', description: 'Envio cancelado pela equipe.', source: 'api' });
  await writeAudit({ actorId: ctx.userId, action: 'cancel', entity: 'shipment', entityId: id, oldValue: { status: shipment.status }, newValue: { status: 'cancelado' } });

  return json(event, 200, { ok: true, status: 'cancelado' });
});
