/* ================================================================
   /api/materials — insumos/materiais (base da precificação, §11).
     GET/POST/PATCH?id/DELETE?id
   Permissões: products.read (ler) / products.write (editar).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const FIELDS = ['name', 'unit', 'cost_per_unit', 'supplier'] as const;
function pick(b: Record<string, unknown>) {
  const o: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in b) o[k] = b[k];
  if ('cost_per_unit' in o) o.cost_per_unit = Number(o.cost_per_unit) || 0;
  return o;
}

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'products.read');
    const { data, error } = await sb.from('materials').select('*').order('name');
    if (error) throw badRequest(error.message);
    return json(event, 200, { materials: data ?? [] });
  }
  if (event.httpMethod === 'POST') {
    await requirePermission(event, 'products.write');
    const f = pick(parseBody(event));
    if (!f.name) throw badRequest('Nome é obrigatório.');
    const { data, error } = await sb.from('materials').insert(f).select('*').single();
    if (error) throw badRequest(error.message);
    return json(event, 201, { material: data });
  }
  if (event.httpMethod === 'PATCH') {
    await requirePermission(event, 'products.write');
    if (!id) throw badRequest('Informe o id.');
    const f = pick(parseBody(event));
    if (Object.keys(f).length === 0) throw badRequest('Nada para atualizar.');
    const { data, error } = await sb.from('materials').update(f).eq('id', id).select('*').single();
    if (error) throw badRequest(error.message);
    return json(event, 200, { material: data });
  }
  if (event.httpMethod === 'DELETE') {
    await requirePermission(event, 'products.write');
    if (!id) throw badRequest('Informe o id.');
    const { error } = await sb.from('materials').delete().eq('id', id);
    if (error) throw badRequest(error.message);
    return json(event, 200, { ok: true });
  }
  throw badRequest('Método não suportado.');
});
