/* ================================================================
   /api/push-dispatch — esvazia a fila de notificações (push_outbox).

   QUEM CHAMA
     • o BANCO, por pg_net, assim que o pedido entra ou vira pago
       (função push_poke da migration 0032) — é o caminho principal e
       não depende de navegador nenhum estar aberto;
     • o pg_cron do Supabase, a cada minuto, como retentativa;
     • o `orders.ts`, logo depois de registrar o pagamento;
     • o painel, ao abrir a tela de notificações.

   Chamar várias vezes é seguro e esperado: a trava por aparelho fica
   em `idempotency_keys` (scope 'push'), então o mesmo aviso nunca sai
   duas vezes para o mesmo celular.

   ENTRADA: nenhuma. O corpo da requisição é ignorado de propósito —
   quem decide o que enviar é a fila, não quem chamou. Por isso o
   segredo é opcional: um chamador não autorizado não consegue mandar
   notificação nenhuma, só pedir que a fila ande.
   ================================================================ */
import type { Handler, HandlerEvent } from '@netlify/functions';
import { withHttp, json, badRequest, unauthorized } from '../lib/http';
import { getAuth } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';
import { readVapid, sendPush, type PushSubscription } from '../lib/webpush';
import { logIntegration } from '../lib/log';

/** Depois disso o aviso é dado por perdido (evita fila eterna no cron). */
const MAX_TENTATIVAS = 10;
const LOTE = 25;

const TITULOS: Record<string, string> = {
  novo_pedido: 'Novo pedido recebido!',
  venda_aprovada: 'Venda aprovada!',
};

/** R$ 1.234,50 — sem depender do ICU do runtime. */
export function brl(v: number): string {
  const n = Math.abs(Number(v) || 0).toFixed(2);
  const [int, dec] = n.split('.');
  const comGrupos = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${Number(v) < 0 ? '-' : ''}R$ ${comGrupos},${dec}`;
}

/** "Pedido #1024 · Mariana Souza · R$ 319,00" */
export function linhaDoPedido(o: { number?: number | null; total?: number | null; customer?: { name?: string | null } | null }): string {
  const nome = (o.customer?.name || '').trim() || 'Cliente';
  return `Pedido #${o.number ?? '—'} · ${nome} · ${brl(Number(o.total) || 0)}`;
}

export interface DispatchResumo {
  enviados: number;
  falhas: number;
  ignorados: number;
  pendentes: number;
  aparelhos: number;
}

/* ----------------------------------------------------------------
   O trabalho de verdade. Exportado para o orders.ts chamar direto,
   sem dar a volta pela rede.
   ---------------------------------------------------------------- */
