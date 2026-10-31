import {
  useEffect, useRef, useState,
  type CSSProperties, type DragEvent, type Dispatch, type FormEvent, type SetStateAction,
} from 'react';
import {
  Info, Image as ImageIcon, Package, Palette, Layers, Tag, Eye,
  Star, Trash2, ChevronUp, ChevronDown, ExternalLink, Copy, Plus, X,
  AlertTriangle, Check, RefreshCw, ZoomIn,
} from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL, parseBRL, displaySrc, SITE_BASE } from '../lib/format';
import { parseFicha, serializeFicha, semAcento, type Ficha } from '../components/FichaEditor';

interface InvRow { variant_id: string | null; quantity: number; reserved: number; }
interface Variant {
  id?: string; size: string; color: string; gender: string; price_delta: number | string;
  is_active?: boolean;
  /* contagem daquele tamanho; vazio = tamanho sem controle de estoque */
  stock?: number | string; inventory?: InvRow[];
}
interface Addon {
  id?: string; name: string; price: number | string; requires_text: boolean;
  /* produto que o adicional consome do estoque (null = só preço, ex.: bordar nome) */
  addon_product_id?: string | null;
}
interface Component {
  id?: string; child_product_id: string; child_variant_id?: string | null;
  match_size?: boolean; quantity: number | string;
}
interface Product {
  id: string; sku: string | null; name: string; slug?: string | null; description: string | null;
  price_cash: number | null; price_card: number | null; original_price?: number | null; installments_max?: number | null; status: string;
  weight_kg: number | null; length_cm: number | null; width_cm: number | null; height_cm: number | null;
  featured?: boolean; images: string[]; product_categories?: { category: string }[];
  product_variants?: Variant[]; product_addons?: Addon[];
  product_components?: Component[]; inventory?: InvRow[];
}

/** Catálogo leve para componentes/adicionais e para mostrar as "irmãs" do grupo. */
interface CatItem { id: string; name: string; sku: string | null; image: string | null; cats: string[]; }

/** Contagem gravada para a peça inteira (a linha sem variação). */
function estoqueDoProduto(p: Product | null): string {
  const linha = (p?.inventory || []).find((i) => i.variant_id === null);
  return linha ? String(linha.quantity) : '';
}

/** Contagem gravada para um tamanho. */
function estoqueDaVariacao(v: Variant): string {
  const linha = (v.inventory || [])[0];
  return linha ? String(linha.quantity) : '';
}

/** "aurora rosê" -> "aurora-rose" (slug amigável p/ URL) */
function slugify(s: string): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/* As subcategorias de "acessorios" o site mostra numa segunda fila de filtros,
   dentro da aba Acessórios. Marque sempre "acessorios" JUNTO da subcategoria. */
const CAT_GRUPOS: { grupo: string; itens: string[] }[] = [
  { grupo: 'Público', itens: ['menina', 'menino', 'unissex'] },
  { grupo: 'Linha', itens: ['luxo', 'kit'] },
  { grupo: 'Enxoval', itens: ['manta', 'cueiro'] },
  { grupo: 'Acessórios', itens: ['acessorios', 'touca', 'sapato-faixa', 'sapatinho-menina', 'sapatinho-menino'] },
];
const CATEGORIES = CAT_GRUPOS.flatMap((g) => g.itens);
const CAT_LABEL: Record<string, string> = {
  'sapato-faixa': 'sapato e faixa', 'sapatinho-menina': 'sapatinho menina', 'sapatinho-menino': 'sapatinho menino',
};
const catLabel = (c: string) => CAT_LABEL[c] || c;

/* Peças mais usadas nas saídas, agrupadas. Clicar inclui no "Contém" da ficha
   (texto livre — qualquer outra peça pode ser digitada em "outra peça"). */
const PECA_GRUPOS: { grupo: string; itens: string[] }[] = [
  { grupo: 'Roupas', itens: ['Vestido', 'Body', 'Macacão', 'Jardineira', 'Calça', 'Casaco'] },
  { grupo: 'Enxoval', itens: ['Manta', 'Cueiro'] },
  { grupo: 'Acessórios', itens: ['Touca', 'Touca personalizada', 'Sapatinho', 'Sapato e faixa', 'Faixa'] },
  { grupo: 'Outros', itens: ['Luva', 'Touca e Luva', 'Babador', 'Nome na golinha'] },
];

const SECTIONS = [
  { id: 'info', label: 'Informações', icon: Info },
  { id: 'fotos', label: 'Fotografias', icon: ImageIcon },
  { id: 'composicao', label: 'Composição e peças', icon: Package },
  { id: 'variacoes', label: 'Cores e tamanhos', icon: Palette },
  { id: 'grupos', label: 'Grupos do modelo', icon: Layers },
  { id: 'categorias', label: 'Categorias', icon: Tag },
  { id: 'publicacao', label: 'Status e publicação', icon: Eye },
] as const;
type SectionId = typeof SECTIONS[number]['id'];

