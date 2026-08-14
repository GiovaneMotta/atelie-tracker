/* ================================================================
   /api/calendar — Calendário de Envios/Entregas (modelo SOA).
     GET /api/calendar?month=YYYY-MM
   Reúne o que precisa sair/entregar por data: peças da Produção com
   prazo (due_at) no mês. Resiliente: se a Produção ainda não foi
   migrada (0012), devolve vazio sem quebrar. Só leitura.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, badRequest } from '../lib/http';
import { getAuth } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

export const handler: Handler = withHttp(async (event) => {
  await getAuth(event);
  const sb = admin();

  const monthParam = event.queryStringParameters?.month || new Date().toISOString().slice(0, 7);
  const m = /^(\d{4})-(\d{2})$/.exec(monthParam);
  if (!m) throw badRequest('Mês inválido (use YYYY-MM).');
  const year = Number(m[1]), month = Number(m[2]);
  const from = new Date(year, month - 1, 1).toISOString();
  const to = new Date(year, month, 0, 23, 59, 59).toISOString();

  const items: any[] = [];

  // Peças da produção com prazo no mês
  try {
    const { data } = await sb.from('production_cards')
      .select('id, title, due_at, priority, sector_id, customer:customers(name), sector:production_sectors(name,color,is_final)')
      .not('due_at', 'is', null).gte('due_at', from).lte('due_at', to);
    for (const c of data ?? []) {
      items.push({
        id: c.id, type: 'producao', date: c.due_at, title: c.title,
        priority: c.priority, customer: (c as any).customer?.name || null,
        sector: (c as any).sector?.name || null, done: (c as any).sector?.is_final || false,
      });
    }
  } catch { /* produção ainda não migrada */ }

  return json(event, 200, { month: monthParam, items });
});
