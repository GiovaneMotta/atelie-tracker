/* ================================================================
   WascriptService — camada desacoplada do WhatsApp (WaScript/WaSpeed) (§5).
   Doc de referência: https://api-whatsapp.wascript.com.br/api-docs/
   ----------------------------------------------------------------
   Envio (texto/mídia/documento) implementado como chamadas HTTP reais,
   ATIVADAS somente quando WASCRIPT_TOKEN estiver configurado. Como o
   caminho exato de cada rota pode variar conforme a versão da conta, os
   paths ficam centralizados em ROUTES e podem ser ajustados sem tocar na
   lógica. NÃO inventamos rota não documentada: se faltar, lança erro claro.
   Token só no backend (env).
   ================================================================ */
import { logIntegration } from '../log';

const BASE = process.env.WASCRIPT_BASE_URL || 'https://api-whatsapp.wascript.com.br';

// Ajustar conforme a documentação/instância da conta (§7: não inventar).
const ROUTES = {
  sendText: '/api/enviar-texto',
  sendMedia: '/api/enviar-imagem',
  sendDocument: '/api/enviar-documento',
};

function token(): string {
  const t = process.env.WASCRIPT_TOKEN;
  if (!t) throw new Error('WhatsApp não configurado (WASCRIPT_TOKEN).');
  return t;
}

async function call(path: string, body: Record<string, unknown>) {
  const resp = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token()}`,
    },
    body: JSON.stringify(body),
  });
  const data: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    await logIntegration('WHATSAPP', 'error', 'Falha no envio WaScript', { path, status: resp.status });
    throw new Error('Falha ao enviar pela WaScript.');
  }
  await logIntegration('WHATSAPP', 'info', 'Mensagem enviada via WaScript', { path });
  return data;
}

/** Normaliza número para DDI 55 + dígitos (padrão do ateliê). */
export function normalizePhone(phone: string): string {
  let d = (phone || '').replace(/\D/g, '');
  if (d.length <= 11) d = '55' + d;
  return d;
}

export const WascriptService = {
  async sendText(phone: string, text: string) {
    return call(ROUTES.sendText, { phone: normalizePhone(phone), message: text });
  },
  async sendImage(phone: string, imageUrl: string, caption?: string) {
    return call(ROUTES.sendMedia, { phone: normalizePhone(phone), url: imageUrl, caption: caption ?? '' });
  },
  async sendDocument(phone: string, docUrl: string, filename?: string) {
    return call(ROUTES.sendDocument, { phone: normalizePhone(phone), url: docUrl, filename: filename ?? 'arquivo' });
  },

  /** Converte um payload de webhook em mensagem canônica. TODO(Fase 2):
   *  mapear os campos reais assim que confirmarmos o formato do webhook. */
  parseInbound(_payload: unknown): { external_id?: string; from?: string; type?: string; body?: string } | null {
    return null;
  },
};
