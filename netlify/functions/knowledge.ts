/* ================================================================
   /api/knowledge — base de conhecimento da IA (§7).
     GET    /api/knowledge[?category=]  -> lista (qualquer membro ativo)
     POST   /api/knowledge               -> cria    (perm ai.configure)
     PATCH  /api/knowledge?id=<uuid>      -> atualiza (perm ai.configure)
     DELETE /api/knowledge?id=<uuid>      -> remove   (perm ai.configure)
   Conteúdo que a IA vai consultar antes de responder (fase 3).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { getAuth, requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const FIELDS = ['category', 'title', 'content', 'is_active'] as const;
function pick(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in body) out[k] = body[k];
  return out;
}

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'GET') {
    await getAuth(event);
    let q = sb.from('knowledge_base').select('*').order('category').order('title').limit(500);
    const category = event.queryStringParameters?.category;
    if (category) q = q.eq('category', category);
    const { data, error } = await q;
    if (error) throw badRequest(error.message);
    return json(event, 200, { items: data ?? [] });
  }

  if (event.httpMethod === 'POST') {
    await requirePermission(event, 'ai.configure');
    const fields = pick(parseBody<Record<string, unknown>>(event));
    if (!fields.title || !fields.content) throw badRequest('Título e conteúdo são obrigatórios.');
    if (!fields.category) fields.category = 'faq';
    const { data, error } = await sb.from('knowledge_base').insert(fields).select('*').single();
    if (error) throw badRequest(error.message);
    return json(event, 201, { item: data });
  }

  if (event.httpMethod === 'PATCH') {
    await requirePermission(event, 'ai.configure');
    if (!id) throw badRequest('Informe o id.');
    const fields = pick(parseBody<Record<string, unknown>>(event));
    if (Object.keys(fields).length === 0) throw badRequest('Nada para atualizar.');
    const { data, error } = await sb.from('knowledge_base').update(fields).eq('id', id).select('*').single();
    if (error) throw badRequest(error.message);
    return json(event, 200, { item: data });
  }

  if (event.httpMethod === 'DELETE') {
    await requirePermission(event, 'ai.configure');
    if (!id) throw badRequest('Informe o id.');
    const { error } = await sb.from('knowledge_base').delete().eq('id', id);
    if (error) throw badRequest(error.message);
    return json(event, 200, { ok: true });
  }

  throw badRequest('Método não suportado.');
});
