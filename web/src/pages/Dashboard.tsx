import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DollarSign, ShoppingBag, BarChart2, Users, Package, Percent,
  TrendingUp, TrendingDown, AlertTriangle, Truck, Boxes, RefreshCw,
  ArrowRight, ArrowUpRight, Info,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/api';
import { formatBRL, formatDate, ORDER_STATUS } from '../lib/format';

/* ---------- tipos ---------- */
interface Metric { value: number; prev?: number; has_prev?: boolean; }
interface Dash {
  period: { label: string };
  flags: { analytics_connected: boolean; utm_available: boolean };
  can: { orders: boolean; products: boolean };
  sales?: { revenue: Metric; orders: Metric; ticket: Metric; items: Metric; customers: Metric };
  by_status?: Record<string, number>;
  attention?: { aguardando_pagamento?: number; a_enviar?: number; esgotados?: number };
  by_channel?: { channel: string; pedidos: number; receita: number; pct: number }[];
  top_products?: { name: string; qty: number; receita: number }[];
  revenue_series?: { days: number; current: number[]; previous: number[] };
  stock?: { esgotados: number; disponiveis: number; inativos: number; baixo: number | null; inventory_configured: boolean; total: number };
  recent_orders?: { id: string; number: number; total: number; status: string; payment_status: string; created_at: string; customer: string | null; resumo: string; itens: number }[];
}
interface Ship { envios_hoje: number; by_status: Record<string, number>; frete_mes: number; }

const PERIODS: { v: string; l: string }[] = [
  { v: 'hoje', l: 'Hoje' }, { v: 'ontem', l: 'Ontem' }, { v: '7d', l: 'Últimos 7 dias' },
  { v: '30d', l: 'Últimos 30 dias' }, { v: 'mes_atual', l: 'Mês atual' },
  { v: 'mes_anterior', l: 'Mês anterior' }, { v: '3m', l: 'Últimos 3 meses' },
];

const ORDER_TONE: Record<string, string> = {
  pago: 'pill-ok', entregue: 'pill-ok', pos_venda: 'pill-ok',
  aguardando_endereco: 'pill-warn', aguardando_etiqueta: 'pill-warn',
  etiqueta_gerada: 'pill-info', postado: 'pill-info', em_transito: 'pill-info', saiu_entrega: 'pill-info',
  problema: 'pill-bad', cancelado: 'pill-bad',
};
const PAY_TONE: Record<string, string> = { pago: 'pill-ok', estornado: 'pill-bad', falhou: 'pill-bad' };
const PAY_LABEL: Record<string, string> = { pago: 'Pago', pendente: 'Aguardando', estornado: 'Estornado', falhou: 'Falhou' };
const STATUS_ORDER = ['aguardando_pagamento', 'pago', 'aguardando_etiqueta', 'etiqueta_gerada', 'postado', 'em_transito', 'entregue', 'cancelado'];
const STATUS_DOT: Record<string, string> = {
  aguardando_pagamento: 'var(--ink-faint)', pago: 'var(--ok)', aguardando_etiqueta: 'var(--warn)',
  etiqueta_gerada: 'var(--info)', postado: 'var(--info)', em_transito: 'var(--info)',
  entregue: 'var(--ok)', cancelado: 'var(--bad)',
};

function Delta({ m }: { m?: Metric }) {
  if (!m || !m.has_prev || !m.prev) return <div className="trend flat">sem base de comparação</div>;
  const pct = ((m.value - m.prev) / m.prev) * 100;
  const up = pct >= 0;
  return (
    <div className={`trend ${up ? 'up' : 'down'}`}>
      {up ? <TrendingUp /> : <TrendingDown />}{Math.abs(pct).toFixed(1).replace('.', ',')}% <em>vs. período anterior</em>
    </div>
  );
}

