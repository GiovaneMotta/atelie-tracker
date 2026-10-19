import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL, formatDate, formatDateTime, ORDER_STATUS, NEXT_STATUS } from '../lib/format';
import OrderAddress, { Address, enderecoCompleto } from '../components/OrderAddress';
import OrderPayment from '../components/OrderPayment';

interface Item { id: string; name: string; sku: string | null; quantity: number; unit_price: number; line_total: number;
  addons: { name: string; price: number }[]; customization?: Record<string, unknown> | null; }

/** Nome a ser bordado. O site grava em customization.nome (create_site_order);
    baby_name fica aceito por causa dos pedidos criados antes do alinhamento. */
function nomeBordado(it: Item): string {
  const c = it.customization ?? {};
  const v = c.nome ?? c.baby_name;
  return typeof v === 'string' ? v.trim() : '';
}
interface Utm { source?: string | null; medium?: string | null; campaign?: string | null; content?: string | null; term?: string | null; }
interface Order {
  id: string; number: number; status: string; payment_status: string; payment_method: string | null;
  subtotal: number; discount: number; shipping_cost: number; total: number; notes: string | null; created_at: string;
  channel: string | null; utm: Utm | null;
  customer: { id: string; name: string; whatsapp: string | null; phone?: string | null; document: string | null } | null;
  address: Address | null; items: Item[];
}
interface HistoryRow { action: string; reason: string | null; old_value: any; new_value: any; created_at: string; actor: { name: string } | null; }

const CHANNEL_LABEL: Record<string, string> = {
  site: 'Site', catalogo: 'Site', whatsapp: 'WhatsApp', inbox: 'WhatsApp', manual: 'Manual',
};

function historyLabel(h: HistoryRow): string {
  if (h.action === 'create') return 'Pedido criado' + (h.new_value?.source === 'site' ? ' pelo site' : '');
  if (h.reason === 'Mudança de status' || h.new_value?.status) {
    const s = h.new_value?.status;
    return 'Status: ' + (s ? (ORDER_STATUS[s] || s) : '—');
  }
  return h.reason || h.action;
}

