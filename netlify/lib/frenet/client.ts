/* ================================================================
   frenet/client — FrenetClient (§31). Única porta de saída para a
   Frenet. Responsável por: timeout (§36), headers (token/partner —
   NUNCA logados §33), parse, mapeamento de erro amigável (§35) e log
   estruturado sanitizado (§40). Retry só quando seguro (GET/cotação).
   ================================================================ */
import { logIntegration, type LogCategory } from '../log';

export type FrenetErrorKind =
  | 'auth' | 'balance' | 'invalid' | 'unavailable' | 'timeout' | 'notfound' | 'generic';

export class FrenetError extends Error {
  kind: FrenetErrorKind;
  httpStatus: number;      // status sugerido para a API interna devolver
  frenetStatus?: number;   // status HTTP retornado pela Frenet
  constructor(kind: FrenetErrorKind, message: string, httpStatus = 502, frenetStatus?: number) {
    super(message);
    this.kind = kind;
    this.httpStatus = httpStatus;
    this.frenetStatus = frenetStatus;
  }
}

export interface FrenetRequestOptions {
  base: string;
  path: string;                       // começa com "/"
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers: Record<string, string>;    // token/x-partner-token já montados pelo chamador
  body?: unknown;
  timeoutMs?: number;
  retries?: number;                   // só usar > 0 em operações idempotentes (cotação/consulta)
  logCategory?: LogCategory;          // default FRENET
  logLabel?: string;                  // ex: 'QUOTE', 'ONECLICK' (§33)
  /** Contexto extra para o log — NUNCA inclua tokens/PII desnecessária. */
  logContext?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT = 20000;

function friendlyFromResponse(status: number, data: any): FrenetError {
  const msg = String(
    data?.Message || data?.message || data?.ErrorMessage ||
    (Array.isArray(data?.Details) ? data.Details.map((d: any) => d?.Message).filter(Boolean).join('; ') : '') || '',
  );
  const low = msg.toLowerCase();

  if (status === 401 || status === 403) {
    return new FrenetError('auth', 'Falha de autenticação com a Frenet. Verifique os tokens configurados.', 502, status);
  }
  if (status === 404) {
    return new FrenetError('notfound', 'Recurso não encontrado na Frenet.', 404, status);
  }
  if (/saldo|balance|insufficient|limite|limit/.test(low)) {
    return new FrenetError('balance', 'Saldo ou limite de etiquetas insuficiente na carteira Frenet.', 409, status);
  }
  if (status === 400 || status === 422) {
    return new FrenetError('invalid', msg ? `Dados recusados pela Frenet: ${msg}` : 'Dados inválidos para a Frenet.', 422, status);
  }
  if (status === 429) {
    return new FrenetError('unavailable', 'Muitas requisições à Frenet. Tente novamente em instantes.', 503, status);
  }
  if (status >= 500) {
    return new FrenetError('unavailable', 'A Frenet está indisponível no momento. Tente novamente.', 503, status);
  }
  return new FrenetError('generic', msg || 'Falha ao comunicar com a Frenet.', 502, status);
}

async function once(opts: FrenetRequestOptions): Promise<any> {
  const url = `${opts.base}${opts.path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT);
  const category = opts.logCategory ?? 'FRENET';
  const label = opts.logLabel ?? 'REQUEST';

  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...opts.headers },
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    const text = await res.text();
    let data: any = undefined;
    try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }

    if (!res.ok) {
      // Log sanitizado: caminho, status e um recorte curto — nunca headers/tokens.
      await logIntegration(category, 'error', `${label}_RESPONSE erro ${res.status}`, {
        path: opts.path, status: res.status, ...opts.logContext,
        detail: typeof data === 'string' ? data.slice(0, 300) : (data?.Message || data?.ErrorMessage || undefined),
      });
      throw friendlyFromResponse(res.status, data);
    }

    await logIntegration(category, 'info', `${label}_RESPONSE ok`, {
      path: opts.path, status: res.status, ...opts.logContext,
    });
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Executa a chamada com timeout e, se permitido, poucas tentativas seguras. */
export async function frenetRequest(opts: FrenetRequestOptions): Promise<any> {
  const retries = Math.max(0, opts.retries ?? 0);
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once(opts);
    } catch (err) {
      lastErr = err;
      // NÃO repetir erros de negócio (auth/saldo/dados) — só rede/indisponibilidade.
      if (err instanceof FrenetError && !['unavailable', 'timeout'].includes(err.kind)) throw err;
      if (attempt === retries) break;
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }

  if (lastErr instanceof FrenetError) throw lastErr;
  // Timeout/rede: AbortError ou TypeError de fetch.
  const isAbort = (lastErr as any)?.name === 'AbortError';
  await logIntegration(opts.logCategory ?? 'FRENET', 'error',
    `${opts.logLabel ?? 'REQUEST'}_${isAbort ? 'TIMEOUT' : 'NETWORK'}`,
    { path: opts.path, ...opts.logContext });
  throw new FrenetError(
    'timeout',
    isAbort ? 'A Frenet demorou para responder (timeout). Tente novamente.'
            : 'Não foi possível conectar à Frenet. Verifique a conexão e tente novamente.',
    504,
  );
}