export default function Products() {
  const { can } = useAuth();
  const [list, setList] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const writable = can('products.write');

  const term = q.trim().toLowerCase();
  const filtered = list.filter((p) =>
    (!term || p.name.toLowerCase().includes(term) || (p.sku || '').toLowerCase().includes(term)) &&
    (!statusF || p.status === statusF));

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
      onClose={() => { setEditing(null); load(); }}
      onReload={load}
    />;
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Produtos</h1><p className="muted">{loading ? 'Carregando…' : `${filtered.length} de ${list.length} produto(s)`}</p></div>
        {writable && <button className="btn btn-primary" onClick={() => setEditing('new')}><Plus size={16} /> Novo produto</button>}
      </div>

      <div className="filters" style={{ marginBottom: 16 }}>
        <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou SKU…" /></div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="">Todos os status</option>
          <option value="ativo">Ativo</option><option value="inativo">Inativo</option>
          <option value="esgotado">Esgotado</option><option value="oculto">Oculto</option>
        </select>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead><tr><th></th><th>Produto</th><th>SKU</th><th>Categorias</th><th>À vista</th><th>Peso</th><th>Status</th></tr></thead>
          <tbody>
            {!loading && filtered.length === 0 && <tr><td colSpan={7} className="muted center">{list.length === 0 ? 'Nenhum produto ainda.' : 'Nenhum produto encontrado.'}</td></tr>}
            {filtered.map((p) => (
              <tr key={p.id} className={writable ? 'row-link' : ''} onClick={() => writable && setEditing(p)}>
                <td>{p.images?.[0]
                  ? <img src={displaySrc(p.images[0])} alt="" style={THUMB_MINI} loading="lazy" />
                  : <div style={{ ...THUMB_MINI, ...THUMB_EMPTY }}>—</div>}</td>
                <td><strong>{p.name}</strong></td>
                <td className="mono">{p.sku || '—'}</td>
                <td>{(p.product_categories || []).filter((c) => !c.category.startsWith('modelo:') && !c.category.startsWith('pecas:')).map((c) => <span key={c.category} className="badge">{catLabel(c.category)}</span>)}</td>
                <td>{p.price_cash != null ? formatBRL(p.price_cash) : '—'}</td>
                <td>{p.weight_kg != null ? `${p.weight_kg} kg` : '—'}</td>
                <td><span className={statusPillClass(p.status)}>{statusLabelOf(p.status)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function statusLabelOf(s: string): string {
  return ({ ativo: 'Ativo', inativo: 'Inativo', esgotado: 'Esgotado', oculto: 'Oculto' } as Record<string, string>)[s] || s;
}
function statusPillClass(s: string): string {
  if (s === 'ativo') return 'pill pill-ok';
  if (s === 'esgotado') return 'pill pill-warn';
  if (s === 'oculto') return 'pill pill-info';
  return 'pill';
}

/* ============================ Editor ============================ */

function ProductEditor({ product, onClose, onReload }: { product: Product | null; onClose: () => void; onReload: () => void }) {
  /* Valores iniciais calculados uma vez — servem para o estado E para a
     linha de base do "alterações não salvas", para os dois nunca divergirem. */
  const init = {
    name: product?.name || '', sku: product?.sku || '', slug: product?.slug || '', status: product?.status || 'ativo',
    price_cash: product?.price_cash != null ? String(product.price_cash) : '',
    price_card: product?.price_card != null ? String(product.price_card) : '',
    original_price: product?.original_price != null ? String(product.original_price) : '',
    installments_max: product?.installments_max != null ? String(product.installments_max) : '',
    weight_kg: product?.weight_kg != null ? String(product.weight_kg) : '',
    length_cm: product?.length_cm != null ? String(product.length_cm) : '',
    width_cm: product?.width_cm != null ? String(product.width_cm) : '',
    height_cm: product?.height_cm != null ? String(product.height_cm) : '',
  };
  const initImages = product?.images || [];
  const initFeatured = !!product?.featured;
  const initCats = (product?.product_categories || []).map((c) => c.category)
    .filter((c) => !c.startsWith('modelo:') && !c.startsWith('pecas:'));
  const initModelo = ((product?.product_categories || []).find((c) => c.category.startsWith('modelo:'))?.category || '').replace('modelo:', '');
  const initGrupo = ((product?.product_categories || []).find((c) => c.category.startsWith('pecas:'))?.category || '').replace('pecas:', '');
  const initVariants: Variant[] = (product?.product_variants || []).filter((v) => v.is_active !== false)
    .map((v) => ({ ...v, stock: estoqueDaVariacao(v) }));
  const initAddons: Addon[] = product?.product_addons || [];
  const initComponents: Component[] = product?.product_components || [];
  const initStock = estoqueDoProduto(product);
  const initFicha: Ficha = parseFicha(product?.description || '');

  const [pid, setPid] = useState<string | null>(product?.id || null);
  const [f, setF] = useState(init);
  const [ficha, setFicha] = useState<Ficha>(initFicha);
  const [images, setImages] = useState<string[]>(initImages);
  const [featured, setFeatured] = useState<boolean>(initFeatured);
  const [categories, setCategories] = useState<string[]>(initCats);
  const [modelo, setModelo] = useState<string>(initModelo);
  const [grupoPecas, setGrupoPecas] = useState<string>(initGrupo);
  const [variants, setVariants] = useState<Variant[]>(initVariants);
  const [addons, setAddons] = useState<Addon[]>(initAddons);
  const [components, setComponents] = useState<Component[]>(initComponents);
  const [stockProduto, setStockProduto] = useState<string>(initStock);
  const [catalogo, setCatalogo] = useState<CatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedOk, setSavedOk] = useState(false);
  const [active, setActive] = useState<SectionId>('info');
  const [preview, setPreview] = useState(false);

  const [baseline, setBaseline] = useState<string>(() => snapOf({
    ...init, description: serializeFicha(initFicha), images: initImages, featured: initFeatured,
    categories: initCats, modelo: initModelo, grupoPecas: initGrupo,
    variants: initVariants, addons: initAddons, components: initComponents, stockProduto: initStock,
  }));

  const set = (k: keyof typeof init, v: string) => { setF((s) => ({ ...s, [k]: v })); setSavedOk(false); };

  useEffect(() => {
    apiFetch<{ products: Product[] }>('/api/products')
      .then((r) => setCatalogo((r.products || []).map((p) => ({
        id: p.id, name: p.name, sku: p.sku, image: p.images?.[0] || null,
        cats: (p.product_categories || []).map((c) => c.category),
      }))))
      .catch(() => {});
  }, []);

  /* Snapshot atual × linha de base = há alterações não salvas? */
  const curSnap = snapOf({
    ...f, description: serializeFicha(ficha), images, featured,
    categories, modelo, grupoPecas, variants, addons, components, stockProduto,
  });
  const dirty = curSnap !== baseline;

  /* Avisa ao fechar a aba/recarregar com alterações pendentes. */
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  /* Destaca a seção visível na navegação lateral. */
  const secRefs = useRef<Record<string, HTMLElement | null>>({});
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
      if (vis[0]) setActive((vis[0].target as HTMLElement).id as SectionId);
    }, { rootMargin: '-80px 0px -55% 0px', threshold: [0, 0.2, 0.6] });
    SECTIONS.forEach((s) => { const el = secRefs.current[s.id]; if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, []);
  function goto(id: SectionId) { secRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  function toggleCat(c: string) {
    setSavedOk(false);
    setCategories((cur) => cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
  }

  /* ---- validação ---- */
  const nameErr = !f.name.trim();
  const noPrice = !f.price_cash.trim();
  const noPhoto = images.length === 0;
  /* Produto ativo sem SKU não aparece no site: o catálogo público filtra
     peças sem código (sem SKU não há link estável produto.html?id/sku). */
  const noSkuAtivo = f.status === 'ativo' && !f.sku.trim();
  const warns: Partial<Record<SectionId, boolean>> = { info: nameErr || noPrice || noSkuAtivo, fotos: noPhoto, publicacao: noSkuAtivo };

  function basePayload() {
    return {
      name: f.name, sku: f.sku || null, slug: (f.slug || slugify(f.name)) || null, status: f.status,
      price_cash: f.price_cash ? parseBRL(f.price_cash) : null,
      price_card: f.price_card ? parseBRL(f.price_card) : null,
      original_price: f.original_price ? parseBRL(f.original_price) : null,
      installments_max: f.installments_max ? Math.trunc(parseBRL(f.installments_max)) : null,
      weight_kg: f.weight_kg ? parseBRL(f.weight_kg) : null,
      length_cm: f.length_cm ? parseBRL(f.length_cm) : null,
      width_cm: f.width_cm ? parseBRL(f.width_cm) : null,
      height_cm: f.height_cm ? parseBRL(f.height_cm) : null,
      description: serializeFicha(ficha) || null,
      featured, images,
      categories: [
        ...categories,
        ...(modelo.trim() ? ['modelo:' + modelo.trim().toLowerCase()] : []),
        ...(grupoPecas.trim() ? ['pecas:' + grupoPecas.trim().toLowerCase()] : []),
      ],
      variants: variants.map((v) => ({
        id: v.id, size: v.size, color: v.color, gender: v.gender,
        price_delta: parseBRL(v.price_delta),
        stock: String(v.stock ?? '').trim(),
      })),
      /* peça com tamanhos conta por tamanho; sem tamanhos, conta inteira */
      stock: variants.length ? '' : stockProduto.trim(),
      addons: addons.map((a) => ({ ...a, price: parseBRL(a.price) })),
      components: components
        .filter((c) => c.child_product_id)
        .map((c) => ({
          child_product_id: c.child_product_id,
          match_size: c.match_size !== false,
          quantity: Math.max(1, Math.round(Number(c.quantity) || 1)),
        })),
    };
  }

  /* Depois de salvar: adota o que o servidor devolveu (id/slug/sku) e zera a
     linha de base, para a tela continuar aberta sem marcar "não salvo". */
  function adopt(saved: Product) {
    const slug = saved.slug ?? (f.slug || slugify(f.name));
    const sku = saved.sku ?? (f.sku || '');
    const imgs = saved.images ?? images;
    setPid(saved.id);
    setF((s) => ({ ...s, slug: slug || '', sku: sku || '' }));
    setImages(imgs);
    setBaseline(snapOf({
      ...f, slug: slug || '', sku: sku || '', description: serializeFicha(ficha), images: imgs, featured,
      categories, modelo, grupoPecas, variants, addons, components, stockProduto,
    }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (nameErr) { setError('Dê um nome ao produto para poder salvar.'); goto('info'); return; }
    setBusy(true); setError('');
    try {
      const payload = basePayload();
      const r = pid
        ? await apiFetch<{ product: Product }>(`/api/products?id=${pid}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await apiFetch<{ product: Product }>('/api/products', { method: 'POST', body: JSON.stringify(payload) });
      if (r.product) adopt(r.product);
      onReload();
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 2600);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); }
    finally { setBusy(false); }
  }

  /* Duplicar = abre um NOVO produto pré-preenchido para outra cor do mesmo
     modelo. Aproveita descrição, composição, itens, categorias, grupos e
     preços; NÃO copia SKU, slug, estoque nem fotos (a cor nova tem as suas). */
  function duplicate() {
    if (!window.confirm('Criar um novo produto a partir deste? Descrição, composição, itens, categorias e preços são aproveitados. SKU, fotos e estoque começam vazios para você preencher.')) return;
    setPid(null);
    setF((s) => ({ ...s, name: s.name.replace(/\s*\(cópia\)$/, '') + ' (cópia)', sku: '', slug: '', status: 'inativo' }));
    setImages([]);
    setStockProduto('');
    setVariants((cur) => cur.map((v) => ({ ...v, id: undefined, stock: '' })));
    setAddons((cur) => cur.map((a) => ({ ...a, id: undefined })));
    setComponents((cur) => cur.map((c) => ({ ...c, id: undefined })));
    setBaseline('');                 // força "não salvo" (é um produto novo)
    setSavedOk(false); setError('');
    goto('info');
  }

  async function remove() {
    if (!pid) return;
    if (!window.confirm(`Excluir "${f.name}"? Esta ação não pode ser desfeita.`)) return;
    setBusy(true); setError('');
    try {
      await apiFetch(`/api/products?id=${pid}`, { method: 'DELETE' });
      onClose();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao excluir.'); setBusy(false); }
  }

  function tryClose() {
    if (dirty && !window.confirm('Há alterações não salvas. Sair mesmo assim?')) return;
    onClose();
  }

  /* Negrito e itálico na descrição, na mesma convenção da ficha. */
  const prosaRef = useRef<HTMLTextAreaElement>(null);
  function envolver(marca: string) {
    const el = prosaRef.current;
    if (!el) return;
    const ini = el.selectionStart ?? 0, fim = el.selectionEnd ?? 0;
    const txt = ficha.prosa, dentro = txt.slice(ini, fim) || 'texto';
    const novo = txt.slice(0, ini) + marca + dentro + marca + txt.slice(fim);
    setFicha((cur) => ({ ...cur, prosa: novo })); setSavedOk(false);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(ini + marca.length, ini + marca.length + dentro.length); });
  }

  /* itens inclusos (## Contém) */
  const jaIncluso = new Set(ficha.contem.map((x) => semAcento(x)));
  function togglePeca(label: string) {
    setSavedOk(false);
    setFicha((cur) => {
      const has = cur.contem.some((x) => semAcento(x) === semAcento(label));
      return { ...cur, contem: has ? cur.contem.filter((x) => semAcento(x) !== semAcento(label)) : [...cur.contem, label] };
    });
  }
  const setContem = (contem: string[]) => { setFicha((cur) => ({ ...cur, contem })); setSavedOk(false); };

  /* irmãs do mesmo grupo (somente leitura, ajuda a não errar a palavra) */
  const siblingsCor = modelo.trim()
    ? catalogo.filter((p) => p.id !== pid && p.cats.includes('modelo:' + modelo.trim().toLowerCase())) : [];
  const siblingsPecas = grupoPecas.trim()
    ? catalogo.filter((p) => p.id !== pid && p.cats.includes('pecas:' + grupoPecas.trim().toLowerCase())) : [];
  const modelosConhecidos = Array.from(new Set(catalogo.flatMap((p) => p.cats).filter((c) => c.startsWith('modelo:')).map((c) => c.replace('modelo:', '')))).sort();
  const gruposConhecidos = Array.from(new Set(catalogo.flatMap((p) => p.cats).filter((c) => c.startsWith('pecas:')).map((c) => c.replace('pecas:', '')))).sort();

  const skuUp = f.sku.trim().toUpperCase();
  const canView = !!pid && !!skuUp;
  const siteUrl = canView ? `${SITE_BASE}/produto.html?sku=${encodeURIComponent(skuUp)}` : '';

  const outrasCats = categories.filter((c) => !CATEGORIES.includes(c));

  return (
    <div className="page" style={{ paddingBottom: 96 }}>
      <form onSubmit={submit}>
        <div className="page-head">
          <div>
            <p className="crumb"><button type="button" className="btn-link" onClick={tryClose}>← Produtos</button></p>
            <h1 style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {pid ? (f.name || 'Editar produto') : 'Novo produto'}
              <span className={statusPillClass(f.status)}>{statusLabelOf(f.status)}</span>
            </h1>
          </div>
          <div className="page-actions">
            {canView && <button type="button" className="btn btn-ghost" onClick={() => setPreview(true)}><Eye size={16} /> Prévia</button>}
            {canView && <a className="btn btn-ghost" href={siteUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={16} /> Ver no site</a>}
            {pid && <button type="button" className="btn btn-ghost" disabled={busy} onClick={duplicate}><Copy size={16} /> Duplicar</button>}
            {pid && <button type="button" className="btn btn-ghost btn-danger" disabled={busy} onClick={remove}><Trash2 size={16} /> Excluir</button>}
          </div>
        </div>

        {error && <div className="alert-error">{error}</div>}

        <div className="pe">
          {/* navegação lateral por seções */}
          <nav className="pe-nav" aria-label="Seções do produto">
            {SECTIONS.map((s) => (
              <a key={s.id} className={active === s.id ? 'on' : ''} onClick={() => goto(s.id)}>
                <s.icon /> <span>{s.label}</span>
                {warns[s.id] && <span className="dot-warn" title="Precisa de atenção" />}
              </a>
            ))}
          </nav>

          <div className="pe-sections">
            {/* 1 — Informações */}
            <section id="info" ref={(el) => { secRefs.current.info = el; }} className="pe-sec">
              <div className="card">
                <div className="sec-title"><Info size={18} /><h3>Informações do produto</h3></div>
                <p className="sec-desc">Nome, código, preços e a descrição que aparece na página.</p>
                <div className="form-grid">
                  <label className="field span-all"><span>Nome do produto *</span>
                    <input value={f.name} onChange={(e) => set('name', e.target.value)} required
                      style={nameErr ? { borderColor: 'var(--bad)' } : undefined} />
                    {nameErr && <span className="field-err">O nome é obrigatório.</span>}
                  </label>
                  <label className="field"><span>SKU (código)</span>
                    <input value={f.sku} onChange={(e) => set('sku', e.target.value)} placeholder="SM-G000"
                      style={noSkuAtivo ? { borderColor: 'var(--warn)' } : undefined} />
                    {noSkuAtivo && <span className="field-err" style={{ color: 'var(--warn)' }}>Produto ativo sem SKU não aparece no site.</span>}
                  </label>
                  <label className="field"><span>Slug (URL)</span><input value={f.slug} onChange={(e) => set('slug', e.target.value)} placeholder={slugify(f.name) || 'gerado-do-nome'} /></label>
                  <label className="field"><span>Preço à vista / Pix (R$)</span>
                    <input value={f.price_cash} onChange={(e) => set('price_cash', e.target.value)} placeholder="349,00"
                      style={noPrice ? { borderColor: 'var(--warn)' } : undefined} />
                    {noPrice && <span className="field-err" style={{ color: 'var(--warn)' }}>Sem preço, a peça não mostra valor no site.</span>}
                  </label>
                  <label className="field"><span>Preço no cartão (R$)</span><input value={f.price_card} onChange={(e) => set('price_card', e.target.value)} placeholder="369,00" /></label>
                  <label className="field"><span>Preço "de" / promocional (R$)</span><input value={f.original_price} onChange={(e) => set('original_price', e.target.value)} placeholder="opcional — mostra riscado" /></label>
                  <label className="field"><span>Parcelas (máx.)</span><input value={f.installments_max} onChange={(e) => set('installments_max', e.target.value)} placeholder="6" inputMode="numeric" /></label>
                </div>

                <div className="field span-all" style={{ marginTop: 6 }}>
                  <span>Descrição — o texto ao lado do preço</span>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => envolver('**')} title="Negrito"><b>N</b></button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => envolver('*')} title="Itálico"><i>I</i></button>
                  </div>
                  <textarea ref={prosaRef} rows={4} value={ficha.prosa}
                    placeholder="Tricô salmão com flores 3D aplicadas no tule e gola de renda."
                    onChange={(e) => { setFicha((cur) => ({ ...cur, prosa: e.target.value })); setSavedOk(false); }} />
                </div>

                <h4 className="sub-h">Características</h4>
                <datalist id="rotulos-ficha">
                  {['Tecido', 'Medidas', 'Composição', 'Personalização', 'Cuidados', 'Peso'].map((r) => <option key={r} value={r} />)}
                </datalist>
                {ficha.caracs.map((c, i) => (
                  <div className="row-inline" key={i}>
                    <input list="rotulos-ficha" value={c.k} placeholder="Tecido" style={{ maxWidth: 180 }}
                      onChange={(e) => { setFicha((cur) => ({ ...cur, caracs: cur.caracs.map((x, j) => j === i ? { ...x, k: e.target.value } : x) })); setSavedOk(false); }} />
                    <input value={c.v} placeholder="Tricô 100% algodão"
                      onChange={(e) => { setFicha((cur) => ({ ...cur, caracs: cur.caracs.map((x, j) => j === i ? { ...x, v: e.target.value } : x) })); setSavedOk(false); }} />
                    <button type="button" className="btn-link" onClick={() => { setFicha((cur) => ({ ...cur, caracs: cur.caracs.filter((_, j) => j !== i) })); setSavedOk(false); }}><X size={15} /></button>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFicha((cur) => ({ ...cur, caracs: [...cur.caracs, { k: '', v: '' }] })); setSavedOk(false); }}><Plus size={14} /> Característica</button>

                <label className="field" style={{ marginTop: 16, maxWidth: 260 }}><span>Prazo de produção</span>
                  <input value={ficha.prazo} placeholder="15 dias úteis"
                    onChange={(e) => { setFicha((cur) => ({ ...cur, prazo: e.target.value })); setSavedOk(false); }} /></label>

                <h4 className="sub-h">Frete — peso e dimensões</h4>
                <p className="muted small" style={{ marginTop: -6 }}>Usados na cotação de frete. O cliente nunca precisa informar.</p>
                <div className="form-grid">
                  <label className="field"><span>Peso (kg)</span><input value={f.weight_kg} onChange={(e) => set('weight_kg', e.target.value)} placeholder="0,5" /></label>
                  <label className="field"><span>Comprimento (cm)</span><input value={f.length_cm} onChange={(e) => set('length_cm', e.target.value)} /></label>
                  <label className="field"><span>Largura (cm)</span><input value={f.width_cm} onChange={(e) => set('width_cm', e.target.value)} /></label>
                  <label className="field"><span>Altura (cm)</span><input value={f.height_cm} onChange={(e) => set('height_cm', e.target.value)} /></label>
                </div>

                {ficha.extras && (
                  <p className="muted small" style={{ marginTop: 10 }}>
                    <AlertTriangle size={13} style={{ verticalAlign: '-2px' }} /> Esta ficha tem outras seções escritas à mão. Elas são preservadas no texto e vão para o site.
                  </p>
                )}
              </div>
            </section>

            {/* 2 — Fotografias */}
            <section id="fotos" ref={(el) => { secRefs.current.fotos = el; }} className="pe-sec">
              <div className="card">
                <div className="sec-title"><ImageIcon size={18} /><h3>Fotografias</h3></div>
                <p className="sec-desc">A 1ª foto é a <strong>capa</strong> no site. Arraste para reordenar; otimizamos em WebP automaticamente.</p>
                <ImageManager productId={pid} images={images} setImages={(u) => { setImages(u); setSavedOk(false); }} />
              </div>
            </section>

            {/* 3 — Composição e peças inclusas */}
            <section id="composicao" ref={(el) => { secRefs.current.composicao = el; }} className="pe-sec">
              <div className="card">
                <div className="sec-title"><Package size={18} /><h3>Composição e peças inclusas</h3></div>
                <p className="sec-desc">As peças que acompanham a saída — viram a aba “Itens inclusos” no site.</p>

                {PECA_GRUPOS.map((g) => (
                  <div key={g.grupo} style={{ marginBottom: 12 }}>
                    <div className="grp-label">{g.grupo}</div>
                    <div className="chips">
                      {g.itens.map((p) => (
                        <button type="button" key={p} className={`chip ${jaIncluso.has(semAcento(p)) ? 'chip-on' : ''}`} onClick={() => togglePeca(p)}>
                          {jaIncluso.has(semAcento(p)) && <Check size={13} />} {p}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="resumo-pecas">
                  <strong>{ficha.contem.length}</strong> peça(s) inclusa(s)
                </div>
                {ficha.contem.length > 0 && (
                  <>
                    <datalist id="pecas-sugeridas">{PECA_GRUPOS.flatMap((g) => g.itens).map((p) => <option key={p} value={p} />)}</datalist>
                    {ficha.contem.map((item, i) => (
                      <div className="row-inline" key={i}>
                        <input list="pecas-sugeridas" value={item} placeholder="01 Vestido em tricô"
                          onChange={(e) => setContem(ficha.contem.map((x, j) => j === i ? e.target.value : x))} />
                        <button type="button" className="btn-link" onClick={() => setContem(ficha.contem.filter((_, j) => j !== i))}><X size={15} /></button>
                      </div>
                    ))}
                  </>
                )}
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => setContem([...ficha.contem, ''])}><Plus size={14} /> Outra peça…</button>

                <h4 className="sub-h">Composição de kit (consome estoque)</h4>
                <p className="muted small" style={{ marginTop: -6 }}>Só para kit: peças que saem do estoque quando este produto é vendido. O disponível é quantas vezes dá para montar.</p>
                {components.map((c, i) => (
                  <div className="row-inline" key={i}>
                    <select value={c.child_product_id} onChange={(e) => { setComponents((cur) => cur.map((x, j) => j === i ? { ...x, child_product_id: e.target.value } : x)); setSavedOk(false); }}>
                      <option value="">— escolha a peça —</option>
                      {catalogo.filter((p) => p.id !== pid).map((p) => <option key={p.id} value={p.id}>{p.sku ? p.sku + ' · ' : ''}{p.name}</option>)}
                    </select>
                    <input placeholder="Qtd" inputMode="numeric" value={c.quantity} style={{ maxWidth: 80 }}
                      onChange={(e) => { setComponents((cur) => cur.map((x, j) => j === i ? { ...x, quantity: e.target.value } : x)); setSavedOk(false); }} />
                    <label className="field-check" style={{ margin: 0 }}>
                      <input type="checkbox" checked={c.match_size !== false} onChange={(e) => { setComponents((cur) => cur.map((x, j) => j === i ? { ...x, match_size: e.target.checked } : x)); setSavedOk(false); }} />
                      <span>mesmo tamanho</span>
                    </label>
                    <button type="button" className="btn-link" onClick={() => { setComponents((cur) => cur.filter((_, j) => j !== i)); setSavedOk(false); }}><X size={15} /></button>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setComponents((cur) => [...cur, { child_product_id: '', quantity: 1, match_size: true }]); setSavedOk(false); }}><Plus size={14} /> Peça do kit</button>

                <h4 className="sub-h">Personalizações / adicionais</h4>
                <p className="muted small" style={{ marginTop: -6 }}>Ex.: “Bordar nome” — R$ 19,90. Se o adicional for uma peça real, escolha o produto para baixar do estoque dele.</p>
                {addons.map((a, i) => (
                  <div className="row-inline" key={i}>
                    <input placeholder="Nome do adicional" value={a.name} onChange={(e) => { setAddons((cur) => cur.map((x, j) => j === i ? { ...x, name: e.target.value } : x)); setSavedOk(false); }} />
                    <input placeholder="R$" value={a.price} style={{ maxWidth: 90 }} onChange={(e) => { setAddons((cur) => cur.map((x, j) => j === i ? { ...x, price: e.target.value } : x)); setSavedOk(false); }} />
                    <select value={a.addon_product_id || ''} onChange={(e) => { setAddons((cur) => cur.map((x, j) => j === i ? { ...x, addon_product_id: e.target.value || null } : x)); setSavedOk(false); }}>
                      <option value="">sem estoque (serviço)</option>
                      {catalogo.filter((p) => p.id !== pid).map((p) => <option key={p.id} value={p.id}>{p.sku ? p.sku + ' · ' : ''}{p.name}</option>)}
                    </select>
                    <label className="field-check" style={{ margin: 0 }}>
                      <input type="checkbox" checked={a.requires_text} onChange={(e) => { setAddons((cur) => cur.map((x, j) => j === i ? { ...x, requires_text: e.target.checked } : x)); setSavedOk(false); }} />
                      <span>pede texto</span>
                    </label>
                    <button type="button" className="btn-link" onClick={() => { setAddons((cur) => cur.filter((_, j) => j !== i)); setSavedOk(false); }}><X size={15} /></button>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAddons((cur) => [...cur, { name: '', price: 0, requires_text: false, addon_product_id: null }]); setSavedOk(false); }}><Plus size={14} /> Adicional</button>
              </div>
            </section>

            {/* 4 — Cores e tamanhos */}
            <section id="variacoes" ref={(el) => { secRefs.current.variacoes = el; }} className="pe-sec">
              <div className="card">
                <div className="sec-title"><Palette size={18} /><h3>Variações — cores e tamanhos</h3></div>
                <p className="sec-desc">Um tamanho por linha. <strong>+/- R$</strong> é a diferença de preço do tamanho (0 = igual). <strong>Estoque</strong> vazio = vende sem limite.</p>
                {variants.map((v, i) => (
                  <div className="row-inline" key={i}>
                    <input placeholder="Tamanho" value={v.size} style={{ maxWidth: 110 }} onChange={(e) => { setVariants((cur) => cur.map((x, j) => j === i ? { ...x, size: e.target.value } : x)); setSavedOk(false); }} />
                    <input placeholder="Cor" value={v.color} onChange={(e) => { setVariants((cur) => cur.map((x, j) => j === i ? { ...x, color: e.target.value } : x)); setSavedOk(false); }} />
                    <select value={v.gender} onChange={(e) => { setVariants((cur) => cur.map((x, j) => j === i ? { ...x, gender: e.target.value } : x)); setSavedOk(false); }}>
                      <option value="">—</option><option value="menina">menina</option><option value="menino">menino</option><option value="unissex">unissex</option>
                    </select>
                    <input placeholder="+/- R$" value={v.price_delta} style={{ maxWidth: 90 }} onChange={(e) => { setVariants((cur) => cur.map((x, j) => j === i ? { ...x, price_delta: e.target.value } : x)); setSavedOk(false); }} />
                    <input placeholder="Estoque" inputMode="numeric" value={v.stock ?? ''} style={{ maxWidth: 90 }} onChange={(e) => { setVariants((cur) => cur.map((x, j) => j === i ? { ...x, stock: e.target.value } : x)); setSavedOk(false); }} />
                    <button type="button" className="btn-link" onClick={() => { setVariants((cur) => cur.filter((_, j) => j !== i)); setSavedOk(false); }}><X size={15} /></button>
                  </div>
                ))}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setVariants((cur) => [...cur, { size: '', color: '', gender: '', price_delta: 0, stock: '' }]); setSavedOk(false); }}><Plus size={14} /> Variação</button>

                {variants.length === 0 && (
                  <>
                    <h4 className="sub-h">Estoque</h4>
                    <label className="field" style={{ maxWidth: 320 }}><span>Quantas peças você tem</span>
                      <input value={stockProduto} inputMode="numeric" placeholder="deixe vazio para vender sem controle"
                        onChange={(e) => { setStockProduto(e.target.value); setSavedOk(false); }} /></label>
                    <p className="muted small" style={{ marginTop: -6 }}>Ao cadastrar tamanhos acima, a contagem passa a ser por tamanho e este campo some.</p>
                  </>
                )}
              </div>
            </section>

            {/* 5 — Grupos do modelo */}
            <section id="grupos" ref={(el) => { secRefs.current.grupos = el; }} className="pe-sec">
              <div className="card">
                <div className="sec-title"><Layers size={18} /><h3>Grupos do modelo</h3></div>
                <p className="sec-desc">Ligam peças do mesmo modelo. Use sempre a mesma palavra (sem acento) em todas.</p>

                <label className="field"><span>Grupo de cores — mesmo modelo em cores diferentes</span>
                  <input value={modelo} list="modelos-conhecidos" onChange={(e) => { setModelo(e.target.value); setSavedOk(false); }}
                    placeholder="ex.: bailarina — vazio se a peça não tem outras cores" /></label>
                <datalist id="modelos-conhecidos">{modelosConhecidos.map((m) => <option key={m} value={m} />)}</datalist>
                <p className="muted small" style={{ marginTop: -6 }}>Vira as bolinhas de “outras cores” na página do produto.</p>
                {modelo.trim() && (
                  <div className="grp-irmas">
                    {siblingsCor.length ? <><span className="muted small">Já neste grupo de cores:</span>
                      <div className="irma-list">{siblingsCor.map((p) => <span key={p.id} className="irma">{p.image && <img src={displaySrc(p.image)} alt="" />}{p.name}</span>)}</div></>
                      : <span className="muted small">Nenhuma outra peça usa <b>{modelo.trim().toLowerCase()}</b> ainda — esta será a primeira.</span>}
                  </div>
                )}

                <label className="field" style={{ marginTop: 18 }}><span>Grupo de composição — mesmo modelo com mais/menos peças</span>
                  <input value={grupoPecas} list="grupos-conhecidos" onChange={(e) => { setGrupoPecas(e.target.value); setSavedOk(false); }}
                    placeholder="ex.: bailarina-rose — vazio se não tem versões" /></label>
                <datalist id="grupos-conhecidos">{gruposConhecidos.map((m) => <option key={m} value={m} />)}</datalist>
                <p className="muted small" style={{ marginTop: -6 }}>Vira o seletor “Quantidade de peças”. O rótulo sai da contagem de “Itens inclusos”.</p>
                {grupoPecas.trim() && (
                  <div className="grp-irmas">
                    {siblingsPecas.length ? <><span className="muted small">Já neste grupo de composição:</span>
                      <div className="irma-list">{siblingsPecas.map((p) => <span key={p.id} className="irma">{p.image && <img src={displaySrc(p.image)} alt="" />}{p.name}</span>)}</div></>
                      : <span className="muted small">Nenhuma outra peça usa <b>{grupoPecas.trim().toLowerCase()}</b> ainda — esta será a primeira.</span>}
                  </div>
                )}
              </div>
            </section>

            {/* 6 — Categorias */}
            <section id="categorias" ref={(el) => { secRefs.current.categorias = el; }} className="pe-sec">
              <div className="card">
                <div className="sec-title"><Tag size={18} /><h3>Categorias</h3></div>
                <p className="sec-desc">Onde a peça aparece nos filtros do site. Marque <b>acessorios</b> junto da subcategoria.</p>
                {CAT_GRUPOS.map((g) => (
                  <div key={g.grupo} style={{ marginBottom: 12 }}>
                    <div className="grp-label">{g.grupo}</div>
                    <div className="chips">
                      {g.itens.map((c) => (
                        <button type="button" key={c} className={`chip ${categories.includes(c) ? 'chip-on' : ''}`} onClick={() => toggleCat(c)}>
                          {categories.includes(c) && <Check size={13} />} {catLabel(c)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {outrasCats.length > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    <div className="grp-label">Outras</div>
                    <div className="chips">
                      {outrasCats.map((c) => <button type="button" key={c} className="chip chip-on" onClick={() => toggleCat(c)}><Check size={13} /> {c}</button>)}
                    </div>
                  </div>
                )}
                <p className="muted small" style={{ marginTop: 8 }}>{categories.length} categoria(s) selecionada(s).</p>
              </div>
            </section>

            {/* 7 — Status e publicação */}
            <section id="publicacao" ref={(el) => { secRefs.current.publicacao = el; }} className="pe-sec">
              <div className="card">
                <div className="sec-title"><Eye size={18} /><h3>Status e publicação</h3></div>
                <p className="sec-desc">Controla se e como a peça aparece no site.</p>
                <div className="status-opts">
                  {[
                    { v: 'ativo', t: 'Ativo', d: 'Visível e à venda no site.' },
                    { v: 'oculto', t: 'Oculto', d: 'Sai do site sem apagar o produto.' },
                    { v: 'esgotado', t: 'Esgotado', d: 'Aparece, mas sem botão de compra.' },
                    { v: 'inativo', t: 'Inativo', d: 'Fora do site (rascunho).' },
                  ].map((o) => (
                    <button type="button" key={o.v} className={`status-opt ${f.status === o.v ? 'on ' + o.v : ''}`} onClick={() => set('status', o.v)}>
                      <span className={statusPillClass(o.v)}>{o.t}</span>
                      <span className="muted small">{o.d}</span>
                    </button>
                  ))}
                </div>
                <label className="switch" style={{ marginTop: 16 }}>
                  <input type="checkbox" checked={featured} onChange={(e) => { setFeatured(e.target.checked); setSavedOk(false); }} />
                  <span className="track" /><span className="switch-label">Produto em destaque (vitrine “Favoritas” da home)</span>
                </label>

                {(noPhoto || noPrice || nameErr || noSkuAtivo) && (
                  <div className="val-box">
                    <strong><AlertTriangle size={14} style={{ verticalAlign: '-2px' }} /> Antes de publicar, confira:</strong>
                    <ul>
                      {nameErr && <li>o produto está <b>sem nome</b>.</li>}
                      {noSkuAtivo && <li>o produto está <b>ativo sem SKU</b> — sem um código, ele não aparece no site.</li>}
                      {noPrice && <li>o produto está <b>sem preço à vista</b>.</li>}
                      {noPhoto && <li>o produto está <b>sem fotografia</b> (a 1ª é a capa).</li>}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </form>

      {/* barra fixa de salvamento */}
      <div className="savebar">
        <div className="savebar-state">
          {busy ? <><RefreshCw size={15} className="spin" /> Salvando…</>
            : savedOk ? <span className="saved-ok"><Check size={15} /> Salvo</span>
              : dirty ? <><span className="dirty-dot" /> Alterações não salvas</>
                : <span className="muted">Tudo salvo</span>}
        </div>
        <span className="savebar-spacer" />
        <button type="button" className="btn btn-ghost" onClick={tryClose} disabled={busy}>Cancelar</button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || (!dirty && !!pid)}>
          {pid ? 'Salvar alterações' : 'Criar produto'}
        </button>
      </div>

      {/* prévia do site (reaproveita a página real) */}
      {preview && canView && (
        <div className="modal-scrim" onClick={() => setPreview(false)}>
          <div className="preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="preview-head">
              <strong>Prévia no site</strong>
              {dirty && <span className="muted small">mostra a versão salva — salve para ver as mudanças</span>}
              <span style={{ flex: 1 }} />
              <a className="btn btn-ghost btn-sm" href={siteUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Abrir</a>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPreview(false)}><X size={15} /></button>
            </div>
            <iframe title="Prévia do produto" src={siteUrl} className="preview-frame" />
          </div>
        </div>
      )}
    </div>
  );
}

/** Normaliza o estado editável num texto estável, para detectar alterações. */
function snapOf(a: {
  name: string; sku: string; slug: string; status: string;
  price_cash: string; price_card: string; original_price: string; installments_max: string;
  weight_kg: string; length_cm: string; width_cm: string; height_cm: string;
  description: string; images: string[]; featured: boolean; categories: string[];
  modelo: string; grupoPecas: string; variants: Variant[]; addons: Addon[]; components: Component[]; stockProduto: string;
}): string {
  return JSON.stringify({
    name: a.name, sku: a.sku, slug: a.slug, status: a.status,
    price_cash: a.price_cash, price_card: a.price_card, original_price: a.original_price, installments_max: a.installments_max,
    weight_kg: a.weight_kg, length_cm: a.length_cm, width_cm: a.width_cm, height_cm: a.height_cm,
    description: a.description, images: a.images, featured: a.featured,
    categories: [...a.categories].sort(), modelo: a.modelo.trim().toLowerCase(), grupoPecas: a.grupoPecas.trim().toLowerCase(),
    variants: a.variants.map((v) => ({ size: v.size, color: v.color, gender: v.gender, price_delta: String(v.price_delta), stock: String(v.stock ?? '') })),
    addons: a.addons.map((x) => ({ name: x.name, price: String(x.price), requires_text: !!x.requires_text, addon_product_id: x.addon_product_id || null })),
    components: a.components.map((c) => ({ child: c.child_product_id, match: c.match_size !== false, qty: String(c.quantity) })),
    stockProduto: a.stockProduto,
  });
}

/* ============================ Gerenciador de imagens ============================ */

const MAX_INPUT_BYTES = 15 * 1024 * 1024; // 15 MB por arquivo (antes de comprimir)
const MAX_DIM = 1600;                     // maior lado após redimensionar
const WEBP_QUALITY = 0.82;                // qualidade boa p/ foto de produto
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif,image/heic,image/heif,.heic,.heif';

function isStorageUrl(u: string): boolean {
  return u.includes('/storage/v1/object/public/catalog/');
}

/* HEIC/HEIF (fotos de iPhone) o navegador não decodifica sozinho: detecta
   pela extensão ou pelo tipo (às vezes vem vazio no arquivo .heic). */
function isHeic(file: File): boolean {
  const n = file.name.toLowerCase();
  return file.type === 'image/heic' || file.type === 'image/heif' || n.endsWith('.heic') || n.endsWith('.heif');
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

/* GIF animado nao sobrevive ao canvas: drawImage copia so o primeiro quadro.
   Entao ele sobe como veio, sem conversao nem redimensionamento. */
const LIMITE_GIF = 5 * 1024 * 1024;

/** Prepara o arquivo para upload: bytes e content-type a enviar. */
async function prepararUpload(file: File): Promise<{ blob: Blob; contentType: string }> {
  if (file.type === 'image/gif') {
    if (file.size > LIMITE_GIF) throw new Error('GIF acima de 5 MB. Reduza a duração ou o tamanho antes de subir.');
    return { blob: file, contentType: 'image/gif' };
  }
  /* HEIC do iPhone: o canvas não lê direto. Converte p/ JPEG (libheif via
     heic2any, carregado só quando aparece um HEIC) e segue o fluxo normal. */
  if (isHeic(file)) {
    const base = await heicParaJpeg(file);
    return { blob: await compressToWebp(base), contentType: 'image/webp' };
  }
  return { blob: await compressToWebp(file), contentType: 'image/webp' };
}

/** Converte HEIC/HEIF -> JPEG no navegador (import dinâmico, não pesa no load). */
async function heicParaJpeg(file: File): Promise<Blob> {
  try {
    const mod: any = await import('heic2any');
    const heic2any = (mod.default || mod) as (opts: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>;
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
    return Array.isArray(out) ? out[0] : out;
  } catch {
    throw new Error('Não foi possível ler este HEIC. Tente exportar como JPG no celular (Ajustes › Câmera › Mais compatível).');
  }
}

/** Redimensiona (se muito grande) e converte para WebP, no navegador. */
async function compressToWebp(file: Blob): Promise<Blob> {
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
  { productId?: string | null; images: string[]; setImages: Dispatch<SetStateAction<string[]>> }) {
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [replacing, setReplacing] = useState<number | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const ctrls = useRef<Map<string, AbortController>>(new Map());
  const addRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceIdx = useRef<number>(-1);

  const disabled = !productId; // upload precisa do id do produto (salve antes)

  const patchUp = (id: string, p: Partial<Upload>) => setUploads((cur) => cur.map((u) => u.id === id ? { ...u, ...p } : u));
  const dropUp = (id: string) => setUploads((cur) => cur.filter((u) => u.id !== id));

  async function uploadOne(file: File) {
    const id = uid();
    if (!file.type.startsWith('image/') && !isHeic(file)) { setUploads((c) => [...c, { id, name: file.name, preview: '', status: 'erro', msg: 'Não é uma imagem.' }]); return; }
    if (file.size > MAX_INPUT_BYTES) { setUploads((c) => [...c, { id, name: file.name, preview: '', status: 'erro', msg: 'Arquivo muito grande (máx. 15MB).' }]); return; }

    /* HEIC não renderiza como prévia no navegador: mostra só o placeholder. */
    const preview = isHeic(file) ? '' : URL.createObjectURL(file);
    setUploads((c) => [...c, { id, name: file.name, preview, status: 'comprimindo' }]);
    const ctrl = new AbortController();
    ctrls.current.set(id, ctrl);
    try {
      const { blob, contentType } = await prepararUpload(file);
      if (ctrl.signal.aborted) throw new DOMException('cancelado', 'AbortError');
      patchUp(id, { status: 'enviando' });
      const dataBase64 = await blobToBase64(blob);
      const res = await apiFetch<{ url: string }>('/api/product-image', {
        method: 'POST',
        body: JSON.stringify({ product_id: productId, dataBase64, contentType }),
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
    if (!window.confirm('Excluir esta foto? Ela sai do produto e do armazenamento.')) return;
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
  function reorder(from: number, to: number) {
    if (from === to) return;
    setImages((cur) => { const a = [...cur]; const [x] = a.splice(from, 1); a.splice(to, 0, x); return a; });
  }
  function onDragStart(i: number) { dragFrom.current = i; }
  function onDragOverCard(e: DragEvent, i: number) { e.preventDefault(); if (overIdx !== i) setOverIdx(i); }
  function onDropCard(i: number) { const from = dragFrom.current; dragFrom.current = null; setOverIdx(null); if (from != null) reorder(from, i); }

  async function doReplace(i: number, file: File) {
    if (!file || !file.type.startsWith('image/')) return;
    const old = images[i];
    setReplacing(i);
    try {
      const { blob, contentType } = await prepararUpload(file);
      const dataBase64 = await blobToBase64(blob);
      const res = await apiFetch<{ url: string }>('/api/product-image', {
        method: 'POST', body: JSON.stringify({ product_id: productId, dataBase64, contentType }),
      });
      setImages((cur) => cur.map((u, j) => j === i ? res.url : u));
      if (isStorageUrl(old)) apiFetch('/api/product-image', { method: 'DELETE', body: JSON.stringify({ url: old }) }).catch(() => {});
    } catch (e: any) {
      alert('Erro ao trocar a imagem: ' + (e?.message || ''));
    } finally { setReplacing(null); }
  }

  return (
    <div>
      {disabled && <p className="val-box" style={{ marginTop: 0 }}><AlertTriangle size={14} style={{ verticalAlign: '-2px' }} /> Salve o produto primeiro para poder enviar as fotos.</p>}

      {/* Grade das imagens já vinculadas */}
      {images.length > 0 && (
        <div className="photo-grid">
          {images.map((url, i) => (
            <div key={url + i} className={`photo${i === 0 ? ' main' : ''}${overIdx === i ? ' drag-over' : ''}`}
              draggable onDragStart={() => onDragStart(i)} onDragOver={(e) => onDragOverCard(e, i)} onDrop={() => onDropCard(i)} onDragEnd={() => { dragFrom.current = null; setOverIdx(null); }}>
              <div className="photo-wrap">
                <img src={displaySrc(url)} alt="" loading="lazy" />
                {i === 0 && <span className="photo-main-badge"><Star size={11} /> Capa</span>}
                <button type="button" className="photo-zoom" title="Ampliar" onClick={() => setZoom(displaySrc(url))}><ZoomIn size={15} /></button>
                {replacing === i && <div className="photo-overlay">trocando…</div>}
              </div>
              <div className="photo-actions">
                {i !== 0 && <button type="button" className="mini-btn" title="Tornar capa" onClick={() => makeMain(i)}><Star size={13} /> capa</button>}
                <span style={{ flex: 1 }} />
                <button type="button" className="ico-btn" title="Mover para trás" disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp size={14} /></button>
                <button type="button" className="ico-btn" title="Mover para frente" disabled={i === images.length - 1} onClick={() => move(i, 1)}><ChevronDown size={14} /></button>
                <button type="button" className="ico-btn" title="Trocar" disabled={disabled} onClick={() => { replaceIdx.current = i; replaceRef.current?.click(); }}><RefreshCw size={13} /></button>
                <button type="button" className="ico-btn danger" title="Excluir" onClick={() => removeAt(i)}><Trash2 size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Uploads em andamento */}
      {uploads.length > 0 && (
        <div className="photo-grid">
          {uploads.map((u) => (
            <div key={u.id} className="photo">
              <div className="photo-wrap">
                {u.preview
                  ? <img src={u.preview} alt="" style={{ opacity: u.status === 'erro' || u.status === 'cancelado' ? 0.4 : 0.8 }} />
                  : <div className="photo-empty">?</div>}
                <div className="photo-overlay">
                  {u.status === 'comprimindo' && 'otimizando…'}
                  {u.status === 'enviando' && 'enviando…'}
                  {u.status === 'ok' && '✓ pronto'}
                  {u.status === 'cancelado' && 'cancelado'}
                  {u.status === 'erro' && (u.msg || 'erro')}
                </div>
              </div>
              <div className="photo-actions">
                <span className="muted small" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}</span>
                {(u.status === 'comprimindo' || u.status === 'enviando')
                  ? <button type="button" className="mini-btn" onClick={() => cancel(u.id)}>cancelar</button>
                  : <button type="button" className="mini-btn" onClick={() => dropUp(u.id)}>fechar</button>}
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
        className={`dropzone${dragOver ? ' over' : ''}${disabled ? ' off' : ''}`}
      >
        <strong>Arraste imagens aqui</strong>
        <span className="muted small">ou clique para selecionar — várias de uma vez</span>
        <span className="muted small">JPG, PNG, WebP, AVIF ou HEIC (iPhone) · até 15MB cada</span>
      </div>
      {images.length > 0 && <p className="muted small" style={{ marginTop: 8 }}>As fotos são gravadas quando você <b>salvar o produto</b>.</p>}

      <input ref={addRef} type="file" accept={ACCEPT} multiple hidden
        onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
      <input ref={replaceRef} type="file" accept={ACCEPT} hidden
        onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file && replaceIdx.current >= 0) doReplace(replaceIdx.current, file); }} />

      {zoom && (
        <div className="modal-scrim" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" className="photo-lightbox" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

/* estilos inline mínimos (miniatura da LISTA de produtos) */
const THUMB_MINI: CSSProperties = { width: 40, height: 40, borderRadius: 6, objectFit: 'cover', display: 'block', background: '#f1f5f9' };
const THUMB_EMPTY: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 12 };
