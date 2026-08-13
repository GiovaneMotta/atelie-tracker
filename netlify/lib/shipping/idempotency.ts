/* ================================================================
   shipping/idempotency — trava e memorização para operações que podem
   ser COBRADAS (§17, §37). Usa a tabela idempotency_keys (0006).

   Fluxo da geração de etiqueta:
   1) acquire('label:shipment:<id>')  -> se já existe, devolve o resultado
      memorizado (não gera de novo) OU sinaliza "em processamento".
   2) chama a Frenet.
   3) memoize(result) para repetições responderem igual sem reexecutar.
   4) release() SÓ em falhas anteriores à chamada da Frenet (validação),
      nunca depois de a Frenet possivelmente ter criado a etiqueta.
   ================================================================ */
import { admin } from '../supabaseAdmin';

export type IdempotencyScope = 'label' | 'payment' | 'message' | 'order' | 'webhook';

export interface AcquireResult {
  acquired: boolean;                 // true = você ganhou a trava; pode executar
  existingResult: unknown | null;    // resultado memorizado (se repetição já concluída)
}

export function labelKey(shipmentId: string): string {
  return `label:shipment:${shipmentId}`;
}

/** Tenta criar a chave. Se já existir, devolve o resultado memorizado. */
export async function acquireIdempotency(key: string, scope: IdempotencyScope): Promise<AcquireResult> {
  const sb = admin();
  const { error } = await sb.from('idempotency_keys').insert({ key, scope });
  if (!error) return { acquired: true, existingResult: null };

  // 23505 = unique_violation -> alguém já pegou a trava (em curso ou concluída).
  const { data } = await sb.from('idempotency_keys').select('result').eq('key', key).maybeSingle();
  return { acquired: false, existingResult: data?.result ?? null };
}

/** Grava o resultado para que repetições respondam igual (§17). */
export async function memoizeResult(key: string, result: unknown): Promise<void> {
  await admin().from('idempotency_keys').update({ result: result as any }).eq('key', key);
}

/** Remove a trava — usar SÓ quando a operação não chegou a tocar a Frenet. */
export async function releaseIdempotency(key: string): Promise<void> {
  await admin().from('idempotency_keys').delete().eq('key', key);
}

/** Webhook: registra uma vez por evento (§24 anti-duplicidade). */
export async function seenWebhook(key: string): Promise<boolean> {
  const sb = admin();
  const { error } = await sb.from('idempotency_keys').insert({ key, scope: 'webhook' });
  return Boolean(error); // true = já visto
}
