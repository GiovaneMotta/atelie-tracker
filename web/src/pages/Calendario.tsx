import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';

interface Item { id: string; type: string; date: string; title: string; priority: string; customer: string | null; sector: string | null; done: boolean; }

const WD = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function Calendario() {
  const navigate = useNavigate();
  const [ym, setYm] = useState(() => new Date().toISOString().slice(0, 7));
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selDay, setSelDay] = useState<number | null>(null);

  const [year, month] = ym.split('-').map(Number);

  async function load() {
    setLoading(true); setError('');
    try { const d = await apiFetch<{ items: Item[] }>(`/api/calendar?month=${ym}`); setItems(d.items); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); setSelDay(null); }, [ym]);

  const byDay = useMemo(() => {
    const map: Record<number, Item[]> = {};
    for (const it of items) { const d = new Date(it.date).getDate(); (map[d] = map[d] || []).push(it); }
    return map;
  }, [items]);

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells: (number | null)[] = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const monthName = new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const shift = (n: number) => { const d = new Date(year, month - 1 + n, 1); setYm(d.toISOString().slice(0, 7)); };
  const today = new Date();
  const isToday = (d: number) => today.getFullYear() === year && today.getMonth() + 1 === month && today.getDate() === d;

  const selItems = selDay ? (byDay[selDay] || []) : [];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Calendário de Envios</h1><p className="muted">Peças a entregar por dia — {loading ? '…' : `${items.length} no mês`}</p></div>
        <div className="cal-nav">
          <button className="btn btn-ghost btn-sm" onClick={() => shift(-1)}>←</button>
          <strong className="cal-month">{monthName}</strong>
          <button className="btn btn-ghost btn-sm" onClick={() => shift(1)}>→</button>
        </div>
      </div>
      {error && <div className="alert-error">{error}</div>}

      <div className="card">
        <div className="cal-grid cal-head-row">{WD.map((w) => <div key={w} className="cal-wd">{w}</div>)}</div>
        <div className="cal-grid">
          {cells.map((d, i) => {
            const list = d ? (byDay[d] || []) : [];
            return (
              <div key={i} className={`cal-cell ${!d ? 'empty' : ''} ${isToday(d || 0) ? 'today' : ''} ${selDay === d ? 'sel' : ''}`}
                onClick={() => d && list.length && setSelDay(d)}>
                {d && <span className="cal-day">{d}</span>}
                {list.slice(0, 3).map((it) => (
                  <div key={it.id} className={`cal-chip ${it.done ? 'done' : `prio-${it.priority}`}`} title={it.title}>{it.title}</div>
                ))}
                {list.length > 3 && <div className="cal-more">+{list.length - 3}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {selDay && (
        <div className="card">
          <h3>Dia {selDay} — {selItems.length} peça(s)</h3>
          <table className="table">
            <thead><tr><th>Peça</th><th>Cliente</th><th>Setor</th><th>Prioridade</th></tr></thead>
            <tbody>
              {selItems.map((it) => (
                <tr key={it.id} className="row-link" onClick={() => navigate('/producao')}>
                  <td><strong>{it.title}</strong></td>
                  <td>{it.customer || '—'}</td>
                  <td>{it.done ? '✓ Pronto' : (it.sector || '—')}</td>
                  <td>{it.priority !== 'normal' ? <span className={`badge prio-${it.priority}`}>{it.priority}</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && items.length === 0 && (
        <div className="card"><p className="muted small">Nenhuma peça com prazo neste mês. Defina "Entregar até" nas peças da <strong>Produção</strong> que elas aparecem aqui.</p></div>
      )}
    </div>
  );
}
