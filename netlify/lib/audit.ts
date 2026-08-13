/* ================================================================
   audit — trilha de auditoria (§34). Quem, o quê, quando, antes/depois.
   Chamar em toda operação sensível: preço, desconto, pagamento,
   endereço, frete, etiqueta, cancelamento.
   ================================================================ */
import { admin } from './supabaseAdmin';

export async function writeAudit(params: {
  actorId: string | null;
  action: string;                 // 'create' | 'update' | 'delete' | 'approve' | ...
  entity: string;                 // 'order' | 'payment' | 'customer' | ...
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}): Promise<void> {
  await admin().from('audit_logs').insert({
    actor_id: params.actorId,
    action: params.action,
    entity: params.entity,
    entity_id: params.entityId ?? null,
    old_value: params.oldValue ?? null,
    new_value: params.newValue ?? null,
    reason: params.reason ?? null,
  });
}