export default function OrderDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const [order, setOrder] = useState<Order | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [enviandoProd, setEnviandoProd] = useState(false);
  const [cardsDoPedido, setCardsDoPedido] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ order: Order; history: HistoryRow[] }>(`/api/orders?id=${id}`);
      setOrder(data.order);
      setHistory(data.history || []);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [id]);

  /* O cartao de producao nasce manual neste painel. Contamos os que ja
     existem para este pedido, para nao duplicar a linha de producao. */
  useEffect(() => {
    if (!order) return;
    let vivo = true;
    apiFetch<{ cards: { order_id: string | null }[] }>('/api/production')
      .then((d) => { if (vivo) setCardsDoPedido((d.cards ?? []).filter((c) => c.order_id === order.id).length); })
      .catch(() => {});
    return () => { vivo = false; };
  }, [order]);

  async function enviarParaProducao() {
    if (!order) return;
    setEnviandoProd(true); setError(''); setMsg('');
    try {
      for (const it of order.items) {
        await apiFetch('/api/production', {
          method: 'POST',
          body: JSON.stringify({
            title: it.quantity > 1 ? it.name + ' (' + it.quantity + 'x)' : it.name,
            order_id: order.id,
            customer_id: order.customer?.id ?? null,
            custom: { baby_name: nomeBordado(it), notes: it.sku ? 'SKU ' + it.sku : '' },
          }),
        });
      }
      setCardsDoPedido(order.items.length);
      setMsg(order.items.length + ' cartão(ões) criado(s) na produção.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao enviar para produção.');
    } finally { setEnviandoProd(false); }
  }

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

  /* Pre-condicoes: a maquina de estados do banco so valida a ORDEM dos
     passos, nunca se o passo faz sentido. Sem isto da para marcar
     'aguardando etiqueta' sem endereco e despachar sem pagamento. */
  /* Tres eixos independentes, como nos back-offices de e-commerce:
     pagamento, producao e envio contam coisas diferentes e nao cabem
     numa fila unica de 13 degraus. */
  const ENVIADOS = ['postado', 'em_transito', 'saiu_entrega', 'entregue', 'pos_venda'];
  const faixaPagamento = order.payment_status === 'pago'
    ? { classe: 'ok', texto: 'Pago' }
    : { classe: 'pendente', texto: 'A receber' };
  const faixaProducao = cardsDoPedido > 0
    ? { classe: 'ok', texto: cardsDoPedido + ' na linha' }
    : { classe: 'pendente', texto: 'Não enviado' };
  const faixaEnvio = order.status === 'entregue' || order.status === 'pos_venda'
    ? { classe: 'ok', texto: 'Entregue' }
    : ENVIADOS.includes(order.status)
      ? { classe: 'ok', texto: 'A caminho' }
      : enderecoCompleto(order.address)
        ? { classe: 'pendente', texto: 'Pronto para etiqueta' }
        : { classe: 'pendente', texto: 'Sem endereço' };

  function motivoBloqueio(destino: string): string {
    const o = order;
    if (!o) return '';
    const exigeEndereco = ['aguardando_etiqueta', 'etiqueta_gerada', 'postado'];
    if (exigeEndereco.includes(destino) && !enderecoCompleto(o.address)) {
      return 'defina o endereço completo antes';
    }
    if (destino === 'aguardando_etiqueta' && o.payment_status !== 'pago') {
      return 'registre o pagamento antes';
    }
    if (destino === 'cancelado' && !can('orders.cancel')) {
      return 'cancelamento exige permissão de expedição ou admin';
    }
    return '';
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="crumb"><Link to="/pedidos">← Pedidos</Link></p>
          <h1>Pedido #{order.number}</h1>
          <p className="muted">Criado em {formatDate(order.created_at)}</p>
          <div className="faixas">
            <span className={'faixa ' + faixaPagamento.classe}><span className="ponto" />Pagamento: <b>{faixaPagamento.texto}</b></span>
            <span className={'faixa ' + faixaProducao.classe}><span className="ponto" />Produção: <b>{faixaProducao.texto}</b></span>
            <span className={'faixa ' + faixaEnvio.classe}><span className="ponto" />Envio: <b>{faixaEnvio.texto}</b></span>
          </div>
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
                      {nomeBordado(it) && <div className="bordado-tag">Bordar: {nomeBordado(it)}</div>}
                    </td>
                    <td className="mono center">{it.quantity}×</td>
                    <td className="mono right">{formatBRL(it.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {can('production.write') && (
              cardsDoPedido > 0
                ? <p className="muted small">Já está na produção ({cardsDoPedido} cartão/cartões). <Link to="/producao">ver quadro</Link></p>
                : <button className="btn btn-ghost btn-sm" disabled={enviandoProd || order.items.length === 0} onClick={enviarParaProducao}>
                    {enviandoProd ? 'Enviando…' : 'Enviar para produção'}
                  </button>
            )}
            <div className="totals slim">
              <div><span>Subtotal</span><strong>{formatBRL(order.subtotal)}</strong></div>
              <div><span>Desconto</span><strong>- {formatBRL(order.discount)}</strong></div>
              <div><span>Frete</span><strong>{formatBRL(order.shipping_cost)}</strong></div>
              <div className="totals-final"><span>Total</span><strong>{formatBRL(order.total)}</strong></div>
            </div>
          </div>
          {order.notes && <div className="card"><h3>Observações</h3><p>{order.notes}</p></div>}

          {history.length > 0 && (
            <div className="card">
              <h3>Histórico</h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {history.map((h, i) => (
                  <li key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderTop: i ? '1px solid #eef0f3' : 'none' }}>
                    <span style={{ marginTop: 5, width: 8, height: 8, borderRadius: 999, background: '#c9836a', flex: '0 0 auto' }} />
                    <div>
                      <div>{historyLabel(h)}{h.actor?.name ? <span className="muted small"> · {h.actor.name}</span> : null}</div>
                      <div className="muted small">{formatDateTime(h.created_at)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div>
          <div className="card">
            <h3>Cliente</h3>
            {order.customer
              ? <p><Link to={`/clientes/${order.customer.id}`}>{order.customer.name}</Link><br /><span className="muted">{order.customer.whatsapp || ''}</span></p>
              : <p className="muted">Sem cliente vinculado.</p>}
          </div>
          <OrderAddress orderId={order.id} customerId={order.customer?.id ?? null}
            address={order.address} onChanged={load} />
          <OrderPayment orderId={order.id} status={order.status}
            paymentStatus={order.payment_status} paymentMethod={order.payment_method}
            onChanged={load} />

          <div className="card">
            <h3>Origem</h3>
            <p><span className="badge">{order.channel ? (CHANNEL_LABEL[order.channel] || order.channel) : '—'}</span></p>
            {order.utm && (order.utm.source || order.utm.medium || order.utm.campaign || order.utm.content || order.utm.term) && (
              <ul className="muted small" style={{ margin: '8px 0 0', paddingLeft: 16 }}>
                {order.utm.source && <li>Origem: {order.utm.source}</li>}
                {order.utm.medium && <li>Mídia: {order.utm.medium}</li>}
                {order.utm.campaign && <li>Campanha: {order.utm.campaign}</li>}
                {order.utm.content && <li>Conteúdo: {order.utm.content}</li>}
                {order.utm.term && <li>Termo: {order.utm.term}</li>}
              </ul>
            )}
          </div>

          {can('orders.write') && nexts.length > 0 && (
            <div className="card">
              <h3>Avançar status</h3>
              <div className="chips">
                {nexts.map((s) => {
                  const motivo = motivoBloqueio(s);
                  return (
                    <button key={s} className={`chip ${s === 'cancelado' ? 'chip-danger' : 'chip-on'}`}
                      onClick={() => changeStatus(s)}
                      disabled={Boolean(motivo)}
                      title={motivo || undefined}>
                      {ORDER_STATUS[s] || s}
                    </button>
                  );
                })}
              </div>
              {nexts.map((s) => motivoBloqueio(s) ? (
                <p key={s} className="muted small">{ORDER_STATUS[s] || s}: {motivoBloqueio(s)}.</p>
              ) : null)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
