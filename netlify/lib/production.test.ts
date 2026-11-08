/* ================================================================
   Teste de integração da trava de produção: pedido de TESTE não pode
   virar card de produção. Auth e Supabase mockados — nada é gravado.
   ================================================================ */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: { order: null as any, sectors: [{ id: 's1', is_final: false }] as any[], card: { id: 'card-1' } as any, inserts: [] as any[] },
}));

vi.mock('./auth', () => ({
  requirePermission: async () => ({ userId: 'u1', has: () => true }),
}));

vi.mock('./supabaseAdmin', () => {
  const pick = (table: string) => {
    const s = h.state;
    if (table === 'orders') return s.order;
    if (table === 'production_sectors') return s.sectors;
    if (table === 'production_cards') return s.card;
    return null;
  };
  const from = (table: string) => {
    const b: any = {
      select: () => b, eq: () => b, order: () => b, limit: () => b,
      maybeSingle: async () => ({ data: pick(table), error: null }),
      single: async () => ({ data: pick(table), error: null }),
      insert: (row: any) => {
        h.state.inserts.push({ table, row });
        const r = { data: pick(table) ?? {}, error: null };
        return { select: () => ({ single: async () => r, maybeSingle: async () => r }), then: (res: any) => res(r) };
      },
      then: (res: any) => res({ data: pick(table), error: null }),
    };
    return b;
  };
  return { admin: () => ({ from }) };
});

import { handler } from '../functions/production';

const post = (body: Record<string, unknown>) =>
  (handler as any)({ httpMethod: 'POST', body: JSON.stringify(body), queryStringParameters: null, headers: {} });

beforeEach(() => { h.state.inserts = []; });

describe('trava de produção para pedido de teste', () => {
  it('5) pedido de TESTE é recusado (não vira card)', async () => {
    h.state.order = { channel: 'teste' };
    const res = await post({ title: 'Saída TESTE', order_id: 'ord-teste' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/produção/i);
    expect(h.state.inserts.filter((i) => i.table === 'production_cards').length).toBe(0);
  });

  it('pedido REAL continua podendo ir para a produção', async () => {
    h.state.order = { channel: 'site' };
    const res = await post({ title: 'Saída real', order_id: 'ord-real' });
    expect(res.statusCode).toBe(201);
    expect(h.state.inserts.filter((i) => i.table === 'production_cards').length).toBe(1);
  });

  it('card sem pedido vinculado não é afetado pela trava', async () => {
    h.state.order = { channel: 'teste' }; // nem consultado quando não há order_id
    const res = await post({ title: 'Avulso' });
    expect(res.statusCode).toBe(201);
  });
});
