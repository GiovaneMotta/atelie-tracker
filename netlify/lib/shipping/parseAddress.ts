/* ================================================================
   shipping/parseAddress — extração HEURÍSTICA (grátis, sem IA) dos
   dados do destinatário a partir de um texto colado (ex.: WhatsApp).
   Puxa CEP, CPF/CNPJ, telefone, nome e número; rua/bairro/cidade/UF
   vêm depois do ViaCEP (pelo CEP). Pura e testável.
   Não inventa dados: só extrai o que está no texto.
   ================================================================ */
import { onlyDigits, isValidDocument } from './normalize';

export interface ParsedRecipient {
  name?: string; document?: string; phone?: string; cep?: string;
  street?: string; number?: string; complement?: string;
  district?: string; city?: string; state?: string; reference?: string;
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export function parseAddressHeuristic(input: string): ParsedRecipient {
  const text = String(input || '').replace(/\r/g, '');
  const out: ParsedRecipient = {};
  let work = ` ${text} `;

  // CEP -------------------------------------------------------------
  const cep = work.match(/\b(\d{5})[-.\s]?(\d{3})\b/);
  if (cep) { out.cep = cep[1] + cep[2]; work = work.replace(cep[0], ' '); }

  // Telefone (DDD; celular 9 dígitos). Rótulo ajuda, mas é opcional. --
  const phone = work.match(/(?:tel(?:efone)?|fone|whats(?:app)?|cel(?:ular)?)?\s*:?\s*(\(?\d{2}\)?\s?9?\d{4}[-.\s]?\d{4})\b/i);
  if (phone) {
    const p = onlyDigits(phone[1]);
    if (p.length >= 10 && p.length <= 11) { out.phone = p; work = work.replace(phone[1], ' '); }
  }

  // CPF/CNPJ (rótulo tem prioridade; senão, grupo de 11/14 dígitos) --
  const labeled = work.match(/(?:cpf|cnpj)\s*:?\s*([\d.\-/]{11,18})/i);
  let doc = labeled ? onlyDigits(labeled[1]) : '';
  if (!isValidDocument(doc)) {
    const cnpj = work.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
    const cpf = work.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
    doc = onlyDigits(cnpj?.[0] || cpf?.[0] || '');
  }
  if (isValidDocument(doc)) out.document = doc;

  // UF -------------------------------------------------------------
  const uf = work.match(new RegExp(`[-/,\\s]\\s*(${UFS.join('|')})\\b`));
  if (uf) out.state = uf[1].toUpperCase();

  // Rua + número por palavra-chave de logradouro --------------------
  const streetLine = text.split(/[\n,]/).map((s) => s.trim())
    .find((s) => /^(rua|r\.|av\.?|avenida|travessa|tv\.?|alameda|al\.?|estrada|rod(?:ovia)?|quadra|qd|pra[çc]a)\b/i.test(s));
  if (streetLine) {
    out.street = streetLine.replace(/\s*,?\s*n[º°o]?\.?\s*\d+.*$/i, '').replace(/\s*,\s*\d+.*$/, '').trim();
    const num = streetLine.match(/n[º°o]?\.?\s*(\d{1,6})\b/i) || streetLine.match(/,\s*(\d{1,6})\b/);
    if (num) out.number = num[1];
  }
  if (!out.number) {
    const numAny = text.match(/\bn[º°o]\.?\s*(\d{1,6})\b/i);
    if (numAny) out.number = numAny[1];
  }

  // Nome: primeira linha "de nome" (2+ palavras, só letras) ---------
  const firstLine = text.split(/\n/).map((s) => s.trim()).find(Boolean) || '';
  const nameCand = firstLine.split(/[,;:]/)[0].trim();
  if (/^[\p{L}'.\s]{4,60}$/u.test(nameCand) && nameCand.split(/\s+/).length >= 2 && !/^(rua|av|avenida)/i.test(nameCand)) {
    out.name = nameCand;
  }

  return out;
}
