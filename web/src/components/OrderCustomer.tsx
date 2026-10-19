/* ====================================================================
   Cliente do pedido.

   O cliente só era escolhido na criação do pedido. Um pedido manual que
   nascesse sem cliente ficava preso: sem cliente não há endereço, sem
   endereço não há etiqueta nem entrega. O pedido do site sempre traz um
   cliente, mas o manual não.
   ==================================================================== */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface PickCustomer {
  id: string;
  name: string;
  whatsapp: string | null;
  phone?: string | null;
}

interface Props {
  orderId: string;
  customer: { id: string; name: string; whatsapp: string | null; phone?: string | null } | null;
  onChanged: () => void;
}

export default function OrderCustomer({ orderId, customer, onChanged }: Props) {
  const { can } = useAuth();
  const [buscando, setBuscando] = useState(false);
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<PickCustomer[]>([]);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  const podeEditar = can('orders.write');

  async function buscar(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setResultados([]); return; }
    try {
      const d = await apiFetch<{ customers: PickCustomer[] }>(`/api/customers?search=${encodeURIComponent(q)}`);
      setResultados(d.customers.slice(0, 6));
    } catch { setResultados([]); }
  }

  async function vincular(c: PickCustomer) {
    setBusy(true); setErro('');
    try {
      await apiFetch(`/api/orders?id=${orderId}`, {
        method: 'PATCH', body: JSON.stringify({ customer_id: c.id }),
      });
      setBuscando(false); setQuery(''); setResultados([]);
      onChanged();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao vincular o cliente.');
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h3>Cliente</h3>

      {customer && !buscando && (
        <p>
          <Link to={`/clientes/${customer.id}`}>{customer.name}</Link><br />
          <span className="muted">{customer.whatsapp || customer.phone || ''}</span>
        </p>
      )}
      {!customer && !buscando && <p className="muted">Sem cliente vinculado.</p>}

      {buscando && (
        <div className="picker">
          <input autoFocus placeholder="Buscar por nome, telefone…" value={query}
            onChange={(e) => buscar(e.target.value)} />
          {query.trim().length > 0 && query.trim().length < 2 && (
            <p className="muted small">Digite ao menos 2 letras.</p>
          )}
          {resultados.map((c) => (
            <button key={c.id} className="picker-opt" disabled={busy} onClick={() => vincular(c)}>
              {c.name} <span className="muted">{c.whatsapp || c.phone || ''}</span>
            </button>
          ))}
          {query.trim().length >= 2 && resultados.length === 0 && (
            <p className="muted small">
              Ninguém encontrado. <Link to="/clientes">Cadastrar cliente</Link>
            </p>
          )}
        </div>
      )}

      {erro && <div className="alert-error">{erro}</div>}

      {podeEditar && (
        <div className="form-actions">
          {buscando
            ? <button className="btn btn-ghost btn-sm" onClick={() => { setBuscando(false); setQuery(''); setResultados([]); }}>Cancelar</button>
            : <button className="btn btn-ghost btn-sm" onClick={() => setBuscando(true)}>
                {customer ? 'Trocar cliente' : 'Vincular cliente'}
              </button>}
        </div>
      )}
    </div>
  );
}
