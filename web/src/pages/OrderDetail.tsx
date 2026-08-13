import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL, formatDate, ORDER_STATUS, NEXT_STATUS } from '../lib/format';

interface Item { id: string; name: string; sku: string | null; quantity: number; unit_price: number; line_total: number; addons: { name: string; price: number }[]; }
interface Address { street: string | null; number: string | null; district: string | null; city: string | null; state: string | null; cep: string | null; }
interface Order {
  id: string; number: number; status: string; payment_status: string; payment_method: string | null;
  subtotal: number; discount: number; shipping_cost: number; total: number; notes: string | null; created_at: string;
  customer: { id: string; name: string; whatsapp: string | null; document: string | null } | null;
  address: Address | null; items: Item[];
}

export default function OrderDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ order: Order }>(`/api/orders?id=${id}`);
      setOrder(data.order);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]);

  async function changeStatus(status: string) {
    setError(''); setMsg('');
    try {
      await apiFetch(`/api/orders?id=${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setMsg('Status atualizado.');
      load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); }
  }

  if (loading) return <div className="page"><p className="muted">Carregando…</p></div>;
  if (error && !order) return <div className="page"><div className="alert-error">{error}</div></div>;
  if (!order) return null;

  const nexts = NEXT_STATUS[order.status] || [];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="crumb"><Link to="/pedidos">← Pedidos</Link></p>
          <h1>Pedido #{order.number}</h1>
          <p className="muted">Criado em {formatDate(order.created_at)}</p>
        </div>
        <span className="badge badge-lg">{ORDER_STATUS[order.status] || order.status}</span>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {msg && <div className="alert-ok">{msg}</div>}

      <div className="two-col">
        <div>
          <div className="card">
            <h3>Itens</h3>
            <table className="table compact">
              <tbody>
                {order.items.map((it) => (
                  <tr key={it.id}>
                    <td><strong>{it.name}</strong>
                      {it.addons?.length > 0 && <div className="muted small">+ {it.addons.map((a) => a.name).join(', ')}</div>}
                    </td>
                    <td className="mono center">{it.quantity}×</td>
                    <td className="mono right">{formatBRL(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="totals slim">
              <div><span>Subtotal</span><strong>{formatBRL(order.subtotal)}</strong></div>
              <div><span>Desconto</span><strong>- {formatBRL(order.discount)}</strong></div>
              <div><span>Frete</span><strong>{formatBRL(order.shipping_cost)}</strong></div>
              <div className="totals-final"><span>Total</span><strong>{formatBRL(order.total)}</strong></div>
            </div>
          </div>
          {order.notes && <div className="card"><h3>Observações</h3><p>{order.notes}</p></div>}
        </div>

        <div>
          <div className="card">
            <h3>Cliente</h3>
            {order.customer
              ? <p><Link to={`/clientes/${order.customer.id}`}>{order.customer.name}</Link><br /><span className="muted">{order.customer.whatsapp || ''}</span></p>
              : <p className="muted">Sem cliente vinculado.</p>}
          </div>
          <div className="card">
            <h3>Endereço de entrega</h3>
            {order.address
              ? <p>{[order.address.street, order.address.number].filter(Boolean).join(', ')}<br />
                  <span className="muted">{[order.address.district, order.address.city, order.address.state].filter(Boolean).join(' · ')} {order.address.cep ? `· ${order.address.cep}` : ''}</span></p>
              : <p className="muted">Nenhum endereço definido.</p>}
          </div>
          <div className="card">
            <h3>Pagamento</h3>
            <p><span className="badge">{order.payment_status}</span> {order.payment_method || ''}</p>
          </div>

          {can('orders.write') && nexts.length > 0 && (
            <div className="card">
              <h3>Avançar status</h3>
              <div className="chips">
                {nexts.map((s) => (
                  <button key={s} className={`chip ${s === 'cancelado' ? 'chip-danger' : 'chip-on'}`}
                    onClick={() => changeStatus(s)}
                    disabled={s === 'cancelado' && !can('orders.cancel')}>
                    {ORDER_STATUS[s] || s}
                  </button>
                ))}
              </div>
              {!can('orders.cancel') && nexts.includes('cancelado') && <p className="muted small">Cancelamento exige permissão de expedição/admin.</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
