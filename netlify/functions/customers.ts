/* ================================================================
   /api/customers — CRUD de clientes (§3).
     GET    /api/customers            -> lista (busca opcional ?search=)
     GET    /api/customers?id=<uuid>  -> um cliente + endereços
     POST   /api/customers            -> cria
     PATCH  /api/customers?id=<uuid>  -> atualiza
   Permissões: customers.read (ler) / customers.write (criar/editar).
   CPF só aparece completo para quem tem customers.cpf; senão, mascarado (§43).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound } from '../lib/http';
import { getAuth, requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { writeAudit } from '../lib/audit';
import type { AuthContext } from '../lib/auth';

const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Mascara o documento revelando só os 2 últimos dígitos. */
function maskDocument(doc: string | null): string | null {
  if (!doc) return doc;
  const d = onlyDigits(doc);
  if (d.length < 3) return '•••';
  return '•'.repeat(d.length - 2) + d.slice(-2);
}

function shapeCustomer(row: any, ctx: AuthContext) {
  const canSeeCpf = ctx.has('customers.cpf');
  return { ...row, document: canSeeCpf ? row.document : maskDocument(row.document) };
}

// Campos que o cliente pode enviar (whitelist — evita injeção de colunas).
const WRITABLE = [
  'name', 'phone', 'whatsapp', 'email', 'document', 'birth_date', 'origin',
  'utm', 'owner_id', 'status', 'do_not_contact', 'notes_summary',
] as const;

function pickWritable(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of WRITABLE) if (k in body) out[k] = body[k];
  if ('document' in out) out.document = onlyDigits(out.document) || null;
  if ('phone' in out) out.phone = onlyDigits(out.phone) || null;
  if ('whatsapp' in out) out.whatsapp = onlyDigits(out.whatsapp) || null;
  return out;
}

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;

  // ---- LEITURA ----
  if (event.httpMethod === 'GET') {
    const ctx = await requirePermission(event, 'customers.read');

    if (id) {
      const { data, error } = await sb.from('customers').select('*').eq('id', id).maybeSingle();
      if (error) throw badRequest(error.message);
      if (!data) throw notFound('Cliente não encontrado.');
      const { data: addresses } = await sb
        .from('customer_addresses').select('*').eq('customer_id', id).order('is_default', { ascending: false });
      return json(event, 200, { customer: shapeCustomer(data, ctx), addresses: addresses ?? [] });
    }

    // Remove vírgulas/parênteses: o filtro .or() do PostgREST usa vírgula como separador.
    const search = (event.queryStringParameters?.search || '').trim().replace(/[(),]/g, ' ').trim();
    const limit = Math.min(Number(event.queryStringParameters?.limit) || 50, 200);
    let q = sb.from('customers').select('*').order('last_interaction_at', { ascending: false, nullsFirst: false }).limit(limit);
    if (search) {
      const digits = onlyDigits(search);
      const or = [`name.ilike.%${search}%`, `email.ilike.%${search}%`];
      if (digits) { or.push(`phone.ilike.%${digits}%`); or.push(`whatsapp.ilike.%${digits}%`); }
      q = q.or(or.join(','));
    }
    const { data, error } = await q;
    if (error) throw badRequest(error.message);
    return json(event, 200, { customers: (data ?? []).map((r) => shapeCustomer(r, ctx)) });
  }

  // ---- CRIAÇÃO ----
  if (event.httpMethod === 'POST') {
    const ctx = await requirePermission(event, 'customers.write');
    const body = parseBody<Record<string, unknown>>(event);
    const fields = pickWritable(body);
    if (!fields.name || String(fields.name).trim() === '') throw badRequest('Nome é obrigatório.');

    const { data, error } = await sb.from('customers').insert(fields).select('*').single();
    if (error) throw badRequest(error.message);
    await writeAudit({ actorId: ctx.userId, action: 'create', entity: 'customer', entityId: data.id, newValue: fields });
    return json(event, 201, { customer: shapeCustomer(data, ctx) });
  }

  // ---- ATUALIZAÇÃO ----
  if (event.httpMethod === 'PATCH') {
    const ctx = await requirePermission(event, 'customers.write');
    if (!id) throw badRequest('Informe o id do cliente.');
    const body = parseBody<Record<string, unknown>>(event);
    const fields = pickWritable(body);
    if (Object.keys(fields).length === 0) throw badRequest('Nada para atualizar.');

    const { data: before } = await sb.from('customers').select('*').eq('id', id).maybeSingle();
    if (!before) throw notFound('Cliente não encontrado.');

    const { data, error } = await sb.from('customers').update(fields).eq('id', id).select('*').single();
    if (error) throw badRequest(error.message);
    await writeAudit({ actorId: ctx.userId, action: 'update', entity: 'customer', entityId: id, oldValue: before, newValue: fields });
    return json(event, 200, { customer: shapeCustomer(data, ctx) });
  }

  await getAuth(event); // garante 401 antes de 405 para não-autenticados
  throw badRequest('Método não suportado.');
});
