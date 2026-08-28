/* ================================================================
   /api/coupons — cupons de desconto (Fase I · Marketing).
     GET            -> lista os cupons
     POST           -> cria cupom
     PATCH ?id=...  -> atualiza cupom
     DELETE ?id=... -> remove cupom
   Permissões: settings.read (ler) / settings.write (gerir).
   O site aplica/valida via RPC (validate_coupon / create_site_order).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';

const num = (v: unknown, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const normCode = (s: unknown) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
const tsOrNull = (v: unknown) => { const s = String(v ?? '').trim(); return s ? new Date(s).toISOString() : null; };

function sanitize(body: any) {
  const type = body.type === 'fixed' ? 'fixed' : 'percent';
  const out: Record<string, any> = {
    code: normCode(body.code),
    description: (body.description == null ? null : String(body.description).trim() || null),
    type,
    value: Math.max(0, num(body.value)),
    min_order: Math.max(0, num(body.min_order)),
    max_uses: (body.max_uses === '' || body.max_uses == null) ? null : Math.max(0, Math.trunc(num(body.max_uses))),
    starts_at: tsOrNull(body.starts_at),
    expires_at: tsOrNull(body.expires_at),
    active: body.active !== false && body.active !== 'false',
  };
  if (type === 'percent' && out.value > 100) out.value = 100;
  return out;
}

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'settings.read');
    const { data, error } = await sb.from('coupons').select('*').order('created_at', { ascending: false });
    if (error) throw badRequest(error.message);
    return json(event, 200, { coupons: data || [] });
  }

  if (event.httpMethod === 'POST') {
    const ctx = await requirePermission(event, 'settings.write');
    const body = sanitize(parseBody<any>(event));
    if (!body.code) throw badRequest('Informe o código do cupom.');
    if (body.value <= 0) throw badRequest('Informe um valor de desconto maior que zero.');
    const { data, error } = await sb.from('coupons').insert(body).select().single();
    if (error) throw badRequest(error.code === '23505' ? 'Já existe um cupom com esse código.' : error.message);
    await writeAudit({ actorId: ctx.userId, action: 'create', entity: 'coupon', entityId: data.id, reason: 'Cupom criado', newValue: data });
    return json(event, 201, { coupon: data });
  }

  if (event.httpMethod === 'PATCH') {
    const ctx = await requirePermission(event, 'settings.write');
    if (!id) throw badRequest('Cupom não informado.');
    const { data: prev } = await sb.from('coupons').select('*').eq('id', id).maybeSingle();
    if (!prev) throw badRequest('Cupom não encontrado.');
    const body = sanitize(parseBody<any>(event));
    if (!body.code) throw badRequest('Informe o código do cupom.');
    const { data, error } = await sb.from('coupons')
      .update({ ...body, updated_at: new Date().toISOString() }).eq('id', id).select().single();
    if (error) throw badRequest(error.code === '23505' ? 'Já existe um cupom com esse código.' : error.message);
    await writeAudit({ actorId: ctx.userId, action: 'update', entity: 'coupon', entityId: id, reason: 'Cupom atualizado', oldValue: prev, newValue: data });
    return json(event, 200, { coupon: data });
  }

  if (event.httpMethod === 'DELETE') {
    const ctx = await requirePermission(event, 'settings.write');
    if (!id) throw badRequest('Cupom não informado.');
    const { data: prev } = await sb.from('coupons').select('*').eq('id', id).maybeSingle();
    const { error } = await sb.from('coupons').delete().eq('id', id);
    if (error) throw badRequest(error.message);
    await writeAudit({ actorId: ctx.userId, action: 'delete', entity: 'coupon', entityId: id, reason: 'Cupom removido', oldValue: prev });
    return json(event, 200, { ok: true });
  }

  throw badRequest('Método não suportado.');
});
