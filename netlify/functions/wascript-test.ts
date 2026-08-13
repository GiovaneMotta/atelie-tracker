/* ================================================================
   /api/wascript-test — status + teste de conexão do WhatsApp (WaScript).
   Não expõe o token; só diz se está configurado/válido. Devolve a URL de
   webhook que a usuária deve cadastrar no painel do WaScript.
   Acesso: qualquer membro ativo.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json } from '../lib/http';
import { getAuth } from '../lib/auth';
import { WascriptService } from '../lib/services/WascriptService';

export const handler: Handler = withHttp(async (event) => {
  await getAuth(event);
  const site = process.env.SITE_URL || `https://${event.headers.host || ''}`;
  const webhookUrl = `${site.replace(/\/$/, '')}/webhooks/wascript`;

  const result = await WascriptService.testConnection();
  return json(event, 200, {
    configured: result.configured,          // token presente no Netlify?
    valid: result.ok,                        // a API respondeu OK?
    status: result.status,                   // status HTTP do teste
    webhook_url: webhookUrl,                 // registrar no painel WaScript
  });
});
