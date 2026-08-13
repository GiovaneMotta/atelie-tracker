/* ================================================================
   /api/addresses — endereços de um cliente (§3). Múltiplos por cliente.
     POST   /api/addresses                -> cria (body inclui customer_id)
     PATCH  /api/addresses?id=<uuid>       -> atualiza
     DELETE /api/addresses?id=<uuid>       -> remove
   Endereço é dado sensível: toda alteração vai para a auditoria (§34).
   Permissão: customers.write.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const FIELDS = ['label', 'recipient', 'cep', 'street', 'number', 'complement',
  'district', 'city', 'state', 'reference', 'is_default'] as const;

function pick(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in body) out[k] = body[k];
  if ('cep' in out) out.cep = onlyDigits(out.cep) || null;
  if ('state' in out && typeof out.state === 'string') out.state = out.state.toUpperCase().slice(0, 2);
  return out;
}

/** Se o endereço for marcado como padrão, desmarca os demais do cliente. */
async function unsetOtherDefaults(customerId: string, keepId?: string) {
  const sb = admin();
  let q = sb.from('customer_addresses').update({ is_default: false }).eq('customer_id', customerId);
  if (keepId) q = q.neq('id', keepId);
  await q;
}

export const handler: Handler = withHttp(async (event) => {
  const ctx = await requirePermission(event, 'customers.write');
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'POST') {
    const body = parseBody<Record<string, unknown>>(event);
    const customerId = String(body.customer_id || '');
    if (!customerId) throw badRequest('customer_id é obrigatório.');
    const fields = { ...pick(body), customer_id: customerId };

    const { data, error } = await sb.from('customer_addresses').insert(fields).select('*').single();
    if (error) throw badRequest(error.message);
    if (data.is_default) await unsetOtherDefaults(customerId, data.id);
    await writeAudit({ actorId: ctx.userId, action: 'create', entity: 'address', entityId: data.id, newValue: fields });
    return json(event, 201, { address: data });
  }

  if (event.httpMethod === 'PATCH') {
    if (!id) throw badRequest('Informe o id do endereço.');
    const body = parseBody<Record<string, unknown>>(event);
    const fields = pick(body);
    if (Object.keys(fields).length === 0) throw badRequest('Nada para atualizar.');

    const { data: before } = await sb.from('customer_addresses').select('*').eq('id', id).maybeSingle();
    if (!before) throw notFound('Endereço não encontrado.');

    const { data, error } = await sb.from('customer_addresses').update(fields).eq('id', id).select('*').single();
    if (error) throw badRequest(error.message);
    if (data.is_default) await unsetOtherDefaults(data.customer_id, data.id);
    await writeAudit({ actorId: ctx.userId, action: 'update', entity: 'address', entityId: id, oldValue: before, newValue: fields });
    return json(event, 200, { address: data });
  }

  if (event.httpMethod === 'DELETE') {
    if (!id) throw badRequest('Informe o id do endereço.');
    const { data: before } = await sb.from('customer_addresses').select('*').eq('id', id).maybeSingle();
    if (!before) throw notFound('Endereço não encontrado.');
    const { error } = await sb.from('customer_addresses').delete().eq('id', id);
    if (error) throw badRequest(error.message);
    await writeAudit({ actorId: ctx.userId, action: 'delete', entity: 'address', entityId: id, oldValue: before });
    return json(event, 200, { ok: true });
  }

  throw badRequest('Método não suportado.');
});
