/* ================================================================
   /api/push — aparelhos autorizados a receber notificação.

     GET    /api/push                  -> chave pública + lista de aparelhos
     POST   /api/push                  -> inscreve ESTE navegador
     POST   /api/push?action=teste     -> notificação de teste (só para você)
     PATCH  /api/push?id=<uuid>        -> renomeia um aparelho
     DELETE /api/push?id=<uuid>        -> remove um aparelho

   Permissão: notifications.manage.

   O que o navegador manda na inscrição (endpoint + p256dh + auth) é
   gerado por ELE, não por nós: são as credenciais que permitem entregar
   mensagem naquele aparelho. Ficam em `push_devices`, com RLS fechada —
   o frontend nunca lê a tabela direto, e esta API nunca devolve o
   endpoint completo (só um resumo, para a tela reconhecer "este é o
   celular que estou usando agora").

   A notificação de teste vai EXCLUSIVAMENTE para os aparelhos inscritos
   aqui. Nenhum caminho desta função fala com cliente.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest, notFound } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { readVapid, sendPush, bytesToB64url, type PushSubscription } from '../lib/webpush';
import { writeAudit } from '../lib/audit';

/** Identifica a inscrição sem expor a URL de entrega. */
export async function endpointHash(endpoint: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return bytesToB64url(new Uint8Array(d)).slice(0, 16);
}

interface Inscricao {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  label?: string;
}

export const handler: Handler = withHttp(async (event) => {
  const ctx = await requirePermission(event, 'notifications.manage');
  const sb = admin();
  const id = event.queryStringParameters?.id;
  const vapid = readVapid(process.env as Record<string, string | undefined>);

  /* ---- LISTA + configuração ---- */
  if (event.httpMethod === 'GET') {
    const { data: devices } = await sb
      .from('push_devices')
      .select('id, label, user_agent, active, failures, last_error, last_success_at, created_at, endpoint, staff_id')
      .order('created_at', { ascending: true });

    const lista = await Promise.all((devices ?? []).map(async (d) => ({
      id: d.id,
      label: d.label,
      user_agent: d.user_agent,
      active: d.active,
      failures: d.failures,
      last_error: d.last_error,
      last_success_at: d.last_success_at,
      created_at: d.created_at,
      meu: d.staff_id === ctx.userId,
      hash: await endpointHash(d.endpoint),       // a tela compara com o hash do próprio navegador
    })));

    const { count: pendentes } = await sb
      .from('push_outbox').select('id', { count: 'exact', head: true }).is('dispatched_at', null);

    return json(event, 200, {
      publicKey: vapid?.publicKey ?? null,
      configurado: !!vapid,
      devices: lista,
      pendentes: pendentes ?? 0,
    });
  }

  /* ---- INSCREVER / TESTAR ---- */
  if (event.httpMethod === 'POST') {
    const acao = event.queryStringParameters?.action;

    if (acao === 'teste') {
      if (!vapid) throw badRequest('As chaves VAPID ainda não foram cadastradas na Cloudflare.');
      const { data: devices } = await sb
        .from('push_devices').select('id, endpoint, p256dh, auth').eq('active', true);
      if (!devices?.length) throw badRequest('Nenhum aparelho inscrito ainda.');

      let ok = 0; let falhas = 0; let removidos = 0;
      for (const d of devices) {
        const sub: PushSubscription = { endpoint: d.endpoint, p256dh: d.p256dh, auth: d.auth };
        const r = await sendPush(sub, {
          title: 'Notificação de teste',
          body: 'Funcionou! É assim que você vai receber os avisos de pedido.',
          url: '/config/notificacoes',
          tag: 'teste',
          kind: 'teste',
        }, vapid);
        if (r.ok) {
          ok++;
          await sb.from('push_devices')
            .update({ last_success_at: new Date().toISOString(), failures: 0, last_error: null }).eq('id', d.id);
        } else if (r.gone) {
          removidos++;
          await sb.from('push_devices').delete().eq('id', d.id);
        } else {
          falhas++;
          await sb.from('push_devices').update({ last_error: (r.error || '').slice(0, 300) }).eq('id', d.id);
        }
      }
      return json(event, 200, { ok: true, enviados: ok, falhas, removidos });
    }

    const body = parseBody<Inscricao>(event);
    const endpoint = String(body.endpoint || '').trim();
    const p256dh = String(body.keys?.p256dh || '').trim();
    const auth = String(body.keys?.auth || '').trim();
    if (!endpoint || !p256dh || !auth) throw badRequest('Inscrição incompleta.');
    if (!/^https:\/\//i.test(endpoint)) throw badRequest('Endpoint de push inválido.');

    /* Mesmo navegador reinscrevendo (troca de chave, reinstalação):
       o endpoint é único, então atualiza em vez de duplicar. */
    const { data: device, error } = await sb.from('push_devices').upsert({
      staff_id: ctx.userId,
      endpoint, p256dh, auth,
      label: (body.label || '').trim().slice(0, 60) || 'Meu aparelho',
      user_agent: (event.headers['user-agent'] || '').slice(0, 300),
      active: true, failures: 0, last_error: null,
    }, { onConflict: 'endpoint' }).select('id, label, created_at').single();
    if (error) throw badRequest(error.message);

    await writeAudit({
      actorId: ctx.userId, action: 'create', entity: 'push_device', entityId: device.id,
      newValue: { label: device.label }, reason: 'Aparelho autorizado a receber notificações',
    });
    return json(event, 201, { device: { ...device, hash: await endpointHash(endpoint) } });
  }

  /* ---- RENOMEAR ---- */
  if (event.httpMethod === 'PATCH') {
    if (!id) throw badRequest('Informe o id do aparelho.');
    const body = parseBody<{ label?: string }>(event);
    const label = String(body.label || '').trim().slice(0, 60);
    if (!label) throw badRequest('Informe o novo nome.');
    const { data, error } = await sb.from('push_devices')
      .update({ label }).eq('id', id).select('id, label').maybeSingle();
    if (error) throw badRequest(error.message);
    if (!data) throw notFound('Aparelho não encontrado.');
    return json(event, 200, { device: data });
  }

  /* ---- REMOVER ---- */
  if (event.httpMethod === 'DELETE') {
    if (!id) throw badRequest('Informe o id do aparelho.');
    const { data: antes } = await sb.from('push_devices').select('id, label').eq('id', id).maybeSingle();
    if (!antes) throw notFound('Aparelho não encontrado.');
    const { error } = await sb.from('push_devices').delete().eq('id', id);
    if (error) throw badRequest(error.message);
    await writeAudit({
      actorId: ctx.userId, action: 'delete', entity: 'push_device', entityId: id,
      oldValue: { label: antes.label }, reason: 'Aparelho removido das notificações',
    });
    return json(event, 200, { ok: true });
  }

  throw badRequest('Método não suportado.');
});
