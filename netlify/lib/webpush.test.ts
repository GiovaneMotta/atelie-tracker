/* ================================================================
   Teste da criptografia de Web Push (RFC 8291) e do VAPID (RFC 8292).

   Nenhuma notificação real é enviada: o `fetch` é mockado. O que se
   prova aqui é que o pacote que sai daqui é DECIFRÁVEL pelo aparelho
   — fazemos o papel do celular, refazendo a derivação do lado do
   receptor e abrindo o envelope. Se a matemática estiver errada, o
   navegador descartaria a notificação em silêncio, e nenhum teste de
   "o endpoint respondeu 201" perceberia.

   As chaves VAPID usadas aqui são SORTEADAS a cada execução. A chave
   de produção mora só nas variáveis da Cloudflare — nunca num arquivo
   do repositório, nem em teste.
   ================================================================ */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';

if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;

import {
  encryptPayload, vapidHeader, sendPush, readVapid, b64urlToBytes, bytesToB64url,
} from './webpush';

const utf8 = (s: string) => new TextEncoder().encode(s);
function concat(...p: Uint8Array[]) {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  let o = 0; for (const x of p) { out.set(x, o); o += x.length; }
  return out;
}
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, concat(info, new Uint8Array([1])))).slice(0, len);
}

/** Par VAPID descartável, só para este arquivo de teste. */
let VAPID: { publicKey: string; privateKey: string; subject: string };
beforeAll(async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
  VAPID = { publicKey: bytesToB64url(pub), privateKey: jwk.d!, subject: 'mailto:teste@example.com' };
});

/** Cria uma "inscrição" como a que um navegador real entregaria. */
async function fakeSubscription() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    sub: {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      p256dh: bytesToB64url(pub),
      auth: bytesToB64url(auth),
    },
    privateKey: kp.privateKey,
    publicRaw: pub,
    authSecret: auth,
  };
}

/** O lado do CELULAR: desfaz o que encryptPayload fez. */
async function decryptAsDevice(
  body: Uint8Array,
  device: { privateKey: CryptoKey; publicRaw: Uint8Array; authSecret: Uint8Array },
): Promise<string> {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const sealed = body.slice(21 + idlen);

  const senderKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, device.privateKey, 256),
  );
  const keyInfo = concat(utf8('WebPush: info\0'), device.publicRaw, asPublic);
  const ikm = await hkdf(device.authSecret, shared, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const k = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const open = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, k, sealed),
  );
  return new TextDecoder().decode(open.slice(0, open.length - 1));  // tira o 0x02 do fim
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('criptografia aes128gcm', () => {
  it('o aparelho consegue abrir a notificação', async () => {
    const d = await fakeSubscription();
    const texto = JSON.stringify({ title: 'Novo pedido recebido!', body: 'Pedido #1024 · Mariana Souza · R$ 319,00' });
    const body = await encryptPayload(d.sub, texto);
    expect(await decryptAsDevice(body, d)).toBe(texto);
  });

  it('o cabeçalho do corpo segue o formato da RFC (salt | rs | idlen | chave)', async () => {
    const d = await fakeSubscription();
    const body = await encryptPayload(d.sub, 'oi');
    expect(body.length).toBeGreaterThan(21 + 65);
    expect(new DataView(body.buffer, body.byteOffset).getUint32(16)).toBe(4096);
    expect(body[20]).toBe(65);              // chave pública não comprimida
    expect(body[21]).toBe(0x04);
  });

  it('cada envio usa salt e chave efêmera novos', async () => {
    const d = await fakeSubscription();
    const a = await encryptPayload(d.sub, 'igual');
    const b = await encryptPayload(d.sub, 'igual');
    expect(bytesToB64url(a)).not.toBe(bytesToB64url(b));
  });

  it('recusa inscrição com p256dh fora do formato', async () => {
    await expect(
      encryptPayload({ endpoint: 'https://x/y', p256dh: bytesToB64url(new Uint8Array(10)), auth: 'AAAA' }, 'x'),
    ).rejects.toThrow(/p256dh/);
  });
});

describe('VAPID', () => {
  it('assina um JWT que a chave pública verifica, com aud do serviço de push', async () => {
    const header = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', VAPID);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
    expect(m).toBeTruthy();
    const [h, p, s] = m![1].split('.');
    expect(m![2]).toBe(VAPID.publicKey);

    const claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(p)));
    expect(claims.aud).toBe('https://fcm.googleapis.com');
    expect(claims.sub).toBe(VAPID.subject);
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(claims.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 24 * 3600);

    const pub = b64urlToBytes(VAPID.publicKey);
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', x: bytesToB64url(pub.slice(1, 33)), y: bytesToB64url(pub.slice(33, 65)) },
      { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' }, key, b64urlToBytes(s), utf8(`${h}.${p}`),
    );
    expect(ok).toBe(true);
  });

  it('readVapid devolve null sem as variáveis de ambiente', () => {
    expect(readVapid({})).toBeNull();
    expect(readVapid({ VAPID_PUBLIC_KEY: 'x' })).toBeNull();
    expect(readVapid({ VAPID_PUBLIC_KEY: 'x', VAPID_PRIVATE_KEY: 'y' })?.subject).toMatch(/^mailto:/);
  });
});

describe('sendPush', () => {
  it('manda os cabeçalhos que o serviço de push exige', async () => {
    const d = await fakeSubscription();
    const fetchMock = vi.fn(async () => new Response('', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    const r = await sendPush(d.sub, { title: 'oi' }, VAPID);
    expect(r).toEqual({ ok: true, status: 201, gone: false });

    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe(d.sub.endpoint);
    expect(init.headers['Content-Encoding']).toBe('aes128gcm');
    expect(init.headers['Content-Type']).toBe('application/octet-stream');
    expect(init.headers.Authorization).toMatch(/^vapid t=.+, k=.+$/);
    expect(Number(init.headers.TTL)).toBeGreaterThan(0);
  });

  it('410 e 404 marcam a inscrição como morta (gone)', async () => {
    const d = await fakeSubscription();
    for (const status of [410, 404]) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('gone', { status })));
      const r = await sendPush(d.sub, { title: 'x' }, VAPID);
      expect(r.gone).toBe(true);
      expect(r.ok).toBe(false);
    }
  });

  it('erro de rede vira resultado, não exceção', async () => {
    const d = await fakeSubscription();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('conexão caiu'); }));
    const r = await sendPush(d.sub, { title: 'x' }, VAPID);
    expect(r.ok).toBe(false);
    expect(r.gone).toBe(false);
    expect(r.error).toMatch(/conexão caiu/);
  });

  it('500 do serviço de push não remove o aparelho', async () => {
    const d = await fakeSubscription();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const r = await sendPush(d.sub, { title: 'x' }, VAPID);
    expect(r.ok).toBe(false);
    expect(r.gone).toBe(false);
  });
});
