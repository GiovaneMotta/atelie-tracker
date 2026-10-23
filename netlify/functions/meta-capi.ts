/* ================================================================
   /api/meta-capi — manda o Purchase para a API de Conversões da Meta

     POST { order_id }   -> enfileira e tenta enviar aquele pedido
     POST { retry: true } -> reenvia os pendentes (até 20)
     GET                 -> últimos eventos e seus estados

   PORQUE ISTO EXISTE
   O Purchase saiu do navegador: lá ele disparava no clique do
   WhatsApp, antes de qualquer pagamento. Agora ele sai daqui, quando
   a Lili marca o pedido como pago — que é o único momento em que a
   venda realmente aconteceu.

   O QUE NUNCA PODE ACONTECER
   O pagamento não pode depender da Meta. Quem chama isto grava o
   pagamento PRIMEIRO; se o envio falhar, a linha fica pendente e é
   reenviada. Um erro aqui nunca derruba o registro financeiro.

   DEDUPLICAÇÃO
   event_id = 'purchase-<order_id>', gravado numa coluna única. Clicar
   duas vezes em "pago", ou dois reenvios simultâneos, esbarram no
   índice — não viram duas vendas.

   Variáveis (Cloudflare → projeto do PAINEL → Variables and secrets):
     META_CAPI_TOKEN     obrigatória, Secret
     META_PIXEL_ID       obrigatória
     META_API_VERSION    opcional (padrão v26.0)
     META_TEST_EVENT_CODE opcional — manda como evento de teste, que
                          aparece em "Eventos de teste" sem sujar os
                          dados reais. Use para validar e depois apague.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const VERSAO_PADRAO = 'v26.0';

/* A Meta exige SHA-256 do valor normalizado para dado pessoal.
   fbp, fbc, external_id, IP e user agent NÃO são hasheados. */
