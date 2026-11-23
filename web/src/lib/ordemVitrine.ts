/* ================================================================
   Ordem da vitrine — a regra de mover peças (lógica pura, testada em
   ordemVitrine.test.ts).

   O site tem UMA ordem só para o catálogo inteiro (products.sort_order).
   A tela mostra um recorte dela (uma categoria). Mover uma peça no
   recorte troca as peças DO RECORTE de lugar entre si, nas mesmas casas
   que elas já ocupavam na lista inteira; quem está fora do recorte não
   sai do lugar. É isso que garante que reordenar "Menino" não mexe em
   "Menina".
   ================================================================ */

/** Move o item da posição `de` para a posição `para` DENTRO do recorte
 *  (posições contadas só entre os itens do recorte) e devolve a lista
 *  inteira nova. Não altera a lista recebida. Posição fora do limite vai
 *  para a ponta; movimento sem efeito devolve a própria lista. */
export function moverNoRecorte<T>(lista: T[], noRecorte: (item: T) => boolean, de: number, para: number): T[] {
  const recorte = lista.filter(noRecorte);
  if (!Number.isInteger(de) || de < 0 || de >= recorte.length) return lista;
  const alvo = Math.max(0, Math.min(recorte.length - 1, Math.trunc(para)));
  if (alvo === de) return lista;
  const [item] = recorte.splice(de, 1);
  recorte.splice(alvo, 0, item);
  let k = 0;
  return lista.map((x) => (noRecorte(x) ? recorte[k++] : x));
}
