/* ================================================================
   /api/shipment-label — geração e recuperação de etiqueta.
     POST /api/shipment-label?id=<uuid> -> GERA (OneClick). Idempotente e
          travado (§17): clique duplo/repetição NÃO gera 2 etiquetas nem
          cobra de novo. Checa saldo/limite (§16). [labels.generate]
     GET  /api/shipment-label?id=<uuid> -> recupera/reimprime a etiqueta
          já existente, sem gerar nova (§20). [labels.read]
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, badRequest, notFound, conflict, ApiError } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';
import { logIntegration } from '../lib/log';
import {
  loadFrenetConfig, FrenetError, FrenetShipmentService, FrenetLabelService, shipmentStatusToInternal,
} from '../lib/frenet';
import { buildOneClickPayload } from '../lib/shipping/buildOneClick';
import { validateRecipient, validateSender } from '../lib/shipping/validateAddress';
import { acquireIdempotency, memoizeResult, releaseIdempotency, labelKey } from '../lib/shipping/idempotency';
import type { ShipItem, ShipVolume } from '../lib/shipping/volumes';

const GENERATED = new Set(['etiqueta_gerada', 'postado', 'em_transito', 'saiu_entrega', 'entregue', 'problema']);

function itemsFromRows(rows: any[]): ShipItem[] {
  return (rows || []).map((r) => ({
    name: r.name, sku: r.sku, quantity: r.quantity, unitPrice: Number(r.unit_price) || 0,
    weightKg: r.weight_kg, lengthCm: r.length_cm, widthCm: r.width_cm, heightCm: r.height_cm,
  }));
}
function volumesFromRows(rows: any[], fallbackWeight: number): ShipVolume[] {
  const v = (rows || []).map((r) => ({
    weightKg: Number(r.weight_kg) || 0, lengthCm: Number(r.length_cm) || 0,
    widthCm: Number(r.width_cm) || 0, heightCm: Number(r.height_cm) || 0,
    declaredValue: r.declared_value ?? undefined, quantity: r.quantity || 1,
  }));
  return v.length ? v : [{ weightKg: fallbackWeight || 0.5, lengthCm: 30, widthCm: 25, heightCm: 10, quantity: 1 }];
}

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;
  if (!id) throw badRequest('Informe o id do envio.');

  const { data: shipment } = await sb.from('shipments')
    .select('*, shipment_items(*), shipment_volumes(*)').eq('id', id).maybeSingle();
  if (!shipment) throw notFound('Envio não encontrado.');

  const config = await loadFrenetConfig();

  // ------------------------------------------------------- GET (reimpressão)
  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'labels.read');
    if (!shipment.frenet_shipment_id) throw conflict('Etiqueta ainda não foi gerada para este envio.');

    const force = event.queryStringParameters?.refresh === '1';
    if (shipment.label_url && !force) {
      return json(event, 200, { label_url: shipment.label_url, declaration_url: shipment.declaration_url, tracking_url: shipment.tracking_url, reprint: true });
    }
    const label = await FrenetLabelService.getLabel(config, shipment.frenet_shipment_id, shipment.label_format);
    await sb.from('shipments').update({
      label_url: label.labelUrl ?? shipment.label_url,
      declaration_url: label.declarationUrl ?? shipment.declaration_url,
      tracking_url: label.trackingUrl ?? shipment.tracking_url,
    }).eq('id', id);
    return json(event, 200, { label_url: label.labelUrl, declaration_url: label.declarationUrl, tracking_url: label.trackingUrl, reprint: true });
  }

  if (event.httpMethod !== 'POST') throw badRequest('Método não suportado.');

  // ------------------------------------------------------- POST (geração)
  const ctx = await requirePermission(event, 'labels.generate');

  // 1) Já gerada? Não gerar de novo (§20) — devolve a existente.
  if (GENERATED.has(shipment.status) || shipment.frenet_shipment_id) {
    return json(event, 200, {
      already_generated: true,
      shipment_id: shipment.frenet_shipment_id,
      label_url: shipment.label_url, declaration_url: shipment.declaration_url, tracking_url: shipment.tracking_url,
      message: 'Etiqueta já gerada para este envio. Use “Abrir/Imprimir”.',
    });
  }
  if (shipment.status === 'cancelado') throw conflict('Envio cancelado — não é possível gerar etiqueta.');
  if (!shipment.service_code) throw conflict('Selecione um serviço de frete antes de gerar a etiqueta.');

  // 2) Validação final de endereço (§9) — bloqueia se faltar número/obrigatórios.
  const rcheck = validateRecipient(shipment.recipient || {});
  if (!rcheck.ok) return json(event, 422, { error: 'Endereço incompleto para postagem.', validation: rcheck });
  if (!config.useFrenetRegistration) {
    const scheck = validateSender(config.sender);
    if (!scheck.ok) return json(event, 422, { error: 'Remetente incompleto nas Configurações.', validation: scheck });
  }

  // 3) Tokens WhiteLabel obrigatórios (§16) — sem fingir que funciona.
  if (!config.hasClientToken || !config.hasPartnerToken) {
    throw conflict('Geração de etiqueta indisponível: configure FRENET_API_TOKEN e FRENET_PARTNER_TOKEN da Frenet.');
  }

  // 4) Saldo/limite (§16) — checagem prévia amigável.
  try {
    const wallet = await FrenetShipmentService.getWallet(config);
    const price = Number(shipment.price) || 0;
    const usable = wallet.balance + wallet.bonusBalance;
    if (wallet.labelLimit <= 0) throw conflict('Limite de etiquetas esgotado na carteira Frenet. Ajuste o limite no painel Frenet.');
    if (price > 0 && usable < price) {
      throw conflict(`Saldo insuficiente na carteira Frenet (disponível R$ ${usable.toFixed(2)}, frete R$ ${price.toFixed(2)}). Adicione saldo e tente novamente.`);
    }
  } catch (err) {
    if (err instanceof FrenetError && err.kind !== 'unavailable' && err.kind !== 'timeout') {
      // erro de negócio (ex.: auth) já é claro
      throw conflict(err.message);
    }
    // indisponibilidade na checagem de saldo não bloqueia; o OneClick valida de novo
  }

  // 5) TRAVA de idempotência (§17). Só um processo gera; repetição responde igual.
  const key = labelKey(id);
  const lock = await acquireIdempotency(key, 'label');
  if (!lock.acquired) {
    if (lock.existingResult) return json(event, 200, { ...(lock.existingResult as object), reused: true });
    throw conflict('Este envio já está gerando a etiqueta. Aguarde a conclusão (não clique novamente).');
  }

  // 6) Marca processamento.
  await sb.from('shipments').update({ status: 'gerando', generating_at: new Date().toISOString(), last_error: null }).eq('id', id);

  const items = itemsFromRows(shipment.shipment_items);
  const volumes = volumesFromRows(shipment.shipment_volumes, Number(shipment.weight_kg));
  const payload = buildOneClickPayload(config, {
    orderId: shipment.id,
    orderValue: Number(shipment.declared_value) || items.reduce((s, it) => s + it.unitPrice * it.quantity, 0),
    createdAt: shipment.created_at,
    recipient: shipment.recipient,
    items, volumes,
    quote: {
      serviceCode: shipment.service_code, serviceName: shipment.service_name,
      carrier: shipment.carrier, carrierCode: shipment.carrier_code,
      price: Number(shipment.price) || 0, days: shipment.delivery_days,
    },
    notifyUrl: config.webhook.url || undefined,
  });

  try {
    const result = await FrenetShipmentService.createOneClick(config, payload);
    const item = result.items[0];

    // Sucesso: temos um ShipmentId da Frenet.
    if (item && item.shipmentId) {
      const internal = shipmentStatusToInternal(item.shipmentStatus) || 'etiqueta_gerada';
      const status = internal === 'cancelado' || internal === 'erro' ? 'etiqueta_gerada' : internal;
      await sb.from('shipments').update({
        frenet_shipment_id: item.shipmentId, frenet_order_id: item.orderId,
        label_url: item.labelUrl, declaration_url: item.declarationUrl, tracking_url: item.trackingUrl,
        valid_through: item.validThrough, frenet_status: item.shipmentStatus,
        status, generating_at: null, last_error: item.errors.length ? item.errors.join('; ') : null,
      }).eq('id', id);

      await sb.from('shipping_labels').insert({
        shipment_id: id, format: shipment.label_format || 'A4', url: item.labelUrl,
        frenet_data: item as any,
      });

      const out = {
        ok: true, shipment_id: item.shipmentId, label_url: item.labelUrl,
        declaration_url: item.declarationUrl, tracking_url: item.trackingUrl, status,
      };
      await memoizeResult(key, out);
      await writeAudit({ actorId: ctx.userId, action: 'generate_label', entity: 'shipment', entityId: id, newValue: { frenet_shipment_id: item.shipmentId, price: shipment.price } });
      return json(event, 200, out);
    }

    // Erro por item SEM ShipmentId -> nada criado: libera a trava p/ correção e retry.
    const msg = (item?.errors?.length ? item.errors.join('; ') : result.batchError) || 'A Frenet não gerou a etiqueta. Revise os dados e tente novamente.';
    await sb.from('shipments').update({ status: 'erro', generating_at: null, last_error: msg }).eq('id', id);
    await releaseIdempotency(key);
    await logIntegration('FRENET', 'error', 'LABEL_RESPONSE sem ShipmentId', { shipmentId: id, statusBatch: result.statusBatch });
    throw conflict(msg);

  } catch (err) {
    if (err instanceof FrenetError) {
      // Erros de negócio antes da criação (auth/dados/saldo) -> libera p/ retry.
      if (['auth', 'invalid', 'balance', 'notfound'].includes(err.kind)) {
        await sb.from('shipments').update({ status: 'erro', generating_at: null, last_error: err.message }).eq('id', id);
        await releaseIdempotency(key);
        throw conflict(err.message);
      }
      // Timeout/indisponibilidade -> INCERTO se cobrou. NÃO liberar a trava (§17).
      await sb.from('shipments').update({
        status: 'erro', generating_at: null,
        last_error: `${err.message} Não gere novamente: confira no painel Frenet se a etiqueta foi criada.`,
      }).eq('id', id);
      throw new ApiError(err.httpStatus,
        `${err.message} Por segurança, verifique no painel da Frenet antes de tentar de novo (a etiqueta pode ter sido criada).`);
    }
    // Erro inesperado: mantém a trava (incerteza) e registra.
    await sb.from('shipments').update({ status: 'erro', generating_at: null, last_error: 'Falha inesperada ao gerar etiqueta.' }).eq('id', id);
    throw err;
  }
});
