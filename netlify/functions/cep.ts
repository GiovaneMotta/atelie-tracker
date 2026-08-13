/* ================================================================
   /api/cep?cep=00000000 — autocompletar por CEP (ViaCEP).
   Preenche rua/bairro/cidade/UF. Dado público. Requer estar logado.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, badRequest, notFound } from '../lib/http';
import { getAuth } from '../lib/auth';
import { lookupCep } from '../lib/shipping/cep';

export const handler: Handler = withHttp(async (event) => {
  if (event.httpMethod !== 'GET') throw badRequest('Método não suportado.');
  await getAuth(event); // membro ativo

  const cep = (event.queryStringParameters?.cep || '').replace(/\D/g, '');
  if (cep.length !== 8) throw badRequest('Informe um CEP com 8 dígitos.');

  const result = await lookupCep(cep);
  if (!result) throw notFound('CEP não encontrado.');
  return json(event, 200, result);
});
