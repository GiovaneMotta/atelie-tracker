/* ================================================================
   shipping/parseAddress — extração HEURÍSTICA (grátis, sem IA) dos
   dados do destinatário a partir de um texto colado (ex.: WhatsApp).
   Puxa CEP, CPF/CNPJ, telefone, nome, número e complemento; rua/bairro/
   cidade/UF podem vir depois do ViaCEP (pelo CEP). Pura e testável.

   Entende DOIS estilos:
   - linha única "Nome, CPF, telefone, Rua X 123, Bairro, Cidade-UF, CEP";
   - linhas ROTULADAS "Nome: …", "WhatsApp: …", "CEP: …", "Número: …".
   Não inventa dados: só extrai o que está no texto.
   ================================================================ */
import { onlyDigits, isValidDocument } from './normalize';

export interface ParsedRecipient {
  name?: string; document?: string; phone?: string; cep?: string;
  street?: string; number?: string; complement?: string;
  district?: string; city?: string; state?: string; reference?: string;
}

const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

/** Mapa "Rótulo: valor" por linha, normalizado (sem acento/º/pontuação). */
function labelMap(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([^:]{1,30}?)\s*:\s*(\S.*)$/);
    if (!m) continue;
    const key = m[1].normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[º°ª.]/g, '').replace(/\s+/g, ' ').trim();
    for (const part of key.split(/[\/|]/).map((s) => s.trim())) {
      if (part && !(part in out)) out[part] = m[2].trim();
    }
  }
  return out;
}

export function parseAddressHeuristic(input: string): ParsedRecipient {
  const text = String(input || '').replace(/\r/g, '');
  const out: ParsedRecipient = {};
  let work = ` ${text} `;
  const L = labelMap(text);
  const lbl = (...keys: string[]) => { for (const k of keys) if (L[k]) return L[k]; return ''; };
  // rótulo cujo nome CONTÉM a palavra (ex.: "telefone para contato" → telefone)
  const lblLike = (...words: string[]) => { for (const k of Object.keys(L)) if (words.some((w) => k.includes(w))) return L[k]; return ''; };

  // CEP (rótulo tem prioridade) ------------------------------------
  const cep = (lbl('cep') || work).match(/\b(\d{5})[-.\s]?(\d{3})\b/);
  if (cep) { out.cep = cep[1] + cep[2]; work = work.replace(cep[0], ' '); }

  // CPF/CNPJ — ANTES do telefone e REMOVIDO do texto, senão os 11 dígitos de
  // um CPF sem pontuação viram "telefone". Rótulo tem prioridade.
  let docRaw = '';
  const labeledDoc = text.match(/(?:cpf|cnpj)\s*:?\s*(\d[\d.\-/ ]{9,18}\d)/i);
  if (labeledDoc) docRaw = labeledDoc[1];
  else {
    const cnpj = work.match(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/);
    const cpf = work.match(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/);
    docRaw = cnpj?.[0] || cpf?.[0] || '';
  }
  if (docRaw) {
    work = work.split(docRaw).join(' ');
    const doc = onlyDigits(docRaw);
    if (isValidDocument(doc)) out.document = doc;
  }

  // Telefone (DDD; celular 9 dígitos). Rótulo que CONTÉM telefone/whatsapp/…
  // tem prioridade; senão procura no texto (já sem CEP e sem documento).
  const telSrc = lblLike('telefone', 'whatsapp', 'celular', 'fone', 'contato', 'zap', 'tel', 'cel') || work;
  const phone = telSrc.match(/(\(?\d{2}\)?\s?9?\d{4}[-.\s]?\d{4})\b/);
  if (phone) {
    const p = onlyDigits(phone[1]);
    if (p.length >= 10 && p.length <= 11) { out.phone = p; work = work.replace(phone[1], ' '); }
  }

  // Bairro / Cidade / UF por rótulo --------------------------------
  if (lbl('bairro')) out.district = lbl('bairro');
  if (lbl('cidade', 'municipio')) out.city = lbl('cidade', 'municipio');
  const ufLbl = (lbl('estado', 'uf') || '').toUpperCase();
  if (UFS.includes(ufLbl)) out.state = ufLbl;

  // UF heurística (se não veio por rótulo) -------------------------
  if (!out.state) {
    const uf = work.match(new RegExp(`[-/,\\s]\\s*(${UFS.join('|')})\\b`));
    if (uf) out.state = uf[1].toUpperCase();
  }

  // Rua + número ---------------------------------------------------
  const ruaLbl = lbl('endereco', 'rua', 'avenida', 'av', 'logradouro', 'end');
  const segs = text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  let streetLine = ruaLbl;
  let streetIdx = -1;
  if (!streetLine) {
    streetIdx = segs.findIndex((s) => /^(rua|r\.|av\.?|avenida|travessa|tv\.?|alameda|al\.?|estrada|rod(?:ovia)?|quadra|qd|pra[çc]a)\b/i.test(s));
    if (streetIdx >= 0) streetLine = segs[streetIdx];
  }
  if (streetLine) {
    out.street = streetLine
      .replace(/\s*,?\s*n[º°o]?\.?\s*\d+.*$/i, '')   // "nº 123 ..."
      .replace(/\s*,\s*\d+.*$/, '')                   // ", 123 ..."
      .replace(/\s+\d{1,6}\s*$/, '')                  // "Rua X 123" (número solto no fim)
      .trim();
    const num = streetLine.match(/n[º°o]?\.?\s*(\d{1,6})\b/i)
      || streetLine.match(/,\s*(\d{1,6})\b/)
      || streetLine.match(/\s(\d{1,6})\s*$/);
    if (num) out.number = num[1];
    // Número órfão no segmento seguinte: "Rua Grande, 456" (a vírgula separou).
    if (!out.number && streetIdx >= 0 && segs[streetIdx + 1]) {
      const m2 = segs[streetIdx + 1].match(/^\s*(\d{1,6})\b/);
      if (m2) out.number = m2[1];
    }
  }
  // Número por rótulo tem prioridade.
  const numLbl = lbl('numero', 'num', 'n');
  if (numLbl) { const d = numLbl.match(/\d{1,6}[A-Za-z]?/); if (d) out.number = d[0]; }

  // Complemento (rótulo ou palavra-chave: apto/bloco/casa/…) -------
  const compLbl = lbl('complemento', 'compl', 'comp');
  if (compLbl) out.complement = compLbl;
  else {
    const cm = text.match(/\b(apto?\.?|ap\.?|apartamento|bloco|bl\.?|casa|lote|lt\.?|quadra|qd\.?|fundos?|sala|andar)\b[^\n,]*/i);
    if (cm) out.complement = cm[0].trim();
  }

  // Nome: rótulo, senão a primeira linha "de nome" (2+ palavras, letras) --
  const nomeLbl = lbl('nome', 'cliente', 'comprador', 'compradora', 'nome completo', 'nome do cliente');
  if (nomeLbl && /^[\p{L}'.\s]{2,60}$/u.test(nomeLbl)) {
    out.name = nomeLbl.replace(/\s+/g, ' ').trim();
  } else {
    const firstLine = text.split(/\n/).map((s) => s.trim()).find(Boolean) || '';
    const nameCand = firstLine.split(/[,;:]/)[0].trim();
    if (/^[\p{L}'.\s]{4,60}$/u.test(nameCand) && nameCand.split(/\s+/).length >= 2 && !/^(rua|av|avenida)/i.test(nameCand)) {
      out.name = nameCand;
    }
  }

  return out;
}
