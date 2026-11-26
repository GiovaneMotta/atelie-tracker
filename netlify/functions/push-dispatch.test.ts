/* ================================================================
   Teste do despachante de notificações (push-dispatch).

   Supabase e o serviço de push são FALSOS: nenhuma notificação real
   sai daqui e nenhum dado de produção é tocado. O que se verifica é o
   comportamento que a Lili vai sentir no celular:

     • pedido do site vira "Novo pedido recebido!";
     • pagamento vira "Venda aprovada!";
     • pedido cancelado não avisa;
     • reprocessar a fila NÃO manda o mesmo aviso duas vezes;
     • vários celulares recebem, cada um uma vez;
     • falha de envio: 410 tira o aparelho da lista, erro passageiro
       deixa o aviso na fila para a retentativa.
   ================================================================ */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

/* ---------------- Supabase de mentira, em memória ---------------- */
const h = vi.hoisted(() => ({
  db: {
    push_outbox: [] as any[],
    push_devices: [] as any[],
    orders: [] as any[],
    customers: [] as any[],
    idempotency_keys: [] as any[],
    integration_logs: [] as any[],
  },
}));

vi.mock('../lib/supabaseAdmin', () => {
  const casa = (linha: any, filtros: [string, string, any][]) =>
    filtros.every(([op, col, val]) => (op === 'is' ? linha[col] == null && val === null : linha[col] === val));

  function builder(tabela: string) {
    const q: any = { op: 'select', filtros: [], payload: null, count: false, head: false, limite: null };
    const linhas = () => (h.db as any)[tabela] as any[];

    /** Anexa o pedido e o cliente, como o PostgREST faria no embed. */
    const enriquecer = (r: any) => {
      if (tabela !== 'push_outbox') return r;
      const pedido = h.db.orders.find((o) => o.id === r.order_id);
      if (!pedido) return { ...r, order: null };
      const cliente = h.db.customers.find((c) => c.id === pedido.customer_id) || null;
      return { ...r, order: { ...pedido, customer: cliente } };
    };

    async function rodar(): Promise<any> {
      const alvo = linhas().filter((r) => casa(r, q.filtros));
      switch (q.op) {
        case 'insert': {
          const row = { ...q.payload };
          const chave = tabela === 'idempotency_keys' ? 'key' : 'id';
          if (linhas().some((r) => r[chave] === row[chave])) {
            return { data: null, error: { code: '23505', message: 'duplicate key' } };
          }
          if (!row.id && tabela !== 'idempotency_keys') row.id = `gen-${linhas().length + 1}`;
          linhas().push(row);
          return { data: row, error: null };
        }
        case 'update':
          for (const r of alvo) Object.assign(r, q.payload);
          return { data: alvo, error: null };
        case 'delete': {
          for (const r of alvo) linhas().splice(linhas().indexOf(r), 1);
          return { data: null, error: null };
        }
        default: {
          const data = q.limite ? alvo.slice(0, q.limite) : alvo;
          if (q.head) return { data: null, error: null, count: alvo.length };
          return { data: data.map(enriquecer), error: null, count: alvo.length };
        }
      }
    }

    const b: any = {
      select: (_c?: string, o?: any) => { if (o?.count) q.count = true; if (o?.head) q.head = true; return b; },
      insert: (row: any) => { q.op = 'insert'; q.payload = row; return b; },
      upsert: (row: any) => { q.op = 'insert'; q.payload = row; return b; },
      update: (row: any) => { q.op = 'update'; q.payload = row; return b; },
      delete: () => { q.op = 'delete'; return b; },
      eq: (c: string, v: any) => { q.filtros.push(['eq', c, v]); return b; },
      is: (c: string, v: any) => { q.filtros.push(['is', c, v]); return b; },
      order: () => b,
      limit: (n: number) => { q.limite = n; return b; },
      single: async () => rodar(),
      maybeSingle: async () => { const r = await rodar(); return { ...r, data: r.data?.[0] ?? r.data ?? null }; },
      then: (res: any, rej: any) => rodar().then(res, rej),
    };
    return b;
  }

  return { admin: () => ({ from: (t: string) => builder(t) }) };
});

