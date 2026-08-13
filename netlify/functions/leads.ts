/* ================================================================
   /api/leads — funil de vendas / kanban (§10).
     GET    /api/leads              -> { stages[], leads[] } do funil padrão
     POST   /api/leads              -> cria lead (entra na etapa "Novo")
     PATCH  /api/leads?id=<uuid>     -> edita campos e/ou move de etapa
     DELETE /api/leads?id=<uuid>     -> remove
   Acesso: qualquer membro ativo (a RLS de leitura já usa auth_is_staff).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { getAuth } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const FIELDS = ['customer_id', 'title', 'interest', 'value', 'origin', 'owner_id', 'next_followup_at', 'lost_reason'] as const;

function pick(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in body) out[k] = body[k];
  if ('value' in out) out.value = out.value === '' || out.value == null ? null : Number(out.value);
  return out;
}

async function defaultPipelineId(): Promise<string> {
  const { data } = await admin().from('pipelines').select('id').eq('is_default', true).limit(1).maybeSingle();
  if (!data) throw badRequest('Nenhum funil configurado.');
  return data.id;
}

export const handler: Handler = withHttp(async (event) => {
  const ctx = await getAuth(event);
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'GET') {
    const pid = await defaultPipelineId();
    const [{ data: stages }, { data: leads }] = await Promise.all([
      sb.from('pipeline_stages').select('*').eq('pipeline_id', pid).order('position'),
      sb.from('leads').select('*, customer:customers(name,whatsapp,phone)').eq('pipeline_id', pid).order('position'),
    ]);
    return json(event, 200, { stages: stages ?? [], leads: leads ?? [] });
  }

  if (event.httpMethod === 'POST') {
    const body = parseBody<Record<string, unknown>>(event);
    const pid = await defaultPipelineId();
    let stageId = body.stage_id as string | undefined;
    if (!stageId) {
      const { data: st } = await sb.from('pipeline_stages').select('id').eq('pipeline_id', pid).eq('key', 'novo').maybeSingle();
      stageId = st?.id;
    }
    if (!stageId) throw badRequest('Etapa inicial não encontrada.');
    const fields = pick(body);
    if (!fields.title && !fields.customer_id) throw badRequest('Informe um título ou vincule um cliente.');
    const { data, error } = await sb.from('leads')
      .insert({ ...fields, pipeline_id: pid, stage_id: stageId, owner_id: fields.owner_id ?? ctx.userId })
      .select('*, customer:customers(name,whatsapp,phone)').single();
    if (error) throw badRequest(error.message);
    return json(event, 201, { lead: data });
  }

  if (event.httpMethod === 'PATCH') {
    if (!id) throw badRequest('Informe o id do lead.');
    const body = parseBody<Record<string, unknown>>(event);
    const updates: Record<string, unknown> = pick(body);
    if ('position' in body) updates.position = Number(body.position) || 0;

    if (typeof body.stage_id === 'string') {
      updates.stage_id = body.stage_id;
      const { data: stage } = await sb.from('pipeline_stages').select('is_won,is_lost').eq('id', body.stage_id).maybeSingle();
      updates.won_at = stage?.is_won ? new Date().toISOString() : null;
      updates.lost_at = stage?.is_lost ? new Date().toISOString() : null;
    }
    if (Object.keys(updates).length === 0) throw badRequest('Nada para atualizar.');

    const { data, error } = await sb.from('leads').update(updates).eq('id', id)
      .select('*, customer:customers(name,whatsapp,phone)').single();
    if (error) throw badRequest(error.message);
    return json(event, 200, { lead: data });
  }

  if (event.httpMethod === 'DELETE') {
    if (!id) throw badRequest('Informe o id do lead.');
    const { error } = await sb.from('leads').delete().eq('id', id);
    if (error) throw badRequest(error.message);
    return json(event, 200, { ok: true });
  }

  throw badRequest('Método não suportado.');
});
