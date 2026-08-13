/* ================================================================
   frenet/label — FrenetLabelService (§19, §20).
   GET {wl}/shipments/{id}/label -> dados da etiqueta (LabelUrl, etc.).
   Usado na REIMPRESSÃO: nunca gera etiqueta nova, apenas recupera a
   existente (§20). Formato configurável, A4 padrão.
   ================================================================ */
import { frenetRequest, FrenetError } from './client';
import type { FrenetConfig } from './config';

function pick(o: any, ...keys: string[]) { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; }
const s = (v: unknown) => (v == null ? null : String(v));

export interface LabelData {
  shipmentId: string | null;
  labelUrl: string | null;
  declarationUrl: string | null;
  trackingUrl: string | null;
  validThrough: string | null;
  raw: unknown;
}

export const FrenetLabelService = {
  async getLabel(config: FrenetConfig, shipmentId: string, format?: string): Promise<LabelData> {
    if (!config.hasClientToken || !config.hasPartnerToken) {
      throw new FrenetError('auth', 'Recuperação de etiqueta indisponível: configure os tokens da Frenet.', 409);
    }
    const data = await frenetRequest({
      base: config.whitelabelBase, path: `/shipments/${encodeURIComponent(shipmentId)}/label`, method: 'GET',
      headers: { token: config.clientToken, 'x-partner-token': config.partnerToken, 'x-printing-format': format || config.labelFormat },
      timeoutMs: 20000, retries: 1, logLabel: 'LABEL', logContext: { shipmentId },
    });
    return {
      shipmentId: s(pick(data, 'ShipmentId', 'shipmentId')) ?? shipmentId,
      labelUrl: s(pick(data, 'LabelUrl', 'labelUrl')),
      declarationUrl: s(pick(data, 'DeclarationUrl', 'declarationUrl')),
      trackingUrl: s(pick(data, 'TrackingUrl', 'trackingUrl')),
      validThrough: s(pick(data, 'ValidThrough', 'validThrough')),
      raw: data,
    };
  },
};
