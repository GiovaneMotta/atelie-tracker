/* ================================================================
   shipping/normalize — normalização de dados antes de enviar à Frenet
   (§8). Remove máscara de CEP/telefone/CPF, normaliza valores/peso/dim.
   Funções puras e testáveis.
   ================================================================ */

export const onlyDigits = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

/** CEP -> 8 dígitos ('' se inválido). */
export function normalizeCep(cep: unknown): string {
  const d = onlyDigits(cep);
  return d.length === 8 ? d : d.slice(0, 8);
}

/** Telefone BR -> dígitos (com DDD). Remove +55 duplicado quando houver. */
export function normalizePhone(phone: unknown): string {
  let d = onlyDigits(phone);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2); // tira DDI 55 se veio junto
  return d;
}

/** CPF/CNPJ -> dígitos (11 ou 14). */
export function normalizeDocument(doc: unknown): string {
  return onlyDigits(doc);
}

/** "R$ 1.349,90" | "349,00" | 349.9 -> número. */
export function parseMoney(input: unknown): number {
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0;
  if (input == null) return 0;
  let s = String(input).replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // vírgula = decimal BR
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Peso em kg (aceita "0,5" | "500g"? -> não; espera kg). Mín. 0.001. */
export function parseWeightKg(input: unknown): number {
  const n = parseMoney(input);
  return n > 0 ? n : 0;
}

export function round2(n: number): number { return Math.round((Number(n) || 0) * 100) / 100; }
export function round3(n: number): number { return Math.round((Number(n) || 0) * 1000) / 1000; }

export function isValidDocument(doc: string): boolean {
  const d = onlyDigits(doc);
  return d.length === 11 || d.length === 14; // valida tamanho; dígito verificador é opcional aqui
}

/** UF -> 2 letras maiúsculas. */
export function normalizeUF(uf: unknown): string {
  return String(uf ?? '').trim().toUpperCase().slice(0, 2);
}