async function sha256(v: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Telefone do Brasil para o formato que a Meta espera: só dígitos com DDI. */
function telefoneE164(v: unknown): string {
  const d = soDigitos(v);
  if (!d) return '';
  if (d.startsWith('55')) return d;
  return d.length >= 10 ? '55' + d : '';
}

interface Resultado { ok: boolean; status: string; detalhe?: string }

/** Monta e envia o evento de um pedido. Idempotente pelo event_id. */
export async function enviarPurchase(orderId: string, env: Record<string, string | undefined>): Promise<Resultado> {
  const sb = admin();
  const token = env.META_CAPI_TOKEN;
  const pixel = env.META_PIXEL_ID;
  if (!token || !pixel) return { ok: false, status: 'erro', detalhe: 'META_CAPI_TOKEN / META_PIXEL_ID ausentes' };

  const { data: pedido } = await sb.from('orders')
    .select('id, number, total, status, payment_status, utm, channel, created_at, customer_id, order_items(sku, quantity)')
    .eq('id', orderId).maybeSingle();
  if (!pedido) return { ok: false, status: 'erro', detalhe: 'Pedido não encontrado.' };
  if (pedido.payment_status !== 'pago') {
    return { ok: false, status: 'erro', detalhe: 'Pedido não está pago; nada a enviar.' };
  }

  const eventId = `purchase-${pedido.id}`;

  /* Reserva o lugar na fila. O índice único é a trava: se já existe e
     já foi enviado, para por aqui. */
  const { data: jaExiste } = await sb.from('meta_events')
    .select('id, status, attempts').eq('event_id', eventId).maybeSingle();
  if (jaExiste?.status === 'enviado') return { ok: true, status: 'duplicado' };
  if (!jaExiste) {
    await sb.from('meta_events').insert({ event_id: eventId, order_id: pedido.id, event_name: 'Purchase' });
  }

  /* Identificadores: só o que existe de verdade. Pedido nascido na
     conversa não tem fbp/fbc, e inventar correspondência é pior que
     não ter — a Meta otimizaria para a pessoa errada. */
  const utm = (pedido.utm || {}) as Record<string, unknown>;
  const userData: Record<string, unknown> = {};
  if (utm.fbp) userData.fbp = String(utm.fbp);
  if (utm.fbc) userData.fbc = String(utm.fbc);

  const { data: cliente } = pedido.customer_id
    ? await sb.from('customers').select('name, phone, email').eq('id', pedido.customer_id).maybeSingle()
    : { data: null };

  if (cliente?.phone) {
    const tel = telefoneE164(cliente.phone);
    if (tel) userData.ph = [await sha256(tel)];
  }
  if (cliente?.email) userData.em = [await sha256(String(cliente.email).trim().toLowerCase())];
  if (cliente?.name) {
    const partes = String(cliente.name).trim().toLowerCase().split(/\s+/);
    if (partes[0]) userData.fn = [await sha256(partes[0])];
    if (partes.length > 1) userData.ln = [await sha256(partes[partes.length - 1])];
  }
  if (pedido.customer_id) userData.external_id = [await sha256(String(pedido.customer_id))];

  /* Sem nenhum identificador a Meta recusa o evento. */
  if (!Object.keys(userData).length) {
    const erro = 'Pedido sem nenhum identificador (sem telefone, e-mail ou origem do site).';
    await sb.from('meta_events').update({
      status: 'erro', last_error: erro, attempts: (jaExiste?.attempts || 0) + 1,
    }).eq('event_id', eventId);
    return { ok: false, status: 'erro', detalhe: erro };
  }

  const veioDoSite = !!(utm.fbp || utm.fbc) || pedido.channel === 'site';
  const itens = (pedido.order_items || []) as { sku: string; quantity: number }[];

  /* event_time = AGORA, não a criação do pedido. A Meta recusa a
     requisição inteira quando o evento tem mais de 7 dias, e pedido
     fechado no WhatsApp pode demorar. Além disso, a venda se concretiza
     no pagamento — que é este instante. */
  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: veioDoSite ? 'website' : 'business_messaging',
      ...(veioDoSite && env.SITE_URL ? { event_source_url: env.SITE_URL } : {}),
      user_data: userData,
      custom_data: {
        currency: 'BRL',
        value: Number(pedido.total) || 0,
        order_id: `PED-${pedido.number}`,
        content_type: 'product',
        content_ids: itens.map((i) => i.sku).filter(Boolean),
        num_items: itens.reduce((n, i) => n + (Number(i.quantity) || 0), 0),
      },
    }],
    ...(env.META_TEST_EVENT_CODE ? { test_event_code: env.META_TEST_EVENT_CODE } : {}),
  };

  const versao = env.META_API_VERSION || VERSAO_PADRAO;
  const url = `https://graph.facebook.com/${versao}/${pixel}/events?access_token=${encodeURIComponent(token)}`;

  let resposta: unknown = null;
  let okHttp = false;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    resposta = await r.json().catch(() => ({}));
    okHttp = r.ok;
  } catch (e) {
    resposta = { erro_local: String(e) };
  }

  /* "Enviado" só depois de LER a resposta. Ter disparado não é ter
     entregue. */
  const aceitos = (resposta as { events_received?: number })?.events_received;
  const deuCerto = okHttp && typeof aceitos === 'number' && aceitos > 0;

  await sb.from('meta_events').update({
    status: deuCerto ? 'enviado' : 'erro',
    attempts: (jaExiste?.attempts || 0) + 1,
    payload: payload as unknown as object,
    response: resposta as object,
    last_error: deuCerto ? null : JSON.stringify(resposta).slice(0, 500),
    sent_at: deuCerto ? new Date().toISOString() : null,
  }).eq('event_id', eventId);

  return deuCerto
    ? { ok: true, status: 'enviado' }
    : { ok: false, status: 'erro', detalhe: JSON.stringify(resposta).slice(0, 300) };
}

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();

  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'orders.read');
    const { data } = await sb.from('meta_events')
      .select('event_id, event_name, status, attempts, last_error, sent_at, created_at, order_id')
      .order('created_at', { ascending: false }).limit(50);
    const { count: pendentes } = await sb.from('meta_events')
      .select('id', { count: 'exact', head: true }).neq('status', 'enviado');
    return json(event, 200, { eventos: data ?? [], pendentes: pendentes ?? 0 });
  }

  if (event.httpMethod === 'POST') {
    await requirePermission(event, 'orders.write');
    const body = parseBody<{ order_id?: string; retry?: boolean }>(event);
    const env = process.env as Record<string, string | undefined>;

    if (body.retry) {
      const { data: pendentes } = await sb.from('meta_events')
        .select('order_id').neq('status', 'enviado').not('order_id', 'is', null)
        .order('created_at').limit(20);
      const saida = [];
      for (const p of pendentes ?? []) {
        saida.push({ order_id: p.order_id, ...(await enviarPurchase(p.order_id as string, env)) });
      }
      return json(event, 200, { reenviados: saida.length, resultados: saida });
    }

    const id = (body.order_id || '').trim();
    if (!id) throw badRequest('Informe o pedido.');
    return json(event, 200, await enviarPurchase(id, env));
  }

  throw badRequest('Método não suportado.');
});
