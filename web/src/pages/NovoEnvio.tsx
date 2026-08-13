import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatBRL, maskCep, maskPhone, maskCpfCnpj } from '../lib/format';

/* Wizard de expedição (§7, §11, §12, §14, §15):
   1) Dados  ->  2) Cotação  ->  3) Conferência  ->  gera etiqueta */

interface Recipient {
  name: string; document: string; phone: string; email: string;
  cep: string; street: string; number: string; complement: string;
  district: string; city: string; state: string; reference: string;
}
interface Item {
  product_id: string | null; name: string; sku: string | null; quantity: number;
  unit_price: number; weight_kg: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null;
}
interface PickProduct {
  id: string; name: string; sku: string | null; price_cash: number | null;
  weight_kg: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null;
}
interface QuoteOption {
  carrier: string; carrierCode: string | null; serviceCode: string; serviceName: string;
  price: number; days: number | null; source: string;
}

const emptyRecipient: Recipient = {
  name: '', document: '', phone: '', email: '', cep: '', street: '', number: '',
  complement: '', district: '', city: '', state: '', reference: '',
};

const FIELD_LABEL: Record<string, string> = {
  name: 'Nome', cep: 'CEP', street: 'Endereço', number: 'Número', district: 'Bairro', city: 'Cidade', state: 'UF',
};

