import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL, formatDate, ORDER_STATUS } from '../lib/format';

interface OrderRow { id: string; number: number; total: number; status: string; channel: string | null; created_at: string; customer: { name: string } | null; }

const CHANNEL_LABEL: Record<string, string> = {
  site: 'Site', catalogo: 'Site', whatsapp: 'WhatsApp', inbox: 'WhatsApp', manual: 'Manual',
};
const channelLabel = (c: string | null) => (c ? (CHANNEL_LABEL[c] || c) : '—');

export default function Orders() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ orders: OrderRow[] }>('/api/orders');
      setList(data.orders);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (creating) return <NewOrder onCancel={() => setCreating(false)} onCreated={(id) => navigate(`/pedidos/${id}`)} />;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Pedidos</h1><p className="muted">{loading ? 'Carregando…' : `${list.length} pedido(s)`}</p></div>
        {can('orders.write') && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Novo pedido</button>}
      </div>
      {error && <div className="alert-error">{error}</div>}
      <div className="card table-card">
        <table className="table">
          <thead><tr><th>#</th><th>Cliente</th><th>Total</th><th>Origem</th><th>Status</th><th>Data</th></tr></thead>
          <tbody>
            {!loading && list.length === 0 && <tr><td colSpan={6} className="muted center">Nenhum pedido ainda.</td></tr>}
            {list.map((o) => (
              <tr key={o.id} className="row-link" onClick={() => navigate(`/pedidos/${o.id}`)}>
                <td className="mono">#{o.number}</td>
                <td>{o.customer?.name || '—'}</td>
                <td>{formatBRL(o.total)}</td>
                <td><span className="badge">{channelLabel(o.channel)}</span></td>
                <td><span className="badge">{ORDER_STATUS[o.status] || o.status}</span></td>
                <td>{formatDate(o.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface PickCustomer { id: string; name: string; whatsapp: string | null; phone: string | null; }
interface PickProduct { id: string; name: string; sku: string | null; price_cash: number | null; }
interface Line { product: PickProduct; quantity: number; }

function NewOrder({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [customer, setCustomer] = useState<PickCustomer | null>(null);
  const [custQuery, setCustQuery] = useState('');
  const [custResults, setCustResults] = useState<PickCustomer[]>([]);
  const [prodQuery, setProdQuery] = useState('');
  const [prodResults, setProdResults] = useState<PickProduct[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function searchCustomers(q: string) {
    setCustQuery(q);
    if (q.trim().length < 2) { setCustResults([]); return; }
    const data = await apiFetch<{ customers: PickCustomer[] }>(`/api/customers?search=${encodeURIComponent(q)}`);
    setCustResults(data.customers.slice(0, 6));
  }
  async function searchProducts(q: string) {
    setProdQuery(q);
    if (q.trim().length < 2) { setProdResults([]); return; }
    const data = await apiFetch<{ products: PickProduct[] }>(`/api/products?search=${encodeURIComponent(q)}&status=ativo`);
    setProdResults(data.products.slice(0, 6));
  }
  function addLine(p: PickProduct) {
    setLines((cur) => {
      const found = cur.find((l) => l.product.id === p.id);
      if (found) return cur.map((l) => l.product.id === p.id ? { ...l, quantity: l.quantity + 1 } : l);
      return [...cur, { product: p, quantity: 1 }];
    });
    setProdQuery(''); setProdResults([]);
  }

  const subtotal = lines.reduce((s, l) => s + (Number(l.product.price_cash || 0) * l.quantity), 0);
  const total = Math.max(0, subtotal - (parseFloat(discount.replace(',', '.')) || 0));

  async function save() {
    setBusy(true); setError('');
    try {
      const payload = {
        customer_id: customer?.id || null,
        items: lines.map((l) => ({ product_id: l.product.id, quantity: l.quantity })),
        discount: parseFloat(discount.replace(',', '.')) || 0,
        notes: notes || null,
      };
      const data = await apiFetch<{ order: { id: string } }>('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
      onCreated(data.order.id);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao criar pedido.'); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><p className="crumb"><button className="btn-link" onClick={onCancel}>← Pedidos</button></p><h1>Novo pedido</h1></div>
      </div>

      <div className="card">
        <h3>Cliente</h3>
        {customer
          ? <div className="picked">{customer.name} <button className="btn-link" onClick={() => setCustomer(null)}>trocar</button></div>
          : (
            <div className="picker">
              <input placeholder="Buscar cliente…" value={custQuery} onChange={(e) => searchCustomers(e.target.value)} />
              {custResults.map((c) => <button key={c.id} className="picker-opt" onClick={() => { setCustomer(c); setCustResults([]); setCustQuery(''); }}>{c.name} <span className="muted">{c.whatsapp || c.phone}</span></button>)}
            </div>
          )}
      </div>

      <div className="card">
        <h3>Itens</h3>
        <div className="picker">
          <input placeholder="Buscar produto ativo…" value={prodQuery} onChange={(e) => searchProducts(e.target.value)} />
          {prodResults.map((p) => <button key={p.id} className="picker-opt" onClick={() => addLine(p)}>{p.name} <span className="muted">{p.price_cash != null ? formatBRL(p.price_cash) : ''}</span></button>)}
        </div>
        {lines.length === 0 && <p className="muted">Nenhum item adicionado.</p>}
        {lines.map((l, i) => (
          <div className="row-inline" key={l.product.id}>
            <span style={{ flex: 1 }}>{l.product.name}</span>
            <input type="number" min={1} value={l.quantity} style={{ width: 70 }}
              onChange={(e) => setLines((cur) => cur.map((x, j) => j === i ? { ...x, quantity: Math.max(1, parseInt(e.target.value) || 1) } : x))} />
            <span className="mono">{formatBRL(Number(l.product.price_cash || 0) * l.quantity)}</span>
            <button className="btn-link" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
      </div>

      <div className="card form-grid">
        <label className="field"><span>Desconto (R$)</span><input value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" /></label>
        <label className="field span-all"><span>Observações</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      </div>

      <div className="card totals">
        <div><span>Subtotal</span><strong>{formatBRL(subtotal)}</strong></div>
        <div><span>Desconto</span><strong>- {formatBRL(parseFloat(discount.replace(',', '.')) || 0)}</strong></div>
        <div className="totals-final"><span>Total (estimado)</span><strong>{formatBRL(total)}</strong></div>
        <p className="muted small">O total definitivo é calculado no servidor ao salvar (preços travados no backend).</p>
      </div>

      {error && <div className="alert-error">{error}</div>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || lines.length === 0} onClick={save}>{busy ? 'Criando…' : 'Criar pedido'}</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
