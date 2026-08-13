/* ================================================================
   http — helpers de resposta, CORS, roteamento e tratamento de erro.
   Erros amigáveis no corpo; stack trace NUNCA vai ao cliente (§54).
   ================================================================ */
import type { HandlerEvent, HandlerResponse } from '@netlify/functions';
import { logIntegration } from './log';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
export const badRequest   = (m: string) => new ApiError(400, m);
export const unauthorized = (m = 'Não autenticado.') => new ApiError(401, m);
export const forbidden    = (m = 'Sem permissão para esta ação.') => new ApiError(403, m);
export const notFound     = (m = 'Não encontrado.') => new ApiError(404, m);
export const conflict     = (m: string) => new ApiError(409, m);

function corsHeaders(event: HandlerEvent): Record<string, string> {
  const allowed = (process.env.ALLOWED_ORIGINS || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const origin = event.headers.origin || event.headers.Origin || '';
  const allow = allowed.length === 0 ? '*' : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

export function json(event: HandlerEvent, status: number, body: unknown): HandlerResponse {
  return { statusCode: status, headers: corsHeaders(event), body: JSON.stringify(body) };
}

export function parseBody<T = any>(event: HandlerEvent): T {
  try { return JSON.parse(event.body || '{}') as T; } catch { throw badRequest('JSON inválido.'); }
}

/** Envolve um handler: trata OPTIONS, captura ApiError e erros inesperados. */
export function withHttp(
  fn: (event: HandlerEvent) => Promise<HandlerResponse>,
) {
  return async (event: HandlerEvent): Promise<HandlerResponse> => {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 204, headers: corsHeaders(event), body: '' };
    }
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof ApiError) {
        return json(event, err.status, { error: err.message });
      }
      // Erro inesperado: registra o detalhe técnico só no log, devolve genérico.
      await logIntegration('ERROR', 'error', 'Erro não tratado na API', {
        path: event.path, method: event.httpMethod, detail: String(err),
      }).catch(() => {});
      return json(event, 500, { error: 'Ocorreu um erro interno. Tente novamente.' });
    }
  };
}
