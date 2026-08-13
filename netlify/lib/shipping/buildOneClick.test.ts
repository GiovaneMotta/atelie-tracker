import { describe, it, expect } from 'vitest';
import { buildOneClickPayload } from './buildOneClick';
import { testConfig } from '../frenet/_testConfig';

const input = {
  orderId: 'abc-123',
  orderValue: 250,
  recipient: {
    name: 'Maria Souza', document: '123.456.789-09', phone: '(99) 98888-7777',
    cep: '65900-000', street: 'Rua A', number: '123', complement: 'Apto 2',
    district: 'Centro', city: 'Imperatriz', state: 'ma',
  },
  items: [{ name: 'Saída Maternidade', sku: 'SM1', quantity: 1, unitPrice: 250, weightKg: 0.5, lengthCm: 30, widthCm: 25, heightCm: 10 }],
  volumes: [{ weightKg: 0.5, lengthCm: 30, widthCm: 25, heightCm: 10, declaredValue: 250, quantity: 1 }],
  quote: { serviceCode: '04510', serviceName: 'PAC', carrier: 'Correios', carrierCode: 'CORREIOS', price: 28.9, days: 7 },
  notifyUrl: 'https://crm.example.com/webhooks/frenet-tracking',
};

describe('buildOneClickPayload (§15)', () => {
  it('mapeia destinatário, itens, volumes e cotação com os nomes da doc', () => {
    const [shipment]: any = buildOneClickPayload(testConfig(), input);

    expect(shipment.Order.Id).toBe('abc-123');
    expect(shipment.Order.Value).toBe(250);
    expect(shipment.Order.To.Name).toBe('Maria Souza');
    expect(shipment.Order.To.Document).toBe('12345678909');       // só dígitos
    expect(shipment.Order.To.Address.ZipCode).toBe('65900000');
    expect(shipment.Order.To.Address.AddressNumber).toBe('123');
    expect(shipment.Order.To.Address.AddressQuarter).toBe('Centro');
    expect(shipment.Order.To.Address.AddressState).toBe('MA');

    expect(shipment.Volumes[0].Weight).toBe(0.5);
    expect(shipment.Quotation.ShippingServiceCode).toBe('04510');
    expect(shipment.Order.Items[0].ProductName).toBe('Saída Maternidade');
    expect(shipment.TrackingNotificationUrl).toContain('/webhooks/frenet-tracking');
  });

  it('inclui From quando NÃO usa cadastro Frenet', () => {
    const [shipment]: any = buildOneClickPayload(testConfig({ useFrenetRegistration: false }), input);
    expect(shipment.Order.From).toBeDefined();
    expect(shipment.Order.UseFrenetRegistration).toBe(false);
    expect(shipment.Order.From.Address.ZipCode).toBe('65900001');
  });

  it('omite From quando usa cadastro Frenet', () => {
    const [shipment]: any = buildOneClickPayload(testConfig({ useFrenetRegistration: true }), input);
    expect(shipment.Order.From).toBeUndefined();
    expect(shipment.Order.UseFrenetRegistration).toBe(true);
  });
});