import { dispatchPending, brl, linhaDoPedido } from './push-dispatch';

/* ---------------- chaves e cenário ---------------- */
let env: Record<string, string | undefined>;

beforeAll(async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  let bin = ''; for (const b of pub) bin += String.fromCharCode(b);
  env = {
    VAPID_PUBLIC_KEY: btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    VAPID_PRIVATE_KEY: jwk.d!,
  };
});

/** Aparelho com chaves válidas (senão a criptografia recusa). */
async function aparelho(id: string, label: string) {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const b64 = (u: Uint8Array) => {
    let s = ''; for (const b of u) s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return {
    id, label, active: true, failures: 0,
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    p256dh: b64(pub),
    auth: b64(crypto.getRandomValues(new Uint8Array(16))),
  };
}

const pedido = (over: Record<string, unknown> = {}) => ({
  id: 'ord-1', number: 1024, total: 319, status: 'rascunho', payment_status: 'pendente',
  channel: 'site', customer_id: 'cli-1', ...over,
});

/** fetch falso: por padrão 201; `respostas` sobrescreve por endpoint. */
let respostas: Record<string, number>;
let enviosFeitos: { endpoint: string }[];
function mockarPush() {
  enviosFeitos = [];
  respostas = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    enviosFeitos.push({ endpoint: String(url) });
    const status = respostas[String(url)] ?? 201;
    return new Response('', { status });
  }));
}

beforeEach(() => {
  h.db.push_outbox = []; h.db.push_devices = []; h.db.orders = [];
  h.db.customers = [{ id: 'cli-1', name: 'Mariana Souza' }];
  h.db.idempotency_keys = []; h.db.integration_logs = [];
  mockarPush();
});

/* ================================================================ */
describe('texto da notificação', () => {
  it('monta "Pedido #1024 · Mariana Souza · R$ 319,00"', () => {
    expect(linhaDoPedido({ number: 1024, total: 319, customer: { name: 'Mariana Souza' } }))
      .toBe('Pedido #1024 · Mariana Souza · R$ 319,00');
  });

  it('cliente sem nome não quebra a linha', () => {
    expect(linhaDoPedido({ number: 7, total: 0, customer: null })).toBe('Pedido #7 · Cliente · R$ 0,00');
  });

  it('formata valores em real, com milhar', () => {
    expect(brl(319)).toBe('R$ 319,00');
    expect(brl(1234.5)).toBe('R$ 1.234,50');
    expect(brl(1234567.89)).toBe('R$ 1.234.567,89');
  });
});

describe('1) pedido novo pelo site', () => {
  it('avisa com o título certo e marca a fila como entregue', async () => {
    h.db.orders = [pedido()];
    h.db.push_devices = [await aparelho('cel-lili', 'Celular da Lili')];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];

    const r = await dispatchPending(env);

    expect(r.enviados).toBe(1);
    expect(enviosFeitos).toHaveLength(1);
    expect(h.db.push_outbox[0].dispatched_at).toBeTruthy();
    expect(h.db.idempotency_keys).toEqual([
      { key: 'push:novo_pedido:ord-1:cel-lili', scope: 'push' },
    ]);
    expect(h.db.push_devices[0].last_success_at).toBeTruthy();
  });
});

describe('2) pedido marcado como pago', () => {
  it('avisa "Venda aprovada!" e usa chave de trava própria', async () => {
    h.db.orders = [pedido({ status: 'pago', payment_status: 'pago' })];
    h.db.push_devices = [await aparelho('cel-lili', 'Celular')];
    h.db.push_outbox = [{ id: 'out-2', order_id: 'ord-1', kind: 'venda_aprovada', attempts: 0, dispatched_at: null }];

    const r = await dispatchPending(env);

    expect(r.enviados).toBe(1);
    expect(h.db.idempotency_keys[0].key).toBe('push:venda_aprovada:ord-1:cel-lili');
  });

  it('os dois avisos do MESMO pedido são independentes', async () => {
    h.db.orders = [pedido({ status: 'pago', payment_status: 'pago' })];
    h.db.push_devices = [await aparelho('cel-lili', 'Celular')];
    h.db.push_outbox = [
      { id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null },
      { id: 'out-2', order_id: 'ord-1', kind: 'venda_aprovada', attempts: 0, dispatched_at: null },
    ];

    const r = await dispatchPending(env);
    expect(r.enviados).toBe(2);
    expect(h.db.idempotency_keys.map((k) => k.key).sort()).toEqual([
      'push:novo_pedido:ord-1:cel-lili', 'push:venda_aprovada:ord-1:cel-lili',
    ]);
  });
});

