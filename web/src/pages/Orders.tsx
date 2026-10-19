import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL, formatDate, ORDER_STATUS, displaySrc, thumbSrc } from '../lib/format';

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
interface PickVariant { id: string; size: string | null; color: string | null; price_delta: number | null; is_active?: boolean; }
interface PickProduct { id: string; name: string; sku: string | null; price_cash: number | null; images?: string[] | null; product_categories?: { category: string | null }[]; product_variants?: PickVariant[]; }
/* variant = tamanho/cor. O servidor cobra price_cash + price_delta e rotula o item
   como "Nome — RN", entao a linha precisa carregar a variante escolhida. */
interface Line { product: PickProduct; variant: PickVariant | null; quantity: number; nomeBebe: string; }

/* Bordar o nome do bebe e o diferencial do atelie e aparece em toda descricao,
   mas nao e adicional pago: vai como personalizacao livre do item. */
const CHAVE_NOME = 'nome_bebe';

function ProdThumb({ url }: { url?: string | null }) {
  const [src, setSrc] = useState(url ? thumbSrc(url) : '');
  if (!url) return <span className="prod-thumb prod-thumb-empty" aria-hidden="true" />;
  return (
    <img className="prod-thumb" src={src} alt="" loading="lazy" decoding="async"
      onError={() => { const cheia = displaySrc(url); if (src !== cheia) setSrc(cheia); }} />
  );
}

function activeVariants(p: PickProduct): PickVariant[] {
  return (p.product_variants ?? []).filter((v) => v.is_active !== false);
}
function variantLabel(v: PickVariant): string {
  return [v.size, v.color].filter(Boolean).join(' / ') || 'Único';
}
function unitPrice(l: Line): number {
  return Number(l.product.price_cash || 0) + Number(l.variant?.price_delta || 0);
}

