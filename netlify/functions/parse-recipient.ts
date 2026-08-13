/* ================================================================
   /api/parse-recipient — "cole a mensagem e o sistema preenche".
   POST { text } -> extrai destinatário: heurística (grátis) + IA
   (quando houver ANTHROPIC_API_KEY) + ViaCEP (endereço pelo CEP).
   NÃO cria envio; só devolve os campos para a tela preencher.
   Permissão: shipping.quote (quem cota/cria envio).
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { logIntegration } from '../lib/log';
import { parseAddressHeuristic, type ParsedRecipient } from '../lib/shipping/parseAddress';
import { aiExtractRecipient, aiConfigured } from '../lib/shipping/aiExtract';
import { lookupCep } from '../lib/shipping/cep';
import { normalizeCep, normalizePhone, normalizeDocument, normalizeUF, onlyDigits } from '../lib/shipping/normalize';

const REQUIRED = ['name', 'cep', 'street', 'number', 'district', 'city', 'state'] as const;

/** IA/heurística: campos não-vazios da fonte sobrescrevem a base. */
function merge(base: ParsedRecipient, over: ParsedRecipient | null): ParsedRecipient {
  if (!over) return base;
  const out = { ...base };
  for (const k of Object.keys(over) as (keyof ParsedRecipient)[]) {
    const v = over[k]; if (v && String(v).trim()) out[k] = v as any;
  }
  return out;
}

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'POST') throw badRequest('Método não suportado.');
  await requirePermission(event, 'shipping.quote');

  const body = parseBody<{ text?: string }>(event);
  const text = String(body.text || '').trim();
  if (text.length < 5) throw badRequest('Cole a mensagem com os dados do cliente.');

  // 1) Heurística (grátis) sempre.
  let data = parseAddressHeuristic(text);
  let source: 'heuristica' | 'ia' = 'heuristica';

  // 2) IA por cima (quando configurada). Falha → mantém heurística.
  if (aiConfigured()) {
    try {
      const ai = await aiExtractRecipient(text);
      if (ai) { data = merge(data, ai); source = 'ia'; }
    } catch (err) {
      await logIntegration('AI', 'warn', 'Extração por IA falhou; usando heurística', { detail: String(err).slice(0, 160) });
    }
  }

  // 3) ViaCEP: o CEP é a fonte da verdade do endereço.
  let cepLookup = false;
  const cep = normalizeCep(data.cep);
  if (cep.length === 8) {
    const c = await lookupCep(cep);
    if (c) {
      data.cep = c.cep;
      if (c.street) data.street = c.street;
      if (c.district) data.district = c.district;
      if (c.city) data.city = c.city;
      if (c.state) data.state = c.state;
      cepLookup = true;
    }
  }

  const recipient = {
    name: (data.name || '').trim(),
    document: normalizeDocument(data.document),
    phone: normalizePhone(data.phone),
    email: '',
    cep: normalizeCep(data.cep),
    street: (data.street || '').trim(),
    number: (data.number || '').trim(),
    complement: (data.complement || '').trim(),
    district: (data.district || '').trim(),
    city: (data.city || '').trim(),
    state: normalizeUF(data.state),
    reference: (data.reference || '').trim(),
  };

  const missing = REQUIRED.filter((k) => !String((recipient as any)[k]).trim());
  const filled = Object.entries(recipient).filter(([, v]) => String(v).trim()).map(([k]) => k);

  return json(event, 200, {
    recipient,
    source,               // 'ia' | 'heuristica'
    ai_available: aiConfigured(),
    cep_lookup: cepLookup,
    filled,
    missing,              // campos obrigatórios que faltaram (destaque na tela)
    warnings: onlyDigits(recipient.document) && ![11, 14].includes(onlyDigits(recipient.document).length)
      ? ['CPF/CNPJ parece incompleto — confira.'] : [],
  });
});