export default function NovoEnvio() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [r, setR] = useState<Recipient>(emptyRecipient);
  const [items, setItems] = useState<Item[]>([]);
  const [declaredOverride, setDeclaredOverride] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [paste, setPaste] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extractInfo, setExtractInfo] = useState<{ source?: string; missing?: string[]; cep_lookup?: boolean; ai_available?: boolean; error?: string } | null>(null);

  const [prodQuery, setProdQuery] = useState('');
  const [prodResults, setProdResults] = useState<PickProduct[]>([]);

  const [quoting, setQuoting] = useState(false);
  const [quoteErr, setQuoteErr] = useState('');
  const [options, setOptions] = useState<QuoteOption[]>([]);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [cheapest, setCheapest] = useState(-1);
  const [fastest, setFastest] = useState(-1);
  const [partnerConfigured, setPartnerConfigured] = useState(true);
  const [chosen, setChosen] = useState<QuoteOption | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [confirmErr, setConfirmErr] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);

  const set = (k: keyof Recipient, v: string) => setR((c) => ({ ...c, [k]: v }));

  // Autocompletar por CEP (preenche só o que está vazio, sem sobrescrever edições).
  async function fillCep(cepDigits: string) {
    if (cepDigits.length !== 8) return;
    try {
      const c = await apiFetch<{ street: string; district: string; city: string; state: string }>(`/api/cep?cep=${cepDigits}`);
      setR((cur) => ({
        ...cur,
        street: cur.street || c.street, district: cur.district || c.district,
        city: cur.city || c.city, state: cur.state || c.state,
      }));
    } catch { /* CEP não encontrado: ignora, usuário digita */ }
  }

  // Cola a mensagem → extrai e preenche (IA quando houver chave; senão grátis).
  async function extractPaste() {
    if (paste.trim().length < 5) return;
    setExtracting(true); setExtractInfo(null);
    try {
      const data = await apiFetch<any>('/api/parse-recipient', { method: 'POST', body: JSON.stringify({ text: paste }) });
      setR((cur) => {
        const next = { ...cur };
        for (const [k, v] of Object.entries(data.recipient)) if (String(v).trim()) (next as any)[k] = v;
        return next;
      });
      setFieldErrors({});
      setExtractInfo({ source: data.source, missing: data.missing, cep_lookup: data.cep_lookup, ai_available: data.ai_available });
    } catch (err) {
      setExtractInfo({ error: err instanceof Error ? err.message : 'Não consegui ler os dados.' });
    } finally { setExtracting(false); }
  }

  const itemsSubtotal = items.reduce((s, it) => s + it.unit_price * it.quantity, 0);
  const declaredValue = declaredOverride ? Number(declaredOverride.replace(',', '.')) || 0 : itemsSubtotal;

  async function searchProducts(q: string) {
    setProdQuery(q);
    if (q.trim().length < 2) { setProdResults([]); return; }
    const data = await apiFetch<{ products: PickProduct[] }>(`/api/products?search=${encodeURIComponent(q)}&status=ativo`);
    setProdResults(data.products.slice(0, 6));
  }
  function addProduct(p: PickProduct) {
    setItems((cur) => {
      const found = cur.find((l) => l.product_id === p.id);
      if (found) return cur.map((l) => l.product_id === p.id ? { ...l, quantity: l.quantity + 1 } : l);
      return [...cur, {
        product_id: p.id, name: p.name, sku: p.sku, quantity: 1, unit_price: Number(p.price_cash) || 0,
        weight_kg: p.weight_kg, length_cm: p.length_cm, width_cm: p.width_cm, height_cm: p.height_cm,
      }];
    });
    setProdQuery(''); setProdResults([]);
  }

  function validateStep1(): boolean {
    const e: Record<string, string> = {};
    if (!r.name.trim()) e.name = 'Informe o nome.';
    if (r.cep.replace(/\D/g, '').length !== 8) e.cep = 'CEP inválido.';
    if (!r.street.trim()) e.street = 'Informe o endereço.';
    if (!r.number.trim()) e.number = 'Informe o número (a referência não substitui).';
    if (!r.district.trim()) e.district = 'Informe o bairro.';
    if (!r.city.trim()) e.city = 'Informe a cidade.';
    if (r.state.trim().length !== 2) e.state = 'UF (2 letras).';
    if (items.length === 0 && declaredValue <= 0) e.items = 'Adicione ao menos um produto ou informe o valor.';
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }

  async function goQuote() {
    if (!validateStep1()) return;
    setStep(2); setQuoteErr(''); setOptions([]); setChosen(null); setQuoting(true);
    try {
      const data = await apiFetch<any>('/api/shipping-quote', {
        method: 'POST',
        body: JSON.stringify({
          cepDest: r.cep, declaredValue,
          items: items.map((it) => ({
            product_id: it.product_id, name: it.name, sku: it.sku, quantity: it.quantity,
            unit_price: it.unit_price, weight_kg: it.weight_kg, length_cm: it.length_cm, width_cm: it.width_cm, height_cm: it.height_cm,
          })),
        }),
      });
      setOptions(data.options || []);
      setQuoteId(data.quote_id || null);
      setCheapest(data.cheapest_index ?? -1);
      setFastest(data.fastest_index ?? -1);
      setPartnerConfigured(data.partner_configured !== false);
      if (!data.options?.length) setQuoteErr(data.message || 'Nenhum serviço retornado.');
    } catch (err) { setQuoteErr(err instanceof Error ? err.message : 'Erro ao cotar.'); } finally { setQuoting(false); }
  }

  async function confirm() {
    if (!chosen) return;
    setConfirming(true); setConfirmErr('');
    try {
      const created = await apiFetch<{ shipment: { id: string } }>('/api/shipments', {
        method: 'POST',
        body: JSON.stringify({
          recipient: r,
          declared_value: declaredValue,
          quote_id: quoteId,
          quote: { serviceCode: chosen.serviceCode, serviceName: chosen.serviceName, carrier: chosen.carrier, carrierCode: chosen.carrierCode, price: chosen.price, days: chosen.days },
          items: items.map((it) => ({
            product_id: it.product_id, name: it.name, sku: it.sku, quantity: it.quantity,
            unit_price: it.unit_price, weight_kg: it.weight_kg, length_cm: it.length_cm, width_cm: it.width_cm, height_cm: it.height_cm,
          })),
        }),
      });
      const id = created.shipment.id;
      setCreatedId(id);
      // Gera a etiqueta. Se falhar (ex.: saldo), o envio já existe: vamos ao detalhe.
      await apiFetch(`/api/shipment-label?id=${id}`, { method: 'POST' });
      navigate(`/envios/${id}`);
    } catch (err) {
      setConfirmErr(err instanceof Error ? err.message : 'Erro ao confirmar.');
    } finally { setConfirming(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="crumb"><button className="btn-link" onClick={() => navigate('/expedicao')}>← Expedição</button></p>
          <h1>Novo envio</h1>
        </div>
      </div>

      <div className="steps">
        {['Dados', 'Cotação', 'Conferência'].map((label, i) => (
          <div key={label} className={`step ${step === i + 1 ? 'is-active' : ''} ${step > i + 1 ? 'is-done' : ''}`}>
            <span className="step-n">{i + 1}</span> {label}
          </div>
        ))}
      </div>

      {/* -------------------------------------------------- STEP 1 */}
      {step === 1 && (
        <>
          <div className="card paste-card">
            <h3>✨ Preenchimento rápido</h3>
            <p className="muted small">Cole a mensagem do cliente (nome, CPF, telefone, endereço, CEP) e o sistema preenche sozinho. Depois é só conferir.</p>
            <textarea rows={4} value={paste} onChange={(e) => setPaste(e.target.value)}
              placeholder="Ex.: Maria Silva, CPF 123.456.789-09, (99) 98888-7777, Rua das Flores 123, Centro, Imperatriz-MA, 65900-000" />
            <div className="form-actions" style={{ margin: '8px 0 0' }}>
              <button className="btn btn-primary" onClick={extractPaste} disabled={extracting || paste.trim().length < 5}>{extracting ? 'Lendo…' : 'Extrair e preencher'}</button>
              {paste && <button className="btn btn-ghost" onClick={() => { setPaste(''); setExtractInfo(null); }}>Limpar</button>}
            </div>
            {extractInfo && !extractInfo.error && (
              <div className="alert-ok" style={{ marginTop: 10 }}>
                Preenchido {extractInfo.source === 'ia' ? 'com IA' : 'automaticamente'}{extractInfo.cep_lookup ? ' + endereço pelo CEP' : ''}. Confira os campos abaixo.
                {extractInfo.missing && extractInfo.missing.length > 0 && (
                  <div><strong>Falta preencher:</strong> {extractInfo.missing.map((m) => FIELD_LABEL[m] || m).join(', ')}.</div>
                )}
                {!extractInfo.ai_available && <div className="muted small">Dica: com a chave da Anthropic configurada, a leitura de mensagens bagunçadas fica ainda melhor.</div>}
              </div>
            )}
            {extractInfo?.error && <div className="alert-error" style={{ marginTop: 10 }}>{extractInfo.error}</div>}
          </div>

          <div className="card">
            <h3>Destinatário</h3>
            <div className="form-grid">
              <label className="field span-all"><span>Nome completo *</span><input value={r.name} onChange={(e) => set('name', e.target.value)} />{fieldErrors.name && <em className="field-err">{fieldErrors.name}</em>}</label>
              <label className="field"><span>CPF/CNPJ</span><input value={maskCpfCnpj(r.document)} onChange={(e) => set('document', e.target.value.replace(/\D/g, ''))} /></label>
              <label className="field"><span>Telefone</span><input value={maskPhone(r.phone)} onChange={(e) => set('phone', e.target.value.replace(/\D/g, ''))} /></label>
              <label className="field"><span>CEP *</span><input value={maskCep(r.cep)} onChange={(e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 8); set('cep', d); if (d.length === 8) fillCep(d); }} placeholder="00000-000" />{fieldErrors.cep && <em className="field-err">{fieldErrors.cep}</em>}</label>
              <label className="field"><span>E-mail</span><input value={r.email} onChange={(e) => set('email', e.target.value)} /></label>
              <label className="field span-all"><span>Endereço *</span><input value={r.street} onChange={(e) => set('street', e.target.value)} />{fieldErrors.street && <em className="field-err">{fieldErrors.street}</em>}</label>
              <label className="field"><span>Número *</span><input value={r.number} onChange={(e) => set('number', e.target.value)} />{fieldErrors.number && <em className="field-err">{fieldErrors.number}</em>}</label>
              <label className="field"><span>Complemento</span><input value={r.complement} onChange={(e) => set('complement', e.target.value)} /></label>
              <label className="field"><span>Bairro *</span><input value={r.district} onChange={(e) => set('district', e.target.value)} />{fieldErrors.district && <em className="field-err">{fieldErrors.district}</em>}</label>
              <label className="field"><span>Cidade *</span><input value={r.city} onChange={(e) => set('city', e.target.value)} />{fieldErrors.city && <em className="field-err">{fieldErrors.city}</em>}</label>
              <label className="field"><span>UF *</span><input value={r.state} onChange={(e) => set('state', e.target.value.toUpperCase().slice(0, 2))} maxLength={2} />{fieldErrors.state && <em className="field-err">{fieldErrors.state}</em>}</label>
              <label className="field span-all"><span>Referência</span><input value={r.reference} onChange={(e) => set('reference', e.target.value)} placeholder="Ponto de referência (não substitui o número)" /></label>
            </div>
          </div>

          <div className="card">
            <h3>Pedido</h3>
            <div className="picker">
              <input placeholder="Buscar produto ativo…" value={prodQuery} onChange={(e) => searchProducts(e.target.value)} />
              {prodResults.map((p) => <button key={p.id} className="picker-opt" onClick={() => addProduct(p)}>{p.name} <span className="muted">{p.price_cash != null ? formatBRL(p.price_cash) : ''}</span></button>)}
            </div>
            {fieldErrors.items && <em className="field-err">{fieldErrors.items}</em>}
            {items.length === 0 && <p className="muted">Nenhum produto adicionado.</p>}
            {items.map((it, i) => (
              <div className="row-inline" key={it.product_id || i}>
                <span style={{ flex: 1 }}>{it.name} <span className="muted small">{it.weight_kg ? `${it.weight_kg}kg` : 'sem peso'}</span></span>
                <input type="number" min={1} value={it.quantity} style={{ width: 64 }}
                  onChange={(e) => setItems((cur) => cur.map((x, j) => j === i ? { ...x, quantity: Math.max(1, parseInt(e.target.value) || 1) } : x))} />
                <span className="mono">{formatBRL(it.unit_price * it.quantity)}</span>
                <button className="btn-link" onClick={() => setItems((cur) => cur.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <div className="form-grid" style={{ marginTop: 12 }}>
              <label className="field"><span>Valor da mercadoria (R$)</span><input value={declaredOverride} onChange={(e) => setDeclaredOverride(e.target.value)} placeholder={itemsSubtotal ? itemsSubtotal.toFixed(2) : '0,00'} /></label>
            </div>
            <p className="muted small">Valor declarado: <strong>{formatBRL(declaredValue)}</strong> {declaredOverride ? '(manual)' : '(soma dos itens)'}</p>
          </div>

          <div className="form-actions">
            <button className="btn btn-primary" onClick={goQuote}>Calcular frete →</button>
          </div>
        </>
      )}

      {/* -------------------------------------------------- STEP 2 */}
      {step === 2 && (
        <>
          {!partnerConfigured && (
            <div className="alert-error">
              Cotação de vitrine (sem Partner Token). Estes preços são informativos — a geração de etiqueta exige o Partner Token da Frenet.
            </div>
          )}
          <div className="card">
            <h3>Serviços disponíveis</h3>
            {quoting && <p className="muted">Consultando a Frenet…</p>}
            {quoteErr && <div className="alert-error">{quoteErr}</div>}
            {!quoting && options.length > 0 && (
              <div className="quote-list">
                {options.map((o, i) => (
                  <div key={o.serviceCode + i} className={`quote-card ${chosen?.serviceCode === o.serviceCode ? 'is-chosen' : ''}`}>
                    <div className="quote-main">
                      <strong>{o.carrier} {o.serviceName && o.serviceName !== o.carrier ? `· ${o.serviceName}` : ''}</strong>
                      <div className="quote-badges">
                        {i === cheapest && <span className="badge badge-ok">Menor preço</span>}
                        {i === fastest && <span className="badge">Menor prazo</span>}
                      </div>
                    </div>
                    <div className="quote-price">{formatBRL(o.price)}</div>
                    <div className="quote-days muted">{o.days != null ? `${o.days} dia(s) úteis` : 'prazo não informado'}</div>
                    <button className={`btn ${chosen?.serviceCode === o.serviceCode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setChosen(o)}>
                      {chosen?.serviceCode === o.serviceCode ? 'Selecionado ✓' : 'Selecionar'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="form-actions">
            <button className="btn btn-ghost" onClick={() => setStep(1)}>← Editar dados</button>
            <button className="btn btn-ghost" onClick={goQuote} disabled={quoting}>Recalcular</button>
            <button className="btn btn-primary" disabled={!chosen} onClick={() => setStep(3)}>Conferir →</button>
          </div>
        </>
      )}

      {/* -------------------------------------------------- STEP 3 */}
      {step === 3 && chosen && (
        <>
          <div className="card">
            <h3>Confirmar envio</h3>
            <div className="detail-grid">
              <div className="info"><span className="info-label">Destinatário</span><strong>{r.name}</strong><span>{maskCpfCnpj(r.document) || '—'}</span><span>{maskPhone(r.phone) || '—'}</span></div>
              <div className="info"><span className="info-label">Endereço</span><span>{r.street}, {r.number} {r.complement}</span><span>{r.district} — {r.city}/{r.state}</span><span>CEP {maskCep(r.cep)}</span>{r.reference && <span className="muted small">Ref: {r.reference}</span>}</div>
              <div className="info"><span className="info-label">Logística</span><span>{chosen.carrier} · {chosen.serviceName}</span><span>Frete {formatBRL(chosen.price)}</span><span>{chosen.days != null ? `${chosen.days} dia(s)` : 'prazo n/d'}</span></div>
            </div>
          </div>

          <div className="card table-card">
            <table className="table compact">
              <thead><tr><th>Produto</th><th>Qtd</th><th className="right">Valor</th></tr></thead>
              <tbody>
                {items.map((it, i) => <tr key={i}><td>{it.name}</td><td>{it.quantity}</td><td className="right">{formatBRL(it.unit_price * it.quantity)}</td></tr>)}
                {items.length === 0 && <tr><td colSpan={3} className="muted">Sem itens — valor declarado {formatBRL(declaredValue)}.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="card">
            <p className="muted small">Ao confirmar, o sistema cria a postagem e gera a etiqueta REAL na Frenet (operação que consome saldo da carteira). Isto não pode ser desfeito automaticamente.</p>
            {confirmErr && <div className="alert-error">{confirmErr}{createdId && <> — <button className="btn-link" onClick={() => navigate(`/envios/${createdId}`)}>ver envio criado</button></>}</div>}
            <div className="form-actions">
              <button className="btn btn-ghost" onClick={() => setStep(1)}>Editar dados</button>
              <button className="btn btn-ghost" onClick={() => setStep(2)}>← Voltar</button>
              <button className="btn btn-primary" disabled={confirming} onClick={confirm}>{confirming ? 'Gerando…' : 'Confirmar e gerar etiqueta'}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
