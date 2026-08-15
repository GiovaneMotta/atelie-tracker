/* ================================================================
   /api/finance — caixa / financeiro (§41, modelo SOA).
     GET  /api/finance?month=YYYY-MM  -> lançamentos + resumo + 6 meses
     POST /api/finance                 -> lança entrada/saída
     DELETE /api/finance?id=<uuid>
   Permissões: finance.read / finance.write.
   ================================================================ */
import type { Handler } from '@netlify/functions';
import { withHttp, json, parseBody, badRequest } from '../lib/http';
import { requirePermission } from '../lib/auth';
import { admin } from '../lib/supabaseAdmin';

const round2 = (n: number) => Math.round(n * 100) / 100;

export const handler: Handler = withHttp(async (event) => {
  const sb = admin();
  const id = event.queryStringParameters?.id;

  if (event.httpMethod === 'GET') {
    await requirePermission(event, 'finance.read');
    const monthParam = event.queryStringParameters?.month || new Date().toISOString().slice(0, 7);
    const m = /^(\d{4})-(\d{2})$/.exec(monthParam);
    if (!m) throw badRequest('Mês inválido.');
    const year = Number(m[1]), month = Number(m[2]);
    const first = new Date(year, month - 1, 1);
    const last = new Date(year, month, 0);
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const { data: entries } = await sb.from('cash_entries').select('*')
      .gte('entry_date', iso(first)).lte('entry_date', iso(last)).order('entry_date', { ascending: false });

    let entradas = 0, saidas = 0;
    for (const e of entries ?? []) { if (e.kind === 'entrada') entradas += Number(e.amount); else saidas += Number(e.amount); }

    // 6 meses (inclui o atual)
    const sixAgo = new Date(year, month - 6, 1);
    const { data: recent } = await sb.from('cash_entries').select('kind, amount, entry_date')
      .gte('entry_date', iso(sixAgo)).lte('entry_date', iso(last));
    const byMonth: Record<string, { entradas: number; saidas: number }> = {};
    for (let i = 5; i >= 0; i--) { const d = new Date(year, month - 1 - i, 1); byMonth[d.toISOString().slice(0, 7)] = { entradas: 0, saidas: 0 }; }
    for (const e of recent ?? []) {
      const key = String(e.entry_date).slice(0, 7);
      if (byMonth[key]) { if (e.kind === 'entrada') byMonth[key].entradas += Number(e.amount); else byMonth[key].saidas += Number(e.amount); }
    }
    const months = Object.entries(byMonth).map(([k, v]) => ({ month: k, entradas: round2(v.entradas), saidas: round2(v.saidas), saldo: round2(v.entradas - v.saidas) }));

    return json(event, 200, {
      month: monthParam, entries: entries ?? [],
      summary: { entradas: round2(entradas), saidas: round2(saidas), saldo: round2(entradas - saidas) },
      months,
    });
  }

  if (event.httpMethod === 'POST') {
    const ctx = await requirePermission(event, 'finance.write');
    const b = parseBody<any>(event);
    const kind = b.kind === 'saida' ? 'saida' : 'entrada';
    const amount = Number(String(b.amount).replace(',', '.')) || 0;
    if (amount <= 0) throw badRequest('Informe um valor válido.');
    const { data, error } = await sb.from('cash_entries').insert({
      kind, amount, category: b.category ?? null, description: b.description ?? null,
      entry_date: b.entry_date || new Date().toISOString().slice(0, 10),
      order_id: b.order_id ?? null, created_by: ctx.userId,
    }).select('*').single();
    if (error) throw badRequest(error.message);
    return json(event, 201, { entry: data });
  }

  if (event.httpMethod === 'DELETE') {
    await requirePermission(event, 'finance.write');
    if (!id) throw badRequest('Informe o id.');
    const { error } = await sb.from('cash_entries').delete().eq('id', id);
    if (error) throw badRequest(error.message);
    return json(event, 200, { ok: true });
  }

  throw badRequest('Método não suportado.');
});
