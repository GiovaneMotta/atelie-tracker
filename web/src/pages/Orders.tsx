import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import {
  formatBRL, formatDate, ORDER_STATUS, ORDER_STATUS_TONE,
  PAYMENT_STATUS, PAYMENT_STATUS_TONE, pillClass, displaySrc, thumbSrc,
} from '../lib/format';

interface OrderRow { id: string; number: number; total: number; status: string; payment_status: string; channel: string | null; created_at: string; customer: { name: string } | null; }

const CHANNEL_LABEL: Record<string, string> = {
  site: 'Site', catalogo: 'Site', whatsapp: 'WhatsApp', inbox: 'WhatsApp', manual: 'Manual', teste: 'Teste',
};
const channelLabel = (c: string | null) => (c ? (CHANNEL_LABEL[c] || c) : '—');
/** Agrupa os canais do banco em origens que a loja usa de verdade. */
const origemGrupo = (c: string | null): string => {
  if (c === 'site' || c === 'catalogo') return 'site';
  if (c === 'whatsapp' || c === 'inbox') return 'whatsapp';
  if (c === 'manual') return 'manual';
  return 'outros';
};

export default function Orders() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [list, setList] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  // Busca, filtros e ordenação — tudo no cliente; não altera a API nem o backend.
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('todos');
  const [fOrigem, setFOrigem] = useState('todos');
  const [fPeriodo, setFPeriodo] = useState('todos');
  const [sort, setSort] = useState('data_desc');

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ orders: OrderRow[] }>('/api/orders');
      setList(data.orders);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const view = useMemo(() => {
    const term = q.trim().toLowerCase();
    const now = Date.now();
    const DAY = 864e5;
    const periodoOk = (iso: string) => {
      if (fPeriodo === 'todos') return true;
      const t = new Date(iso).getTime();
      if (fPeriodo === 'hoje') { const d = new Date(); d.setHours(0, 0, 0, 0); return t >= d.getTime(); }
      if (fPeriodo === '7d') return t >= now - 7 * DAY;
      if (fPeriodo === '30d') return t >= now - 30 * DAY;
      if (fPeriodo === 'mes') { const d = new Date(); return t >= new Date(d.getFullYear(), d.getMonth(), 1).getTime(); }
      return true;
    };
    const rows = list.filter((o) => {
      if (fStatus !== 'todos' && o.status !== fStatus) return false;
      if (fOrigem !== 'todos' && origemGrupo(o.channel) !== fOrigem) return false;
      if (!periodoOk(o.created_at)) return false;
      if (term && !`#${o.number} ${o.customer?.name || ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
    return [...rows].sort((a, b) => {
      if (sort === 'valor_desc') return (b.total || 0) - (a.total || 0);
      if (sort === 'valor_asc') return (a.total || 0) - (b.total || 0);
      if (sort === 'data_asc') return a.created_at.localeCompare(b.created_at);
      return b.created_at.localeCompare(a.created_at);
    });
  }, [list, q, fStatus, fOrigem, fPeriodo, sort]);

  const pagos = view.filter((o) => o.payment_status === 'pago').length;
  const pendentes = view.filter((o) => o.payment_status !== 'pago' && o.status !== 'cancelado').length;

  if (creating) return <NewOrder onCancel={() => setCreating(false)} onCreated={(id) => navigate(`/pedidos/${id}`)} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Pedidos</h1>
          <p className="muted">{loading ? 'Carregando…' : `${view.length} de ${list.length} pedido(s) · ${pagos} pago(s) · ${pendentes} pendente(s)`}</p>
        </div>
        {can('orders.write') && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Novo pedido</button>}
      </div>
      {error && <div className="alert-error">{error}</div>}

      <div className="filters" style={{ marginBottom: 16 }}>
        <label className="search"><Search size={16} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nº ou cliente…" /></label>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filtrar por status">
          <option value="todos">Todos os status</option>
          {Object.keys(ORDER_STATUS).map((s) => <option key={s} value={s}>{ORDER_STATUS[s]}</option>)}
        </select>
        <select value={fOrigem} onChange={(e) => setFOrigem(e.target.value)} aria-label="Filtrar por origem">
          <option value="todos">Todas as origens</option>
          <option value="site">Site</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="manual">Manual</option>
          <option value="outros">Outros</option>
        </select>
        <select value={fPeriodo} onChange={(e) => setFPeriodo(e.target.value)} aria-label="Filtrar por período">
          <option value="todos">Qualquer data</option>
          <option value="hoje">Hoje</option>
          <option value="7d">Últimos 7 dias</option>
          <option value="30d">Últimos 30 dias</option>
          <option value="mes">Mês atual</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
          <option value="data_desc">Mais recentes</option>
          <option value="data_asc">Mais antigos</option>
          <option value="valor_desc">Maior valor</option>
          <option value="valor_asc">Menor valor</option>
        </select>
      </div>

      <div className="card table-card">
        <table className="table">
          <thead><tr><th>#</th><th>Cliente</th><th className="right">Total</th><th>Pagamento</th><th>Status</th><th>Origem</th><th>Data</th></tr></thead>
          <tbody>
            {!loading && view.length === 0 && (
              <tr><td colSpan={7} className="muted center">{list.length ? 'Nenhum pedido com esses filtros.' : 'Nenhum pedido ainda.'}</td></tr>
            )}
            {view.map((o) => (
              <tr key={o.id} className="row-link" onClick={() => navigate(`/pedidos/${o.id}`)}>
                <td className="mono">#{o.number}</td>
                <td>{o.customer?.name || '—'}</td>
                <td className="right mono">{formatBRL(o.total)}</td>
                <td><span className={pillClass(PAYMENT_STATUS_TONE[o.payment_status])}>{PAYMENT_STATUS[o.payment_status] || o.payment_status || '—'}</span></td>
                <td><span className={pillClass(ORDER_STATUS_TONE[o.status])}>{ORDER_STATUS[o.status] || o.status}</span></td>
                <td><span className="badge">{channelLabel(o.channel)}</span></td>
                <td className="mono">{formatDate(o.created_at)}</td>
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
   mas nao e adicional pago: vai como personalizacao livre do item.
   A chave e 'nome', a mesma que o site grava via create_site_order: pedido
   manual e pedido do site precisam ser lidos do mesmo jeito. */
const CHAVE_NOME = 'nome';

/* Cadastro rápido de cliente novo (nome + telefone + endereço), preenchível
   colando texto do WhatsApp. É só o rascunho do formulário; nada é gravado
   até "Criar pedido". */
type NovoCliente = { name: string; phone: string; cep: string; street: string; number: string; complement: string; district: string; city: string; state: string };
const NOVO_VAZIO: NovoCliente = { name: '', phone: '', cep: '', street: '', number: '', complement: '', district: '', city: '', state: '' };
const NOVO_CAMPOS = Object.keys(NOVO_VAZIO) as (keyof NovoCliente)[];

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
  const [teste, setTeste] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // --- Cliente: buscar existente OU cadastrar novo (preenchível por texto) ---
  const [custMode, setCustMode] = useState<'search' | 'novo'>('search');
  const [novo, setNovo] = useState<NovoCliente>(NOVO_VAZIO);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [dupes, setDupes] = useState<PickCustomer[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parseInfo, setParseInfo] = useState<{ source?: string; cepLookup?: boolean; error?: string } | null>(null);
  // Lembra o cliente/endereço criados nesta tentativa: num retry (falha parcial)
  // reaproveita em vez de duplicar. Limpo ao editar os dados ou ao concluir.
  const created = useRef<{ customerId?: string; addressId?: string }>({});

  /* Dedupe pelo telefone: avisa se já existe cliente com esse número. */
  async function buscarDuplicados(phone: string) {
    const d = phone.replace(/\D/g, '');
    if (d.length < 10) { setDupes([]); return; }
    try {
      const r = await apiFetch<{ customers: PickCustomer[] }>(`/api/customers?search=${encodeURIComponent(d)}`);
      const match = r.customers.filter((c) => (c.phone || '').replace(/\D/g, '').includes(d) || (c.whatsapp || '').replace(/\D/g, '').includes(d));
      setDupes(match.slice(0, 3));
    } catch { setDupes([]); }
  }
  function setNovoCampo(k: keyof NovoCliente, v: string) {
    setNovo((s) => ({ ...s, [k]: v }));
    created.current = {};               // dados mudaram: não reutilizar o criado antes
    if (k === 'phone') buscarDuplicados(v);
  }
  /* CEP completa rua/bairro/cidade/UF VAZIOS (não sobrescreve o colado). */
  async function cepAutocomplete(cep: string) {
    setNovo((s) => ({ ...s, cep }));
    const limpo = cep.replace(/\D/g, '');
    if (limpo.length !== 8) return;
    try {
      const d = await apiFetch<{ street?: string; district?: string; city?: string; state?: string }>(`/api/cep?cep=${limpo}`);
      setNovo((s) => ({
        ...s,
        street: s.street || d.street || '', district: s.district || d.district || '',
        city: s.city || d.city || '', state: s.state || d.state || '',
      }));
    } catch { /* CEP não achado: segue manual */ }
  }
  const fmtCep = (c: string) => { const d = (c || '').replace(/\D/g, ''); return d.length === 8 ? d.slice(0, 5) + '-' + d.slice(5) : (c || ''); };
  /* Lê o texto pelo MESMO leitor da expedição (/api/parse-recipient:
     heurística grátis + IA opcional + ViaCEP pelo CEP). Não inventa (só o
     que achou) e não sobrescreve campo já preenchido sem avisar. */
  async function aplicarTexto() {
    if (pasteText.trim().length < 5) return;
    setParsing(true); setParseInfo(null);
    try {
      const d = await apiFetch<{ recipient: Record<string, string>; source: string; cep_lookup: boolean }>(
        '/api/parse-recipient', { method: 'POST', body: JSON.stringify({ text: pasteText }) });
      const rec = d.recipient || {};
      const p: NovoCliente = {
        name: rec.name || '', phone: rec.phone || '', cep: fmtCep(rec.cep || ''), street: rec.street || '',
        number: rec.number || '', complement: rec.complement || '', district: rec.district || '',
        city: rec.city || '', state: rec.state || '',
      };
      const conflitos = NOVO_CAMPOS.filter((k) => novo[k].trim() && p[k] && novo[k].trim() !== p[k]);
      let overwrite = true;
      if (conflitos.length) {
        overwrite = window.confirm('Alguns campos já preenchidos têm valor diferente do texto. Substituir pelos dados detectados?\n\n(Cancelar mantém os atuais e preenche só os campos vazios.)');
      }
      setNovo((cur) => {
        const next = { ...cur };
        for (const k of NOVO_CAMPOS) { if (!p[k]) continue; if (!cur[k].trim() || overwrite) next[k] = p[k]; }
        return next;
      });
      if (p.phone) buscarDuplicados(p.phone);
      created.current = {};             // dados novos: começa do zero num eventual retry
      setParseInfo({ source: d.source, cepLookup: d.cep_lookup });
      setPasteOpen(false); setPasteText('');
    } catch (err) {
      setParseInfo({ error: err instanceof Error ? err.message : 'Não consegui ler os dados.' });
    } finally { setParsing(false); }
  }
  function usarExistente(c: PickCustomer) {
    setCustomer(c); setCustMode('search'); setNovo(NOVO_VAZIO); setDupes([]); setPasteOpen(false); setPasteText('');
  }
  const novoTemEndereco = Boolean(novo.cep || novo.street || novo.number || novo.district || novo.city || novo.state);
  const novoPendenteNome = custMode === 'novo' && !novo.name.trim() && (novoTemEndereco || !!novo.phone);

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
      let customerId = customer?.id || null;
      let novoAddressId: string | null = null;
      // Cliente novo por texto: cria cliente (+ endereço) ANTES do pedido.
      // Reusa os endpoints existentes; o fluxo de quem escolhe cliente/sem
      // cliente continua idêntico. Em retry, reaproveita o já criado (não duplica).
      if (!customerId && custMode === 'novo' && novo.name.trim()) {
        if (created.current.customerId) {
          customerId = created.current.customerId;
        } else {
          const c = await apiFetch<{ customer: { id: string } }>('/api/customers', {
            method: 'POST',
            body: JSON.stringify({ name: novo.name.trim(), phone: novo.phone || null, whatsapp: novo.phone || null }),
          });
          customerId = c.customer.id;
          created.current.customerId = customerId;
        }
        if (novoTemEndereco) {
          if (created.current.addressId) {
            novoAddressId = created.current.addressId;
          } else {
            const a = await apiFetch<{ address: { id: string } }>('/api/addresses', {
              method: 'POST',
              body: JSON.stringify({
                customer_id: customerId, cep: novo.cep, street: novo.street, number: novo.number,
                complement: novo.complement, district: novo.district, city: novo.city, state: novo.state,
              }),
            });
            novoAddressId = a.address.id;
            created.current.addressId = novoAddressId;
          }
        }
      }
      const payload = {
        customer_id: customerId,
        items: lines.map((l) => ({
          product_id: l.product.id,
          variant_id: l.variant?.id ?? null,
          quantity: l.quantity,
          customization: l.nomeBebe.trim() ? { [CHAVE_NOME]: l.nomeBebe.trim() } : {},
        })),
        discount: parseFloat(discount.replace(',', '.')) || 0,
        notes: notes || null,
        // Pedido de teste: canal 'teste' isola do faturamento/relatórios e do Purchase real.
        channel: teste ? 'teste' : undefined,
      };
      const data = await apiFetch<{ order: { id: string } }>('/api/orders', { method: 'POST', body: JSON.stringify(payload) });
      if (novoAddressId) {
        try { await apiFetch(`/api/orders?id=${data.order.id}`, { method: 'PATCH', body: JSON.stringify({ address_id: novoAddressId }) }); }
        catch { /* endereço fica salvo no cliente; dá para vincular no detalhe do pedido */ }
      }
      created.current = {};   // pedido criado: zera o rascunho de ids
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
        {customer ? (
          <div className="picked">{customer.name} <button className="btn-link" onClick={() => setCustomer(null)}>trocar</button></div>
        ) : (
          <>
            <div className="cat-tabs" style={{ marginBottom: 10 }}>
              <button type="button" className={'cat-tab' + (custMode === 'search' ? ' is-on' : '')} onClick={() => setCustMode('search')}>Buscar existente</button>
              <button type="button" className={'cat-tab' + (custMode === 'novo' ? ' is-on' : '')} onClick={() => setCustMode('novo')}>Novo cliente</button>
            </div>

            {custMode === 'search' ? (
              <div className="picker">
                <input placeholder="Buscar cliente…" value={custQuery} onChange={(e) => searchCustomers(e.target.value)} />
                {custResults.map((c) => <button key={c.id} className="picker-opt" onClick={() => { setCustomer(c); setCustResults([]); setCustQuery(''); }}>{c.name} <span className="muted">{c.whatsapp || c.phone}</span></button>)}
              </div>
            ) : (
              <>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPasteOpen((o) => !o)}>
                  {pasteOpen ? '▾ ' : '＋ '}Preencher dados automaticamente
                </button>
                {pasteOpen && (
                  <div className="paste-box">
                    <textarea rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)}
                      placeholder={'Cole aqui a mensagem do WhatsApp com os dados do cliente…\nEx.:\nNome: Maria\nWhatsApp: (98) 98888-7766\nCEP: 65000-000\nRua das Flores, 123 - Centro\nSão Luís - MA'} />
                    <div className="form-actions">
                      <button type="button" className="btn btn-primary btn-sm" disabled={parsing || pasteText.trim().length < 5} onClick={aplicarTexto}>{parsing ? 'Lendo…' : 'Analisar e preencher'}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setPasteOpen(false); setPasteText(''); }}>Cancelar</button>
                    </div>
                    <p className="muted small">Lê nome, telefone, CEP e endereço em formatos variados. Nada é salvo até você conferir e clicar em “Criar pedido”.</p>
                  </div>
                )}
                {parseInfo?.error && <div className="alert-error" style={{ marginTop: 8 }}>{parseInfo.error}</div>}
                {parseInfo && !parseInfo.error && (
                  <p className="small" style={{ marginTop: 6, color: '#2e7d32' }}>
                    ✓ Preenchido {parseInfo.source === 'ia' ? 'com leitura inteligente' : 'automaticamente'}{parseInfo.cepLookup ? ' · endereço completado pelo CEP' : ''}. Confira abaixo.
                  </p>
                )}

                {dupes.length > 0 && (
                  <div className="alert-warn">
                    <strong>Já existe cliente com este telefone.</strong> Para não duplicar, selecione:{' '}
                    {dupes.map((d) => (
                      <button key={d.id} type="button" className="btn-link" onClick={() => usarExistente(d)}>{d.name}</button>
                    ))}
                  </div>
                )}

                <div className="form-grid" style={{ marginTop: 12 }}>
                  <label className="field span-all"><span>Nome *</span>
                    <input value={novo.name} onChange={(e) => setNovoCampo('name', e.target.value)} placeholder="Nome do cliente" /></label>
                  <label className="field"><span>WhatsApp</span>
                    <input value={novo.phone} inputMode="numeric" onChange={(e) => setNovoCampo('phone', e.target.value)} placeholder="(00) 00000-0000" /></label>
                  <label className="field"><span>CEP</span>
                    <input value={novo.cep} inputMode="numeric" onChange={(e) => cepAutocomplete(e.target.value)} placeholder="00000-000" /></label>
                  <label className="field span-all"><span>Rua</span>
                    <input value={novo.street} onChange={(e) => setNovoCampo('street', e.target.value)} /></label>
                  <label className="field"><span>Número</span>
                    <input value={novo.number} onChange={(e) => setNovoCampo('number', e.target.value)} /></label>
                  <label className="field"><span>Complemento</span>
                    <input value={novo.complement} onChange={(e) => setNovoCampo('complement', e.target.value)} /></label>
                  <label className="field"><span>Bairro</span>
                    <input value={novo.district} onChange={(e) => setNovoCampo('district', e.target.value)} /></label>
                  <label className="field"><span>Cidade</span>
                    <input value={novo.city} onChange={(e) => setNovoCampo('city', e.target.value)} /></label>
                  <label className="field"><span>UF</span>
                    <input value={novo.state} maxLength={2} onChange={(e) => setNovoCampo('state', e.target.value.toUpperCase())} /></label>
                </div>
                {novoPendenteNome && <p className="small" style={{ color: '#9a6a00', marginTop: 8 }}>Informe o <strong>nome</strong> para cadastrar o cliente.</p>}
              </>
            )}
          </>
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
        <label className="field-check span-all">
          <input type="checkbox" checked={teste} onChange={(e) => setTeste(e.target.checked)} />
          <span>Pedido de teste — fica fora de faturamento/relatórios e só ele dispara o Purchase em modo de teste (Meta).</span>
        </label>
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
        <button className="btn btn-primary" disabled={busy || lines.length === 0 || semTamanho.length > 0 || novoPendenteNome} onClick={save}>{busy ? 'Criando…' : 'Criar pedido'}</button>
        <button className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
