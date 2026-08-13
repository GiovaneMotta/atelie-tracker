import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL } from '../lib/format';

interface Row {
  id: string; status: string; carrier: string | null; service: string | null; price: number | null;
  tracking_code: string | null; recipient: { name?: string } | null; label_url?: string | null; created_at: string;
}
interface Stats {
  envios_hoje: number; by_status: Record<string, number>; frete_hoje: number; frete_mes: number; frete_medio: number; labels_generated: number;
}

const COLUMNS: { title: string; statuses: string[] }[] = [
  { title: 'Aguardando etiqueta', statuses: ['rascunho', 'cotado', 'aguardando_confirmacao', 'gerando'] },
  { title: 'Etiqueta gerada', statuses: ['etiqueta_gerada'] },
  { title: 'Postados', statuses: ['postado'] },
  { title: 'Em trânsito', statuses: ['em_transito'] },
  { title: 'Saíram p/ entrega', statuses: ['saiu_entrega'] },
  { title: 'Entregues', statuses: ['entregue'] },
  { title: 'Problemas', statuses: ['problema', 'erro'] },
];

export default function Expedicao() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [ship, st] = await Promise.all([
        apiFetch<{ shipments: Row[] }>('/api/shipments'),
        apiFetch<Stats>('/api/shipping-stats').catch(() => null),
      ]);
      setRows(ship.shipments); setStats(st);
    } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const countBy = (statuses: string[]) => rows.filter((r) => statuses.includes(r.status)).length;
  const copy = (code: string | null) => code && navigator.clipboard?.writeText(code);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Expedição</h1><p className="muted">{loading ? 'Carregando…' : `${rows.length} envio(s)`}</p></div>
        {can('shipping.create') && <button className="btn btn-primary" onClick={() => navigate('/expedicao/novo')}>+ Novo envio</button>}
      </div>

      {stats && (
        <div className="kpi-row">
          <div className="kpi"><span className="kpi-label">Envios hoje</span><strong className="kpi-value">{stats.envios_hoje}</strong></div>
          <div className="kpi"><span className="kpi-label">Aguardando etiqueta</span><strong className="kpi-value">{countBy(['rascunho', 'cotado', 'aguardando_confirmacao', 'gerando'])}</strong></div>
          <div className="kpi"><span className="kpi-label">Em trânsito</span><strong className="kpi-value">{countBy(['em_transito', 'saiu_entrega', 'postado'])}</strong></div>
          <div className="kpi"><span className="kpi-label">Frete no mês</span><strong className="kpi-value">{formatBRL(stats.frete_mes)}</strong></div>
        </div>
      )}

      <div className="board">
        {COLUMNS.map((col) => {
          const cards = rows.filter((r) => col.statuses.includes(r.status));
          return (
            <div className="board-col" key={col.title}>
              <div className="board-col-head">{col.title} <span className="count">{cards.length}</span></div>
              {cards.length === 0 && <p className="muted small board-empty">—</p>}
              {cards.map((c) => (
                <div className="board-card" key={c.id}>
                  <strong className="board-name">{c.recipient?.name || '—'}</strong>
                  <div className="muted small">{c.carrier || ''} {c.service ? `· ${c.service}` : ''}</div>
                  {c.tracking_code && <div className="mono small">{c.tracking_code}</div>}
                  <div className="board-actions">
                    <button className="btn-link" onClick={() => navigate(`/envios/${c.id}`)}>Ver</button>
                    {c.label_url && <a className="btn-link" href={c.label_url} target="_blank" rel="noreferrer">Etiqueta</a>}
                    {c.tracking_code && <button className="btn-link" onClick={() => copy(c.tracking_code)}>Copiar rastreio</button>}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
