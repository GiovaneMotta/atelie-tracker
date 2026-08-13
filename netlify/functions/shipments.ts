/* ================================================================
   /api/shipments — envios (§7, §14, §21, §22).
     GET   /api/shipments            -> lista (filtros: status, carrier,
                                        service, q=nome/rastreio, from, to)
     GET   /api/shipments?id=<uuid>  -> detalhe (itens, volumes, cotações,
                                        etiquetas, rastreio)
     POST  /api/shipments            -> cria envio (valida endereço §9),
                                        status 'aguardando_confirmacao'
     PATCH /api/shipments?id=<uuid>  -> checklist/notes/editar (rascunho)
   Permissões: shipments.read / shipping.create / shipments.write.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound, conflict } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';
import { loadFrenetConfig } from '../lib/frenet';
import { validateRecipient, type RecipientInput } from '../lib/shipping/validateAddress';
import { deriveVolumes, totalItemsWeight, type ShipItem, type ShipVolume } from '../lib/shipping/volumes';
import { normalizeCep, normalizePhone, normalizeDocument, normalizeUF, parseMoney } from '../lib/shipping/normalize';

const DETAIL = '*, shipment_items(*), shipment_volumes(*), shipping_labels(*), tracking_events(*), shipping_quotes(*)';
const EDITABLE = new Set(['rascunho', 'cotando', 'cotado', 'aguardando_confirmacao', 'erro']);

function normalizeRecipient(r: any): RecipientInput {
  return {
    name: String(r?.name ?? '').trim(),
    document: normalizeDocument(r?.document),
    phone: normalizePhone(r?.phone),
    email: String(r?.email ?? '').trim(),
    cep: normalizeCep(r?.cep),
    street: String(r?.street ?? '').trim(),
    number: String(r?.number ?? '').trim(),
    complement: String(r?.complement ?? '').trim(),
    district: String(r?.district ?? '').trim(),
    city: String(r?.city ?? '').trim(),
    state: normalizeUF(r?.state),
    reference: String(r?.reference ?? '').trim(),
  };
}
function toItems(body: any): ShipItem[] {
  const arr = Array.isArray(body.items) ? body.items : [];
  return arr.map((it: any): ShipItem => ({
    name: String(it.name ?? 'Item'), sku: it.sku ?? null,
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
  const sb = admin();
  const id = event.queryStringParameters?.id;

  // ----------------------------------------------------------------- GET
  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'shipments.read');

    if (id) {
      const { data, error } = await sb.from('shipments').select(DETAIL).eq('id', id).maybeSingle();
      if (error) throw badRequest(error.message);
      if (!data) throw notFound('Envio não encontrado.');
      // Ordena eventos de rastreio (mais recente primeiro) no servidor.
      if (Array.isArray((data as any).tracking_events)) {
        (data as any).tracking_events.sort((a: any, b: any) =>
          String(b.occurred_at || b.created_at).localeCompare(String(a.occurred_at || a.created_at)));
      }
      return json(event, 200, { shipment: data });
    }

    const p = event.queryStringParameters || {};
    let q = sb.from('shipments')
      .select('id, status, carrier, service, price, tracking_code, recipient, environment, created_at, frenet_shipment_id, label_url')
      .order('created_at', { ascending: false }).limit(300);
    if (p.status) q = q.eq('status', p.status);
    if (p.carrier) q = q.ilike('carrier', `%${p.carrier}%`);
    if (p.service) q = q.ilike('service', `%${p.service}%`);
    if (p.from) q = q.gte('created_at', p.from);
    if (p.to) q = q.lte('created_at', p.to);
    if (p.q) {
      const term = p.q.replace(/[(),%*]/g, ' ').trim();
      // Filtro OR bruto do PostgREST usa '*' como curinga (não '%').
      if (term) q = q.or(`tracking_code.ilike.*${term}*,recipient->>name.ilike.*${term}*`);
    }
    const { data, error } = await q;
    if (error) throw badRequest(error.message);
    return json(event, 200, { shipments: data ?? [] });
  }

  // ----------------------------------------------------------------- POST
  if (event.httpMethod === 'POST') {
    const ctx = await requirePermission(event, 'shipping.create');
    const body = parseBody<any>(event);

    const recipient = normalizeRecipient(body.recipient || {});
    const check = validateRecipient(recipient);
    if (!check.ok) return json(event, 422, { error: 'Endereço incompleto para postagem.', validation: check });

    const config = await loadFrenetConfig();
    const items = toItems(body);
    const declaredValue = parseMoney(body.declared_value ?? body.declaredValue ?? items.reduce((s, it) => s + it.unitPrice * it.quantity, 0));
    const volumes = deriveVolumes(items, config.box, declaredValue, toVolumes(body));
    const weightKg = totalItemsWeight(items) || volumes.reduce((s, v) => s + v.weightKg * v.quantity, 0);

    const quote = body.quote || null;
    const hasQuote = quote && (quote.serviceCode || quote.service_code);
    const status = hasQuote ? 'aguardando_confirmacao' : 'rascunho';

    const sender = config.useFrenetRegistration ? null : config.sender;

    const { data: shipment, error } = await sb.from('shipments').insert({
      order_id: body.order_id ?? null,
      recipient, sender,
      carrier: hasQuote ? (quote.carrier ?? null) : null,
      service: hasQuote ? (quote.serviceName ?? quote.service_name ?? null) : null,
      service_code: hasQuote ? (quote.serviceCode ?? quote.service_code) : null,
      service_name: hasQuote ? (quote.serviceName ?? quote.service_name ?? null) : null,
      carrier_code: hasQuote ? (quote.carrierCode ?? quote.carrier_code ?? null) : null,
      price: hasQuote ? parseMoney(quote.price) : null,
      delivery_days: hasQuote ? (quote.days ?? quote.delivery_days ?? null) : null,
      declared_value: declaredValue,
      weight_kg: weightKg,
      label_format: config.labelFormat,
      environment: config.environment,
      status,
      notes: body.notes ?? null,
      created_by: ctx.userId,
    }).select('*').single();
    if (error) throw badRequest(error.message);

    if (items.length) {
      const srcItems = Array.isArray(body.items) ? body.items : [];
      await sb.from('shipment_items').insert(items.map((it, i) => ({
        shipment_id: shipment.id,
        product_id: srcItems[i]?.product_id ?? null,
        name: it.name, sku: it.sku, quantity: it.quantity, unit_price: it.unitPrice,
        weight_kg: it.weightKg, length_cm: it.lengthCm, width_cm: it.widthCm, height_cm: it.heightCm,
      })));
    }
    await sb.from('shipment_volumes').insert(volumes.map((v) => ({
      shipment_id: shipment.id, weight_kg: v.weightKg, length_cm: v.lengthCm, width_cm: v.widthCm,
      height_cm: v.heightCm, declared_value: v.declaredValue ?? null, quantity: v.quantity,
    })));

    if (body.quote_id) await sb.from('shipping_quotes').update({ shipment_id: shipment.id, chosen: quote as any }).eq('id', body.quote_id);

    await writeAudit({ actorId: ctx.userId, action: 'create', entity: 'shipment', entityId: shipment.id, newValue: { status, service_code: shipment.service_code, declared_value: declaredValue } });

    const { data: full } = await sb.from('shipments').select(DETAIL).eq('id', shipment.id).single();
    return json(event, 201, { shipment: full, validation: check });
  }

  // ----------------------------------------------------------------- PATCH
  if (event.httpMethod === 'PATCH') {
    if (!id) throw badRequest('Informe o id do envio.');
    const body = parseBody<any>(event);
    const action = body.action || 'update';

    const { data: current } = await sb.from('shipments').select('*').eq('id', id).maybeSingle();
    if (!current) throw notFound('Envio não encontrado.');

    if (action === 'checklist') {
      const ctx = await requirePermission(event, 'shipments.write');
      const checklist = { ...(current.checklist || {}), ...(body.checklist || {}) };
      const { error } = await sb.from('shipments').update({ checklist }).eq('id', id);
      if (error) throw badRequest(error.message);
      await writeAudit({ actorId: ctx.userId, action: 'update', entity: 'shipment', entityId: id, reason: 'checklist', newValue: checklist });
      const { data: full } = await sb.from('shipments').select(DETAIL).eq('id', id).single();
      return json(event, 200, { shipment: full });
    }

    // Edição de dados/serviço só antes de gerar etiqueta (§14).
    const ctx = await requirePermission(event, 'shipping.create');
    if (!EDITABLE.has(current.status)) throw conflict('Este envio já teve a etiqueta gerada e não pode mais ser editado.');

    const patch: Record<string, unknown> = {};
    if (body.recipient) {
      const recipient = normalizeRecipient(body.recipient);
      const check = validateRecipient(recipient);
      if (!check.ok) return json(event, 422, { error: 'Endereço incompleto para postagem.', validation: check });
      patch.recipient = recipient;
    }
    if (typeof body.notes === 'string') patch.notes = body.notes;
    if (body.quote) {
      const quote = body.quote;
      patch.carrier = quote.carrier ?? null;
      patch.service = quote.serviceName ?? quote.service_name ?? null;
      patch.service_code = quote.serviceCode ?? quote.service_code ?? null;
      patch.service_name = quote.serviceName ?? quote.service_name ?? null;
      patch.carrier_code = quote.carrierCode ?? quote.carrier_code ?? null;
      patch.price = parseMoney(quote.price);
      patch.delivery_days = quote.days ?? quote.delivery_days ?? null;
      patch.status = 'aguardando_confirmacao';
    }
    if (!Object.keys(patch).length) throw badRequest('Nada para atualizar.');

    const { error } = await sb.from('shipments').update(patch).eq('id', id);
    if (error) throw badRequest(error.message);
    await writeAudit({ actorId: ctx.userId, action: 'update', entity: 'shipment', entityId: id, newValue: patch });
    const { data: full } = await sb.from('shipments').select(DETAIL).eq('id', id).single();
    return json(event, 200, { shipment: full });
  }

  throw badRequest('Método não suportado.');
});
