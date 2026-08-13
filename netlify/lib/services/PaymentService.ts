/* ================================================================
   PaymentService — camada desacoplada de pagamento (§14, §22).
   createLink() é REAL (mesma API InfinitePay já usada no catálogo em
   ../../netlify/functions/pagamento.js). Preços travados no backend, em
   CENTAVOS. Handle só no env. Reembolso = ação crítica, exige aprovação
   humana (§58/§66) — implementado na fase de pagamentos.
   ================================================================ */
import { logIntegration } from '../log';

export interface PayItem { description: string; quantity: number; price: number; } // price em REAIS

export const PaymentService = {
  async createLink(orderNsu: string, items: PayItem[], siteUrl: string): Promise<{ link: string; orderNsu: string }> {
    const handle = (process.env.INFINITEPAY_HANDLE || '').replace(/^\$/, '');
    if (!handle) throw new Error('Pagamento não configurado (INFINITEPAY_HANDLE).');

    const itemsAPI = items
      .map((it) => ({
        quantity: Math.max(1, Math.trunc(it.quantity) || 1),
        price: Math.max(0, Math.round(Number(it.price) * 100)), // reais -> centavos
        description: String(it.description || 'Item').slice(0, 120),
      }))
      .filter((it) => it.price > 0);
    if (!itemsAPI.length) throw new Error('Itens inválidos para pagamento.');

    const payload = {
      handle,
      items: itemsAPI,
      order_nsu: orderNsu,
      redirect_url: `${siteUrl}/pagamento/obrigado`,
      webhook_url: `${siteUrl}/webhooks/payment`,
    };

    const resp = await fetch('https://api.checkout.infinitepay.io/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data: any = await resp.json().catch(() => ({}));
    const link = data.url || data.link || data.checkout_url || data.payment_url || data?.data?.url || data?.data?.link;
    if (!resp.ok || !link) {
      await logIntegration('PAYMENT', 'error', 'InfinitePay não retornou link', { status: resp.status });
      throw new Error('Não foi possível gerar o link de pagamento.');
    }
    await logIntegration('PAYMENT', 'info', 'Link de pagamento criado', { orderNsu });
    return { link, orderNsu };
  },
};
