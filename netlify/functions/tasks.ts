/* ================================================================
   /api/tasks — tarefas da equipe (§32).
     GET    /api/tasks[?status=&mine=1]  -> lista
     POST   /api/tasks                    -> cria
     PATCH  /api/tasks?id=<uuid>           -> atualiza (status, etc.)
     DELETE /api/tasks?id=<uuid>           -> remove
   Acesso: qualquer membro ativo.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { getAuth } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const FIELDS = ['title', 'description', 'assignee_id', 'customer_id', 'order_id', 'priority', 'status', 'due_at'] as const;
const SELECT = '*, assignee:staff(name), customer:customers(name)';

function pick(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in body) out[k] = body[k] === '' ? null : body[k];
  return out;
}

export const handler: Handler = withHttp(async (event) => {
  const ctx = await getAuth(event);
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'GET') {
    let q = sb.from('tasks').select(SELECT).order('status').order('due_at', { ascending: true, nullsFirst: false }).limit(300);
    const status = event.queryStringParameters?.status;
    if (status) q = q.eq('status', status);
    if (event.queryStringParameters?.mine === '1') q = q.eq('assignee_id', ctx.userId);
    const { data, error } = await q;
    if (error) throw badRequest(error.message);
    return json(event, 200, { tasks: data ?? [] });
  }

  if (event.httpMethod === 'POST') {
    const body = parseBody<Record<string, unknown>>(event);
    const fields = pick(body);
    if (!fields.title || String(fields.title).trim() === '') throw badRequest('Título é obrigatório.');
    const { data, error } = await sb.from('tasks').insert(fields).select(SELECT).single();
    if (error) throw badRequest(error.message);
    return json(event, 201, { task: data });
  }

  if (event.httpMethod === 'PATCH') {
    if (!id) throw badRequest('Informe o id da tarefa.');
    const fields = pick(parseBody<Record<string, unknown>>(event));
    if (Object.keys(fields).length === 0) throw badRequest('Nada para atualizar.');
    const { data, error } = await sb.from('tasks').update(fields).eq('id', id).select(SELECT).single();
    if (error) throw badRequest(error.message);
    return json(event, 200, { task: data });
  }

  if (event.httpMethod === 'DELETE') {
    if (!id) throw badRequest('Informe o id da tarefa.');
    const { error } = await sb.from('tasks').delete().eq('id', id);
    if (error) throw badRequest(error.message);
    return json(event, 200, { ok: true });
  }

  throw badRequest('Método não suportado.');
});