describe('3) pedido cancelado', () => {
  it('não envia nada, mesmo com o aviso já na fila', async () => {
    h.db.orders = [pedido({ status: 'cancelado' })];
    h.db.push_devices = [await aparelho('cel-lili', 'Celular')];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];

    const r = await dispatchPending(env);

    expect(r.enviados).toBe(0);
    expect(r.ignorados).toBe(1);
    expect(enviosFeitos).toHaveLength(0);
    expect(h.db.push_outbox[0].last_error).toBe('pedido cancelado');
    expect(h.db.push_outbox[0].dispatched_at).toBeTruthy();   // sai da fila, não volta
  });

  it('pedido apagado também não avisa', async () => {
    h.db.orders = [];
    h.db.push_devices = [await aparelho('cel-lili', 'Celular')];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'sumiu', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];

    const r = await dispatchPending(env);
    expect(r.enviados).toBe(0);
    expect(enviosFeitos).toHaveLength(0);
  });
});

describe('4) evento duplicado / reprocessamento', () => {
  it('rodar a fila de novo NÃO manda o mesmo aviso outra vez', async () => {
    h.db.orders = [pedido()];
    h.db.push_devices = [await aparelho('cel-lili', 'Celular')];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];

    await dispatchPending(env);
    expect(enviosFeitos).toHaveLength(1);

    // alguém reprocessa a linha (ex.: retentativa depois de um reset manual)
    h.db.push_outbox[0].dispatched_at = null;
    const r2 = await dispatchPending(env);

    expect(enviosFeitos).toHaveLength(1);             // nenhum envio novo
    expect(r2.enviados).toBe(0);
    expect(h.db.push_outbox[0].dispatched_at).toBeTruthy();
  });

  it('aparelho novo recebe mesmo que outro já tenha recebido o aviso', async () => {
    h.db.orders = [pedido()];
    h.db.push_devices = [await aparelho('cel-a', 'A')];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];
    await dispatchPending(env);

    h.db.push_devices.push(await aparelho('cel-b', 'B'));
    h.db.push_outbox[0].dispatched_at = null;
    await dispatchPending(env);

    expect(enviosFeitos.map((e) => e.endpoint)).toEqual([
      'https://fcm.googleapis.com/fcm/send/cel-a',
      'https://fcm.googleapis.com/fcm/send/cel-b',
    ]);
  });
});

describe('5) mais de um aparelho inscrito', () => {
  it('todos recebem, uma vez cada', async () => {
    h.db.orders = [pedido()];
    h.db.push_devices = [
      await aparelho('cel-lili', 'Celular da Lili'),
      await aparelho('cel-giovane', 'Celular do Giovane'),
      await aparelho('tablet', 'Tablet'),
    ];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];

    const r = await dispatchPending(env);

    expect(r.enviados).toBe(3);
    expect(r.aparelhos).toBe(3);
    expect(new Set(enviosFeitos.map((e) => e.endpoint)).size).toBe(3);
    expect(h.db.idempotency_keys).toHaveLength(3);
  });

  it('aparelho desativado fica de fora', async () => {
    const off = await aparelho('cel-off', 'Antigo'); off.active = false;
    h.db.orders = [pedido()];
    h.db.push_devices = [await aparelho('cel-on', 'Atual'), off];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];

    const r = await dispatchPending(env);
    expect(r.enviados).toBe(1);
    expect(enviosFeitos[0].endpoint).toContain('cel-on');
  });
});

