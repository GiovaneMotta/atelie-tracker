import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL, formatDate, SHIPMENT_STATUS, SHIPMENT_STATUS_TONE } from '../lib/format';

interface Row {
  id: string; status: string; carrier: string | null; service: string | null; price: number | null;
  tracking_code: string | null; recipient: { name?: string } | null; environment: string | null; created_at: string;
}

const STATUS_OPTIONS = ['', 'rascunho', 'aguardando_confirmacao', 'etiqueta_gerada', 'postado', 'em_transito', 'saiu_entrega', 'entregue', 'problema', 'cancelado', 'erro'];

export default function Shipments() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [carrier, setCarrier] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (status) params.set('status', status);
      if (carrier) params.set('carrier', carrier);
      if (from) params.set('from', new Date(from).toISOString());
      if (to) { const d = new Date(to); d.setHours(23, 59, 59); params.set('to', d.toISOString()); }
      const data = await apiFetch<{ shipments: Row[] }>(`/api/shipments?${params.toString()}`);
      setList(data.shipments);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Envios</h1><p className="muted">{loading ? 'Carregando…' : `${list.length} envio(s)`}</p></div>
        {can('shipping.create') && <button className="btn btn-primary" onClick={() => navigate('/expedicao/novo')}>+ Novo envio</button>}
      </div>

      <div className="card filters">
        <div className="search"><span>🔎</span><input placeholder="Nome ou rastreio…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && load()} /></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s ? SHIPMENT_STATUS[s] : 'Todos os status'}</option>)}
        </select>
        <input placeholder="Transportadora" value={carrier} onChange={(e) => setCarrier(e.target.value)} />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} title="De" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} title="Até" />
        <button className="btn btn-ghost" onClick={load}>Filtrar</button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead><tr><th>Data</th><th>Cliente</th><th>Transportadora</th><th>Serviço</th><th className="right">Valor</th><th>Rastreio</th><th>Status</th></tr></thead>
          <tbody>
            {!loading && list.length === 0 && <tr><td colSpan={7} className="muted center">Nenhum envio encontrado.</td></tr>}
            {list.map((s) => (
              <tr key={s.id} className="row-link" onClick={() => navigate(`/envios/${s.id}`)}>
                <td>{formatDate(s.created_at)}</td>
                <td>{s.recipient?.name || '—'}</td>
                <td>{s.carrier || '—'}</td>
                <td>{s.service || '—'}</td>
                <td className="right">{s.price != null ? formatBRL(s.price) : '—'}</td>
                <td className="mono small">{s.tracking_code || '—'}</td>
                <td><span className={`badge badge-${SHIPMENT_STATUS_TONE[s.status] || 'muted'}`}>{SHIPMENT_STATUS[s.status] || s.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
