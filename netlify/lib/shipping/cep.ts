/* ================================================================
   shipping/cep — consulta de CEP (ViaCEP) no BACKEND. Preenche
   rua/bairro/cidade/UF a partir do CEP. Dado público; sem token.
   Timeout curto; falha silenciosa (retorna null).
   ================================================================ */
import { onlyDigits } from './normalize';

export interface CepResult { cep: string; street: string; district: string; city: string; state: string; }

export async function lookupCep(cepRaw: unknown): Promise<CepResult | null> {
  const cep = onlyDigits(cepRaw);
  if (cep.length !== 8) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: controller.signal });
    if (!res.ok) return null;
    const d: any = await res.json().catch(() => ({}));
    if (!d || d.erro) return null;
    return {
      cep,
      street: d.logradouro || '',
      district: d.bairro || '',
      city: d.localidade || '',
      state: String(d.uf || '').toUpperCase().slice(0, 2),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
