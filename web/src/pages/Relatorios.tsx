import { useEffect, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatBRL, ORDER_STATUS } from '../lib/format';

interface Report {
  period: { label: string };
  summary: { faturamento: number; pedidos: number; pagos: number; ticket: number; itens: number };
  by_status: { status: string; pedidos: number }[];
  by_channel: { channel: string; pedidos: number; receita: number }[];
  by_product: { name: string; sku: string | null; qty: number; receita: number }[];
  by_category: { category: string; qty: number; receita: number }[];
  by_customer: { name: string; pedidos: number; receita: number }[];
  stock?: { esgotados: number; ativos: number; inativos: number; total: number };
}

const PERIODS = [
  { v: 'hoje', l: 'Hoje' }, { v: '7d', l: 'Últimos 7 dias' }, { v: '30d', l: 'Últimos 30 dias' },
  { v: 'mes_atual', l: 'Mês atual' }, { v: 'mes_anterior', l: 'Mês anterior' }, { v: '3m', l: 'Últimos 3 meses' }, { v: '12m', l: 'Últimos 12 meses' },
];
const CHANNEL: Record<string, string> = { site: 'Site', catalogo: 'Site', whatsapp: 'WhatsApp', inbox: 'WhatsApp', manual: 'Manual', outros: 'Outros' };
const brNum = (n: number) => String(n ?? 0).replace('.', ',');

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [headers.map(esc).join(';'), ...rows.map((r) => r.map(esc).join(';'))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

interface Col<T> { label: string; align?: 'right'; cell: (r: T) => ReactNode; csv: (r: T) => string | number; }
function Section<T>({ title, rows, cols, csvName }: { title: string; rows: T[]; cols: Col<T>[]; csvName: string }) {
  return (
    <div className="card table-card" style={{ marginBottom: 20 }}>
      <div className="card-head-row" style={{ padding: '14px 18px 8px' }}>
        <h3 style={{ fontSize: '.95rem' }}>{title}</h3>
        <button className="btn btn-ghost btn-sm" disabled={!rows.length}
          onClick={() => downloadCsv(`${csvName}.csv`, cols.map((c) => c.label), rows.map((r) => cols.map((c) => c.csv(r))))}>
          <Download size={14} /> CSV
        </button>
      </div>
      <table className="table">
        <thead><tr>{cols.map((c, i) => <th key={i} className={c.align === 'right' ? 'right' : ''}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={cols.length} className="muted center">Sem dados no período.</td></tr>}
          {rows.map((r, i) => <tr key={i}>{cols.map((c, j) => <td key={j} className={c.align === 'right' ? 'right mono' : ''}>{c.cell(r)}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

export default function Relatorios() {
  const [period, setPeriod] = useState('30d');
  const [d, setD] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    apiFetch<Report>(`/api/reports?period=${period}`).then(setD)
      .catch((e) => setError(e instanceof Error ? e.message : 'Erro.')).finally(() => setLoading(false));
  }, [period]);

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="dash-ov">Crescimento</div><h1>Relatórios</h1><p className="dash-sub">Números da loja — {d?.period?.label?.toLowerCase() || '…'}.</p></div>
        <div className="dash-controls">
          <label className="period-select"><select value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}</select></label>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="stat-strip">
        <div className="stat"><div className="stat-lb">Faturamento</div><div className="stat-vl">{d ? formatBRL(d.summary.faturamento) : '—'}</div></div>
        <div className="stat"><div className="stat-lb">Pedidos</div><div className="stat-vl">{d ? d.summary.pedidos : '—'}</div></div>
        <div className="stat"><div className="stat-lb">Ticket médio</div><div className="stat-vl">{d ? formatBRL(d.summary.ticket) : '—'}</div></div>
        <div className="stat"><div className="stat-lb">Itens vendidos</div><div className="stat-vl">{d ? d.summary.itens : '—'}</div></div>
      </div>

      {loading && !d && <p className="muted center" style={{ marginTop: 20 }}>Carregando relatórios…</p>}

      {d && (
        <>
          <Section title="Vendas por produto" rows={d.by_product} csvName="vendas-por-produto"
            cols={[
              { label: 'Produto', cell: (r) => <strong>{r.name}</strong>, csv: (r) => r.name },
              { label: 'SKU', cell: (r) => <span className="mono">{r.sku || '—'}</span>, csv: (r) => r.sku || '' },
              { label: 'Qtd', align: 'right', cell: (r) => r.qty, csv: (r) => r.qty },
              { label: 'Receita', align: 'right', cell: (r) => formatBRL(r.receita), csv: (r) => brNum(r.receita) },
            ]} />

          <Section title="Vendas por categoria" rows={d.by_category} csvName="vendas-por-categoria"
            cols={[
              { label: 'Categoria', cell: (r) => <strong style={{ textTransform: 'capitalize' }}>{r.category}</strong>, csv: (r) => r.category },
              { label: 'Qtd', align: 'right', cell: (r) => r.qty, csv: (r) => r.qty },
              { label: 'Receita', align: 'right', cell: (r) => formatBRL(r.receita), csv: (r) => brNum(r.receita) },
            ]} />

          <Section title="Vendas por cliente" rows={d.by_customer} csvName="vendas-por-cliente"
            cols={[
              { label: 'Cliente', cell: (r) => <strong>{r.name}</strong>, csv: (r) => r.name },
              { label: 'Pedidos', align: 'right', cell: (r) => r.pedidos, csv: (r) => r.pedidos },
              { label: 'Receita', align: 'right', cell: (r) => formatBRL(r.receita), csv: (r) => brNum(r.receita) },
            ]} />

          <div className="dash-2">
            <Section title="Pedidos por status" rows={d.by_status} csvName="pedidos-por-status"
              cols={[
                { label: 'Status', cell: (r) => ORDER_STATUS[r.status] || r.status, csv: (r) => ORDER_STATUS[r.status] || r.status },
                { label: 'Pedidos', align: 'right', cell: (r) => r.pedidos, csv: (r) => r.pedidos },
              ]} />
            <Section title="Origem das vendas" rows={d.by_channel} csvName="origem-das-vendas"
              cols={[
                { label: 'Canal', cell: (r) => CHANNEL[r.channel] || r.channel, csv: (r) => CHANNEL[r.channel] || r.channel },
                { label: 'Pedidos', align: 'right', cell: (r) => r.pedidos, csv: (r) => r.pedidos },
                { label: 'Receita', align: 'right', cell: (r) => formatBRL(r.receita), csv: (r) => brNum(r.receita) },
              ]} />
          </div>

          {d.stock && (
            <div className="sec-head" style={{ marginTop: 8 }}><h3>Estoque</h3></div>
          )}
          {d.stock && (
            <div className="stock">
              <div className="stk bad"><div className="stk-n">{d.stock.esgotados}</div><div className="stk-l">Esgotados</div></div>
              <div className="stk ok"><div className="stk-n">{d.stock.ativos}</div><div className="stk-l">Ativos</div></div>
              <div className="stk"><div className="stk-n">{d.stock.total}</div><div className="stk-l">Total de produtos</div></div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