function RevenueChart({ s }: { s?: { current: number[]; previous: number[] } }) {
  const cur = s?.current || [], prev = s?.previous || [];
  const W = 640, H = 180;
  const max = Math.max(1, ...cur, ...prev);
  const pts = (a: number[]) => a.map((v, i) => [a.length > 1 ? (i / (a.length - 1)) * W : 0, H - (v / max) * H] as [number, number]);
  const toLine = (p: [number, number][]) => p.length ? 'M ' + p.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(' L ') : '';
  const cp = pts(cur), pp = pts(prev);
  const hasData = [...cur, ...prev].some((v) => v > 0);
  if (!hasData) return <div className="chart-empty">Sem faturamento pago no período.<br />Assim que houver pedidos pagos, a curva aparece aqui.</div>;
  const end = cp[cp.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Faturamento no período">
      <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stopColor="var(--terracota)" stopOpacity="0.16" /><stop offset="1" stopColor="var(--terracota)" stopOpacity="0" />
      </linearGradient></defs>
      <line x1="0" y1={H * 0.25} x2={W} y2={H * 0.25} stroke="var(--line-soft)" />
      <line x1="0" y1={H * 0.5} x2={W} y2={H * 0.5} stroke="var(--line-soft)" />
      <line x1="0" y1={H * 0.75} x2={W} y2={H * 0.75} stroke="var(--line-soft)" />
      {pp.length > 1 && <path d={toLine(pp)} fill="none" stroke="var(--line)" strokeWidth="2" />}
      {cp.length > 1 && <path d={`${toLine(cp)} L ${W} ${H} L 0 ${H} Z`} fill="url(#rev)" stroke="none" />}
      {cp.length > 1 && <path d={toLine(cp)} fill="none" stroke="var(--terracota)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />}
      {end && <circle cx={end[0]} cy={end[1]} r="4.5" fill="var(--terracota)" stroke="var(--surface)" strokeWidth="2.5" />}
    </svg>
  );
}

export default function Dashboard() {
  const { me } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState('30d');
  const [d, setD] = useState<Dash | null>(null);
  const [ship, setShip] = useState<Ship | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(p = period) {
    setLoading(true); setError('');
    try {
      const dash = await apiFetch<Dash>(`/api/dashboard?period=${p}`);
      setD(dash);
      if (dash.can?.orders) apiFetch<Ship>(`/api/shipping-stats`).then(setShip).catch(() => setShip(null));
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao carregar.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(period); /* eslint-disable-next-line */ }, [period]);

  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const sales = d?.sales;
  const att = d?.attention || {};
  const attItems = [
    { n: att.aguardando_pagamento || 0, tx: 'pagamentos aguardando', tone: 'warn', to: '/pedidos', ico: <DollarSign /> },
    { n: att.a_enviar || 0, tx: 'pedidos para enviar', tone: 'info', to: '/expedicao', ico: <Truck /> },
    { n: att.esgotados || 0, tx: 'produtos esgotados', tone: 'bad', to: '/produtos', ico: <Boxes /> },
  ].filter((x) => x.n > 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{greet}, {me?.name?.split(' ')[0] || 'bem-vinda'}</h1>
          <p className="dash-sub">Veja como está a loja — {d?.period?.label?.toLowerCase() || 'carregando…'}.</p>
        </div>
        <div className="dash-controls">
          <label className="period-select">
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              {PERIODS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}
            </select>
          </label>
          <button className="dash-refresh" title="Atualizar" onClick={() => load()} aria-label="Atualizar"><RefreshCw style={{ width: 16, height: 16 }} /></button>
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      {/* KPIs */}
      <div className="stat-strip">
        <div className="stat"><div className="stat-lb"><DollarSign /> Faturamento</div>
          <div className="stat-vl">{sales ? formatBRL(sales.revenue.value) : '—'}</div><Delta m={sales?.revenue} /></div>
        <div className="stat"><div className="stat-lb"><ShoppingBag /> Pedidos</div>
          <div className="stat-vl">{sales ? sales.orders.value : '—'}</div><Delta m={sales?.orders} /></div>
        <div className="stat"><div className="stat-lb"><BarChart2 /> Ticket médio</div>
          <div className="stat-vl">{sales ? formatBRL(sales.ticket.value) : '—'}</div><Delta m={sales?.ticket} /></div>
        <div className="stat"><div className="stat-lb"><Package /> Itens vendidos</div>
          <div className="stat-vl">{sales ? sales.items.value : '—'}</div></div>
        <div className="stat"><div className="stat-lb"><Users /> Clientes</div>
          <div className="stat-vl">{sales ? sales.customers.value : '—'}</div></div>
        <div className="stat"><div className="stat-lb"><Percent /> Conversão</div>
          <div className="stat-vl na">não conectado</div></div>
      </div>

      {/* Atenção necessária */}
      <div className="sec-head"><h3>Precisa da sua atenção</h3></div>
      {attItems.length > 0 ? (
        <div className="attention">
          {attItems.map((a, i) => (
            <button key={i} className="att" onClick={() => navigate(a.to)}>
              <span className={`att-ico ${a.tone}`}>{a.ico}</span>
              <span><span className="att-n">{a.n}</span><span className="att-tx">{a.tx}</span></span>
            </button>
          ))}
        </div>
      ) : (
        <div className="att-calm"><span className="dot ok" /> Tudo em dia — nenhuma pendência operacional agora.</div>
      )}

      {/* Faturamento + Operação */}
      <div className="dash-2" style={{ marginTop: 24 }}>
        <div className="pnl">
          <div className="pnl-h"><h3>Faturamento</h3><span className="link" onClick={() => navigate('/financeiro')}>Financeiro <ArrowRight /></span></div>
          <div className="chartwrap">
            <div className="chart-lgd"><span><i style={{ background: 'var(--terracota)' }} />Período atual</span><span><i style={{ background: 'var(--line)' }} />Anterior</span></div>
            <RevenueChart s={d?.revenue_series} />
          </div>
        </div>
        <div className="pnl">
          <div className="pnl-h"><h3>Operação</h3><span className="link" onClick={() => navigate('/pedidos')}>Pedidos <ArrowRight /></span></div>
          <div className="opgrid">
            {STATUS_ORDER.map((s) => (
              <button key={s} className="op" onClick={() => navigate('/pedidos')}>
                <span className="op-l"><span className="op-d" style={{ background: STATUS_DOT[s] || 'var(--ink-faint)' }} />{ORDER_STATUS[s] || s}</span>
                <span className="op-n">{d?.by_status?.[s] || 0}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Mais vendidos + Origem */}
      <div className="dash-2" style={{ marginTop: 20 }}>
        <div className="pnl">
          <div className="pnl-h"><h3>Mais vendidos</h3><span className="link" onClick={() => navigate('/produtos')}>Catálogo <ArrowRight /></span></div>
          {d?.top_products && d.top_products.length > 0 ? (
            <div className="tops">
              {d.top_products.map((p, i) => (
                <div className="top-i" key={i}>
                  <div className="top-th" />
                  <div className="top-bd"><b>{p.name}</b><span>{formatBRL(p.receita)} em vendas</span></div>
                  <div className="top-qt"><b>{p.qty}</b><span>vendidos</span></div>
                </div>
              ))}
            </div>
          ) : <div className="chart-empty" style={{ padding: '28px 12px' }}>Ainda sem vendas registradas no período.</div>}
        </div>
        <div className="pnl">
          <div className="pnl-h"><h3>Origem das vendas</h3></div>
          {d?.by_channel && d.by_channel.length > 0 ? (
            <div className="chan">
              {d.by_channel.map((c) => (
                <div className="chan-row" key={c.channel}>
                  <div className="chan-top"><span className="chan-name">{c.channel === 'site' ? 'Site' : c.channel === 'whatsapp' ? 'WhatsApp' : c.channel === 'manual' ? 'Manual' : c.channel}</span>
                    <span className="chan-meta">{c.pedidos} ped. · {formatBRL(c.receita)} · {c.pct}%</span></div>
                  <div className="chan-bar"><div className="chan-fill" style={{ width: `${Math.max(4, c.pct)}%` }} /></div>
                </div>
              ))}
            </div>
          ) : <div className="chart-empty" style={{ padding: '24px 12px' }}>Sem pedidos no período.</div>}
          {!d?.flags?.utm_available && (
            <div className="note-soft"><Info /> Origem por campanha (UTM) aparece aqui quando houver pedidos com rastreamento.</div>
          )}
        </div>
      </div>

      {/* Estoque */}
      <div className="sec-head"><h3>Estoque</h3><span className="link" onClick={() => navigate('/produtos')}>Ver produtos <ArrowRight /></span></div>
      <div className="stock">
        <div className="stk bad"><div className="stk-n">{d?.stock?.esgotados ?? '—'}</div><div className="stk-l">Esgotados</div></div>
        <div className="stk warn"><div className="stk-n">{d?.stock?.inventory_configured ? (d?.stock?.baixo ?? 0) : '—'}</div><div className="stk-l">{d?.stock?.inventory_configured ? 'Estoque baixo' : 'Estoque não configurado'}</div></div>
        <div className="stk ok"><div className="stk-n">{d?.stock?.disponiveis ?? '—'}</div><div className="stk-l">Disponíveis (ativos)</div></div>
      </div>

      {/* Funil (parcial — visitantes não conectados) */}
      <div className="sec-head"><h3>Funil de vendas</h3></div>
      <div className="pnl">
        <div className="funnel">
          <div className="fn off"><div className="fn-n">—</div><div className="fn-l">Visitantes</div></div>
          <div className="fn off"><div className="fn-n">—</div><div className="fn-l">Viu produto</div></div>
          <div className="fn off"><div className="fn-n">—</div><div className="fn-l">Carrinho</div></div>
          <div className="fn off"><div className="fn-n">—</div><div className="fn-l">Checkout</div></div>
          <div className="fn"><div className="fn-n">{sales?.orders.value ?? 0}</div><div className="fn-l">Compras</div></div>
        </div>
        <div className="note-soft"><Info /> Dados de visitantes ainda não conectados (GA4 / eventos do site). Quando conectarmos, o funil completo aparece aqui.</div>
      </div>

      {/* Pedidos recentes */}
      <div className="sec-head"><h3>Pedidos recentes</h3><span className="link" onClick={() => navigate('/pedidos')}>Ver todos <ArrowRight /></span></div>
      <div className="card table-card">
        <table className="table">
          <thead><tr><th>Pedido</th><th>Cliente</th><th>Resumo</th><th>Data</th><th className="right">Valor</th><th>Pagamento</th><th>Status</th></tr></thead>
          <tbody>
            {(!d?.recent_orders || d.recent_orders.length === 0) && <tr><td colSpan={7} className="muted center">Nenhum pedido ainda.</td></tr>}
            {d?.recent_orders?.map((o) => (
              <tr key={o.id} className="row-link" onClick={() => navigate(`/pedidos/${o.id}`)}>
                <td className="mono">#{o.number}</td>
                <td>{o.customer || '—'}</td>
                <td className="muted">{o.resumo || '—'}</td>
                <td className="mono">{formatDate(o.created_at)}</td>
                <td className="right mono">{formatBRL(o.total)}</td>
                <td><span className={`pill ${PAY_TONE[o.payment_status] || ''}`}>{PAY_LABEL[o.payment_status] || o.payment_status}</span></td>
                <td><span className={`pill ${ORDER_TONE[o.status] || ''}`}>{ORDER_STATUS[o.status] || o.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Expedição (compacto) */}
      {ship && (
        <>
          <div className="sec-head"><h3>Expedição</h3><span className="link" onClick={() => navigate('/envios')}>Envios <ArrowRight /></span></div>
          <div className="stock">
            <div className="stk"><div className="stk-n">{ship.envios_hoje}</div><div className="stk-l">Envios hoje</div></div>
            <div className="stk warn"><div className="stk-n">{(ship.by_status?.['aguardando_confirmacao'] || 0) + (ship.by_status?.['cotado'] || 0) + (ship.by_status?.['rascunho'] || 0)}</div><div className="stk-l">Aguardando etiqueta</div></div>
            <div className="stk"><div className="stk-n">{formatBRL(ship.frete_mes)}</div><div className="stk-l">Frete no mês</div></div>
          </div>
        </>
      )}

      {loading && !d && <p className="muted center" style={{ marginTop: 24 }}>Carregando indicadores…</p>}
    </div>
  );
}
