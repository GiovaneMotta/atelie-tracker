import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { frenetRequest, FrenetError } from './client';

function mockResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
}

describe('FrenetClient — mapeamento de erros (§35)', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  const base = { base: 'https://x', path: '/y', headers: {}, logLabel: 'TEST' as const };

  it('401 -> erro de autenticação', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(401, { Message: 'invalid token' })));
    await expect(frenetRequest(base)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('400 com "saldo" -> balance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(400, { Message: 'Saldo insuficiente' })));
    await expect(frenetRequest(base)).rejects.toMatchObject({ kind: 'balance' });
  });

  it('400 comum -> invalid', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(400, { Message: 'CEP inválido' })));
    await expect(frenetRequest(base)).rejects.toMatchObject({ kind: 'invalid' });
  });

  it('AbortError -> timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { const e: any = new Error('aborted'); e.name = 'AbortError'; throw e; }));
    await expect(frenetRequest(base)).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('200 retorna o corpo parseado', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => mockResponse(200, { hello: 'world' })));
    await expect(frenetRequest(base)).resolves.toEqual({ hello: 'world' });
  });

  it('NÃO repete erro de negócio (auth) mesmo com retries', async () => {
    const fetchMock = vi.fn(async () => mockResponse(401, { Message: 'x' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(frenetRequest({ ...base, retries: 2 })).rejects.toBeInstanceOf(FrenetError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
