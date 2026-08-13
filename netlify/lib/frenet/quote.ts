/* ================================================================
   frenet/quote — FrenetQuoteService (§10, §11, §13).
   Duas fontes REAIS, nunca simulação:
   • quoteShipment(): WhiteLabel POST /quotes -> retorna ShippingServiceCode
     (serviço POSTÁVEL, usado depois na etiqueta OneClick §13). Exige
     Partner Token.
   • quoteSimple(): POST api.frenet.com.br/shipping/quote -> cotação de
     vitrine (só token do cliente). Fallback quando não há Partner Token.
   Só exibimos serviços efetivamente retornados pela API (§11).
   ================================================================ */
import { frenetRequest, FrenetError } from './client';
import type { FrenetConfig } from './config';

export interface QuoteVolume {
  weightKg: number; lengthCm: number; widthCm: number; heightCm: number;
  quantity: number; declaredValue?: number; isFragile?: boolean;
}
export interface QuoteInput {
  cepOrigin?: string;
  cepDest: string;
  declaredValue: number;
  volumes: QuoteVolume[];
  services?: { declaredValue?: boolean; receiptNotification?: boolean; ownHand?: boolean };
}
export interface QuoteOption {
  carrier: string;
  carrierCode: string | null;
  serviceCode: string;       // ShippingServiceCode (identificador de serviço)
  serviceName: string;
  price: number;
  days: number | null;
  competitorPrice: number | null;
  services: unknown;
  source: 'whitelabel' | 'simple';
}
export interface QuoteResult {
  sessionId: string | null;
  source: 'whitelabel' | 'simple';
  options: QuoteOption[];
}

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
const num = (v: unknown) => { const n = Number(String(v ?? '').toString().replace(',', '.')); return Number.isFinite(n) ? n : 0; };
function pick(o: any, ...keys: string[]) { for (const k of keys) if (o && o[k] != null) return o[k]; return undefined; }

/** Expande volumes por quantidade (WhiteLabel cota 1 volume por entrada). */
function expandVolumes(vols: QuoteVolume[]): QuoteVolume[] {
  const out: QuoteVolume[] = [];
  for (const v of vols) {
    const q = Math.max(1, Math.floor(v.quantity || 1));
    for (let i = 0; i < q; i++) out.push({ ...v, quantity: 1 });
  }
  return out.length ? out : [{ weightKg: 0.5, lengthCm: 30, widthCm: 25, heightCm: 10, quantity: 1 }];
}

