import { describe, it, expect } from 'vitest';
import { TEST_CHANNEL, isTestOrder, excludeTestOrders, shouldUseTestCode } from './testOrder';

describe('isTestOrder', () => {
  it('é verdadeiro só para o canal de teste', () => {
    expect(isTestOrder({ channel: TEST_CHANNEL })).toBe(true);
  });
  it('é falso para pedidos reais, canal nulo ou ausente', () => {
    expect(isTestOrder({ channel: 'site' })).toBe(false);
    expect(isTestOrder({ channel: 'whatsapp' })).toBe(false);
    expect(isTestOrder({ channel: 'manual' })).toBe(false);
    expect(isTestOrder({ channel: null })).toBe(false);
    expect(isTestOrder({})).toBe(false);
    expect(isTestOrder(null)).toBe(false);
    expect(isTestOrder(undefined)).toBe(false);
  });
});

describe('excludeTestOrders', () => {
  it('remove só os de teste e preserva null/reais', () => {
    const rows = [{ channel: 'site' }, { channel: 'teste' }, { channel: null }, { channel: 'manual' }];
    expect(excludeTestOrders(rows)).toEqual([{ channel: 'site' }, { channel: null }, { channel: 'manual' }]);
  });
  it('não descarta pedidos de canal nulo (comparação segura)', () => {
    expect(excludeTestOrders([{ channel: null }, { channel: undefined }]).length).toBe(2);
  });
});

describe('exclusão de pedidos de teste nos agregados (faturamento/relatórios)', () => {
  // Mesma forma que dashboard.ts / reports.ts aplicam antes de somar.
  const rows = [
    { channel: 'site', status: 'pago', payment_status: 'pago', total: 100 },
    { channel: 'teste', status: 'pago', payment_status: 'pago', total: 999 },
    { channel: 'whatsapp', status: 'pago', payment_status: 'pago', total: 50 },
    { channel: null, status: 'cancelado', payment_status: 'pago', total: 30 },
  ];
  it('faturamento ignora o pedido de teste', () => {
    const faturamento = excludeTestOrders(rows)
      .filter((o) => o.status !== 'cancelado' && o.payment_status === 'pago')
      .reduce((s, o) => s + o.total, 0);
    expect(faturamento).toBe(150); // 100 + 50; os 999 do teste ficam de fora
  });
  it('contagem de pedidos ignora o pedido de teste', () => {
    expect(excludeTestOrders(rows).length).toBe(3);
  });
});

describe('shouldUseTestCode', () => {
  const code = { META_TEST_EVENT_CODE: 'TEST123' };
  const semCode = { META_TEST_EVENT_CODE: undefined };
  it('só usa o test code quando o pedido é de teste E o código existe', () => {
    expect(shouldUseTestCode({ channel: 'teste' }, code)).toBe(true);
  });
  it('nunca usa o test code para pedido real, mesmo com o código setado', () => {
    expect(shouldUseTestCode({ channel: 'site' }, code)).toBe(false);
    expect(shouldUseTestCode({ channel: null }, code)).toBe(false);
  });
  it('não usa o test code se o código não está configurado', () => {
    expect(shouldUseTestCode({ channel: 'teste' }, semCode)).toBe(false);
  });
});
