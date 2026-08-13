import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL, parseBRL } from '../lib/format';

interface Variant { id?: string; size: string; color: string; gender: string; price_delta: number | string; }
interface Addon { id?: string; name: string; price: number | string; requires_text: boolean; }
interface Product {
  id: string; sku: string | null; name: string; description: string | null;
  price_cash: number | null; price_card: number | null; status: string;
  weight_kg: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null;
  images: string[]; product_categories?: { category: string }[];
  product_variants?: Variant[]; product_addons?: Addon[];
}

const CATEGORIES = ['menina', 'menino', 'unissex', 'luxo', 'manta', 'cueiro', 'kit'];

export default function Products() {
  const { can } = useAuth();
  const [list, setList] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const writable = can('products.write');

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ products: Product[] }>('/api/products');
      setList(data.products);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  if (editing) {
    return <ProductEditor
      product={editing === 'new' ? null : editing}
      onCancel={() => setEditing(null)}
      onSaved={() => { setEditing(null); load(); }}
    />;
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Produtos</h1><p className="muted">{loading ? 'Carregando…' : `${list.length} produto(s)`}</p></div>
        {writable && <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Novo produto</button>}
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead><tr><th>Produto</th><th>SKU</th><th>Categorias</th><th>À vista</th><th>Peso</th><th>Status</th></tr></thead>
          <tbody>
            {!loading && list.length === 0 && <tr><td colSpan={6} className="muted center">Nenhum produto ainda.</td></tr>}
            {list.map((p) => (
              <tr key={p.id} className={writable ? 'row-link' : ''} onClick={() => writable && setEditing(p)}>
                <td><strong>{p.name}</strong></td>
                <td className="mono">{p.sku || '—'}</td>
                <td>{(p.product_categories || []).map((c) => <span key={c.category} className="badge">{c.category}</span>)}</td>
                <td>{p.price_cash != null ? formatBRL(p.price_cash) : '—'}</td>
                <td>{p.weight_kg != null ? `${p.weight_kg} kg` : '—'}</td>
                <td><span className="badge">{p.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductEditor({ product, onSaved, onCancel }: { product: Product | null; onSaved: () => void; onCancel: () => void }) {
  const [f, setF] = useState({
    name: product?.name || '', sku: product?.sku || '', status: product?.status || 'ativo',
    price_cash: product?.price_cash != null ? String(product.price_cash) : '',
    price_card: product?.price_card != null ? String(product.price_card) : '',
    weight_kg: product?.weight_kg != null ? String(product.weight_kg) : '',
    length_cm: product?.length_cm != null ? String(product.length_cm) : '',
    width_cm: product?.width_cm != null ? String(product.width_cm) : '',
    height_cm: product?.height_cm != null ? String(product.height_cm) : '',
    description: product?.description || '',
    images: (product?.images || []).join('\n'),
  });
  const [categories, setCategories] = useState<string[]>((product?.product_categories || []).map((c) => c.category));
  const [variants, setVariants] = useState<Variant[]>(product?.product_variants || []);
  const [addons, setAddons] = useState<Addon[]>(product?.product_addons || []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  function toggleCat(c: string) {
    setCategories((cur) => cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const payload = {
      name: f.name, sku: f.sku || null, status: f.status,
      price_cash: f.price_cash ? parseBRL(f.price_cash) : null,
      price_card: f.price_card ? parseBRL(f.price_card) : null,
      weight_kg: f.weight_kg ? parseBRL(f.weight_kg) : null,
      length_cm: f.length_cm ? parseBRL(f.length_cm) : null,
      width_cm: f.width_cm ? parseBRL(f.width_cm) : null,
      height_cm: f.height_cm ? parseBRL(f.height_cm) : null,
      description: f.description || null,
      images: f.images.split('\n').map((s) => s.trim()).filter(Boolean),
      categories,
      variants: variants.map((v) => ({ ...v, price_delta: parseBRL(v.price_delta) })),
      addons: addons.map((a) => ({ ...a, price: parseBRL(a.price) })),
    };
    try {
      if (product) await apiFetch(`/api/products?id=${product.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await apiFetch('/api/products', { method: 'POST', body: JSON.stringify(payload) });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); } finally { setBusy(false); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><p className="crumb"><button className="btn-link" onClick={onCancel}>← Produtos</button></p>
          <h1>{product ? 'Editar produto' : 'Novo produto'}</h1></div>
      </div>
      <form onSubmit={submit}>
        <div className="card form-grid">
          <label className="field span-all"><span>Nome *</span><input value={f.name} onChange={(e) => set('name', e.target.value)} required /></label>
          <label className="field"><span>SKU</span><input value={f.sku} onChange={(e) => set('sku', e.target.value)} /></label>
          <label className="field"><span>Status</span>
            <select value={f.status} onChange={(e) => set('status', e.target.value)}>
              <option value="ativo">Ativo</option><option value="inativo">Inativo</option>
              <option value="esgotado">Esgotado</option><option value="oculto">Oculto</option>
            </select></label>
          <label className="field"><span>Preço à vista (R$)</span><input value={f.price_cash} onChange={(e) => set('price_cash', e.target.value)} placeholder="349,00" /></label>
          <label className="field"><span>Preço no cartão (R$)</span><input value={f.price_card} onChange={(e) => set('price_card', e.target.value)} placeholder="369,00" /></label>
          <label className="field span-all"><span>Descrição</span>
            <textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
        </div>

        <div className="card">
          <h3>Frete — peso e dimensões</h3>
          <p className="muted small">Usados na cotação Frenet. O cliente nunca precisa informar.</p>
          <div className="form-grid">
            <label className="field"><span>Peso (kg)</span><input value={f.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} placeholder="0,5" /></label>
            <label className="field"><span>Comprimento (cm)</span><input value={f.length_cm} onChange={(e) => set('length_cm', e.target.value)} /></label>
            <label className="field"><span>Largura (cm)</span><input value={f.width_cm} onChange={(e) => set('width_cm', e.target.value)} /></label>
            <label className="field"><span>Altura (cm)</span><input value={f.height_cm} onChange={(e) => set('height_cm', e.target.value)} /></label>
          </div>
        </div>

        <div className="card">
          <h3>Categorias</h3>
          <div className="chips">
            {CATEGORIES.map((c) => (
              <button type="button" key={c} className={`chip ${categories.includes(c) ? 'chip-on' : ''}`} onClick={() => toggleCat(c)}>{c}</button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Variações</h3>
          {variants.map((v, i) => (
            <div className="row-inline" key={i}>
              <input placeholder="Tamanho" value={v.size} onChange={(e) => setVariants((cur) => cur.map((x, j) => j === i ? { ...x, size: e.target.value } : x))} />
              <input placeholder="Cor" value={v.color} onChange={(e) => setVariants((cur) => cur.map((x, j) => j === i ? { ...x, color: e.target.value } : x))} />
              <select value={v.gender} onChange={(e) => setVariants((cur) => cur.map((x, j) => j === i ? { ...x, gender: e.target.value } : x))}>
                <option value="">—</option><option value="menina">menina</option><option value="menino">menino</option><option value="unissex">unissex</option>
              </select>
              <input placeholder="+/- R$" value={v.price_delta} onChange={(e) => setVariants((cur) => cur.map((x, j) => j === i ? { ...x, price_delta: e.target.value } : x))} />
              <button type="button" className="btn-link" onClick={() => setVariants((cur) => cur.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={() => setVariants((cur) => [...cur, { size: '', color: '', gender: '', price_delta: 0 }])}>+ Variação</button>
        </div>

        <div className="card">
          <h3>Adicionais / personalizações</h3>
          <p className="muted small">Ex.: "Bordar nome" — R$ 19,90.</p>
          {addons.map((a, i) => (
            <div className="row-inline" key={i}>
              <input placeholder="Nome do adicional" value={a.name} onChange={(e) => setAddons((cur) => cur.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
              <input placeholder="R$" value={a.price} onChange={(e) => setAddons((cur) => cur.map((x, j) => j === i ? { ...x, price: e.target.value } : x))} />
              <label className="field-check">
                <input type="checkbox" checked={a.requires_text} onChange={(e) => setAddons((cur) => cur.map((x, j) => j === i ? { ...x, requires_text: e.target.checked } : x))} />
                <span>pede texto</span>
              </label>
              <button type="button" className="btn-link" onClick={() => setAddons((cur) => cur.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost" onClick={() => setAddons((cur) => [...cur, { name: '', price: 0, requires_text: false }])}>+ Adicional</button>
        </div>

        <div className="card">
          <h3>Imagens</h3>
          <p className="muted small">Uma URL por linha. (Upload direto para o Storage chega numa fase futura.)</p>
          <textarea rows={3} value={f.images} onChange={(e) => set('images', e.target.value)} placeholder="https://…/foto1.jpg" style={{ width: '100%' }} />
        </div>

        {error && <div className="alert-error">{error}</div>}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar produto'}</button>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
