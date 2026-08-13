import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  document: string | null;
  status: string;
  origin: string | null;
}

export default function Customers() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);

  async function load(q = '') {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch<{ customers: Customer[] }>(`/api/customers?search=${encodeURIComponent(q)}`);
      setList(data.customers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    load(search);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Clientes</h1>
          <p className="muted">{loading ? 'Carregando…' : `${list.length} cliente(s)`}</p>
        </div>
        <div className="page-actions">
          <form className="search" onSubmit={onSearch}>
            <span>🔎</span>
            <input
              placeholder="Buscar por nome, telefone, e-mail…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </form>
          {can('customers.write') && (
            <button className="btn btn-primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Fechar' : '+ Novo cliente'}
            </button>
          )}
        </div>
      </div>

      {showForm && can('customers.write') && (
        <NewCustomerForm onCreated={() => { setShowForm(false); load(search); }} />
      )}

      {error && <div className="alert-error">{error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead>
            <tr>
              <th>Nome</th><th>WhatsApp</th><th>E-mail</th><th>CPF/CNPJ</th><th>Origem</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {!loading && list.length === 0 && (
              <tr><td colSpan={6} className="muted center">Nenhum cliente ainda.</td></tr>
            )}
            {list.map((c) => (
              <tr key={c.id} className="row-link" onClick={() => navigate(`/clientes/${c.id}`)}>
                <td><strong>{c.name}</strong></td>
                <td>{c.whatsapp || c.phone || '—'}</td>
                <td>{c.email || '—'}</td>
                <td className="mono">{c.document || '—'}</td>
                <td>{c.origin || '—'}</td>
                <td><span className="badge">{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewCustomerForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', whatsapp: '', phone: '', email: '', document: '', origin: 'whatsapp' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function set<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await apiFetch('/api/customers', { method: 'POST', body: JSON.stringify(form) });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <label className="field"><span>Nome *</span>
        <input value={form.name} onChange={(e) => set('name', e.target.value)} required /></label>
      <label className="field"><span>WhatsApp</span>
        <input value={form.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} placeholder="(99) 99999-9999" /></label>
      <label className="field"><span>Telefone</span>
        <input value={form.phone} onChange={(e) => set('phone', e.target.value)} /></label>
      <label className="field"><span>E-mail</span>
        <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} /></label>
      <label className="field"><span>CPF/CNPJ</span>
        <input value={form.document} onChange={(e) => set('document', e.target.value)} /></label>
      <label className="field"><span>Origem</span>
        <select value={form.origin} onChange={(e) => set('origin', e.target.value)}>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
          <option value="anuncio">Anúncio</option>
          <option value="catalogo">Catálogo</option>
          <option value="indicacao">Indicação</option>
          <option value="manual">Manual</option>
        </select>
      </label>
      {error && <div className="alert-error span-all">{error}</div>}
      <div className="span-all">
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar cliente'}</button>
      </div>
    </form>
  );
}
