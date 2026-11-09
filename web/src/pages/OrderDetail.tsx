import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import {
  formatBRL, formatDate, formatDateTime, ORDER_STATUS, ORDER_STATUS_TONE, NEXT_STATUS, pillClass,
} from '../lib/format';
import OrderAddress, { Address, enderecoCompleto } from '../components/OrderAddress';
import OrderPayment, { FORMAS } from '../components/OrderPayment';
import OrderCustomer from '../components/OrderCustomer';

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
  site: 'Site', catalogo: 'Site', whatsapp: 'WhatsApp', inbox: 'WhatsApp', manual: 'Manual', teste: 'Teste',
};

/* Nome de AÇÃO para cada transição da máquina de estados (os mesmos estados
   do banco; só muda o rótulo que o usuário lê). A lógica/ordem é preservada. */
const ACAO: Record<string, string> = {
  em_atendimento: 'Iniciar atendimento',
  aguardando_pagamento: 'Enviar para pagamento',
  pago: 'Registrar pagamento',
  aguardando_endereco: 'Aguardar endereço',
  aguardando_etiqueta: 'Preparar para etiqueta',
  etiqueta_gerada: 'Gerar etiqueta',
  postado: 'Registrar postagem',
  em_transito: 'Marcar em trânsito',
  saiu_entrega: 'Saiu para entrega',
  entregue: 'Marcar como entregue',
  problema: 'Registrar problema',
  pos_venda: 'Abrir pós-venda',
  cancelado: 'Cancelar pedido',
};

/* Ordem linear dos estados pós-pagamento, só para posicionar a linha do tempo
   de ENVIO (não é a máquina de estados — é leitura visual). */
