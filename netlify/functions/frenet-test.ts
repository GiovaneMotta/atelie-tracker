/* ================================================================
   /api/frenet-test — "TESTAR CONEXÃO" (§5).
   Faz uma chamada REAL e barata à Frenet e devolve 🟢/🔴 com detalhe.
   • Com Partner Token: consulta a carteira (saldo/limite).
   • Só com token do cliente: faz uma cotação simples de teste.
   Nunca retorna/loga tokens.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { loadFrenetConfig, FrenetError, FrenetShipmentService, FrenetQuoteService } from '../lib/frenet';

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'POST') throw badRequest('Método não suportado.');
  await requirePermission(event, 'settings.read');

  const config = await loadFrenetConfig();

  if (!config.hasClientToken) {
    return json(event, 200, { ok: false, environment: config.environment, reason: 'Token do cliente não configurado (FRENET_API_TOKEN no Netlify).' });
  }

  try {
    if (config.hasPartnerToken) {
      const wallet = await FrenetShipmentService.getWallet(config);
      return json(event, 200, {
        ok: true, environment: config.environment, mode: 'whitelabel',
        wallet: { balance: wallet.balance, bonusBalance: wallet.bonusBalance, labelLimit: wallet.labelLimit, walletLimit: wallet.walletLimit },
        message: 'Conectado à Frenet (WhiteLabel). Carteira acessível.',
      });
    }

    // Sem Partner Token: valida ao menos a cotação (precisa de CEP de origem).
    if (config.cepOrigem.length !== 8) {
      return json(event, 200, { ok: false, environment: config.environment, mode: 'quote-only', reason: 'Configure o CEP de origem para testar a cotação.' });
    }
    const res = await FrenetQuoteService.quoteSimple(config, {
      cepOrigin: config.cepOrigem, cepDest: '01001000', declaredValue: 100,
      volumes: [{ weightKg: config.box.weight_kg, lengthCm: config.box.length_cm, widthCm: config.box.width_cm, heightCm: config.box.height_cm, quantity: 1 }],
    });
    return json(event, 200, {
      ok: true, environment: config.environment, mode: 'quote-only',
      services_found: res.options.length,
      message: `Cotação OK (${res.options.length} serviço(s)). Partner Token ausente — geração de etiqueta indisponível até configurá-lo.`,
    });
  } catch (err) {
    if (err instanceof FrenetError) {
      return json(event, 200, { ok: false, environment: config.environment, kind: err.kind, reason: err.message });
    }
    return json(event, 200, { ok: false, environment: config.environment, reason: 'Falha inesperada ao testar a conexão.' });
  }
});
