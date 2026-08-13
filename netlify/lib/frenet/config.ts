/* ================================================================
   frenet/config — resolve a configuração da integração Frenet.

   REGRA DE SEGURANÇA (§3, §37): os TOKENS vêm SEMPRE de variáveis de
   ambiente (process.env). O banco (app_settings.frenet) guarda apenas
   dados NÃO sensíveis (CEP origem, ambiente, base URLs, remetente, caixa).
   Esta função MESCLA os dois, mas nunca grava/expõe token.
   ================================================================ */
import { admin } from '../supabaseAdmin';

export type FrenetEnv = 'homologacao' | 'producao';

export interface FrenetSender {
  name: string; document: string; phone: string; email: string;
  cep: string; street: string; number: string; complement: string;
  district: string; city: string; state: string;
}
export interface FrenetBox { weight_kg: number; length_cm: number; width_cm: number; height_cm: number; }

export interface FrenetConfig {
  environment: FrenetEnv;
  /** Tokens — só no backend, nunca retornar ao frontend. */
  clientToken: string;
  partnerToken: string;
  hasClientToken: boolean;
  hasPartnerToken: boolean;
  /** Base URLs resolvidas para o ambiente atual. */
  quoteBase: string;        // api.frenet.com.br (cotação simples + tracking)
  whitelabelBase: string;   // whitelabel(.hml) — postagem/etiqueta/carteira
  cepOrigem: string;        // só dígitos
  labelFormat: string;      // A4 (§20)
  useFrenetRegistration: boolean;
  box: FrenetBox;
  sender: FrenetSender;
  webhook: { tokenName: string; tokenValue: string; url: string };
}

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const str = (s: unknown, d = '') => (s == null ? d : String(s));

/** Config NÃO-secreta guardada em app_settings.frenet (editável na UI). */
export interface FrenetStoredSettings {
  environment?: FrenetEnv;
  cep_origem?: string;
  label_format?: string;
  use_frenet_registration?: boolean;
  box?: Partial<FrenetBox>;
  sender?: Partial<FrenetSender>;
  base_urls?: { whitelabel_prod?: string; whitelabel_hml?: string; quote?: string };
}

export async function loadStoredSettings(): Promise<FrenetStoredSettings> {
  try {
    const { data } = await admin().from('app_settings').select('value').eq('key', 'frenet').maybeSingle();
    return (data?.value as FrenetStoredSettings) ?? {};
  } catch {
    return {};
  }
}

/** Monta a configuração efetiva (env + settings). */
export async function loadFrenetConfig(stored?: FrenetStoredSettings): Promise<FrenetConfig> {
  const s = stored ?? (await loadStoredSettings());

  const environment: FrenetEnv =
    (s.environment as FrenetEnv) ||
    ((process.env.FRENET_ENV as FrenetEnv) === 'producao' ? 'producao' : 'homologacao');

  const clientToken = process.env.FRENET_API_TOKEN || '';
  const partnerToken = process.env.FRENET_PARTNER_TOKEN || '';

  const quoteBase = s.base_urls?.quote || process.env.FRENET_BASE_URL || 'https://api.frenet.com.br';
  const wlProd = s.base_urls?.whitelabel_prod || process.env.FRENET_WHITELABEL_BASE_URL || 'https://whitelabel.frenet.com.br/v1';
  const wlHml = s.base_urls?.whitelabel_hml || process.env.FRENET_WHITELABEL_BASE_URL_HML || 'https://whitelabel-hml.frenet.dev/v1';
  const whitelabelBase = (environment === 'producao' ? wlProd : wlHml).replace(/\/+$/, '');

  const box: FrenetBox = {
    weight_kg: Number(s.box?.weight_kg ?? process.env.FRETE_PESO ?? 0.5) || 0.5,
    length_cm: Number(s.box?.length_cm ?? process.env.FRETE_COMPRIMENTO ?? 30) || 30,
    width_cm: Number(s.box?.width_cm ?? process.env.FRETE_LARGURA ?? 25) || 25,
    height_cm: Number(s.box?.height_cm ?? process.env.FRETE_ALTURA ?? 10) || 10,
  };

  const sd = s.sender ?? {};
  const sender: FrenetSender = {
    name: str(sd.name), document: digits(sd.document), phone: digits(sd.phone), email: str(sd.email),
    cep: digits(sd.cep), street: str(sd.street), number: str(sd.number), complement: str(sd.complement),
    district: str(sd.district), city: str(sd.city), state: str(sd.state).toUpperCase().slice(0, 2),
  };

  const siteUrl = (process.env.SITE_URL || '').replace(/\/+$/, '');

  return {
    environment,
    clientToken,
    partnerToken,
    hasClientToken: Boolean(clientToken),
    hasPartnerToken: Boolean(partnerToken),
    quoteBase: quoteBase.replace(/\/+$/, ''),
    whitelabelBase,
    cepOrigem: digits(s.cep_origem || process.env.FRENET_CEP_ORIGEM || ''),
    labelFormat: str(s.label_format, 'A4') || 'A4',
    useFrenetRegistration: Boolean(s.use_frenet_registration),
    box,
    sender,
    webhook: {
      tokenName: process.env.FRENET_WEBHOOK_TOKEN_NAME || 'x-frenet-webhook-token',
      tokenValue: process.env.FRENET_WEBHOOK_TOKEN_VALUE || '',
      url: siteUrl ? `${siteUrl}/webhooks/frenet-tracking` : '',
    },
  };
}

/** Versão segura para o frontend: status e config não-secreta (SEM tokens). */
export function publicConfigView(c: FrenetConfig) {
  return {
    environment: c.environment,
    cep_origem: c.cepOrigem,
    label_format: c.labelFormat,
    use_frenet_registration: c.useFrenetRegistration,
    box: c.box,
    sender: c.sender,
    base_urls: { whitelabel: c.whitelabelBase, quote: c.quoteBase },
    webhook_url: c.webhook.url,
    // Apenas STATUS dos tokens — nunca os valores (§5: não exibir tokens).
    tokens: {
      client_configured: c.hasClientToken,
      partner_configured: c.hasPartnerToken,
    },
  };
}
