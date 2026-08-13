import type { FrenetConfig } from './config';

/** Config Frenet de teste (sem IO). Tokens fictícios — nunca reais. */
export function testConfig(over: Partial<FrenetConfig> = {}): FrenetConfig {
  return {
    environment: 'homologacao',
    clientToken: 'CLIENT_TEST',
    partnerToken: 'PARTNER_TEST',
    hasClientToken: true,
    hasPartnerToken: true,
    quoteBase: 'https://api.frenet.com.br',
    whitelabelBase: 'https://whitelabel-hml.frenet.dev/v1',
    cepOrigem: '65900000',
    labelFormat: 'A4',
    useFrenetRegistration: false,
    box: { weight_kg: 0.5, length_cm: 30, width_cm: 25, height_cm: 10 },
    sender: {
      name: 'Ateliê da Lili', document: '12345678000199', phone: '99988887777', email: 'lili@ex.com',
      cep: '65900001', street: 'Rua Remetente', number: '10', complement: '', district: 'Centro',
      city: 'Imperatriz', state: 'MA',
    },
    webhook: { tokenName: 'x-frenet-webhook-token', tokenValue: 'SECRET', url: 'https://crm.example.com/webhooks/frenet-tracking' },
    ...over,
  };
}
