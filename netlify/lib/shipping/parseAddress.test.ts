import { describe, it, expect } from 'vitest';
import { parseAddressHeuristic } from './parseAddress';

describe('parseAddressHeuristic (modo grátis)', () => {
  it('extrai de uma mensagem organizada', () => {
    const r = parseAddressHeuristic('Maria Silva, CPF 123.456.789-09, (99) 98888-7777, Rua das Flores 123, Centro, Imperatriz-MA, 65900-000');
    expect(r.name).toBe('Maria Silva');
    expect(r.document).toBe('12345678909');
    expect(r.phone).toBe('99988887777');
    expect(r.cep).toBe('65900000');
    expect(r.number).toBe('123');
    expect(r.state).toBe('MA');
  });

  it('pega CEP e telefone mesmo sem rótulo', () => {
    const r = parseAddressHeuristic('Envio para 65901-500 fone 99 3111-2222');
    expect(r.cep).toBe('65901500');
    expect(r.phone).toBe('9931112222');
  });

  it('reconhece número com "nº"', () => {
    const r = parseAddressHeuristic('Av. Getúlio Vargas nº 456\nBairro Novo');
    expect(r.number).toBe('456');
    expect(r.street?.toLowerCase()).toContain('getúlio');
  });

  it('não inventa CPF quando ausente/ inválido', () => {
    const r = parseAddressHeuristic('João Pedro, Rua A 10, 65900-000');
    expect(r.document).toBeUndefined();
  });

  it('entende formato ROTULADO multi-linha do WhatsApp (nome, número, complemento)', () => {
    const r = parseAddressHeuristic([
      'Oi boa tarde! Seguem meus dados:',
      'Nome: Mariana Teste CRM',
      'Whatsapp: (98) 98888-7766',
      'CEP: 65020-570',
      'Rua Grande, 456 - apto 302',
      'Centro - São Luís/MA',
    ].join('\n'));
    expect(r.name).toBe('Mariana Teste CRM');
    expect(r.phone).toBe('98988887766');
    expect(r.cep).toBe('65020570');
    expect(r.number).toBe('456');
    expect(r.complement?.toLowerCase()).toContain('apto 302');
    expect(r.state).toBe('MA');
  });

  it('não confunde CPF sem pontuação com telefone; usa o rótulo "Telefone para contato"', () => {
    const r = parseAddressHeuristic([
      'CEP: 30421-422',
      'CPF: 10549523618',
      'Endereço: rua santos, 1495, ap 302',
      'Telefone para contato: 31985480518',
    ].join('\n'));
    expect(r.phone).toBe('31985480518');
    expect(r.number).toBe('1495');
    expect(r.complement?.toLowerCase()).toContain('ap 302');
  });
});
