/* GET /api/health — checagem simples de configuração/conectividade. */
import type { Handler } from '@netlify/functions';
import { withHttp, json } from '../lib/http';
import { admin } from '../lib/supabaseAdmin';

export const handler: Handler = withHttp(async (event) => {
  const checks: Record<string, boolean> = {
    supabase_env: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
  let db = false;
  try {
    const { error } = await admin().from('roles').select('key').limit(1);
    db = !error;
  } catch { db = false; }
  return json(event, 200, { ok: checks.supabase_env && db, checks: { ...checks, db }, ts: new Date().toISOString() });
});
