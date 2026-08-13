/* ================================================================
   shipping/aiExtract — extração de destinatário via IA (Anthropic),
   provedor trocável (reusa AIService §6). Só roda se houver chave.
   A IA NÃO inventa: instruída a devolver vazio quando não achar.
   O endereço final é validado pelo ViaCEP (CEP é a fonte da verdade).
   ================================================================ */
import { getAIProvider } from '../services/AIService';
import type { ParsedRecipient } from './parseAddress';

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM = [
  'Você extrai dados de um DESTINATÁRIO para envio postal a partir de uma mensagem em português do Brasil.',
  'Responda SOMENTE com um JSON válido (sem markdown, sem comentários), com exatamente estas chaves:',
  'name, document, phone, cep, street, number, complement, district, city, state, reference.',
  '- document = CPF ou CNPJ apenas com dígitos.',
  '- phone = apenas dígitos com DDD.',
  '- cep = apenas dígitos (8).',
  '- state = UF com 2 letras.',
  '- Use string vazia ("") quando o dado NÃO estiver na mensagem.',
  'NUNCA invente dados que não estão no texto. Não complete endereço por conta própria.',
].join(' ');

function extractJson(text: string): Record<string, unknown> | null {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

const str = (v: unknown) => (v == null ? '' : String(v).trim());

/** Retorna os campos extraídos pela IA, ou null se não configurada/falhar. */
export async function aiExtractRecipient(text: string): Promise<ParsedRecipient | null> {
  if (!aiConfigured()) return null;
  const provider = getAIProvider();
  const res = await provider.chat({
    system: SYSTEM,
    messages: [{ role: 'user', content: text.slice(0, 4000) }],
    maxTokens: 500,
  });
  const json = extractJson(res.text);
  if (!json) return null;

  const out: ParsedRecipient = {};
  const map: (keyof ParsedRecipient)[] = ['name', 'document', 'phone', 'cep', 'street', 'number', 'complement', 'district', 'city', 'state', 'reference'];
  for (const k of map) { const v = str(json[k]); if (v) (out as any)[k] = v; }
  return out;
}
