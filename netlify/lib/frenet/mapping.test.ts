import { describe, it, expect } from 'vitest';
import { trackingStatus, shipmentStatusToInternal, parseFrenetDate } from './mapping';

describe('mapping (§25)', () => {
  it('mapeia EventType -> status interno (sem inventar)', () => {
    expect(trackingStatus('0')).toBe('postado');
    expect(trackingStatus('1')).toBe('em_transito');
    expect(trackingStatus('5')).toBe('saiu_entrega');
    expect(trackingStatus('9')).toBe('entregue');
    expect(trackingStatus('2')).toBe('problema');
    expect(trackingStatus('18')).toBe('postado');
    expect(trackingStatus('999')).toBe('em_transito'); // desconhecido -> neutro
  });

  it('mapeia ShipmentStatus da Frenet', () => {
    expect(shipmentStatusToInternal(5)).toBe('postado');
    expect(shipmentStatusToInternal(7)).toBe('cancelado');
    expect(shipmentStatusToInternal(1)).toBe('etiqueta_gerada');
    expect(shipmentStatusToInternal('x')).toBeNull();
  });

  it('parseFrenetDate entende dd/MM/yyyy HH:mm', () => {
    const iso = parseFrenetDate('12/08/2026 14:30');
    expect(iso).toContain('2026-08-12T14:30');
    expect(parseFrenetDate('')).toBeNull();
    expect(parseFrenetDate('data-ruim')).toBeNull();
  });
});
