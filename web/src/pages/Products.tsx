import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL, parseBRL } from '../lib/format';

interface Variant { id?: string; size: string; color: string; gender: string; price_delta: number | string; }
interface Addon { id?: string; name: string; price: number | string; requires_text: boolean; }
interface Product {
  id: string; sku: string | null; name: string; description: string | null;
  price_cash: number | null; price_card: number | null; status: string;
  weight_kg: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null;
  featured?: boolean; images: string[]; product_categories?: { category: string }[];
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
          <thead><tr><th></th><th>Produto</th><th>SKU</th><th>Categorias</th><th>À vista</th><th>Peso</th><th>Status</th></tr></thead>
          <tbody>
            {!loading && list.length === 0 && <tr><td colSpan={7} className="muted center">Nenhum produto ainda.</td></tr>}
            {list.map((p) => (
              <tr key={p.id} className={writable ? 'row-link' : ''} onClick={() => writable && setEditing(p)}>
                <td>{p.images?.[0]
                  ? <img src={displaySrc(p.images[0])} alt="" style={THUMB_MINI} loading="lazy" />
                  : <div style={{ ...THUMB_MINI, ...THUMB_EMPTY }}>—</div>}</td>
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
  });
  const [images, setImages] = useState<string[]>(product?.images || []);
  const [featured, setFeatured] = useState<boolean>(!!product?.featured);
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
      featured,
      images,
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

  const statusLabel = ({ ativo: 'Ativo', inativo: 'Inativo', esgotado: 'Esgotado', oculto: 'Oculto' } as Record<string, string>)[f.status] || f.status;
  const statusPill = f.status === 'ativo' ? 'pill pill-ok' : f.status === 'esgotado' ? 'pill pill-warn' : 'pill';

  return (
    <div className="page">
      <form onSubmit={submit}>
        <div className="page-head">
          <div>
            <p className="crumb"><button type="button" className="btn-link" onClick={onCancel}>← Produtos</button></p>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {product ? 'Editar produto' : 'Novo produto'}
              {product && <span className={statusPill}>{statusLabel}</span>}
            </h1>
          </div>
          <div className="page-actions">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancelar</button>
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}</button>
          </div>
        </div>

        {error && <div className="alert-error">{error}</div>}

        <div className="two-col">
          {/* Coluna principal */}
          <div>
            <div className="card">
              <h3>Informações principais</h3>
              <div className="form-grid">
                <label className="field span-all"><span>Nome do produto *</span><input value={f.name} onChange={(e) => set('name', e.target.value)} required /></label>
                <label className="field"><span>SKU</span><input value={f.sku} onChange={(e) => set('sku', e.target.value)} placeholder="SM-G000" /></label>
                <label className="field"><span>Preço à vista (R$)</span><input value={f.price_cash} onChange={(e) => set('price_cash', e.target.value)} placeholder="349,00" /></label>
                <label className="field"><span>Preço no cartão (R$)</span><input value={f.price_card} onChange={(e) => set('price_card', e.target.value)} placeholder="369,00" /></label>
                <label className="field span-all"><span>Descrição</span>
                  <textarea rows={4} value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Conte os detalhes da peça: tecido, bordado, acabamento…" /></label>
              </div>
            </div>

            <div className="card">
              <h3>Status e visibilidade</h3>
              <div className="form-grid">
                <label className="field"><span>Status</span>
                  <select value={f.status} onChange={(e) => set('status', e.target.value)}>
                    <option value="ativo">Ativo</option><option value="inativo">Inativo</option>
                    <option value="esgotado">Esgotado</option><option value="oculto">Oculto</option>
                  </select>
                </label>
              </div>
              <label className="switch" style={{ marginTop: 2 }}>
                <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
                <span className="track" /><span className="switch-label">Produto em destaque (vitrine “Favoritas” da home)</span>
              </label>
              <p className="muted small" style={{ marginTop: 12 }}>Use <strong>Oculto</strong> para tirar do site sem apagar o produto.</p>
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
          </div>

          {/* Coluna lateral — imagens */}
          <div>
            <div className="card" style={{ position: 'sticky', top: 78 }}>
              <h3>Imagens do produto</h3>
              <p className="muted small">A 1ª imagem é a <strong>principal</strong> (capa no site). Arraste para enviar — as fotos são otimizadas (WebP) automaticamente.</p>
              <ImageManager productId={product?.id} images={images} setImages={setImages} />
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}

/* ============================ Gerenciador de imagens ============================ */

const MAX_INPUT_BYTES = 15 * 1024 * 1024; // 15 MB por arquivo (antes de comprimir)
const MAX_DIM = 1600;                     // maior lado após redimensionar
const WEBP_QUALITY = 0.82;                // qualidade boa p/ foto de produto
const SITE_BASE = 'https://ateliedalili-site.pages.dev';
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';

/** Prefixa imagens antigas (caminho relativo "images/...") com a origem do
 *  site para que apareçam no painel; URLs completas (Storage) passam direto. */
function displaySrc(u: string): string {
  return /^https?:\/\//i.test(u) ? u : `${SITE_BASE}/${u.replace(/^\/+/, '')}`;
}
function isStorageUrl(u: string): boolean {
  return u.includes('/storage/v1/object/public/catalog/');
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler a imagem.')); };
    img.src = url;
  });
}