export const FrenetQuoteService = {
  /** Cotação WhiteLabel (serviços postáveis). Requer Partner Token. */
  async quoteShipment(config: FrenetConfig, input: QuoteInput): Promise<QuoteResult> {
    const origin = digits(input.cepOrigin || config.cepOrigem);
    const dest = digits(input.cepDest);
    if (origin.length !== 8) throw new FrenetError('invalid', 'CEP de origem inválido. Configure o CEP de origem.', 422);
    if (dest.length !== 8) throw new FrenetError('invalid', 'CEP de destino inválido.', 422);
    if (!config.hasPartnerToken) throw new FrenetError('auth', 'Cotação de postagem indisponível: configure o Partner Token da Frenet.', 409);

    const body = {
      SenderZipCode: origin,
      RecipientZipCode: dest,
      RecipientCountry: 'BR',
      ShipmentItemValue: input.declaredValue > 0 ? input.declaredValue : 0,
      Volumes: expandVolumes(input.volumes).map((v) => ({
        Weight: num(v.weightKg), Length: num(v.lengthCm), Height: num(v.heightCm),
        Width: num(v.widthCm), IsFragile: Boolean(v.isFragile),
      })),
      Services: {
        DeclaredValue: Boolean(input.services?.declaredValue),
        ReceiptNotification: Boolean(input.services?.receiptNotification),
        OwnHand: Boolean(input.services?.ownHand),
      },
    };

    const data = await frenetRequest({
      base: config.whitelabelBase, path: '/quotes', method: 'POST',
      headers: { token: config.clientToken, 'x-partner-token': config.partnerToken },
      body, timeoutMs: 20000, retries: 1, logLabel: 'QUOTE',
      logContext: { env: config.environment, dest: dest.slice(0, 5) + '***' },
    });

    const quotations: any[] = Array.isArray(pick(data, 'Quotations', 'quotations')) ? pick(data, 'Quotations', 'quotations') : [];
    const options: QuoteOption[] = quotations
      .filter((q) => !pick(q, 'Error', 'error'))
      .map((q): QuoteOption => ({
        carrier: String(pick(q, 'Carrier', 'carrier') ?? 'Correios'),
        carrierCode: pick(q, 'CarrierCode', 'carrierCode') ?? null,
        serviceCode: String(pick(q, 'ShippingServiceCode', 'shippingServiceCode') ?? ''),
        serviceName: String(pick(q, 'ShippingServiceName', 'shippingServiceName') ?? pick(q, 'Carrier', 'carrier') ?? 'Envio'),
        price: num(pick(q, 'ShippingPrice', 'shippingPrice')),
        days: (() => { const d = parseInt(String(pick(q, 'DeliveryTime', 'deliveryTime') ?? ''), 10); return Number.isFinite(d) ? d : null; })(),
        competitorPrice: (() => { const p = pick(q, 'ShippingCompetitorPrice', 'shippingCompetitorPrice'); return p == null ? null : num(p); })(),
        services: pick(q, 'Services', 'services') ?? null,
        source: 'whitelabel',
      }))
      .filter((o) => o.serviceCode && o.price > 0)
      .sort((a, b) => a.price - b.price);

    return { sessionId: pick(data, 'SessionId', 'sessionId') ?? null, source: 'whitelabel', options };
  },

  /** Cotação simples (vitrine) — só token do cliente. Fallback/homologação. */
  async quoteSimple(config: FrenetConfig, input: QuoteInput): Promise<QuoteResult> {
    const origin = digits(input.cepOrigin || config.cepOrigem);
    const dest = digits(input.cepDest);
    if (dest.length !== 8) throw new FrenetError('invalid', 'CEP de destino inválido.', 422);
    if (!config.hasClientToken) throw new FrenetError('auth', 'Token do cliente Frenet não configurado.', 409);

    const items = expandVolumes(input.volumes).map((v) => ({
      Height: num(v.heightCm), Width: num(v.widthCm), Length: num(v.lengthCm),
      Weight: num(v.weightKg), Quantity: 1,
    }));
    const body = {
      SellerCEP: origin,
      RecipientCEP: dest,
      ShipmentInvoiceValue: input.declaredValue > 0 ? input.declaredValue : 100,
      ShippingItemArray: items,
      RecipientCountry: 'BR',
    };

    const data = await frenetRequest({
      base: config.quoteBase, path: '/shipping/quote', method: 'POST',
      headers: { token: config.clientToken },
      body, timeoutMs: 20000, retries: 1, logLabel: 'QUOTE',
      logContext: { env: config.environment, dest: dest.slice(0, 5) + '***' },
    });

    const services: any[] = Array.isArray(data?.ShippingSevicesArray) ? data.ShippingSevicesArray : [];
    const options: QuoteOption[] = services
      .filter((s) => !s.Error && s.ShippingPrice)
      .map((s): QuoteOption => ({
        carrier: String(s.Carrier ?? 'Correios'),
        carrierCode: s.CarrierCode ?? null,
        serviceCode: String(s.ServiceCode ?? ''),
        serviceName: String(s.ServiceDescription ?? s.Carrier ?? 'Envio'),
        price: num(s.ShippingPrice),
        days: (() => { const d = parseInt(String(s.DeliveryTime ?? ''), 10); return Number.isFinite(d) ? d : null; })(),
        competitorPrice: null,
        services: null,
        source: 'simple',
      }))
      .filter((o) => o.price > 0)
      .sort((a, b) => a.price - b.price);

    return { sessionId: null, source: 'simple', options };
  },
};
