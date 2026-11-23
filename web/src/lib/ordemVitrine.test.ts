/* ================================================================
   Regra de mover peças na "Ordem da vitrine". O que importa garantir:
   reordenar uma categoria nunca tira do lugar as peças das outras.
   ================================================================ */
import { describe, it, expect } from 'vitest';
import { moverNoRecorte } from './ordemVitrine';

interface P { sku: string; cat: string }
const p = (sku: string, cat: string): P => ({ sku, cat });
const skus = (l: P[]) => l.map((x) => x.sku);
const menino = (x: P) => x.cat === 'menino';

/* lista inteira como o site guarda: categorias misturadas */
const LISTA = [p('G1', 'menina'), p('M1', 'menino'), p('G2', 'menina'), p('M2', 'menino'), p('A1', 'acess'), p('M3', 'menino')];

describe('moverNoRecorte', () => {
  it('sobe uma peça dentro da categoria sem tirar as outras do lugar', () => {
    const nova = moverNoRecorte(LISTA, menino, 2, 0);           // M3 para o topo de Menino
    expect(skus(nova)).toEqual(['G1', 'M3', 'G2', 'M1', 'A1', 'M2']);
    /* Menina e Acessórios continuam exatamente nas mesmas casas */
    [0, 2, 4].forEach((i) => expect(nova[i]).toBe(LISTA[i]));
  });

  it('desce uma peça e ela fica na posição pedida', () => {
    const nova = moverNoRecorte(LISTA, menino, 0, 2);           // M1 para o fim de Menino
    expect(skus(nova.filter(menino))).toEqual(['M2', 'M3', 'M1']);
    expect(skus(nova)).toEqual(['G1', 'M2', 'G2', 'M3', 'A1', 'M1']);
  });

  it('posição fora do limite vai para a ponta', () => {
    expect(skus(moverNoRecorte(LISTA, menino, 1, -5).filter(menino))).toEqual(['M2', 'M1', 'M3']);
    expect(skus(moverNoRecorte(LISTA, menino, 0, 99).filter(menino))).toEqual(['M2', 'M3', 'M1']);
  });

  it('movimento sem efeito ou inválido devolve a mesma lista', () => {
    expect(moverNoRecorte(LISTA, menino, 1, 1)).toBe(LISTA);
    expect(moverNoRecorte(LISTA, menino, -1, 0)).toBe(LISTA);
    expect(moverNoRecorte(LISTA, menino, 3, 0)).toBe(LISTA);   // Menino só tem 3
    expect(moverNoRecorte(LISTA, menino, 0.5, 0)).toBe(LISTA);
  });

  it('não altera a lista recebida', () => {
    const antes = skus(LISTA);
    moverNoRecorte(LISTA, menino, 2, 0);
    expect(skus(LISTA)).toEqual(antes);
  });

  it('com o recorte "todas" reordena a lista inteira', () => {
    const nova = moverNoRecorte(LISTA, () => true, 5, 0);
    expect(skus(nova)).toEqual(['M3', 'G1', 'M1', 'G2', 'M2', 'A1']);
  });

  it('qualquer sequência de movimentos em Menino preserva Menina e Acessórios', () => {
    /* catálogo parecido com o real: 8 destaques de Menina, depois Menino, Menina e Acessórios */
    const grande: P[] = [
      ...Array.from({ length: 8 }, (_, i) => p(`G${i}`, 'menina')),
      ...Array.from({ length: 45 }, (_, i) => p(`M${i}`, 'menino')),
      ...Array.from({ length: 20 }, (_, i) => p(`H${i}`, 'menina')),
      ...Array.from({ length: 9 }, (_, i) => p(`A${i}`, 'acess')),
    ];
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    let atual = grande;
    for (let t = 0; t < 300; t++) atual = moverNoRecorte(atual, menino, rnd(45), rnd(45));

    expect(atual).toHaveLength(grande.length);
    expect(new Set(atual).size).toBe(grande.length);              // ninguém duplicado nem perdido
    grande.forEach((x, i) => { if (!menino(x)) expect(atual[i]).toBe(x); });
    expect(skus(atual.filter(menino)).sort()).toEqual(skus(grande.filter(menino)).sort());
  });
});
