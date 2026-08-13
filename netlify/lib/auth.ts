/* ================================================================
   auth — contexto de autenticação/autorização de cada requisição.
   Valida o JWT do Supabase, carrega o membro (staff) e suas permissões.
   Toda a autorização real acontece AQUI (nunca só no frontend) (§35).
   ================================================================ */
import type { HandlerEvent } from '@netlify/functions';
import { admin } from './supabaseAdmin';
import { unauthorized, forbidden } from './http';

export interface AuthContext {
  userId: string;
  staff: { id: string; name: string; email: string | null; is_active: boolean };
  permissions: Set<string>;
  has(perm: string): boolean;
}

function bearer(event: HandlerEvent): string {
  const h = event.headers.authorization || event.headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) throw unauthorized();
  return m[1];
}

export async function getAuth(event: HandlerEvent): Promise<AuthContext> {
  const token = bearer(event);
  const sb = admin();

  const { data: userRes, error: userErr } = await sb.auth.getUser(token);
  if (userErr || !userRes?.user) throw unauthorized('Sessão inválida ou expirada.');
  const userId = userRes.user.id;

  const { data: staff, error: staffErr } = await sb
    .from('staff')
    .select('id, name, email, is_active')
    .eq('id', userId)
    .maybeSingle();
  if (staffErr) throw unauthorized('Falha ao carregar o usuário.');
  if (!staff || !staff.is_active) throw forbidden('Usuário sem acesso ativo ao sistema.');

  const { data: perms } = await sb.rpc('staff_permissions', { p_staff: userId });
  const permissions = new Set<string>((perms ?? []).map((r: { permission_key: string }) => r.permission_key));

  return {
    userId,
    staff,
    permissions,
    has: (perm: string) => permissions.has(perm),
  };
}

/** Exige uma permissão; lança 403 se faltar. Retorna o contexto p/ uso. */
export async function requirePermission(event: HandlerEvent, perm: string): Promise<AuthContext> {
  const ctx = await getAuth(event);
  if (!ctx.has(perm)) throw forbidden(`Sem permissão: ${perm}.`);
  return ctx;
}
