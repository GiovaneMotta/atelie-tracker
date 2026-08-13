/* ================================================================
   /api/integration-logs — logs de integração (§33/§40).
   GET ?category=FRENET|WEBHOOK|ERROR|ALL & ?level= & ?limit=
   Nunca contêm tokens (sanitizados na origem). Permissão: settings.read.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'GET') throw badRequest('Método não suportado.');
  await requirePermission(event, 'settings.read');

  const p = event.queryStringParameters || {};
  const limit = Math.min(500, Math.max(1, parseInt(p.limit || '100', 10) || 100));

  let q = admin().from('integration_logs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (p.category && p.category !== 'ALL') q = q.eq('category', p.category);
  else q = q.in('category', ['FRENET', 'WEBHOOK', 'ERROR']);
  if (p.level) q = q.eq('level', p.level);

  const { data, error } = await q;
  if (error) throw badRequest(error.message);
  return json(event, 200, { logs: data ?? [] });
});
