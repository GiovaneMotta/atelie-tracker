/* GET /api/me — dados do membro logado + suas permissões.
   Prova a stack de ponta a ponta: JWT do Supabase -> staff -> permissões. */
import type { Handler } from '@netlify/functions';
import { withHttp, json } from '../lib/http';
import { getAuth } from '../lib/auth';

export const handler: Handler = withHttp(async (event) => {
  const ctx = await getAuth(event);
  return json(event, 200, {
    id: ctx.staff.id,
    name: ctx.staff.name,
    email: ctx.staff.email,
    permissions: Array.from(ctx.permissions).sort(),
  });
});