describe('6) falha no envio', () => {
  it('410 remove a inscrição morta e não atrapalha os outros aparelhos', async () => {
    h.db.orders = [pedido()];
    h.db.push_devices = [await aparelho('cel-morto', 'Trocado'), await aparelho('cel-vivo', 'Atual')];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];
    respostas['https://fcm.googleapis.com/fcm/send/cel-morto'] = 410;

    const r = await dispatchPending(env);

    expect(r.enviados).toBe(1);
    expect(r.falhas).toBe(1);
    expect(h.db.push_devices.map((d) => d.id)).toEqual(['cel-vivo']);   // o morto saiu
    expect(h.db.push_outbox[0].dispatched_at).toBeTruthy();             // nada ficou pendente
  });

  it('404 também remove a inscrição', async () => {
    h.db.orders = [pedido()];
    h.db.push_devices = [await aparelho('cel-x', 'X')];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];
    respostas['https://fcm.googleapis.com/fcm/send/cel-x'] = 404;

    await dispatchPending(env);
    expect(h.db.push_devices).toHaveLength(0);
  });

  it('erro passageiro (500) deixa o aviso na fila e solta a trava para retentar', async () => {
    h.db.orders = [pedido()];
    h.db.push_devices = [await aparelho('cel-lili', 'Celular')];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];
    respostas['https://fcm.googleapis.com/fcm/send/cel-lili'] = 500;

    const r = await dispatchPending(env);

    expect(r.falhas).toBe(1);
    expect(h.db.push_outbox[0].dispatched_at).toBeNull();     // continua na fila
    expect(h.db.push_outbox[0].attempts).toBe(1);
    expect(h.db.idempotency_keys).toHaveLength(0);            // trava solta
    expect(h.db.push_devices[0].failures).toBe(1);

    // o serviço volta: a retentativa entrega
    respostas['https://fcm.googleapis.com/fcm/send/cel-lili'] = 201;
    const r2 = await dispatchPending(env);
    expect(r2.enviados).toBe(1);
    expect(h.db.push_outbox[0].dispatched_at).toBeTruthy();
    expect(h.db.push_devices[0].failures).toBe(0);
  });

  it('erro de rede não derruba o despachante', async () => {
    h.db.orders = [pedido()];
    h.db.push_devices = [await aparelho('cel-lili', 'Celular')];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede fora'); }));

    const r = await dispatchPending(env);
    expect(r.falhas).toBe(1);
    expect(h.db.push_outbox[0].dispatched_at).toBeNull();
  });

  it('depois de 10 tentativas desiste, registra o motivo e sai da fila', async () => {
    h.db.orders = [pedido()];
    h.db.push_devices = [await aparelho('cel-lili', 'Celular')];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 9, dispatched_at: null }];
    respostas['https://fcm.googleapis.com/fcm/send/cel-lili'] = 500;

    await dispatchPending(env);

    expect(h.db.push_outbox[0].dispatched_at).toBeTruthy();
    expect(h.db.push_outbox[0].last_error).toMatch(/desistiu após 10/);
    expect(h.db.integration_logs).toHaveLength(1);
  });
});

describe('situações sem envio possível', () => {
  it('sem chaves VAPID, a fila fica intacta esperando a configuração', async () => {
    h.db.orders = [pedido()];
    h.db.push_devices = [await aparelho('cel-lili', 'Celular')];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];

    const r = await dispatchPending({});

    expect(enviosFeitos).toHaveLength(0);
    expect(r.pendentes).toBe(1);
    expect(h.db.push_outbox[0].dispatched_at).toBeNull();
  });

  it('sem nenhum aparelho inscrito, o aviso sai da fila com o motivo', async () => {
    h.db.orders = [pedido()];
    h.db.push_outbox = [{ id: 'out-1', order_id: 'ord-1', kind: 'novo_pedido', attempts: 0, dispatched_at: null }];

    const r = await dispatchPending(env);
    expect(r.ignorados).toBe(1);
    expect(h.db.push_outbox[0].last_error).toBe('nenhum aparelho inscrito');
  });

  it('fila vazia não faz trabalho nenhum', async () => {
    const r = await dispatchPending(env);
    expect(r).toEqual({ enviados: 0, falhas: 0, ignorados: 0, pendentes: 0, aparelhos: 0 });
    expect(enviosFeitos).toHaveLength(0);
  });
});
