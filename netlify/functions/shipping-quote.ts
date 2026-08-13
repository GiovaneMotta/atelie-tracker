/* ================================================================
   /api/shipping-quote — cotação REAL de frete (§10, §11).
   POST { cepDest, declaredValue, items[]|volumes[], cepOrigin? , shipment_id? }
   • Com Partner Token: cotação WhiteLabel (serviços postáveis §13).
   • Sem Partner Token: cotação simples (vitrine) como fallback.
   Persiste a cotação (auditoria) e devolve só o que a Frenet retornou.
   Permissão: shipping.quote.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { loadFrenetConfig, FrenetError, FrenetQuoteService } from '../lib/frenet';
import { deriveVolumes, volumesToQuote, totalItemsWeight, type ShipItem, type ShipVolume } from '../lib/shipping/volumes';
import { normalizeCep, parseMoney } from '../lib/shipping/normalize';

function toItems(body: any): ShipItem[] {
  const arr = Array.isArray(body.items) ? body.items : [];
  return arr.map((it: any): ShipItem => ({
    name: String(it.name ?? 'Item'),
    sku: it.sku ?? null,
    quantity: Math.max(1, Number(it.quantity) || 1),
    unitPrice: parseMoney(it.unit_price ?? it.price ?? 0),
    weightKg: it.weight_kg != null ? Number(it.weight_kg) : null,
    lengthCm: it.length_cm != null ? Number(it.length_cm) : null,
    widthCm: it.width_cm != null ? Number(it.width_cm) : null,
    heightCm: it.height_cm != null ? Number(it.height_cm) : null,
  }));
}
function toVolumes(body: any): ShipVolume[] | undefined {
  if (!Array.isArray(body.volumes) || !body.volumes.length) return undefined;
  return body.volumes.map((v: any): ShipVolume => ({
    weightKg: Number(v.weightKg ?? v.weight_kg) || 0,
    lengthCm: Number(v.lengthCm ?? v.length_cm) || 0,
    widthCm: Number(v.widthCm ?? v.width_cm) || 0,
    heightCm: Number(v.heightCm ?? v.height_cm) || 0,
    declaredValue: v.declaredValue ?? v.declared_value,
    quantity: Math.max(1, Number(v.quantity) || 1),
  }));
}

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'POST') throw badRequest('Método não suportado.');
  await requirePermission(event, 'shipping.quote');

  const body = parseBody<any>(event);
  const cepDest = normalizeCep(body.cepDest ?? body.cep_dest ?? body.recipient?.cep);
  if (cepDest.length !== 8) throw badRequest('Informe um CEP de destino válido (8 dígitos).');

  const config = await loadFrenetConfig();
  const cepOrigin = normalizeCep(body.cepOrigin ?? body.cep_origin) || config.cepOrigem;
  if (cepOrigin.length !== 8) throw badRequest('CEP de origem não configurado. Ajuste em Configurações › Frenet.');

  const declaredValue = parseMoney(body.declaredValue ?? body.declared_value ?? 0);
  const items = toItems(body);
  const volumes = deriveVolumes(items, config.box, declaredValue, toVolumes(body));
  const weightKg = totalItemsWeight(items) || volumes.reduce((s, v) => s + v.weightKg * v.quantity, 0);

  const input = {
    cepOrigin, cepDest, declaredValue, volumes: volumesToQuote(volumes),
    services: { declaredValue: declaredValue > 0 },
  };

  let result;
  try {
    result = config.hasPartnerToken
      ? await FrenetQuoteService.quoteShipment(config, input)
      : await FrenetQuoteService.quoteSimple(config, input);
  } catch (err) {
    if (err instanceof FrenetError) throw badRequest(err.message);
    throw err;
  }

  if (!result.options.length) {
    return json(event, 200, {
      options: [], source: result.source, session_id: result.session_id ?? null,
      message: 'A Frenet não retornou serviços para este destino/volume. Confira CEP, peso e dimensões.',
    });
  }

  // Destaques: menor preço e menor prazo (§11).
  let cheapestIndex = 0, fastestIndex = 0;
  result.options.forEach((o, i) => {
    if (o.price < result.options[cheapestIndex].price) cheapestIndex = i;
    const od = o.days ?? Infinity, fd = result.options[fastestIndex].days ?? Infinity;
    if (od < fd) fastestIndex = i;
  });

  // Persistir a cotação (§16 / auditoria).
  const { data: saved } = await admin().from('shipping_quotes').insert({
    shipment_id: body.shipment_id ?? null,
    provider: 'frenet',
    cep_origin: cepOrigin, cep_dest: cepDest,
    declared_value: declaredValue, weight_kg: weightKg,
    options: result.options as any,
    session_id: result.session_id,
    environment: config.environment,
    recipient: body.recipient ?? null,
  }).select('id').single();

  return json(event, 200, {
    quote_id: saved?.id ?? null,
    source: result.source,
    session_id: result.session_id ?? null,
    partner_configured: config.hasPartnerToken,
    cheapest_index: cheapestIndex,
    fastest_index: fastestIndex,
    options: result.options,
  });
});
