import { useEffect, useState, type FormEvent } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL, formatDate, ORDER_STATUS } from '../lib/format';

interface Address {
  id: string; label: string | null; recipient: string | null; cep: string | null;
  street: string | null; number: string | null; complement: string | null;
  district: string | null; city: string | null; state: string | null;
  reference: string | null; is_default: boolean;
}
interface Customer {
  id: string; name: string; phone: string | null; whatsapp: string | null; email: string | null;
  document: string | null; origin: string | null; status: string; notes_summary: string | null;
  do_not_contact: boolean; total_spent: number; orders_count: number;
  utm?: { source?: string | null; medium?: string | null; campaign?: string | null } | null;
}
interface Order { id: string; number: number; total: number; status: string; payment_status: string; created_at: string; channel: string | null; }

const ORDER_TONE: Record<string, string> = {
  pago: 'pill-ok', entregue: 'pill-ok', pos_venda: 'pill-ok',
  aguardando_etiqueta: 'pill-warn', etiqueta_gerada: 'pill-info', postado: 'pill-info', em_transito: 'pill-info', saiu_entrega: 'pill-info',
  problema: 'pill-bad', cancelado: 'pill-bad',
};

export default function CustomerDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [addingAddr, setAddingAddr] = useState(false);
  const writable = can('customers.write');

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ customer: Customer; addresses: Address[]; orders?: Order[] }>(`/api/customers?id=${id}`);
      setCustomer(data.customer);
      setAddresses(data.addresses);
      setOrders(data.orders || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao carregar.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, [id]);

  if (loading) return <div className="page"><p className="muted">Carregando…</p></div>;
  if (error) return <div className="page"><div className="alert-error">{error}</div></div>;
  if (!customer) return null;

  const paid = orders.filter((o) => o.payment_status === 'pago' && o.status !== 'cancelado');
  const totalSpent = paid.reduce((s, o) => s + Number(o.total || 0), 0) || customer.total_spent || 0;
  const nOrders = orders.length || customer.orders_count || 0;
  const ticket = paid.length ? totalSpent / paid.length : 0;
  const ultima = orders[0]?.created_at || null;
  const primeira = orders.length ? orders[orders.length - 1].created_at : null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="crumb"><Link to="/clientes">← Clientes</Link></p>
          <h1>{customer.name}</h1>
          <p className="muted">{customer.orders_count} pedido(s) · Total: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(customer.total_spent)}</p>
        </div>
        {writable && <button className="btn btn-ghost" onClick={() => setEditing((v) => !v)}>{editing ? 'Cancelar' : 'Editar dados'}</button>}
      </div>

      {editing
        ? <CustomerForm customer={customer} onSaved={() => { setEditing(false); load(); }} />
        : (
          <div className="card">
            <div className="detail-grid">
              <Info label="WhatsApp" value={customer.whatsapp} />
              <Info label="Telefone" value={customer.phone} />
              <Info label="E-mail" value={customer.email} />
              <Info label="CPF/CNPJ" value={customer.document} mono />
              <Info label="Origem" value={customer.origin} />
              {customer.utm?.campaign && <Info label="Campanha" value={customer.utm.campaign} />}
              {customer.utm?.source && <Info label="Origem (UTM)" value={customer.utm.source} />}
              <Info label="Status" value={customer.status} />
              <Info label="Não contatar" value={customer.do_not_contact ? 'Sim (opt-out)' : 'Não'} />
            </div>
            {customer.notes_summary && <p className="notes">{customer.notes_summary}</p>}
          </div>
        )}

      {!editing && (
        <div className="stat-strip" style={{ marginTop: 18 }}>
          <div className="stat"><div className="stat-lb">Pedidos</div><div className="stat-vl">{nOrders}</div></div>
          <div className="stat"><div className="stat-lb">Total gasto</div><div className="stat-vl">{formatBRL(totalSpent)}</div></div>
          <div className="stat"><div className="stat-lb">Ticket médio</div><div className="stat-vl">{formatBRL(ticket)}</div></div>
          <div className="stat"><div className="stat-lb">Última compra</div><div className="stat-vl" style={{ fontSize: '1.1rem' }}>{ultima ? formatDate(ultima) : '—'}</div>{primeira && primeira !== ultima && <div className="trend flat" style={{ marginTop: 6 }}>1ª: {formatDate(primeira)}</div>}</div>
        </div>
      )}

      {!editing && can('orders.read') && (
        <>
          <div className="sec-head" style={{ marginTop: 26 }}><h3>Histórico de pedidos</h3></div>
          {orders.length === 0
            ? <div className="att-calm">Nenhum pedido registrado para este cliente ainda.</div>
            : (
              <div className="card table-card">
                <table className="table">
                  <thead><tr><th>Pedido</th><th>Data</th><th className="right">Valor</th><th>Pagamento</th><th>Status</th></tr></thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id} className="row-link" onClick={() => navigate(`/pedidos/${o.id}`)}>
                        <td className="mono">#{o.number}</td>
                        <td className="mono">{formatDate(o.created_at)}</td>
                        <td className="right mono">{formatBRL(o.total)}</td>
                        <td><span className={`pill ${o.payment_status === 'pago' ? 'pill-ok' : ''}`}>{o.payment_status}</span></td>
                        <td><span className={`pill ${ORDER_TONE[o.status] || ''}`}>{ORDER_STATUS[o.status] || o.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}

      <div className="page-head" style={{ marginTop: 8 }}>
        <h3>Endereços</h3>
        {writable && <button className="btn btn-ghost" onClick={() => setAddingAddr((v) => !v)}>{addingAddr ? 'Fechar' : '+ Endereço'}</button>}
      </div>

      {addingAddr && writable && (
        <AddressForm customerId={customer.id} onSaved={() => { setAddingAddr(false); load(); }} />
      )}

      {addresses.length === 0 && <p className="muted">Nenhum endereço cadastrado.</p>}
      <div className="addr-list">
        {addresses.map((a) => (
          <div className="card addr-card" key={a.id}>
            {a.is_default && <span className="badge badge-ok">Padrão</span>}
            <strong>{a.label || 'Endereço'}</strong>
            <p>{[a.street, a.number].filter(Boolean).join(', ')}{a.complement ? ` — ${a.complement}` : ''}</p>
            <p className="muted">{[a.district, a.city, a.state].filter(Boolean).join(' · ')} {a.cep ? `· CEP ${a.cep}` : ''}</p>
            {a.reference && <p className="muted">Ref.: {a.reference}</p>}
            {writable && (
              <button className="btn-link" onClick={async () => {
                if (!confirm('Remover este endereço?')) return;
                await apiFetch(`/api/addresses?id=${a.id}`, { method: 'DELETE' });
                load();
              }}>Remover</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="info">
      <span className="info-label">{label}</span>
      <span className={mono ? 'mono' : ''}>{value || '—'}</span>
    </div>
  );
}

function CustomerForm({ customer, onSaved }: { customer: Customer; onSaved: () => void }) {
  const [f, setF] = useState({
    name: customer.name, whatsapp: customer.whatsapp || '', phone: customer.phone || '',
    email: customer.email || '', document: customer.document || '', status: customer.status,
    notes_summary: customer.notes_summary || '', do_not_contact: customer.do_not_contact,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await apiFetch(`/api/customers?id=${customer.id}`, { method: 'PATCH', body: JSON.stringify(f) });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setBusy(false); }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <label className="field"><span>Nome *</span><input value={f.name} onChange={(e) => set('name', e.target.value)} required /></label>
      <label className="field"><span>WhatsApp</span><input value={f.whatsapp} onChange={(e) => set('whatsapp', e.target.value)} /></label>
      <label className="field"><span>Telefone</span><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>
      <label className="field"><span>E-mail</span><input value={f.email} onChange={(e) => set('email', e.target.value)} /></label>
      <label className="field"><span>CPF/CNPJ</span><input value={f.document} onChange={(e) => set('document', e.target.value)} /></label>
      <label className="field"><span>Status</span>
        <select value={f.status} onChange={(e) => set('status', e.target.value)}>
          <option value="ativo">Ativo</option><option value="inativo">Inativo</option>
        </select></label>
      <label className="field span-all"><span>Observações</span>
        <input value={f.notes_summary} onChange={(e) => set('notes_summary', e.target.value)} /></label>
      <label className="field-check span-all">
        <input type="checkbox" checked={f.do_not_contact} onChange={(e) => set('do_not_contact', e.target.checked)} />
        <span>Não enviar mensagens promocionais (opt-out)</span>
      </label>
      {error && <div className="alert-error span-all">{error}</div>}
      <div className="span-all"><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button></div>
    </form>
  );
}

function AddressForm({ customerId, onSaved }: { customerId: string; onSaved: () => void }) {
  const [f, setF] = useState({
    label: '', recipient: '', cep: '', street: '', number: '', complement: '',
    district: '', city: '', state: '', reference: '', is_default: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await apiFetch('/api/addresses', { method: 'POST', body: JSON.stringify({ ...f, customer_id: customerId }) });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setBusy(false); }
  }

  return (
    <form className="card form-grid" onSubmit={submit}>
      <label className="field"><span>Identificação</span><input value={f.label} onChange={(e) => set('label', e.target.value)} placeholder="Casa, Trabalho…" /></label>
      <label className="field"><span>Destinatário</span><input value={f.recipient} onChange={(e) => set('recipient', e.target.value)} /></label>
      <label className="field"><span>CEP</span><input value={f.cep} onChange={(e) => set('cep', e.target.value)} /></label>
      <label className="field"><span>Rua</span><input value={f.street} onChange={(e) => set('street', e.target.value)} /></label>
      <label className="field"><span>Número</span><input value={f.number} onChange={(e) => set('number', e.target.value)} /></label>
      <label className="field"><span>Complemento</span><input value={f.complement} onChange={(e) => set('complement', e.target.value)} /></label>
      <label className="field"><span>Bairro</span><input value={f.district} onChange={(e) => set('district', e.target.value)} /></label>
      <label className="field"><span>Cidade</span><input value={f.city} onChange={(e) => set('city', e.target.value)} /></label>
      <label className="field"><span>UF</span><input value={f.state} maxLength={2} onChange={(e) => set('state', e.target.value)} /></label>
      <label className="field"><span>Referência</span><input value={f.reference} onChange={(e) => set('reference', e.target.value)} /></label>
      <label className="field-check span-all">
        <input type="checkbox" checked={f.is_default} onChange={(e) => set('is_default', e.target.checked)} />
        <span>Endereço padrão</span>
      </label>
      {error && <div className="alert-error span-all">{error}</div>}
      <div className="span-all"><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar endereço'}</button></div>
    </form>
  );
}
