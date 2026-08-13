import { describe, it, expect } from 'vitest';
import { validateRecipient } from './validateAddress';

const base = {
  name: 'Maria', document: '12345678909', phone: '99988887777',
  cep: '65900000', street: 'Rua A', number: '123', district: 'Centro', city: 'Imperatriz', state: 'MA',
};

describe('validateRecipient (§9)', () => {
  it('aceita endereço completo', () => {
    const r = validateRecipient(base);
    expect(r.ok).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('bloqueia quando falta o número', () => {
    const r = validateRecipient({ ...base, number: '' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.field === 'number')).toBe(true);
  });

  it('referência NÃO substitui o número', () => {
    const r = validateRecipient({ ...base, number: '', reference: 'Perto da praça' });
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => e.field === 'number');
    expect(err?.message.toLowerCase()).toContain('referência não substitui');
  });

  it('bloqueia CPF/CNPJ inválido, mas só avisa se ausente', () => {
    expect(validateRecipient({ ...base, document: '123' }).ok).toBe(false);
    const semDoc = validateRecipient({ ...base, document: '' });
    expect(semDoc.ok).toBe(true);
    expect(semDoc.warnings.some((w) => w.field === 'document')).toBe(true);
  });

  it('exige nome, cep, cidade e UF', () => {
    const r = validateRecipient({ ...base, name: '', cep: '123', city: '', state: 'M' });
    const fields = r.errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['name', 'cep', 'city', 'state']));
  });
});