/** Redimensiona (se muito grande) e converte para WebP, no navegador. */
async function compressToWebp(file: File): Promise<Blob> {
  const img = await loadImage(file);
  let { width, height } = img;
  const max = Math.max(width, height);
  if (max > MAX_DIM) { const s = MAX_DIM / max; width = Math.round(width * s); height = Math.round(height * s); }
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas indisponível neste navegador.');
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/webp', WEBP_QUALITY));
  if (!blob) throw new Error('Falha ao otimizar a imagem.');
  return blob;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result); resolve(s.slice(s.indexOf(',') + 1)); };
    fr.onerror = () => reject(new Error('Falha ao ler o arquivo.'));
    fr.readAsDataURL(blob);
  });
}

type UpStatus = 'comprimindo' | 'enviando' | 'ok' | 'erro' | 'cancelado';
interface Upload { id: string; name: string; preview: string; status: UpStatus; msg?: string; }

function uid(): string {
  try { return crypto.randomUUID(); } catch { return Date.now().toString(36) + Math.random().toString(36).slice(2); }
}

function ImageManager({ productId, images, setImages }:
  { productId?: string; images: string[]; setImages: (u: (cur: string[]) => string[]) => void }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [replacing, setReplacing] = useState<number | null>(null);
  const ctrls = useRef<Map<string, AbortController>>(new Map());
  const addRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceIdx = useRef<number>(-1);

  const disabled = !productId; // upload precisa do id do produto (salve antes)

  const patchUp = (id: string, p: Partial<Upload>) => setUploads((cur) => cur.map((u) => u.id === id ? { ...u, ...p } : u));
  const dropUp = (id: string) => setUploads((cur) => cur.filter((u) => u.id !== id));

  async function uploadOne(file: File) {
    const id = uid();
    if (!file.type.startsWith('image/')) { setUploads((c) => [...c, { id, name: file.name, preview: '', status: 'erro', msg: 'Não é uma imagem.' }]); return; }
    if (file.size > MAX_INPUT_BYTES) { setUploads((c) => [...c, { id, name: file.name, preview: '', status: 'erro', msg: 'Arquivo muito grande (máx. 15MB).' }]); return; }

    const preview = URL.createObjectURL(file);
    setUploads((c) => [...c, { id, name: file.name, preview, status: 'comprimindo' }]);
    const ctrl = new AbortController();
    ctrls.current.set(id, ctrl);
    try {
      const blob = await compressToWebp(file);
      if (ctrl.signal.aborted) throw new DOMException('cancelado', 'AbortError');
      patchUp(id, { status: 'enviando' });
      const dataBase64 = await blobToBase64(blob);
      const res = await apiFetch<{ url: string }>('/api/product-image', {
        method: 'POST',
        body: JSON.stringify({ product_id: productId, dataBase64, contentType: 'image/webp' }),
        signal: ctrl.signal,
      });
      setImages((cur) => [...cur, res.url]);
      patchUp(id, { status: 'ok' });
      setTimeout(() => dropUp(id), 900);
    } catch (e: any) {
      if (ctrl.signal.aborted || e?.name === 'AbortError') patchUp(id, { status: 'cancelado' });
      else patchUp(id, { status: 'erro', msg: e?.message || 'Falha no envio.' });
    } finally {
      ctrls.current.delete(id);
    }
  }

  function handleFiles(files: FileList | File[] | null) {
    if (!files) return;
    Array.from(files).forEach((f) => { void uploadOne(f); });
  }

  function cancel(id: string) { ctrls.current.get(id)?.abort(); }

  function removeAt(i: number) {
    const url = images[i];
    setImages((cur) => cur.filter((_, j) => j !== i));
    if (isStorageUrl(url)) {
      apiFetch('/api/product-image', { method: 'DELETE', body: JSON.stringify({ url }) }).catch(() => {/* órfão tolerável */});
    }
  }
  function makeMain(i: number) { setImages((cur) => { const a = [...cur]; const [x] = a.splice(i, 1); a.unshift(x); return a; }); }
  function move(i: number, dir: -1 | 1) {
    setImages((cur) => { const a = [...cur]; const j = i + dir; if (j < 0 || j >= a.length) return cur; [a[i], a[j]] = [a[j], a[i]]; return a; });
  }
  async function doReplace(i: number, file: File) {
    if (!file || !file.type.startsWith('image/')) return;
    const old = images[i];
    setReplacing(i);
    try {
      const blob = await compressToWebp(file);
      const dataBase64 = await blobToBase64(blob);
      const res = await apiFetch<{ url: string }>('/api/product-image', {
        method: 'POST', body: JSON.stringify({ product_id: productId, dataBase64, contentType: 'image/webp' }),
      });
      setImages((cur) => cur.map((u, j) => j === i ? res.url : u));
      if (isStorageUrl(old)) apiFetch('/api/product-image', { method: 'DELETE', body: JSON.stringify({ url: old }) }).catch(() => {});
    } catch (e: any) {
      alert('Erro ao trocar a imagem: ' + (e?.message || ''));
    } finally { setReplacing(null); }
  }

  return (
    <div>
      {disabled && <p className="muted small" style={{ color: '#b45309' }}>Salve o produto primeiro para poder enviar imagens.</p>}

      {/* Grade das imagens já vinculadas */}
      {images.length > 0 && (
        <div style={GRID}>
          {images.map((url, i) => (
            <div key={url + i} style={CARD}>
              <div style={THUMB_WRAP}>
                <img src={displaySrc(url)} alt="" style={THUMB} loading="lazy" />
                {i === 0 && <span style={MAIN_BADGE}>★ Principal</span>}
                {replacing === i && <div style={OVERLAY}>trocando…</div>}
              </div>
              <div style={CARD_ACTIONS}>
                {i !== 0 && <button type="button" style={MINI_BTN} title="Tornar principal" onClick={() => makeMain(i)}>★ principal</button>}
                <span style={{ flex: 1 }} />
                <button type="button" style={ICON_BTN} title="Mover para trás" disabled={i === 0} onClick={() => move(i, -1)}>◀</button>
                <button type="button" style={ICON_BTN} title="Mover para frente" disabled={i === images.length - 1} onClick={() => move(i, 1)}>▶</button>
                <button type="button" style={ICON_BTN} title="Trocar" disabled={!!disabled} onClick={() => { replaceIdx.current = i; replaceRef.current?.click(); }}>⟳</button>
                <button type="button" style={{ ...ICON_BTN, color: '#dc2626' }} title="Excluir" onClick={() => removeAt(i)}>🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Uploads em andamento */}
      {uploads.length > 0 && (
        <div style={GRID}>
          {uploads.map((u) => (
            <div key={u.id} style={CARD}>
              <div style={THUMB_WRAP}>
                {u.preview
                  ? <img src={u.preview} alt="" style={{ ...THUMB, opacity: u.status === 'erro' || u.status === 'cancelado' ? 0.4 : 0.8 }} />
                  : <div style={{ ...THUMB, ...THUMB_EMPTY }}>?</div>}
                <div style={OVERLAY}>
                  {u.status === 'comprimindo' && 'otimizando…'}
                  {u.status === 'enviando' && 'enviando…'}
                  {u.status === 'ok' && '✓ pronto'}
                  {u.status === 'cancelado' && 'cancelado'}
                  {u.status === 'erro' && (u.msg || 'erro')}
                </div>
              </div>
              <div style={CARD_ACTIONS}>
                <span className="muted small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                {(u.status === 'comprimindo' || u.status === 'enviando')
                  ? <button type="button" style={MINI_BTN} onClick={() => cancel(u.id)}>cancelar</button>
                  : <button type="button" style={MINI_BTN} onClick={() => dropUp(u.id)}>fechar</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Zona de envio (drag & drop + clique) */}
      <div
        onDragOver={(e) => { if (!disabled) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!disabled) handleFiles(e.dataTransfer.files); }}
        onClick={() => { if (!disabled) addRef.current?.click(); }}
        style={{ ...DROP, ...(dragOver ? DROP_OVER : null), ...(disabled ? DROP_DISABLED : null) }}
      >
        <strong>Arraste imagens aqui</strong>
        <span className="muted small">ou clique para selecionar — pode escolher várias de uma vez</span>
        <span className="muted small">JPG, PNG, WebP ou AVIF · até 15MB cada</span>
      </div>

      <input ref={addRef} type="file" accept={ACCEPT} multiple hidden
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      <input ref={replaceRef} type="file" accept={ACCEPT} hidden
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file && replaceIdx.current >= 0) doReplace(replaceIdx.current, file); }} />
    </div>
  );
}

/* estilos inline (autocontidos, sem depender do CSS global) */
const THUMB_MINI: CSSProperties = { width: 40, height: 40, borderRadius: 6, objectFit: 'cover', display: 'block', background: '#f1f5f9' };
const THUMB_EMPTY: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 };
const GRID: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 12, margin: '12px 0' };
const CARD: CSSProperties = { border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', background: '#fff' };
const THUMB_WRAP: CSSProperties = { position: 'relative', width: '100%', aspectRatio: '1 / 1', background: '#f8fafc' };
const THUMB: CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const MAIN_BADGE: CSSProperties = { position: 'absolute', top: 6, left: 6, background: '#111827', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 999 };
const OVERLAY: CSSProperties = { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15,23,42,.55)', color: '#fff', fontSize: 12, textAlign: 'center', padding: 6 };
const CARD_ACTIONS: CSSProperties = { display: 'flex', alignItems: 'center', gap: 2, padding: 6 };
const MINI_BTN: CSSProperties = { fontSize: 11, padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' };
const ICON_BTN: CSSProperties = { fontSize: 13, padding: '3px 6px', border: '1px solid #e2e8f0', borderRadius: 6, background: '#fff', cursor: 'pointer', lineHeight: 1 };
const DROP: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: 22, border: '2px dashed #cbd5e1', borderRadius: 12, textAlign: 'center', cursor: 'pointer', background: '#f8fafc' };
const DROP_OVER: CSSProperties = { borderColor: '#6366f1', background: '#eef2ff' };
const DROP_DISABLED: CSSProperties = { opacity: 0.5, cursor: 'not-allowed' };