const ORDEM = ['pago', 'aguardando_endereco', 'aguardando_etiqueta', 'etiqueta_gerada', 'postado', 'em_transito', 'saiu_entrega', 'entregue', 'pos_venda'];
/* Próximo passo "para a frente" sugerido a partir do estado atual. */
const AVANCO: Record<string, string> = {
  pago: 'aguardando_etiqueta', aguardando_endereco: 'aguardando_etiqueta',
  aguardando_etiqueta: 'etiqueta_gerada', etiqueta_gerada: 'postado',
  postado: 'em_transito', em_transito: 'saiu_entrega', saiu_entrega: 'entregue', entregue: 'pos_venda',
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
  const [payOpen, setPayOpen] = useState(0); // "ação principal" abre o card de pagamento

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
    if (status === 'cancelado' && !confirm(`Cancelar o pedido #${order?.number}?\n\nIsto encerra o pedido.`)) return;
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

  const o = order; // referência não-nula para os cálculos abaixo
  const pago = o.payment_status === 'pago';
  const estornado = o.payment_status === 'estornado';
  const enderecoOk = enderecoCompleto(o.address);
  const emProducao = cardsDoPedido > 0;
  const nexts = NEXT_STATUS[o.status] || [];
  const terminal = o.status === 'cancelado' || o.status === 'pos_venda';
  const podeEscrever = can('orders.write');
  const isTeste = o.channel === 'teste';

  /** Data/hora em que o pedido chegou a um status (pela auditoria). */
  function dataDoStatus(s: string): string | null {
    for (const h of history) if (h.new_value?.status === s) return h.created_at;
    return null;
  }

  /* Pre-condicoes: a maquina de estados do banco so valida a ORDEM dos
     passos, nunca se o passo faz sentido. Sem isto da para marcar
     'aguardando etiqueta' sem endereco e despachar sem pagamento. */
  function motivoBloqueio(destino: string): string {
    const exigeEndereco = ['aguardando_etiqueta', 'etiqueta_gerada', 'postado'];
    if (exigeEndereco.includes(destino) && !enderecoOk) return 'defina o endereço completo antes';
    if (destino === 'aguardando_etiqueta' && !pago) return 'registre o pagamento antes';
    if (destino === 'cancelado' && !can('orders.cancel')) return 'cancelamento exige permissão de expedição ou admin';
    return '';
  }

  const abrirPagamento = () => setPayOpen((n) => n + 1);
  const irParaEndereco = () => document.getElementById('card-endereco')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const formaLabel = o.payment_method ? (FORMAS.find((f) => f.key === o.payment_method)?.label || o.payment_method) : '';

  // ---- Ação principal recomendada + "o que falta" --------------------
  type Primary = { label: string; sub?: string; meta?: boolean; run: () => void };
  let primary: Primary | null = null;
  let primaryTarget: string | null = null; // transição de status coberta pela ação principal
  let falta = '';

  if (o.status === 'cancelado') {
    falta = 'Pedido cancelado.';
  } else if (o.status === 'pos_venda') {
    falta = 'Pedido concluído — em pós-venda.';
  } else if (!pago) {
    falta = 'Falta registrar o pagamento.';
    if (podeEscrever) primary = { label: 'Registrar pagamento', sub: 'Confirma a venda e envia o Purchase para a Meta.', meta: true, run: abrirPagamento };
  } else if (can('production.write') && !isTeste && !emProducao && (o.status === 'pago' || o.status === 'aguardando_endereco')) {
    primary = { label: 'Enviar para produção', sub: 'Cria um cartão por item no quadro de Produção.', run: enviarParaProducao };
    falta = 'Pago. Próximo passo sugerido: enviar para a produção.';
  } else if (!enderecoOk) {
    primary = { label: 'Completar endereço', sub: 'O endereço completo é necessário para gerar a etiqueta.', run: irParaEndereco };
    falta = 'Falta completar o endereço para gerar a etiqueta.';
  } else {
    const fwd = AVANCO[o.status];
    if (fwd && podeEscrever) {
      const motivo = motivoBloqueio(fwd);
      if (motivo) { falta = `Falta: ${motivo}.`; }
      else {
        primary = { label: ACAO[fwd], sub: '', run: () => changeStatus(fwd) };
        primaryTarget = fwd;
        falta = `Pronto para: ${ACAO[fwd].toLowerCase()}.`;
      }
    } else if (o.status === 'problema') {
      falta = 'Problema na entrega — escolha uma ação abaixo.';
    } else {
      falta = 'Escolha a próxima ação abaixo.';
    }
  }

  // ---- Ações secundárias (demais transições válidas) -----------------
  const secundarias = nexts.filter((s) => {
    if (s === primaryTarget) return false;         // já é a ação principal
    if (s === 'pago' && primary?.meta) return false; // pagamento já é a ação principal
    return true;
  });

  // ---- Linha do tempo (3 eixos) --------------------------------------
  type Step = { label: string; state: 'done' | 'current' | 'pending' | 'blocked'; date?: string | null };
  const tlPagamento: Step[] = [
    { label: 'Aguardando pagamento', state: pago ? 'done' : (estornado ? 'blocked' : 'current') },
    { label: pago && formaLabel ? `Pago · ${formaLabel}` : 'Pago', state: pago ? 'done' : 'pending', date: dataDoStatus('pago') },
  ];
  if (estornado) tlPagamento.push({ label: 'Estornado', state: 'blocked' });

  const tlProducao: Step[] = [
    { label: emProducao ? `Na produção · ${cardsDoPedido} cartão(ões)` : 'Enviar para produção',
      state: emProducao ? 'done' : (pago ? 'current' : 'pending') },
  ];

  const curIdx = ORDEM.indexOf(o.status);
  const tlEnvio: Step[] = ['aguardando_etiqueta', 'etiqueta_gerada', 'postado', 'em_transito', 'saiu_entrega', 'entregue'].map((k) => {
    const i = ORDEM.indexOf(k);
    const state: Step['state'] = o.status === k ? 'current' : (curIdx > i && curIdx >= 0 ? 'done' : 'pending');
    return { label: ORDER_STATUS[k], state, date: dataDoStatus(k) };
  });
  if (o.status === 'problema') tlEnvio.unshift({ label: 'Problema na entrega', state: 'blocked', date: dataDoStatus('problema') });

  const Timeline = ({ steps }: { steps: Step[] }) => (
    <ul className="otl-steps">
      {steps.map((s, i) => (
        <li key={i} className={`otl-step ${s.state}`}>
          <span className="otl-dot" />
          <span className="otl-lb">{s.label}{s.date && <span className="otl-date"> · {formatDateTime(s.date)}</span>}</span>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="crumb"><Link to="/pedidos">← Pedidos</Link></p>
          <h1>
            Pedido #{o.number}{' '}
            <span className={pillClass(ORDER_STATUS_TONE[o.status])} style={{ verticalAlign: 'middle', fontSize: '.8rem', padding: '5px 13px' }} title={`status: ${o.status}`}>
              {ORDER_STATUS[o.status] || o.status}
            </span>
            {isTeste && <span className="pill pill-warn" style={{ verticalAlign: 'middle', fontSize: '.72rem', marginLeft: 6 }} title="Pedido de teste — fora de faturamento/relatórios">TESTE</span>}
          </h1>
          <p className="muted">Criado em {formatDate(o.created_at)} · {CHANNEL_LABEL[o.channel || ''] || o.channel || '—'}</p>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {msg && <div className="alert-ok">{msg}</div>}

      {/* Ação principal recomendada */}
      {terminal ? (
        <div className="att-calm" style={{ marginBottom: 18 }}>
          <span className={`dot ${o.status === 'cancelado' ? 'bad' : 'ok'}`} /> {falta}
        </div>
      ) : (
        <div className="next-action">
          <div className="na-body">
            <div className="na-h">Próxima ação</div>
            <div className="na-falta">{falta}</div>
            {primary?.sub && <div className="na-sub">{primary.sub}</div>}
          </div>
          {primary && podeEscrever && (
            <button className="btn btn-primary na-btn" onClick={primary.run} disabled={enviandoProd}>
              {enviandoProd && primary.label.includes('produção') ? 'Enviando…' : primary.label}
            </button>
          )}
        </div>
      )}

      <div className="two-col">
        <div>
          {/* Linha do tempo */}
          <div className="card">
            <h3>Linha do tempo</h3>
            <div className="otimeline">
              <div className="otl-axis"><div className="otl-axis-h">Pagamento</div><Timeline steps={tlPagamento} /></div>
              <div className="otl-axis">
                <div className="otl-axis-h">Produção</div><Timeline steps={tlProducao} />
                {emProducao && <Link className="btn-link small" to="/producao">ver no quadro</Link>}
              </div>
              <div className="otl-axis"><div className="otl-axis-h">Envio</div><Timeline steps={tlEnvio} /></div>
            </div>
          </div>

          <div className="card">
            <h3>Itens</h3>
            <table className="table compact">
              <tbody>
                {o.items.map((it) => (
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
            {can('production.write') && !isTeste && (
              emProducao
                ? <p className="muted small">Já está na produção ({cardsDoPedido} cartão/cartões). <Link to="/producao">ver quadro</Link></p>
                : <button className="btn btn-ghost btn-sm" disabled={enviandoProd || o.items.length === 0} onClick={enviarParaProducao}>
                    {enviandoProd ? 'Enviando…' : 'Enviar para produção'}
                  </button>
            )}
            <div className="totals slim">
              <div><span>Subtotal</span><strong>{formatBRL(o.subtotal)}</strong></div>
              <div><span>Desconto</span><strong>- {formatBRL(o.discount)}</strong></div>
              <div><span>Frete</span><strong>{formatBRL(o.shipping_cost)}</strong></div>
              <div className="totals-final"><span>Total</span><strong>{formatBRL(o.total)}</strong></div>
            </div>
          </div>
          {o.notes && <div className="card"><h3>Observações</h3><p>{o.notes}</p></div>}

          {history.length > 0 && (
            <div className="card">
              <h3>Histórico</h3>
              <ul className="track-list">
                {history.map((h, i) => (
                  <li key={i}>
                    <span className="track-dot" />
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
          {/* Outras ações disponíveis (demais transições válidas) */}
          {!terminal && podeEscrever && secundarias.length > 0 && (
            <div className="card">
              <h3>Outras ações</h3>
              <div className="action-list">
                {secundarias.map((s) => {
                  if (s === 'pago') {
                    return <button key={s} className="btn btn-ghost btn-block" onClick={abrirPagamento}>Registrar pagamento</button>;
                  }
                  const motivo = motivoBloqueio(s);
                  const danger = s === 'cancelado';
                  return (
                    <button key={s} className={`btn btn-ghost btn-block${danger ? ' btn-danger' : ''}`}
                      onClick={() => changeStatus(s)} disabled={Boolean(motivo)} title={motivo || undefined}>
                      {ACAO[s] || ORDER_STATUS[s] || s}
                    </button>
                  );
                })}
              </div>
              {secundarias.map((s) => motivoBloqueio(s) ? (
                <p key={s} className="muted small" style={{ marginTop: 6 }}>{ACAO[s] || ORDER_STATUS[s]}: {motivoBloqueio(s)}.</p>
              ) : null)}
            </div>
          )}

          <OrderCustomer orderId={o.id} customer={o.customer} onChanged={load} />
          <div id="card-endereco">
            <OrderAddress orderId={o.id} customerId={o.customer?.id ?? null} address={o.address} onChanged={load} />
          </div>
          <OrderPayment orderId={o.id} status={o.status}
            paymentStatus={o.payment_status} paymentMethod={o.payment_method}
            onChanged={load} openSignal={payOpen} />

          <div className="card">
            <h3>Origem</h3>
            <p><span className="badge">{o.channel ? (CHANNEL_LABEL[o.channel] || o.channel) : '—'}</span></p>
            {o.utm && (o.utm.source || o.utm.medium || o.utm.campaign || o.utm.content || o.utm.term) && (
              <ul className="muted small" style={{ margin: '8px 0 0', paddingLeft: 16 }}>
                {o.utm.source && <li>Origem: {o.utm.source}</li>}
                {o.utm.medium && <li>Mídia: {o.utm.medium}</li>}
                {o.utm.campaign && <li>Campanha: {o.utm.campaign}</li>}
                {o.utm.content && <li>Conteúdo: {o.utm.content}</li>}
                {o.utm.term && <li>Termo: {o.utm.term}</li>}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
