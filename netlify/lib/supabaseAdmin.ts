/* ================================================================
   supabaseAdmin — cliente Supabase com SERVICE ROLE (só backend).
   Ignora RLS: as checagens de permissão são feitas em auth.ts + nas
   funções da API. NUNCA importar isto no frontend (web/).
   ================================================================ */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let cached: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  cached = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
