/* ================================================================
   shipping/volumes — consolida itens em volumes e calcula peso (§29).
   Primeira versão: 1 volume padrão (caixa configurada), mas a estrutura
   já aceita múltiplos volumes explícitos.
   ================================================================ */
import { round3 } from './normalize';
import type { FrenetBox } from '../frenet/config';

export interface ShipItem {
  name: string; sku?: string | null; quantity: number; unitPrice: number;
  weightKg?: number | null; lengthCm?: number | null; widthCm?: number | null; heightCm?: number | null;
}
export interface ShipVolume {
  weightKg: number; lengthCm: number; widthCm: number; heightCm: number;
  declaredValue?: number; quantity: number;
}

/** Peso total dos itens (kg). Se nenhum item tem peso, retorna 0. */
export function totalItemsWeight(items: ShipItem[]): number {
  return round3(items.reduce((s, it) => s + (Number(it.weightKg) || 0) * Math.max(1, it.quantity || 1), 0));
}

/**
 * Deriva os volumes do envio. Se `explicit` vier preenchido, usa-o.
 * Caso contrário, monta 1 volume com a caixa padrão e o peso consolidado
 * (peso dos itens quando houver; senão o peso da caixa padrão).
 */
export function deriveVolumes(items: ShipItem[], box: FrenetBox, declaredValue: number, explicit?: ShipVolume[]): ShipVolume[] {
  if (explicit && explicit.length) {
    return explicit.map((v) => ({
      weightKg: Number(v.weightKg) || box.weight_kg,
      lengthCm: Number(v.lengthCm) || box.length_cm,
      widthCm: Number(v.widthCm) || box.width_cm,
      heightCm: Number(v.heightCm) || box.height_cm,
      declaredValue: v.declaredValue ?? undefined,
      quantity: Math.max(1, v.quantity || 1),
    }));
  }
  const itemsWeight = totalItemsWeight(items);
  return [{
    weightKg: itemsWeight > 0 ? itemsWeight : box.weight_kg,
    lengthCm: box.length_cm, widthCm: box.width_cm, heightCm: box.height_cm,
    declaredValue: declaredValue > 0 ? declaredValue : undefined,
    quantity: 1,
  }];
}

/** Converte volumes -> formato de cotação (QuoteVolume). */
export function volumesToQuote(volumes: ShipVolume[]) {
  return volumes.map((v) => ({
    weightKg: v.weightKg, lengthCm: v.lengthCm, widthCm: v.widthCm, heightCm: v.heightCm,
    quantity: v.quantity, declaredValue: v.declaredValue,
  }));
}
