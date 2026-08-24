/* ================================================================
   Adaptador Cloudflare Pages Functions -> handlers estilo Netlify.
   Reaproveita netlify/functions/*.ts SEM reescrever cada uma:
   - converte o Request (web) no `event` que os handlers esperam;
   - faz a "ponte" das variáveis de ambiente (context.env -> process.env),
     pois o código existente lê process.env (ex.: supabaseAdmin);
   - converte a resposta {statusCode, headers, body} em Response.
   Rota: /api/<nome>  ->  HANDLERS["<nome>"]
   Requer o flag de compatibilidade "nodejs_compat" (ver wrangler.toml).
   ================================================================ */

import { handler as addresses } from '../../netlify/functions/addresses';
import { handler as agenda } from '../../netlify/functions/agenda';
import { handler as aiSettings } from '../../netlify/functions/ai-settings';
import { handler as aiSuggest } from '../../netlify/functions/ai-suggest';
import { handler as automations } from '../../netlify/functions/automations';
import { handler as calendar } from '../../netlify/functions/calendar';
import { handler as cep } from '../../netlify/functions/cep';
import { handler as conversations } from '../../netlify/functions/conversations';
import { handler as customers } from '../../netlify/functions/customers';
import { handler as finance } from '../../netlify/functions/finance';
import { handler as frenetEnv } from '../../netlify/functions/frenet-env';
import { handler as frenetSettings } from '../../netlify/functions/frenet-settings';
import { handler as frenetTest } from '../../netlify/functions/frenet-test';
import { handler as health } from '../../netlify/functions/health';
import { handler as integrationLogs } from '../../netlify/functions/integration-logs';
import { handler as knowledge } from '../../netlify/functions/knowledge';
import { handler as leads } from '../../netlify/functions/leads';
import { handler as materials } from '../../netlify/functions/materials';
import { handler as me } from '../../netlify/functions/me';
import { handler as messages } from '../../netlify/functions/messages';
import { handler as orders } from '../../netlify/functions/orders';
import { handler as parseRecipient } from '../../netlify/functions/parse-recipient';
import { handler as pricing } from '../../netlify/functions/pricing';
import { handler as production } from '../../netlify/functions/production';
import { handler as productImage } from '../../netlify/functions/product-image';
import { handler as products } from '../../netlify/functions/products';
import { handler as shipmentCancel } from '../../netlify/functions/shipment-cancel';
import { handler as shipmentLabel } from '../../netlify/functions/shipment-label';
import { handler as shipmentTracking } from '../../netlify/functions/shipment-tracking';
import { handler as shipments } from '../../netlify/functions/shipments';
import { handler as shippingQuote } from '../../netlify/functions/shipping-quote';
import { handler as shippingStats } from '../../netlify/functions/shipping-stats';
import { handler as staff } from '../../netlify/functions/staff';
import { handler as tasks } from '../../netlify/functions/tasks';
import { handler as wascriptTest } from '../../netlify/functions/wascript-test';

const HANDLERS: Record<string, (event: any, ctx: any) => Promise<any>> = {
  'addresses': addresses, 'agenda': agenda, 'ai-settings': aiSettings, 'ai-suggest': aiSuggest,
  'automations': automations, 'calendar': calendar, 'cep': cep, 'conversations': conversations,
  'customers': customers, 'finance': finance, 'frenet-env': frenetEnv, 'frenet-settings': frenetSettings,
  'frenet-test': frenetTest, 'health': health, 'integration-logs': integrationLogs, 'knowledge': knowledge,
  'leads': leads, 'materials': materials, 'me': me, 'messages': messages, 'orders': orders,
  'parse-recipient': parseRecipient, 'pricing': pricing, 'production': production,
  'product-image': productImage, 'products': products,
  'shipment-cancel': shipmentCancel, 'shipment-label': shipmentLabel, 'shipment-tracking': shipmentTracking,
  'shipments': shipments, 'shipping-quote': shippingQuote, 'shipping-stats': shippingStats, 'staff': staff,
  'tasks': tasks, 'wascript-test': wascriptTest,
};

export const onRequest = async (context: any): Promise<Response> => {
  const { request, env, params } = context;

  // Ponte env -> process.env (o código existente usa process.env)
  try {
    const g: any = globalThis as any;
    g.process = g.process || {};
    g.process.env = Object.assign({}, g.process.env || {}, env);
  } catch { /* nodejs_compat garante process; ignore se indisponível */ }

  const seg = params && params.route;
  const name = Array.isArray(seg) ? seg[0] : String(seg || '');
  const fn = HANDLERS[name];

  const JSONH = { 'content-type': 'application/json; charset=utf-8' };
  if (!fn) {
    return new Response(JSON.stringify({ error: 'Endpoint não encontrado.' }), { status: 404, headers: JSONH });
  }

  const url = new URL(request.url);
  const method = request.method;
  const body = (method === 'GET' || method === 'HEAD') ? null : await request.text();
  const headers: Record<string, string> = {};
  request.headers.forEach((v: string, k: string) => { headers[k] = v; });

  const event = {
    httpMethod: method,
    path: url.pathname,
    rawUrl: request.url,
    rawQuery: url.search.replace(/^\?/, ''),
    queryStringParameters: Object.fromEntries(url.searchParams.entries()),
    headers,
    body,
    isBase64Encoded: false,
  };

  try {
    const res = await fn(event, {});
    return new Response(res && res.body != null ? res.body : '', {
      status: (res && res.statusCode) || 200,
      headers: (res && res.headers) || JSONH,
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: 'Erro interno.', detail: String(e && e.message || e) }), { status: 500, headers: JSONH });
  }
};
