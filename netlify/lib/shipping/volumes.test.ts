import { describe, it, expect } from 'vitest';
import { deriveVolumes, totalItemsWeight, type ShipItem } from './volumes';

const box = { weight_kg: 0.5, length_cm: 30, width_cm: 25, height_cm: 10 };

describe('volumes (§29)', () => {
  it('soma o peso dos itens', () => {
    const items: ShipItem[] = [
      { name: 'Saída', quantity: 2, unitPrice: 100, weightKg: 0.5, lengthCm: null, widthCm: null, heightCm: null },
      { name: 'Manta', quantity: 1, unitPrice: 50, weightKg: 0.3, lengthCm: null, widthCm: null, heightCm: null },
    ];
    expect(totalItemsWeight(items)).toBeCloseTo(1.3, 3);
  });

  it('deriva 1 volume com a caixa padrão e peso consolidado', () => {
    const items: ShipItem[] = [{ name: 'X', quantity: 2, unitPrice: 100, weightKg: 0.4, lengthCm: null, widthCm: null, heightCm: null }];
    const vols = deriveVolumes(items, box, 200);
    expect(vols).toHaveLength(1);
    expect(vols[0].weightKg).toBeCloseTo(0.8, 3);
    expect(vols[0].lengthCm).toBe(30);
    expect(vols[0].declaredValue).toBe(200);
  });

  it('usa o peso da caixa quando itens não têm peso', () => {
    const items: ShipItem[] = [{ name: 'X', quantity: 1, unitPrice: 10, weightKg: null, lengthCm: null, widthCm: null, heightCm: null }];
    const vols = deriveVolumes(items, box, 0);
    expect(vols[0].weightKg).toBe(0.5);
  });

  it('respeita volumes explícitos', () => {
    const explicit = [{ weightKg: 2, lengthCm: 40, widthCm: 30, heightCm: 20, quantity: 1 }];
    const vols = deriveVolumes([], box, 100, explicit);
    expect(vols[0].weightKg).toBe(2);
    expect(vols[0].lengthCm).toBe(40);
  });
});
