/* ================================================================
   shipping/validateAddress — validação de destinatário/endereço (§9).
   Regras críticas do usuário:
   • Sem NÚMERO do imóvel -> NÃO gerar etiqueta.
   • A referência NÃO substitui o número.
   • Faltando qualquer obrigatório -> bloquear e dizer exatamente o quê.
   Retorna erros (bloqueiam) e avisos (não bloqueiam, mas alertam).
   ================================================================ */
import { normalizeCep, normalizeUF, isValidDocument, onlyDigits } from './normalize';

export interface RecipientInput {
  name?: string; document?: string; phone?: string; email?: string;
  cep?: string; street?: string; number?: string; complement?: string;
  district?: string; city?: string; state?: string; reference?: string;
}
export interface FieldIssue { field: string; message: string; }
export interface ValidationResult { ok: boolean; errors: FieldIssue[]; warnings: FieldIssue[]; }

const blank = (v: unknown) => String(v ?? '').trim() === '';

export function validateRecipient(r: RecipientInput): ValidationResult {
  const errors: FieldIssue[] = [];
  const warnings: FieldIssue[] = [];

  if (blank(r.name)) errors.push({ field: 'name', message: 'Informe o nome completo do destinatário.' });

  const cep = normalizeCep(r.cep);
  if (cep.length !== 8) errors.push({ field: 'cep', message: 'CEP inválido (precisa de 8 dígitos).' });

  if (blank(r.street)) errors.push({ field: 'street', message: 'Informe o endereço (rua/avenida).' });

  // Número é obrigatório e a referência não o substitui (§9).
  if (blank(r.number)) {
    errors.push({
      field: 'number',
      message: blank(r.reference)
        ? 'Informe o número do imóvel.'
        : 'Informe o número do imóvel. A referência não substitui o número.',
    });
  } else if (/^s\/?n$/i.test(String(r.number).trim())) {
    // "S/N" é aceito, mas alertamos para conferência.
    warnings.push({ field: 'number', message: 'Número informado como "S/N" — confira antes de postar.' });
  }

  if (blank(r.district)) errors.push({ field: 'district', message: 'Informe o bairro.' });
  if (blank(r.city)) errors.push({ field: 'city', message: 'Informe a cidade.' });

  const uf = normalizeUF(r.state);
  if (uf.length !== 2) errors.push({ field: 'state', message: 'Informe a UF (2 letras).' });

  // Documento: recomendado para postagem. Se informado, precisa ser válido.
  if (blank(r.document)) {
    warnings.push({ field: 'document', message: 'CPF/CNPJ do destinatário não informado (recomendado para postagem).' });
  } else if (!isValidDocument(String(r.document))) {
    errors.push({ field: 'document', message: 'CPF/CNPJ inválido (11 ou 14 dígitos).' });
  }

  if (blank(r.phone)) {
    warnings.push({ field: 'phone', message: 'Telefone do destinatário não informado (recomendado).' });
  } else if (onlyDigits(r.phone).length < 10) {
    warnings.push({ field: 'phone', message: 'Telefone parece incompleto (confira o DDD).' });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Valida o remetente para a postagem (só quando não usa cadastro Frenet). */
export function validateSender(s: RecipientInput): ValidationResult {
  const res = validateRecipient({ ...s });
  // Remetente também precisa de documento válido para postar.
  if (blank(s.document)) res.errors.push({ field: 'sender.document', message: 'Informe o CPF/CNPJ do remetente nas Configurações.' });
  return { ...res, ok: res.errors.length === 0 };
}
