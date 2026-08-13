import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/api';
import { formatBRL, formatDate, SHIPMENT_STATUS, SHIPMENT_STATUS_TONE } from '../lib/format';

interface Health { ok: boolean; checks: Record<string, boolean>; }
interface Stats {
  envios_hoje: number; by_status: Record<string, number>; labels_generated: number;
  frete_hoje: number; frete_mes: number; frete_medio: number;
  latest: { id: string; recipient_name: string; carrier: string | null; service: string | null; price: number | null; status: string; tracking_code: string | null; created_at: string }[];
}

export default function Dashboard() {
  const { me, can } = useAuth();
  const navigate = useNavigate();
  const [health, setHealth] = useState<Health | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const showShipping = can('shipments.read');

  useEffect(() => {
    apiFetch<Health>('/api/health').then(setHealth).catch(() => setHealth(null));
    if (showShipping) apiFetch<Stats>('/api/shipping-stats').then(setStats).catch(() => setStats(null));
  }, [showShipping]);

  const count = (k: string) => stats?.by_status?.[k] || 0;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Olá, {me?.name?.split(' ')[0] || 'bem-vinda'} 👋</h1>
          <p className="muted">Visão geral da expedição.</p>
        </div>
        {can('shipping.create') && <button className="btn btn-primary" onClick={() => navigate('/expedicao/novo')}>+ Novo envio</button>}
      </div>

      {showShipping && (
        <>
          <div className="kpi-row">
            <div className="kpi"><span className="kpi-label">Envios hoje</span><strong className="kpi-value">{stats?.envios_hoje ?? '—'}</strong></div>
            <div className="kpi"><span className="kpi-label">Aguardando etiqueta</span><strong className="kpi-value">{count('aguardando_confirmacao') + count('cotado') + count('rascunho')}</strong></div>
            <div className="kpi"><span className="kpi-label">Em trânsito</span><strong className="kpi-value">{count('em_transito') + count('postado') + count('saiu_entrega')}</strong></div>
            <div className="kpi"><span className="kpi-label">Entregues</span><strong className="kpi-value">{count('entregue')}</strong></div>
          </div>
          <div className="kpi-row">
            <div className="kpi"><span className="kpi-label">Etiquetas geradas</span><strong className="kpi-value">{stats?.labels_generated ?? '—'}</strong></div>
            <div className="kpi"><span className="kpi-label">Frete hoje</span><strong className="kpi-value">{stats ? formatBRL(stats.frete_hoje) : '—'}</strong></div>
            <div className="kpi"><span className="kpi-label">Frete no mês</span><strong className="kpi-value">{stats ? formatBRL(stats.frete_mes) : '—'}</strong></div>
            <div className="kpi"><span className="kpi-label">Frete médio</span><strong className="kpi-value">{stats ? formatBRL(stats.frete_medio) : '—'}</strong></div>
          </div>

          <div className="card table-card">
            <div className="card-head-row"><h3 style={{ margin: 12 }}>Últimos envios</h3><button className="btn-link" style={{ marginRight: 16 }} onClick={() => navigate('/envios')}>ver todos</button></div>
            <table className="table compact">
              <thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th className="right">Frete</th><th>Status</th></tr></thead>
              <tbody>
                {(!stats || stats.latest.length === 0) && <tr><td colSpan={5} className="muted center">Sem envios ainda.</td></tr>}
                {stats?.latest.map((s) => (
                  <tr key={s.id} className="row-link" onClick={() => navigate(`/envios/${s.id}`)}>
                    <td>{formatDate(s.created_at)}</td>
                    <td>{s.recipient_name}</td>
                    <td>{s.carrier || '—'} {s.service ? `· ${s.service}` : ''}</td>
                    <td className="right">{s.price != null ? formatBRL(s.price) : '—'}</td>
                    <td><span className={`badge badge-${SHIPMENT_STATUS_TONE[s.status] || 'muted'}`}>{SHIPMENT_STATUS[s.status] || s.status}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="card">
        <h3>Status do sistema</h3>
        {!health && <p className="muted">Checando conexão com o backend…</p>}
        {health && (
          <ul className="status-list">
            <li><span className={`dot ${health.checks?.supabase_env ? 'ok' : 'bad'}`} /> Variáveis do Supabase {health.checks?.supabase_env ? 'configuradas' : 'faltando'}</li>
            <li><span className={`dot ${health.checks?.db ? 'ok' : 'bad'}`} /> Banco de dados {health.checks?.db ? 'conectado' : 'sem conexão'}</li>
          </ul>
        )}
      </div>
    </div>
  );
}
