import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { formatBRL, formatDate } from '../lib/format';

interface Entry { id: string; kind: string; amount: number; category: string | null; description: string | null; entry_date: string; }
interface MonthAgg { month: string; entradas: number; saidas: number; saldo: number; }
interface Data { month: string; entries: Entry[]; summary: { entradas: number; saidas: number; saldo: number }; months: MonthAgg[]; }

export default function Financeiro() {
  const [ym, setYm] = useState(() => new Date().toISOString().slice(0, 7));
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const [year, month] = ym.split('-').map(Number);
  const monthName = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  async function load() {
    setLoading(true); setError('');
    try { setData(await apiFetch<Data>(`/api/finance?month=${ym}`)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [ym]);
  const shift = (n: number) => { const d = new Date(year, month - 1 + n, 1); setYm(d.toISOString().slice(0, 7)); };

  async function del(id: string) { if (!confirm('Excluir lançamento?')) return; await apiFetch(`/api/finance?id=${id}`, { method: 'DELETE' }); load(); }

  const maxBar = data ? Math.max(1, ...data.months.flatMap((m) => [m.entradas, m.saidas])) : 1;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Financeiro</h1><p className="muted">Caixa do ateliê · <span style={{ textTransform: 'capitalize' }}>{monthName}</span></p></div>
        <div className="cal-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => shift(-1)}>←</button>
          <button className="btn btn-ghost btn-sm" onClick={() => shift(1)}>→</button>
          <button className="btn btn-primary" onClick={() => setAdding((v) => !v)}>+ Lançar</button>
        </div>
      </div>
      {error && <div className="alert-error">{error}</div>}

      {adding && <EntryForm onSaved={() => { setAdding(false); load(); }} />}

      <div className="kpi-row">
        <div className="kpi"><span className="kpi-label">Entradas</span><strong className="kpi-value mg-ok">{data ? formatBRL(data.summary.entradas) : '—'}</strong></div>
        <div className="kpi"><span className="kpi-label">Saídas</span><strong className="kpi-value mg-bad">{data ? formatBRL(data.summary.saidas) : '—'}</strong></div>
        <div className="kpi"><span className="kpi-label">Saldo do mês</span><strong className={`kpi-value ${data && data.summary.saldo < 0 ? 'mg-bad' : 'mg-ok'}`}>{data ? formatBRL(data.summary.saldo) : '—'}</strong></div>
      </div>

      {data && (
        <div className="card">
          <h3>Últimos 6 meses</h3>
          <div className="fin-bars">
            {data.months.map((m) => (
              <div className="fin-bar-col" key={m.month}>
                <div className="fin-bar-pair">
                  <div className="fin-bar in" style={{ height: `${(m.entradas / maxBar) * 100}%` }} title={`Entradas ${formatBRL(m.entradas)}`} />
                  <div className="fin-bar out" style={{ height: `${(m.saidas / maxBar) * 100}%` }} title={`Saídas ${formatBRL(m.saidas)}`} />
                </div>
                <span className="fin-bar-label">{m.month.slice(5)}/{m.month.slice(2, 4)}</span>
              </div>
            ))}
          </div>
          <div className="fin-legend"><span><i className="dot ok" /> Entradas</span><span><i className="dot bad" /> Saídas</span></div>
        </div>
      )}

      <div className="card table-card">
        <table className="table">
          <thead><tr><th>Data</th><th>Tipo</th><th>Categoria</th><th>Descrição</th><th className="right">Valor</th><th></th></tr></thead>
          <tbody>
            {!loading && (!data || data.entries.length === 0) && <tr><td colSpan={6} className="muted center">Sem lançamentos neste mês.</td></tr>}
            {data?.entries.map((e) => (
              <tr key={e.id}>
                <td>{formatDate(e.entry_date)}</td>
                <td><span className={`badge ${e.kind === 'entrada' ? 'mg-ok' : 'mg-bad'}`}>{e.kind === 'entrada' ? 'Entrada' : 'Saída'}</span></td>
                <td>{e.category || '—'}</td>
                <td>{e.description || '—'}</td>
                <td className={`right ${e.kind === 'entrada' ? 'mg-ok' : 'mg-bad'}`}>{e.kind === 'entrada' ? '+' : '−'} {formatBRL(e.amount)}</td>
                <td className="right"><button className="btn-link danger" onClick={() => del(e.id)}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EntryForm({ onSaved }: { onSaved: () => void }) {
  const [f, setF] = useState({ kind: 'entrada', amount: '', category: '', description: '', entry_date: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try { await apiFetch('/api/finance', { method: 'POST', body: JSON.stringify(f) }); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setBusy(false); }
  }
  return (
    <form className="card form-grid" onSubmit={submit}>
      <label className="field"><span>Tipo</span>
        <select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
          <option value="entrada">Entrada (receita)</option><option value="saida">Saída (despesa)</option>
        </select></label>
      <label className="field"><span>Valor (R$)</span><input value={f.amount} onChange={(e) => set('amount', e.target.value)} placeholder="0,00" required /></label>
      <label className="field"><span>Categoria</span><input value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Venda, Material, Frete…" /></label>
      <label className="field"><span>Data</span><input type="date" value={f.entry_date} onChange={(e) => set('entry_date', e.target.value)} /></label>
      <label className="field span-all"><span>Descrição</span><input value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
      {error && <div className="alert-error span-all">{error}</div>}
      <div className="span-all"><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Lançar'}</button></div>
    </form>
  );
}
