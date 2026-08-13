/* ================================================================
   /api/frenet-env — dado leve para a faixa de ambiente (§39).
   Qualquer membro autenticado pode ler (só ambiente + status booleano).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, badRequest } from '../lib/http';
import { getAuth } from '../lib/auth';
import { loadFrenetConfig } from '../lib/frenet';

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'GET') throw badRequest('Método não suportado.');
  await getAuth(event); // exige estar logado como membro ativo
  const c = await loadFrenetConfig();
  return json(event, 200, {
    environment: c.environment,
    client_configured: c.hasClientToken,
    partner_configured: c.hasPartnerToken,
  });
});
