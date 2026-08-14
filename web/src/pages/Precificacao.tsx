import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { formatBRL } from '../lib/format';

interface Material { id: string; name: string; unit: string; cost_per_unit: number; supplier: string | null; }
interface Row { id: string; name: string; sku: string | null; price_cash: number | null; cost: number; profit: number; margin: number; }
interface Line { material_id: string; quantity: number; }

function marginClass(m: number) { return m < 15 ? 'mg-bad' : m < 30 ? 'mg-warn' : 'mg-ok'; }

export default function Precificacao() {
  const [rows, setRows] = useState<Row[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Row | null>(null);
  const [matModal, setMatModal] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [p, m] = await Promise.all([
        apiFetch<{ products: Row[] }>('/api/pricing'),
        apiFetch<{ materials: Material[] }>('/api/materials'),
      ]);
      setRows(p.products); setMaterials(m.materials);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Precificação</h1><p className="muted">Custo × preço × lucro por peça. {loading ? '' : `${rows.length} produto(s)`}</p></div>
        <button className="btn btn-ghost" onClick={() => setMatModal(true)}>Materiais</button>
      </div>
      {error && <div className="alert-error">{error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead><tr><th>Produto</th><th className="right">Custo</th><th className="right">Preço à vista</th><th className="right">Lucro</th><th className="right">Margem</th></tr></thead>
          <tbody>
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="muted center">Nenhum produto.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="row-link" onClick={() => setEditing(r)}>
                <td><strong>{r.name}</strong> {r.sku && <span className="muted small">{r.sku}</span>}</td>
                <td className="right">{r.cost > 0 ? formatBRL(r.cost) : <span className="muted">—</span>}</td>
                <td className="right">{r.price_cash != null ? formatBRL(r.price_cash) : '—'}</td>
                <td className="right">{r.cost > 0 ? formatBRL(r.profit) : '—'}</td>
                <td className="right">{r.cost > 0 ? <span className={`badge ${marginClass(r.margin)}`}>{r.margin}%</span> : <span className="muted">definir</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card"><p className="muted small">💡 A margem só aparece depois de montar a <strong>ficha técnica</strong> (materiais) de cada produto. Clique num produto para definir.</p></div>

      {editing && <ProductPricing product={editing} materials={materials} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
      {matModal && <MaterialsManager materials={materials} onClose={() => setMatModal(false)} onChanged={load} />}
    </div>
  );
}

function ProductPricing({ product, materials, onClose, onSaved }: { product: Row; materials: Material[]; onClose: () => void; onSaved: () => void }) {
  const [price, setPrice] = useState(product.price_cash != null ? String(product.price_cash) : '');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const matById = useMemo(() => Object.fromEntries(materials.map((m) => [m.id, m])), [materials]);

  useEffect(() => {
    apiFetch<{ items: { material_id: string; quantity: number }[] }>(`/api/pricing?id=${product.id}`)
      .then((d) => setLines(d.items.map((i) => ({ material_id: i.material_id, quantity: i.quantity })))).catch(() => {});
  }, [product.id]);

  const cost = lines.reduce((s, l) => s + (Number(matById[l.material_id]?.cost_per_unit || 0) * Number(l.quantity || 0)), 0);
  const priceN = parseFloat(price.replace(',', '.')) || 0;
  const profit = priceN - cost;
  const margin = priceN > 0 ? (profit / priceN) * 100 : 0;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await apiFetch(`/api/pricing?id=${product.id}`, { method: 'PATCH', body: JSON.stringify({ price_cash: priceN, materials: lines }) });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setBusy(false); }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="flow-config-head"><strong>💰 {product.name}</strong><button className="btn-link" onClick={onClose}>fechar</button></div>
        <form onSubmit={save}>
          <span className="field-label">Ficha técnica (materiais)</span>
          {lines.map((l, i) => (
            <div className="opt-row" key={i}>
              <select value={l.material_id} onChange={(e) => setLines((c) => c.map((x, j) => j === i ? { ...x, material_id: e.target.value } : x))}>
                <option value="">— material —</option>
                {materials.map((m) => <option key={m.id} value={m.id}>{m.name} ({formatBRL(m.cost_per_unit)}/{m.unit})</option>)}
              </select>
              <input type="number" step="0.01" min={0} value={l.quantity} style={{ width: 90 }}
                onChange={(e) => setLines((c) => c.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x))} />
              <button type="button" className="btn-link" onClick={() => setLines((c) => c.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLines((c) => [...c, { material_id: '', quantity: 1 }])}>+ Material</button>

          <label className="field" style={{ marginTop: 14 }}><span>Preço à vista (R$)</span>
            <input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="349,00" /></label>

          <div className="price-summary">
            <div><span>Custo</span><strong>{formatBRL(cost)}</strong></div>
            <div><span>Preço</span><strong>{formatBRL(priceN)}</strong></div>
            <div className="price-profit"><span>Lucro</span><strong className={marginClass(margin)}>{formatBRL(profit)} ({priceN > 0 ? margin.toFixed(1) : '0'}%)</strong></div>
          </div>

          {error && <div className="alert-error">{error}</div>}
          <div className="form-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button></div>
        </form>
      </div>
    </div>
  );
}

function MaterialsManager({ materials, onClose, onChanged }: { materials: Material[]; onClose: () => void; onChanged: () => void }) {
  const [list, setList] = useState<Material[]>(materials);
  const [f, setF] = useState({ name: '', unit: 'un', cost_per_unit: '', supplier: '' });
  const [error, setError] = useState('');

  async function add(e: FormEvent) {
    e.preventDefault(); setError('');
    try {
      const d = await apiFetch<{ material: Material }>('/api/materials', { method: 'POST', body: JSON.stringify({ ...f, cost_per_unit: parseFloat(f.cost_per_unit.replace(',', '.')) || 0 }) });
      setList((c) => [...c, d.material].sort((a, b) => a.name.localeCompare(b.name)));
      setF({ name: '', unit: 'un', cost_per_unit: '', supplier: '' }); onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); }
  }
  async function remove(id: string) {
    if (!confirm('Excluir material?')) return;
    await apiFetch(`/api/materials?id=${id}`, { method: 'DELETE' });
    setList((c) => c.filter((m) => m.id !== id)); onChanged();
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="flow-config-head"><strong>🧵 Materiais</strong><button className="btn-link" onClick={onClose}>fechar</button></div>
        <form className="row-inline" onSubmit={add} style={{ flexWrap: 'wrap' }}>
          <input placeholder="Nome" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
          <input placeholder="Unid." value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} style={{ width: 70 }} />
          <input placeholder="Custo R$" value={f.cost_per_unit} onChange={(e) => setF({ ...f, cost_per_unit: e.target.value })} style={{ width: 100 }} />
          <button className="btn btn-primary btn-sm">+ Add</button>
        </form>
        {error && <div className="alert-error">{error}</div>}
        <table className="table" style={{ marginTop: 10 }}>
          <thead><tr><th>Material</th><th>Unid.</th><th className="right">Custo</th><th></th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={4} className="muted center">Nenhum material.</td></tr>}
            {list.map((m) => (
              <tr key={m.id}><td>{m.name}</td><td>{m.unit}</td><td className="right">{formatBRL(m.cost_per_unit)}</td>
                <td className="right"><button className="btn-link danger" onClick={() => remove(m.id)}>✕</button></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