function NewOrder({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const [customer, setCustomer] = useState<PickCustomer | null>(null);
  const [custQuery, setCustQuery] = useState('');
  const [custResults, setCustResults] = useState<PickCustomer[]>([]);
  const [prodQuery, setProdQuery] = useState('');
  const [catalogo, setCatalogo] = useState<PickProduct[]>([]);
  const [carregandoCat, setCarregandoCat] = useState(true);
  const [erroCat, setErroCat] = useState('');
  const [categoria, setCategoria] = useState('todos');
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
  /* 45 pecas cabem na memoria: carrega uma vez e filtra local,
     em vez de uma requisicao por tecla digitada. */
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const data = await apiFetch<{ products: PickProduct[] }>('/api/products?status=ativo');
        if (vivo) setCatalogo(data.products ?? []);
      } catch {
        if (vivo) setErroCat('Não foi possível carregar o catálogo.');
      } finally {
        if (vivo) setCarregandoCat(false);
      }
    })();
    return () => { vivo = false; };
  }, []);

  const categorias = useMemo(() => {
    const achadas = new Set<string>();
    for (const prod of catalogo) {
      for (const c of prod.product_categories ?? []) if (c.category) achadas.add(c.category);
    }
    return Array.from(achadas).sort();
  }, [catalogo]);

  const visiveis = useMemo(() => {
    const busca = prodQuery.trim().toLowerCase();
    return catalogo.filter((prod) => {
      if (categoria !== 'todos' && !(prod.product_categories ?? []).some((c) => c.category === categoria)) return false;
      if (!busca) return true;
      return prod.name.toLowerCase().includes(busca) || (prod.sku ?? '').toLowerCase().includes(busca);
    });
  }, [catalogo, categoria, prodQuery]);
  function addLine(p: PickProduct) {
    const vs = activeVariants(p);
    const inicial = vs.length === 1 ? vs[0] : null;   // tamanho unico ja entra escolhido
    setLines((cur) => {
      const found = cur.find((l) => l.product.id === p.id && (l.variant?.id ?? null) === (inicial?.id ?? null) && !l.nomeBebe);
      if (found) return cur.map((l) => l === found ? { ...l, quantity: l.quantity + 1 } : l);
      return [...cur, { product: p, variant: inicial, quantity: 1, nomeBebe: '' }];
    });
    setProdQuery('');
  }
  function setVariant(i: number, v: PickVariant) {
    setLines((cur) => {
      const alvo = { ...cur[i], variant: v };
      /* se ja existe a mesma peca no mesmo tamanho, junta as duas linhas */
      const gemeo = cur.findIndex((l, j) => j !== i && l.product.id === alvo.product.id && l.variant?.id === v.id && l.nomeBebe === alvo.nomeBebe);
      if (gemeo >= 0) {
        return cur
          .map((l, j) => j === gemeo ? { ...l, quantity: l.quantity + alvo.quantity } : l)
          .filter((_, j) => j !== i);
      }
      return cur.map((l, j) => j === i ? alvo : l);
    });
  }

  const subtotal = lines.reduce((s, l) => s + unitPrice(l) * l.quantity, 0);
  /* peca com mais de um tamanho exige escolha: sem isso a producao recebe o pedido em aberto */
  const semTamanho = lines.filter((l) => !l.variant && activeVariants(l.product).length > 1);
  const total = Math.max(0, subtotal - (parseFloat(discount.replace(',', '.')) || 0));

  async function save() {
    setBusy(true); setError('');
    try {
      const payload = {
        customer_id: customer?.id || null,
        items: lines.map((l) => ({
          product_id: l.product.id,
          variant_id: l.variant?.id ?? null,
          quantity: l.quantity,
          customization: l.nomeBebe.trim() ? { [CHAVE_NOME]: l.nomeBebe.trim() } : {},
        })),
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
          <input placeholder="Buscar por nome ou SKU…" value={prodQuery} onChange={(e) => setProdQuery(e.target.value)} />

          {categorias.length > 1 && (
            <div className="cat-tabs">
              <button type="button" className={'cat-tab' + (categoria === 'todos' ? ' is-on' : '')}
                onClick={() => setCategoria('todos')}>Todos</button>
              {categorias.map((c) => (
                <button key={c} type="button" className={'cat-tab' + (categoria === c ? ' is-on' : '')}
                  onClick={() => setCategoria(c)}>{c.charAt(0).toUpperCase() + c.slice(1)}</button>
              ))}
            </div>
          )}

          {carregandoCat && <p className="muted small">Carregando catálogo…</p>}
          {erroCat && <div className="alert-error">{erroCat}</div>}

          {!carregandoCat && !erroCat && (
            <>
              <p className="muted small">{visiveis.length} peça(s)</p>
              <div className="prod-list">
                {visiveis.map((prod) => (
                  <button key={prod.id} className="picker-opt with-thumb" onClick={() => addLine(prod)}>
                    <ProdThumb key={prod.id} url={prod.images?.[0]} />
                    <span style={{ flex: 1 }}>{prod.name}</span>
                    {prod.sku && <span className="muted small">{prod.sku}</span>}
                    <span className="muted">{prod.price_cash != null ? formatBRL(prod.price_cash) : ''}</span>
                  </button>
                ))}
                {visiveis.length === 0 && <p className="muted small">Nenhuma peça encontrada.</p>}
              </div>
            </>
          )}
        </div>
        {lines.length === 0 && <p className="muted">Nenhum item adicionado.</p>}
        {lines.map((l, i) => {
          const vs = activeVariants(l.product);
          return (
            <div className="order-line" key={l.product.id + '-' + (l.variant?.id ?? 'sem') + '-' + i}>
              <div className="row-inline">
                <ProdThumb key={l.product.id} url={l.product.images?.[0]} />
                <span style={{ flex: 1 }}>{l.product.name}</span>
                <input type="number" min={1} value={l.quantity} style={{ width: 70 }}
                  onChange={(e) => setLines((cur) => cur.map((x, j) => j === i ? { ...x, quantity: Math.max(1, parseInt(e.target.value) || 1) } : x))} />
                <span className="mono">{formatBRL(unitPrice(l) * l.quantity)}</span>
                <button className="btn-link" onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}>✕</button>
              </div>
              {vs.length > 1 && (
                <div className="size-row">
                  <span className="muted small">Tamanho</span>
                  {vs.map((v) => (
                    <button key={v.id} type="button"
                      className={'size-chip' + (l.variant?.id === v.id ? ' is-on' : '')}
                      onClick={() => setVariant(i, v)}>{variantLabel(v)}</button>
                  ))}
                  {!l.variant && <span className="size-warn">escolha o tamanho</span>}
                </div>
              )}
              {vs.length === 1 && l.variant && (
                <div className="size-row"><span className="muted small">Tamanho {variantLabel(l.variant)}</span></div>
              )}
              <div className="size-row">
                <label className="bordado">
                  <span className="muted small">Bordar nome</span>
                  <input value={l.nomeBebe} placeholder="nome do bebê (opcional)" maxLength={40}
                    onChange={(e) => setLines((cur) => cur.map((x, j) => j === i ? { ...x, nomeBebe: e.target.value } : x))} />
                </label>
              </div>
            </div>
          );
        })}
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

      {semTamanho.length > 0 && (
        <div className="alert-error">Escolha o tamanho de: {semTamanho.map((l) => l.product.name).join(', ')}.</div>
      )}
      {error && <div className="alert-error">{error}</div>}
      <div className="form-actions">
        <button className="btn btn-primary" disabled={busy || lines.length === 0 || semTamanho.length > 0} onClick={save}>{busy ? 'Criando…' : 'Criar pedido'}</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