export async function dispatchPending(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Promise<DispatchResumo> {
  const sb = admin();
  const resumo: DispatchResumo = { enviados: 0, falhas: 0, ignorados: 0, pendentes: 0, aparelhos: 0 };

  const vapid = readVapid(env);
  if (!vapid) {
    // Sem chaves, nada sai. A fila fica intacta para quando forem cadastradas.
    const { count } = await sb.from('push_outbox').select('id', { count: 'exact', head: true }).is('dispatched_at', null);
    resumo.pendentes = count ?? 0;
    return resumo;
  }

  const { data: fila } = await sb
    .from('push_outbox')
    .select('id, order_id, kind, attempts, order:orders(id, number, total, status, channel, customer:customers(name))')
    .is('dispatched_at', null)
    .order('created_at', { ascending: true })
    .limit(LOTE);

  if (!fila?.length) return resumo;

  const { data: aparelhos } = await sb
    .from('push_devices')
    .select('id, endpoint, p256dh, auth, failures')
    .eq('active', true);
  resumo.aparelhos = aparelhos?.length ?? 0;

  for (const item of fila) {
    const pedido: any = Array.isArray(item.order) ? item.order[0] : item.order;

    /* Pedido cancelado não avisa — nem que o aviso já estivesse na fila
       (ex.: a cliente pediu, a Lili cancelou antes do envio sair). */
    if (!pedido || pedido.status === 'cancelado') {
      await sb.from('push_outbox').update({
        dispatched_at: new Date().toISOString(),
        last_error: !pedido ? 'pedido removido' : 'pedido cancelado',
      }).eq('id', item.id);
      resumo.ignorados++;
      continue;
    }

    if (!aparelhos?.length) {
      await sb.from('push_outbox').update({
        dispatched_at: new Date().toISOString(),
        last_error: 'nenhum aparelho inscrito',
      }).eq('id', item.id);
      resumo.ignorados++;
      continue;
    }

    const payload = {
      title: TITULOS[item.kind] || 'Ateliê da Lili',
      body: linhaDoPedido(pedido),
      url: `/pedidos/${item.order_id}`,
      tag: `${item.kind}-${item.order_id}`,
      kind: item.kind,
    };

    let aindaPendente = false;
    let ultimoErro = '';
    /* Quantos aparelhos realmente receberam. Serve para não registrar
       como entregue um aviso que, na prática, não chegou a ninguém —
       acontece quando a única inscrição morreu (410) entre a criação do
       pedido e o envio, por exemplo porque o app foi reinstalado. */
    let entregues = 0;

    for (const ap of aparelhos) {
      /* TRAVA POR APARELHO (§37): grava a chave ANTES de enviar. Se já
         existir, este celular já recebeu este aviso — reprocessar a
         fila não duplica. Mesmo padrão do pedido e da etiqueta. */
      const chave = `push:${item.kind}:${item.order_id}:${ap.id}`;
      const { error: claimErr } = await sb.from('idempotency_keys').insert({ key: chave, scope: 'push' });
      if (claimErr) {
        if (claimErr.code === '23505') continue;      // já enviado para este aparelho
        ultimoErro = claimErr.message;
        aindaPendente = true;
        continue;
      }

      const sub: PushSubscription = { endpoint: ap.endpoint, p256dh: ap.p256dh, auth: ap.auth };
      const r = await sendPush(sub, payload, vapid);

      if (r.ok) {
        resumo.enviados++;
        entregues++;
        await sb.from('push_devices')
          .update({ last_success_at: new Date().toISOString(), failures: 0, last_error: null })
          .eq('id', ap.id);
        continue;
      }

      resumo.falhas++;
      ultimoErro = r.error || `HTTP ${r.status}`;

      if (r.gone) {
        /* 410/404: o navegador cancelou a inscrição (app desinstalado,
           dados limpos, permissão revogada). Some da lista — insistir
           só geraria erro para sempre. A trava fica: não há aparelho
           para reenviar. */
        await sb.from('push_devices').delete().eq('id', ap.id);
        continue;
      }

      /* Falha que pode passar (serviço fora do ar, rede): solta a trava
         para a retentativa poder tentar de novo este aparelho. */
      await sb.from('idempotency_keys').delete().eq('key', chave);
      await sb.from('push_devices')
        .update({ failures: (ap.failures ?? 0) + 1, last_error: ultimoErro.slice(0, 300) })
        .eq('id', ap.id);
      aindaPendente = true;
    }

    const tentativas = (item.attempts ?? 0) + 1;
    if (!aindaPendente || tentativas >= MAX_TENTATIVAS) {
      /* Fechar a linha dizendo "entregue" quando ninguém recebeu seria
         mentira — e mentira que some, porque depois não há como saber
         que aquele aviso se perdeu. O motivo fica gravado. */
      const motivo = aindaPendente
        ? `desistiu após ${tentativas} tentativas: ${ultimoErro}`
        : (entregues === 0 ? `nenhum aparelho recebeu: ${ultimoErro || 'inscrição vencida'}` : null);
      await sb.from('push_outbox').update({
        dispatched_at: new Date().toISOString(),
        attempts: tentativas,
        last_error: motivo ? motivo.slice(0, 300) : null,
      }).eq('id', item.id);
      if (aindaPendente) {
        await logIntegration('ERROR', 'error', 'Notificação push desistida após várias tentativas', {
          outbox: item.id, kind: item.kind, erro: ultimoErro,
        }).catch(() => {});
      }
    } else {
      await sb.from('push_outbox').update({
        attempts: tentativas,
        last_error: ultimoErro.slice(0, 300),
      }).eq('id', item.id);
      resumo.pendentes++;
    }
  }

  return resumo;
}

/* ----------------------------------------------------------------
   HTTP
   ---------------------------------------------------------------- */
async function autorizado(event: HandlerEvent): Promise<boolean> {
  const esperado = process.env.PUSH_DISPATCH_SECRET;
  if (!esperado) return true;                         // segredo não configurado: porta aberta
  const h = event.headers['x-push-secret'] || event.headers['X-Push-Secret'];
  if (h && h === esperado) return true;
  try { await getAuth(event); return true; } catch { return false; }   // ou um membro logado
}

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'POST') throw badRequest('Use POST.');
  if (!(await autorizado(event))) throw unauthorized('Chamada não autorizada.');
  const resumo = await dispatchPending(process.env as Record<string, string | undefined>);
  return json(event, 200, { ok: true, ...resumo });
});
