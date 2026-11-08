/* ================================================================
   Teste de integração do Meta CAPI (enviarPurchase) com a Meta MOCKADA.
   Nenhum evento real é disparado: `fetch` e o Supabase são falsos.
   Cobre o isolamento (test_event_code), valor/identificação e a
   deduplicação (idempotência).
   ================================================================ */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

// Web Crypto para o sha256 do código (Node já costuma expor; garantimos).
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

// Estado do Supabase falso, controlado por cada teste.
const h = vi.hoisted(() => ({
  state: {
    order: null as any, metaEvent: null as any, customer: null as any,
    appSettings: null as any, inserts: [] as any[], updates: [] as any[],
  },
}));

vi.mock('./supabaseAdmin', () => {
  const pick = (table: string) => {
    const s = h.state;
    if (table === 'orders') return s.order;
    if (table === 'meta_events') return s.metaEvent;
    if (table === 'customers') return s.customer;
    if (table === 'app_settings') return s.appSettings;
    return null;
  };
  const from = (table: string) => {
    const b: any = {
      select: () => b, eq: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => ({ data: pick(table), error: null }),
      single: async () => ({ data: pick(table), error: null }),
      insert: (row: any) => { h.state.inserts.push({ table, row }); return Promise.resolve({ data: null, error: null }); },
      update: (row: any) => { h.state.updates.push({ table, row }); return { eq: () => Promise.resolve({ data: null, error: null }) }; },
    };
    return b;
  };
  return { admin: () => ({ from }) };
});

import { enviarPurchase } from '../functions/meta-capi';

const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ events_received: 1 }) }));

const baseOrder = (over: Record<string, unknown> = {}) => ({
  id: 'ord-123', number: 1042, total: 389, status: 'pago', payment_status: 'pago',
  utm: {}, channel: 'site', created_at: '2026-11-07T10:00:00Z', customer_id: 'cust-1',
  order_items: [{ sku: 'SM-G026', quantity: 1 }, { sku: 'AC-018', quantity: 1 }],
  ...over,
});
const baseCustomer = { name: 'Marina Souza', phone: '5599988881234', email: 'marina@exemplo.com' };
const env = (over: Record<string, string | undefined> = {}) => ({
  META_CAPI_TOKEN: 'tok-xyz', META_PIXEL_ID: '444984499904899', ...over,
});
const sentBody = () => JSON.parse((fetchMock.mock.calls[0] as any)[1].body);

beforeEach(() => {
  h.state.order = null; h.state.metaEvent = null; h.state.customer = baseCustomer;
  h.state.appSettings = null; h.state.inserts = []; h.state.updates = [];
  fetchMock.mockClear();
  (globalThis as any).fetch = fetchMock;
});

describe('isolamento do test_event_code', () => {
  it('1) pedido REAL não recebe test_event_code, mesmo com o código setado', async () => {
    h.state.order = baseOrder({ channel: 'site' });
    const r = await enviarPurchase('ord-123', env({ META_TEST_EVENT_CODE: 'TEST123' }));
    expect(r.status).toBe('enviado');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody().test_event_code).toBeUndefined();
  });

  it('2) pedido de TESTE recebe o test_event_code quando configurado', async () => {
    h.state.order = baseOrder({ channel: 'teste' });
    await enviarPurchase('ord-123', env({ META_TEST_EVENT_CODE: 'TEST123' }));
    expect(sentBody().test_event_code).toBe('TEST123');
  });

  it('3) sem código configurado, NENHUM pedido recebe test_event_code', async () => {
    h.state.order = baseOrder({ channel: 'teste' });
    await enviarPurchase('ord-123', env()); // sem META_TEST_EVENT_CODE
    expect(sentBody().test_event_code).toBeUndefined();
  });
});

describe('valor e identificação corretos', () => {
  it('envia value, moeda, order_id, event_id, SKUs e dados hasheados', async () => {
    h.state.order = baseOrder({ channel: 'site' });
    await enviarPurchase('ord-123', env());
    const ev = sentBody().data[0];
    expect(ev.event_name).toBe('Purchase');
    expect(ev.event_id).toBe('purchase-ord-123');
    expect(ev.custom_data.value).toBe(389);
    expect(ev.custom_data.currency).toBe('BRL');
    expect(ev.custom_data.order_id).toBe('PED-1042');
    expect(ev.custom_data.content_ids).toEqual(['SM-G026', 'AC-018']);
    expect(ev.custom_data.num_items).toBe(2);
    // PII hasheada (sha256 = 64 hex), nunca em texto puro
    const hex = /^[a-f0-9]{64}$/;
    expect(ev.user_data.em[0]).toMatch(hex);
    expect(ev.user_data.ph[0]).toMatch(hex);
    expect(ev.user_data.fn[0]).toMatch(hex);
    expect(ev.user_data.ln[0]).toMatch(hex);
    expect(ev.user_data.external_id[0]).toMatch(hex);
    expect(JSON.stringify(ev.user_data)).not.toContain('marina@exemplo.com');
  });
});

describe('idempotência / sem Purchase duplicado', () => {
  it('6) evento já enviado retorna "duplicado" e NÃO chama a Meta de novo', async () => {
    h.state.order = baseOrder({ channel: 'site' });
    h.state.metaEvent = { id: 'm1', status: 'enviado', attempts: 1 };
    const r = await enviarPurchase('ord-123', env());
    expect(r.status).toBe('duplicado');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('não reinsere o evento quando já existe a linha (índice único preservado)', async () => {
    h.state.order = baseOrder({ channel: 'site' });
    h.state.metaEvent = { id: 'm1', status: 'erro', attempts: 1 }; // existe, mas não enviado
    await enviarPurchase('ord-123', env());
    const inserts = h.state.inserts.filter((i) => i.table === 'meta_events');
    expect(inserts.length).toBe(0); // não cria 2ª linha para o mesmo event_id
  });
});
