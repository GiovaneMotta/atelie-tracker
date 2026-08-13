import { describe, it, expect, vi, afterEach } from 'vitest';
import { FrenetQuoteService } from './quote';
import { testConfig } from './_testConfig';

function mockFetch(status: number, body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: status < 300, status, text: async () => JSON.stringify(body) })));
}

const input = {
  cepOrigin: '65900000', cepDest: '01001000', declaredValue: 250,
  volumes: [{ weightKg: 0.5, lengthCm: 30, widthCm: 25, heightCm: 10, quantity: 1 }],
};

describe('FrenetQuoteService', () => {
  afterEach(() => vi.restoreAllMocks());

  it('quoteShipment (WhiteLabel) parseia e ordena por preço', async () => {
    mockFetch(200, {
      SessionId: 'sess-1',
      Quotations: [
        { Carrier: 'Correios', CarrierCode: 'C', ShippingServiceCode: '04014', ShippingServiceName: 'SEDEX', ShippingPrice: 42.9, DeliveryTime: 4 },
        { Carrier: 'Correios', CarrierCode: 'C', ShippingServiceCode: '04510', ShippingServiceName: 'PAC', ShippingPrice: 28.9, DeliveryTime: 7 },
        { Error: true, Msg: 'sem atendimento' },
      ],
    });
    const res = await FrenetQuoteService.quoteShipment(testConfig(), input);
    expect(res.sessionId).toBe('sess-1');
    expect(res.options).toHaveLength(2);
    expect(res.options[0].serviceCode).toBe('04510');   // menor preço primeiro
    expect(res.options[0].price).toBe(28.9);
    expect(res.options[1].serviceName).toBe('SEDEX');
  });

  it('quoteShipment exige Partner Token', async () => {
    await expect(FrenetQuoteService.quoteShipment(testConfig({ hasPartnerToken: false }), input))
      .rejects.toMatchObject({ kind: 'auth' });
  });

  it('quoteSimple parseia ShippingSevicesArray', async () => {
    mockFetch(200, {
      ShippingSevicesArray: [
        { Carrier: 'Correios', ServiceCode: '04510', ServiceDescription: 'PAC', ShippingPrice: '28,90', DeliveryTime: '7' },
        { Carrier: 'Correios', ServiceCode: '04014', ServiceDescription: 'SEDEX', ShippingPrice: '42,90', DeliveryTime: '4', Error: false },
      ],
    });
    const res = await FrenetQuoteService.quoteSimple(testConfig({ hasPartnerToken: false }), input);
    expect(res.source).toBe('simple');
    expect(res.options[0].price).toBe(28.9);
    expect(res.options[0].serviceCode).toBe('04510');
  });
});
