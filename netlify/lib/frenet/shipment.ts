/* ================================================================
   frenet/shipment — FrenetShipmentService (§15, §16, §20).
   OneClick: cria pedido, PAGA com o saldo da carteira e retorna as URLs
   das etiquetas (doc oficial). Também consulta/cancela envio e saldo.
   Todas as chamadas WhiteLabel exigem token + x-partner-token.
   ================================================================ */
import { frenetRequest, FrenetError } from './client';
import type { FrenetConfig } from './config';

export interface OneClickResultItem {
  shipmentId: string | null;
  orderId: string | null;
  shipmentStatus: number | null;
  trackingUrl: string | null;
  labelUrl: string | null;
  declarationUrl: string | null;
  validThrough: string | null;
  errors: string[];
}
export interface OneClickResult {
  statusBatch: string | null;   // Processado | ParcialmenteProcessado | Erro
  items: OneClickResultItem[];
  batchError: string | null;
}
export interface WalletInfo {
  balance: number; bonusBalance: number; blockedBalance: number;
  labelLimit: number; walletLimit: number;
}

function pick(o: any, ...keys: string[]) { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; }
const s = (v: unknown) => (v == null ? null : String(v));
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

function requirePartner(config: FrenetConfig) {
  if (!config.hasClientToken || !config.hasPartnerToken) {
    throw new FrenetError('auth',
      'Operação WhiteLabel indisponível: configure FRENET_API_TOKEN e FRENET_PARTNER_TOKEN da Frenet.', 409);
  }
}
function wlHeaders(config: FrenetConfig, extra?: Record<string, string>) {
  return { token: config.clientToken, 'x-partner-token': config.partnerToken, ...(extra || {}) };
}

function parseResultItem(it: any): OneClickResultItem {
  const errs = pick(it, 'Errors', 'errors');
  return {
    shipmentId: s(pick(it, 'ShipmentId', 'shipmentId')),
    orderId: s(pick(it, 'OrderId', 'orderId')),
    shipmentStatus: (() => { const v = pick(it, 'ShipmentStatus', 'shipmentStatus'); return v == null ? null : n(v); })(),
    trackingUrl: s(pick(it, 'TrackingUrl', 'trackingUrl')),
    labelUrl: s(pick(it, 'LabelUrl', 'labelUrl')),
    declarationUrl: s(pick(it, 'DeclarationUrl', 'declarationUrl')),
    validThrough: s(pick(it, 'ValidThrough', 'validThrough')),
    errors: Array.isArray(errs)
      ? errs.map((e: any) => String(e?.Message || e?.message || e)).filter(Boolean)
      : (errs ? [String(errs)] : []),
  };
}

export const FrenetShipmentService = {
  /** Cria a postagem e gera etiqueta(s). `shipments` = payload OneClick pronto. */
  async createOneClick(config: FrenetConfig, shipments: unknown[]): Promise<OneClickResult> {
    requirePartner(config);
    const data = await frenetRequest({
      base: config.whitelabelBase, path: '/shipments/oneclick', method: 'POST',
      headers: wlHeaders(config, { 'x-printing-format': config.labelFormat }),
      body: shipments,
      timeoutMs: 45000,   // criação + pagamento + etiqueta pode demorar
      retries: 0,         // NUNCA repetir cegamente uma operação cobrada (§36)
      logLabel: 'SHIPMENT', logContext: { env: config.environment, count: shipments.length },
    });

    const items = Array.isArray(pick(data, 'Items', 'items')) ? pick(data, 'Items', 'items') : [];
    const batchErr = pick(data, 'Error', 'error');
    return {
      statusBatch: s(pick(data, 'StatusBatch', 'statusBatch')),
      items: items.map(parseResultItem),
      batchError: batchErr ? String(batchErr?.Message || batchErr?.message || batchErr) : null,
    };
  },

  /** Consulta um envio pelo ShipmentId (status/label/tracking atuais). */
  async getShipment(config: FrenetConfig, shipmentId: string) {
    requirePartner(config);
    const data = await frenetRequest({
      base: config.whitelabelBase, path: `/shipments/${encodeURIComponent(shipmentId)}`, method: 'GET',
      headers: wlHeaders(config, { 'x-printing-format': config.labelFormat }),
      timeoutMs: 20000, retries: 1, logLabel: 'SHIPMENT', logContext: { shipmentId },
    });
    return {
      raw: data,
      shipmentStatus: (() => { const v = pick(data, 'ShipmentStatus', 'shipmentStatus'); return v == null ? null : n(v); })(),
      trackingUrl: s(pick(data, 'TrackingUrl', 'trackingUrl')),
      labelUrl: s(pick(data, 'LabelUrl', 'labelUrl')),
      declarationUrl: s(pick(data, 'DeclarationUrl', 'declarationUrl')),
      volumes: Array.isArray(pick(data, 'Volumes', 'volumes')) ? pick(data, 'Volumes', 'volumes') : [],
    };
  },

  /** Cancela um envio (quando suportado). 204 = sucesso. */
  async cancelShipment(config: FrenetConfig, shipmentId: string): Promise<void> {
    requirePartner(config);
    await frenetRequest({
      base: config.whitelabelBase, path: `/shipments/${encodeURIComponent(shipmentId)}/cancel`, method: 'POST',
      headers: wlHeaders(config),
      timeoutMs: 20000, retries: 0, logLabel: 'SHIPMENT', logContext: { shipmentId, action: 'cancel' },
    });
  },

  /** Saldo/limite da carteira (§16). */
  async getWallet(config: FrenetConfig): Promise<WalletInfo> {
    requirePartner(config);
    const data = await frenetRequest({
      base: config.whitelabelBase, path: '/wallet', method: 'GET',
      headers: wlHeaders(config),
      timeoutMs: 15000, retries: 1, logLabel: 'WALLET', logContext: { env: config.environment },
    });
    return {
      balance: n(pick(data, 'Balance', 'balance')),
      bonusBalance: n(pick(data, 'BonusBalance', 'bonusBalance')),
      blockedBalance: n(pick(data, 'BlockedBalance', 'blockedBalance')),
      labelLimit: n(pick(data, 'LabelLimit', 'labelLimit')),
      walletLimit: n(pick(data, 'WalletLimit', 'walletLimit')),
    };
  },
};
