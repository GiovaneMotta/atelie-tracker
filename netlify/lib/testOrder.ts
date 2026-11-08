/* ================================================================
   Pedido de TESTE — isolamento da validação (Meta CAPI).

   Um pedido criado no canal 'teste' existe só para validar o fluxo:
     • SÓ ele recebe o test_event_code do Meta CAPI — vai para
       "Eventos de teste" sem sujar os dados reais; pedidos reais
       continuam enviando o Purchase normalmente;
     • é EXCLUÍDO de faturamento, relatórios e métricas por cliente.

   Marcador por CANAL (sem coluna nova, sem migração): o canal já existe
   em `orders` e já é lido pelas funções, então a regra fica barata e
   central. Estoque não é afetado por nenhum pedido desde a 0030
   (inventory_mover é no-op); produção só entra por ação manual, que a
   interface bloqueia para pedidos de teste.
   ================================================================ */
export const TEST_CHANNEL = 'teste';

/** Verdadeiro só para pedidos do canal de teste. Null/real => falso. */
export function isTestOrder(order: { channel?: string | null } | null | undefined): boolean {
  return !!order && order.channel === TEST_CHANNEL;
}

/** Remove os pedidos de teste de uma lista (mantém canal null e reais). */
export function excludeTestOrders<T extends { channel?: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => !isTestOrder(r));
}

/** Decide se o Purchase deste pedido vai para "Eventos de teste".
    Só quando o pedido é de teste E o código de teste está configurado —
    assim ligar o META_TEST_EVENT_CODE nunca desvia uma venda real. */
export function shouldUseTestCode(
  order: { channel?: string | null } | null | undefined,
  env: { META_TEST_EVENT_CODE?: string | undefined },
): boolean {
  return !!env.META_TEST_EVENT_CODE && isTestOrder(order);
}
