/* ================================================================
   webpush — envio de Web Push (RFC 8291 + VAPID RFC 8292).

   POR QUE ESCRITO À MÃO, E NÃO A BIBLIOTECA `web-push`
   A `web-push` do npm depende de `http`, `https`, `crypto` e `zlib` do
   Node. As funções deste painel rodam na Cloudflare (Workers), onde
   esses módulos não existem de verdade. Aqui usamos só WebCrypto, que
   é nativo tanto no Workers quanto no Node 18+ — então o mesmo código
   roda em produção e nos testes, sem polyfill e sem dependência nova
   no package.json.

   O QUE ACONTECE NUM ENVIO
     1. A notificação é CRIPTOGRAFADA com as chaves que o próprio
        navegador do aparelho gerou (p256dh + auth). Nem o serviço de
        push (Google/Mozilla) consegue ler o conteúdo — só o celular.
     2. O pedido HTTP é ASSINADO com a chave VAPID privada, que prova
        ao serviço de push que o remetente é este painel.

   A chave VAPID privada vem de variável de ambiente e NUNCA aparece
   no frontend nem no repositório.
   ================================================================ */

/* ---------- base64url (sem Buffer: vale no Workers e no Node) ---------- */
export function b64urlToBytes(s: string): Uint8Array {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64url(b: Uint8Array | ArrayBuffer): string {
  const u8 = b instanceof Uint8Array ? b : new Uint8Array(b);
  let bin = '';
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const utf8 = (s: string) => new TextEncoder().encode(s);
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/* ---------- HKDF (RFC 5869), do jeito que a RFC 8291 usa ---------- */
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}
/** Extract + Expand de um bloco só (tudo aqui cabe em 32 bytes). */
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, len);
}

/* ---------- VAPID: o JWT que identifica este painel ---------- */
async function vapidKey(privateD: string, publicRaw: string): Promise<CryptoKey> {
  const pub = b64urlToBytes(publicRaw);
  if (pub.length !== 65 || pub[0] !== 0x04) {
    throw new Error('VAPID_PUBLIC_KEY inválida (esperado 65 bytes não comprimidos).');
  }
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'EC', crv: 'P-256', ext: true,
      x: bytesToB64url(pub.slice(1, 33)),
      y: bytesToB64url(pub.slice(33, 65)),
      d: privateD,
    },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

export async function vapidHeader(
  endpoint: string,
  opts: { publicKey: string; privateKey: string; subject: string },
): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = bytesToB64url(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = bytesToB64url(utf8(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,   // 12h (máx. permitido: 24h)
    sub: opts.subject,
  })));
  const signed = `${header}.${claims}`;
  const key = await vapidKey(opts.privateKey, opts.publicKey);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(signed));
  return `vapid t=${signed}.${bytesToB64url(sig)}, k=${opts.publicKey}`;
}

/* ---------- Criptografia do conteúdo (aes128gcm, RFC 8291) ---------- */
export interface PushSubscription {
  endpoint: string;
  p256dh: string;   // chave pública do aparelho (base64url, 65 bytes)
  auth: string;     // segredo compartilhado do aparelho (base64url, 16 bytes)
}

export async function encryptPayload(sub: PushSubscription, payload: string): Promise<Uint8Array> {
  const uaPublic = b64urlToBytes(sub.p256dh);
  const authSecret = b64urlToBytes(sub.auth);
  if (uaPublic.length !== 65) throw new Error('Inscrição inválida: p256dh fora do formato.');

  // Par efêmero deste envio (descartado depois).
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));

  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256),
  );

  // IKM: amarra o segredo ECDH às DUAS chaves públicas (§3.3 da RFC 8291)
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, shared, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  // 0x02 = delimitador de fim de registro (não usamos padding extra)
  const plaintext = concat(utf8(payload), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, plaintext),
  );

  // Cabeçalho do corpo: salt | tamanho do registro | tamanho da chave | chave
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, sealed);
}

/* ---------- Envio ---------- */
export interface PushResult {
  ok: boolean;
  status: number;
  /** true quando o serviço de push diz que a inscrição morreu (410/404). */
  gone: boolean;
  error?: string;
}

export interface VapidConfig { publicKey: string; privateKey: string; subject: string; }

export function readVapid(env: Record<string, string | undefined>): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY;
  const privateKey = env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: env.VAPID_SUBJECT || 'mailto:contato@ateliedalili.com.br' };
}

export async function sendPush(
  sub: PushSubscription,
  payload: unknown,
  vapid: VapidConfig,
  opts: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high' } = {},
): Promise<PushResult> {
  try {
    const body = await encryptPayload(sub, JSON.stringify(payload));
    const auth = await vapidHeader(sub.endpoint, vapid);

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(opts.ttl ?? 60 * 60 * 24),       // 24h na fila do serviço de push
        Urgency: opts.urgency ?? 'high',
      },
      body,
    });

    if (res.ok) return { ok: true, status: res.status, gone: false };

    // 410 Gone / 404 Not Found = o navegador cancelou a inscrição.
    const gone = res.status === 410 || res.status === 404;
    let detail = '';
    try { detail = (await res.text()).slice(0, 300); } catch { /* corpo opcional */ }
    return { ok: false, status: res.status, gone, error: detail || `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: 0, gone: false, error: String((e as Error)?.message || e) };
  }
}
