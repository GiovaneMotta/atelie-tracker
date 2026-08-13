/* /api/staff — lista os membros ativos da equipe (para atribuições:
   responsável por tarefa, dono de lead, etc.). Qualquer membro ativo lê. */
import type { Handler } from '@netlify/functions';
import { withHttp, json } from '../lib/http';
import { getAuth } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

export const handler: Handler = withHttp(async (event) => {
  await getAuth(event);
  const { data, error } = await admin()
    .from('staff').select('id, name, email').eq('is_active', true).order('name');
  if (error) return json(event, 400, { error: error.message });
  return json(event, 200, { staff: data ?? [] });
});
