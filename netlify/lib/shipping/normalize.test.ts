import { describe, it, expect } from 'vitest';
import { onlyDigits, normalizeCep, normalizePhone, normalizeDocument, parseMoney, isValidDocument, normalizeUF } from './normalize';

describe('normalize', () => {
  it('onlyDigits remove máscara', () => {
    expect(onlyDigits('65.900-000')).toBe('65900000');
    expect(onlyDigits('(99) 98888-7777')).toBe('99988887777');
  });

  it('normalizeCep mantém 8 dígitos', () => {
    expect(normalizeCep('65900-000')).toBe('65900000');
    expect(normalizeCep('123')).toBe('123');
  });

  it('normalizePhone remove DDI 55 quando excede 11 dígitos', () => {
    expect(normalizePhone('+55 (99) 98888-7777')).toBe('99988887777');
    expect(normalizePhone('(99) 3222-1111')).toBe('9932221111');
  });

  it('normalizeDocument só dígitos', () => {
    expect(normalizeDocument('123.456.789-09')).toBe('12345678909');
  });

  it('parseMoney entende formato BR', () => {
    expect(parseMoney('R$ 1.349,90')).toBe(1349.9);
    expect(parseMoney('349,00')).toBe(349);
    expect(parseMoney('349.9')).toBe(349.9);
    expect(parseMoney(28.9)).toBe(28.9);
    expect(parseMoney('')).toBe(0);
  });

  it('isValidDocument valida tamanho de CPF/CNPJ', () => {
    expect(isValidDocument('12345678909')).toBe(true);       // CPF
    expect(isValidDocument('12345678000199')).toBe(true);    // CNPJ
    expect(isValidDocument('123')).toBe(false);
  });

  it('normalizeUF -> 2 letras maiúsculas', () => {
    expect(normalizeUF('ma')).toBe('MA');
    expect(normalizeUF('São Paulo')).toBe('SÃ');
  });
});
