import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/format';

interface Log { id: string; category: string; level: string; message: string; context: any; created_at: string; }
const CATEGORIES = ['ALL', 'FRENET', 'WEBHOOK', 'ERROR'];

export default function Logs() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [category, setCategory] = useState('FRENET');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true); setError('');
    try {
      const data = await apiFetch<{ logs: Log[] }>(`/api/integration-logs?category=${category}&limit=150`);
      setLogs(data.logs);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [category]);

  return (
    <div className="page">
      <div className="page-head">
        <div><p className="crumb muted">Configurações</p><h1>Logs de integração</h1></div>
        <div className="page-actions">
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn btn-ghost" onClick={load}>Atualizar</button>
        </div>
      </div>
      {error && <div className="alert-error">{error}</div>}
      <div className="card table-card">
        <table className="table compact">
          <thead><tr><th>Quando</th><th>Categoria</th><th>Nível</th><th>Mensagem</th><th>Contexto</th></tr></thead>
          <tbody>
            {!loading && logs.length === 0 && <tr><td colSpan={5} className="muted center">Sem registros.</td></tr>}
            {logs.map((l) => (
              <tr key={l.id}>
                <td className="small">{formatDateTime(l.created_at)}</td>
                <td><span className="badge">{l.category}</span></td>
                <td><span className={`badge badge-${l.level === 'error' ? 'bad' : l.level === 'warn' ? 'warn' : 'muted'}`}>{l.level}</span></td>
                <td className="small">{l.message}</td>
                <td className="mono small" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.context ? JSON.stringify(l.context) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">Os logs nunca contêm tokens ou dados sensíveis (sanitizados na origem).</p>
    </div>
  );
}
