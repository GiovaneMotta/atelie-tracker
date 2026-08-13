/* ================================================================
   WascriptService — WhatsApp via WaScript/WaSpeed (§5).
   Doc: https://api-whatsapp.wascript.com.br/api-docs/
   ----------------------------------------------------------------
   API real (confirmada na spec):
     • O TOKEN vai no CAMINHO da URL: /api/enviar-<tipo>/{token}
     • POST /api/enviar-texto/{token}      body { phone, message }
     • POST /api/enviar-imagem/{token}     body { phone, base64, message? }
     • POST /api/enviar-video/{token}      body { phone, base64, message? }
     • POST /api/enviar-audio/{token}      body { phone, base64 }
     • POST /api/enviar-documento/{token}  body { phone, base64, name? }
     • POST /api/modificar-etiquetas/{token} body { phone, actions }
   Segurança: o token (env WASCRIPT_TOKEN) fica no backend e NUNCA é
   registrado em log (logamos só o nome da rota, sem o token).
   Recebimento: não há webhook documentado nesta spec → parseInbound
   permanece TODO até capturarmos um payload real (não inventamos).
   ================================================================ */
import { logIntegration } from '../log';

const BASE = process.env.WASCRIPT_BASE_URL || 'https://api-whatsapp.wascript.com.br';

function token(): string {
  const t = process.env.WASCRIPT_TOKEN;
  if (!t) throw new Error('WhatsApp não configurado (WASCRIPT_TOKEN).');
  return t;
}

/** DDI 55 + apenas dígitos (padrão do ateliê). */
export function normalizePhone(phone: string): string {
  let d = (phone || '').replace(/\D/g, '');
  if (d.length <= 11) d = '55' + d;
  return d;
}

/** POST para uma rota do WaScript. `route` é só o nome (sem token) — é o
 *  que vai para o log; a URL real (com token) nunca é logada. */
async function post(route: string, body: Record<string, unknown>): Promise<any> {
  const url = `${BASE}/api/${route}/${token()}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    await logIntegration('WHATSAPP', 'error', 'Falha no envio WaScript', { route, status: resp.status });
    throw new Error(`Falha ao enviar pela WaScript (${resp.status}).`);
  }
  await logIntegration('WHATSAPP', 'info', 'Enviado via WaScript', { route });
  return data;
}

/** Baixa uma URL e devolve em base64 (para imagem/documento). */
async function urlToBase64(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Não foi possível baixar a mídia.');
  return Buffer.from(await r.arrayBuffer()).toString('base64');
}

export const WascriptService = {
  async sendText(phone: string, message: string): Promise<any> {
    return post('enviar-texto', { phone: normalizePhone(phone), message });
  },

  /** `image` pode ser base64 puro ou uma URL (que baixamos e convertemos). */
  async sendImage(phone: string, image: string, caption?: string): Promise<any> {
    const base64 = /^https?:\/\//i.test(image) ? await urlToBase64(image) : image;
    return post('enviar-imagem', { phone: normalizePhone(phone), base64, message: caption ?? '' });
  },

  async sendDocument(phone: string, doc: string, name?: string): Promise<any> {
    const base64 = /^https?:\/\//i.test(doc) ? await urlToBase64(doc) : doc;
    return post('enviar-documento', { phone: normalizePhone(phone), base64, name: name ?? 'arquivo' });
  },

  async modifyLabels(phone: string, actions: unknown[]): Promise<any> {
    return post('modificar-etiquetas', { phone: normalizePhone(phone), actions });
  },

  /** Converte um payload de webhook de entrada em mensagem canônica.
   *  TODO(Fase 2b): implementar quando capturarmos um payload REAL do
   *  WaScript (a spec pública não documenta o webhook). Até lá, o receptor
   *  `webhook-wascript` só armazena o payload cru para inspeção. */
  parseInbound(_payload: unknown): null {
    return null;
  },
};
