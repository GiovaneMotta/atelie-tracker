/* ================================================================
   /api/automations — construtor de fluxos / robô (§23, §34, §47).
     GET    /api/automations              -> lista
     GET    /api/automations?id=<uuid>     -> automação + grafo (nodes/edges)
     POST   /api/automations               -> cria
     PATCH  /api/automations?id=<uuid>      -> salva flow (metadados + grafo)
     DELETE /api/automations?id=<uuid>      -> remove
   Permissões: automations.read / automations.write.
   O grafo é persistido em automation_nodes/automation_edges (estratégia
   replace no save). A EXECUÇÃO real (worker) é a Fase 4b.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound } from '../lib/http';
import { getAuth, requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

async function loadGraph(id: string) {
  const sb = admin();
  const [{ data: nodes }, { data: edges }] = await Promise.all([
    sb.from('automation_nodes').select('*').eq('automation_id', id),
    sb.from('automation_edges').select('*').eq('automation_id', id),
  ]);
  return {
    nodes: (nodes ?? []).map((n) => ({ id: n.node_key, type: n.type, data: n.data || {}, position: { x: n.pos_x, y: n.pos_y } })),
    edges: (edges ?? []).map((e) => ({ id: `${e.source_key}-${e.target_key}-${e.handle || 'out'}`, source: e.source_key, sourceHandle: e.handle || 'out', target: e.target_key })),
  };
}

async function saveGraph(id: string, nodes: any[], edges: any[]) {
  const sb = admin();
  await sb.from('automation_nodes').delete().eq('automation_id', id);
  await sb.from('automation_edges').delete().eq('automation_id', id);
  if (Array.isArray(nodes) && nodes.length) {
    await sb.from('automation_nodes').insert(nodes.map((n) => ({
      automation_id: id, node_key: n.id, type: n.type, data: n.data || {},
      pos_x: n.position?.x ?? 0, pos_y: n.position?.y ?? 0,
    })));
  }
  if (Array.isArray(edges) && edges.length) {
    await sb.from('automation_edges').insert(edges.map((e) => ({
      automation_id: id, source_key: e.source, target_key: e.target, handle: e.sourceHandle || 'out',
    })));
  }
}

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'automations.read');
    if (id) {
      const { data: automation, error } = await sb.from('automations').select('*').eq('id', id).maybeSingle();
      if (error) throw badRequest(error.message);
      if (!automation) throw notFound('Automação não encontrada.');
      const graph = await loadGraph(id);
      return json(event, 200, { automation, graph });
    }
    const { data, error } = await sb.from('automations').select('*').order('created_at', { ascending: false });
    if (error) throw badRequest(error.message);
    return json(event, 200, { automations: data ?? [] });
  }

  if (event.httpMethod === 'POST') {
    const ctx = await requirePermission(event, 'automations.write');
    const body = parseBody<any>(event);
    const { data, error } = await sb.from('automations').insert({
      name: body.name || 'Novo fluxo', description: body.description ?? null,
      trigger: body.trigger || { type: 'manual' }, is_active: false, created_by: ctx.userId,
    }).select('*').single();
    if (error) throw badRequest(error.message);
    if (body.graph) await saveGraph(data.id, body.graph.nodes || [], body.graph.edges || []);
    return json(event, 201, { automation: data });
  }

  if (event.httpMethod === 'PATCH') {
    await requirePermission(event, 'automations.write');
    if (!id) throw badRequest('Informe o id.');
    const body = parseBody<any>(event);
    const fields: Record<string, unknown> = {};
    for (const k of ['name', 'description', 'trigger', 'is_active']) if (k in body) fields[k] = body[k];
    if (Object.keys(fields).length) {
      const { error } = await sb.from('automations').update(fields).eq('id', id);
      if (error) throw badRequest(error.message);
    }
    if (body.graph) await saveGraph(id, body.graph.nodes || [], body.graph.edges || []);
    const { data: automation } = await sb.from('automations').select('*').eq('id', id).single();
    const graph = await loadGraph(id);
    return json(event, 200, { automation, graph });
  }

  if (event.httpMethod === 'DELETE') {
    await requirePermission(event, 'automations.write');
    if (!id) throw badRequest('Informe o id.');
    const { error } = await sb.from('automations').delete().eq('id', id);
    if (error) throw badRequest(error.message);
    return json(event, 200, { ok: true });
  }

  await getAuth(event);
  throw badRequest('Método não suportado.');
});
