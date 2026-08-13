/* ================================================================
   /api/ai-settings — regras/personalidade da IA (§8).
     GET   /api/ai-settings   -> configurações (qualquer membro ativo)
     PATCH /api/ai-settings   -> atualiza (perm ai.configure)
   Linha única (singleton id=true).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { getAuth, requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const FIELDS = ['agent_name', 'persona', 'formality', 'business_hours', 'handoff_rules',
  'forbidden_topics', 'max_discount_pct', 'allowed_products', 'enabled_critical_tools'] as const;

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();

  if (event.httpMethod === 'GET') {
    await getAuth(event);
    const { data, error } = await sb.from('ai_settings').select('*').eq('id', true).maybeSingle();
    if (error) throw badRequest(error.message);
    return json(event, 200, { settings: data });
  }

  if (event.httpMethod === 'PATCH') {
    await requirePermission(event, 'ai.configure');
    const body = parseBody<Record<string, unknown>>(event);
    const updates: Record<string, unknown> = {};
    for (const k of FIELDS) if (k in body) updates[k] = body[k];
    if ('max_discount_pct' in updates) updates.max_discount_pct = Number(updates.max_discount_pct) || 0;
    if (Object.keys(updates).length === 0) throw badRequest('Nada para atualizar.');
    const { data, error } = await sb.from('ai_settings').update(updates).eq('id', true).select('*').single();
    if (error) throw badRequest(error.message);
    return json(event, 200, { settings: data });
  }

  throw badRequest('Método não suportado.');
});
