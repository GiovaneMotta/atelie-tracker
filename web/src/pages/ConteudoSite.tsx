import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { Info, Plus, ArrowUp, ArrowDown, X, GripVertical } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface Payment { pixDiscountPct: number; installmentsMax: number; freeShippingFrom: string; }
interface Hero {
  heroEyebrow: string; heroTitle: string; heroSubtitle: string; heroImage: string;
  sobreEyebrow: string; sobreTitle: string; sobreBody1: string; sobreBody2: string;
}
interface Banner { eyebrow: string; title: string; subtitle: string; image: string; buttonText: string; buttonLink: string; }
interface Testimonial { name: string; local: string; text: string; }
/* círculo de categoria da home: o slug é a categoria do catálogo; o rótulo
   é opcional (vazio = o site usa o nome padrão daquela categoria) */
interface HomeCat { slug: string; label: string; }
interface Settings {
  atelieName: string; whatsappNumber: string; instagram: string; siteUrl: string;
  whatsappMessage: string; payment: Payment; content: Hero; banners: Banner[];
  testimonials: Testimonial[]; homeCategorias: HomeCat[];
}
const EMPTY_BANNER: Banner = { eyebrow: '', title: '', subtitle: '', image: '', buttonText: 'Ver a coleção', buttonLink: '#catalogo' };
const EMPTY_TESTIMONIAL: Testimonial = { name: '', local: '', text: '' };

/* Nomes bonitos das categorias conhecidas — os mesmos do site
   (js/categorybar.js). Categoria nova, ainda sem nome aqui, vira texto
   legível: "porta-maternidade" -> "Porta maternidade". */
const NOMES_CATEGORIA: Record<string, string> = {
  menina: 'Menina', menino: 'Menino', gemeos: 'Gêmeos', unissex: 'Unissex',
  fralda: 'Fraldas', cueiro: 'Cueiros', manta: 'Mantas', enxoval: 'Enxoval',
  'toalha-fralda': 'Toalha Fralda', 'toalha-capuz': 'Toalha c/ Capuz',
  'kit-leito': 'Kit Leito', kit: 'Kits', acessorios: 'Acessórios',
  batizado: 'Batizado', mamae: 'Mamãe', luxo: 'Luxo', promocao: 'Promoção',
  'sapato-faixa': 'Sapatinho + Faixa', 'sapatinho-menina': 'Sapatinhos Menina',
  'sapatinho-menino': 'Sapatinhos Menino', touca: 'Toucas',
};
const nomeCategoria = (slug: string) =>
  NOMES_CATEGORIA[slug] || slug.replace(/-/g, ' ').replace(/^./, (m) => m.toUpperCase());
/* "modelo:"/"pecas:" agrupam peças irmãs — não são categorias de vitrine */
const ehTagInterna = (c: string) => c.startsWith('modelo:') || c.startsWith('pecas:');

export default function ConteudoSite() {
  const { can } = useAuth();
  const writable = can('settings.write');
  const [f, setF] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const set = (k: keyof Settings, v: any) => setF((s) => s ? { ...s, [k]: v } : s);
  const setPay = (k: keyof Payment, v: any) => setF((s) => s ? { ...s, payment: { ...s.payment, [k]: v } } : s);
  const setHero = (k: keyof Hero, v: string) => setF((s) => s ? { ...s, content: { ...s.content, [k]: v } } : s);
  const setBanner = (i: number, k: keyof Banner, v: string) => setF((s) => s ? { ...s, banners: s.banners.map((b, j) => j === i ? { ...b, [k]: v } : b) } : s);
  const addBanner = () => setF((s) => s ? { ...s, banners: [...s.banners, { ...EMPTY_BANNER }] } : s);
  const removeBanner = (i: number) => setF((s) => s ? { ...s, banners: s.banners.filter((_, j) => j !== i) } : s);
  const moveBanner = (i: number, dir: -1 | 1) => setF((s) => {
    if (!s) return s; const a = [...s.banners]; const j = i + dir; if (j < 0 || j >= a.length) return s;
    [a[i], a[j]] = [a[j], a[i]]; return { ...s, banners: a };
  });
  const setTesti = (i: number, k: keyof Testimonial, v: string) => setF((s) => s ? { ...s, testimonials: s.testimonials.map((t, j) => j === i ? { ...t, [k]: v } : t) } : s);
  const addTesti = () => setF((s) => s ? { ...s, testimonials: [...s.testimonials, { ...EMPTY_TESTIMONIAL }] } : s);
  const removeTesti = (i: number) => setF((s) => s ? { ...s, testimonials: s.testimonials.filter((_, j) => j !== i) } : s);

  /* ── círculos de categoria da home ── */
  const [catalogo, setCatalogo] = useState<{ slug: string; n: number }[]>([]);
  const arrastando = useRef<number | null>(null);
  const [sobre, setSobre] = useState<number | null>(null);
  const setCat = (i: number, k: keyof HomeCat, v: string) =>
    setF((s) => s ? { ...s, homeCategorias: s.homeCategorias.map((c, j) => j === i ? { ...c, [k]: v } : c) } : s);
  const addCat = (slug: string) =>
    setF((s) => s && !s.homeCategorias.some((c) => c.slug === slug)
      ? { ...s, homeCategorias: [...s.homeCategorias, { slug, label: '' }] } : s);
  const removeCat = (i: number) =>
    setF((s) => s ? { ...s, homeCategorias: s.homeCategorias.filter((_, j) => j !== i) } : s);
  const moveCat = (de: number, para: number) => setF((s) => {
    if (!s) return s;
    const a = [...s.homeCategorias];
    if (de < 0 || de >= a.length || para < 0 || para >= a.length || de === para) return s;
    const [x] = a.splice(de, 1); a.splice(para, 0, x);
    return { ...s, homeCategorias: a };
  });

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ settings: Settings }>('/api/site-settings');
      setF({
        ...data.settings,
        banners: Array.isArray(data.settings.banners) ? data.settings.banners : [],
        testimonials: Array.isArray(data.settings.testimonials) ? data.settings.testimonials : [],
        homeCategorias: (Array.isArray(data.settings.homeCategorias) ? data.settings.homeCategorias : [])
          .map((c: any) => typeof c === 'string' ? { slug: c, label: '' } : { slug: String(c?.slug || ''), label: String(c?.label || '') })
          .filter((c: HomeCat) => c.slug),
      });
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao carregar.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  /* categorias que existem de verdade no catálogo, com a contagem de peças —
     a lista de escolha cresce sozinha conforme a Lili cadastra linhas novas */
  useEffect(() => {
    apiFetch<{ items: { categories: string[] }[] }>('/api/catalog-order').then((d) => {
      const conta: Record<string, number> = {};
      (d.items || []).forEach((p) => (p.categories || []).forEach((c) => {
        if (c && !ehTagInterna(c)) conta[c] = (conta[c] || 0) + 1;
      }));
      setCatalogo(Object.entries(conta).map(([slug, n]) => ({ slug, n })).sort((a, b) => b.n - a.n));
    }).catch(() => setCatalogo([]));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    setBusy(true); setError(''); setOk(false);
    try {
      await apiFetch('/api/site-settings', { method: 'PATCH', body: JSON.stringify(f) });
      setOk(true); setTimeout(() => setOk(false), 3500);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); } finally { setBusy(false); }
  }

  if (loading || !f) return <div className="page"><p className="muted">Carregando…</p></div>;

  return (
    <div className="page">
      <form onSubmit={submit}>
        <div className="page-head">
          <div><div className="dash-ov">Site</div><h1>Conteúdo do site</h1><p className="dash-sub">Edite o site sem mexer no código.</p></div>
          {writable && <div className="page-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}</button></div>}
        </div>

        {error && <div className="alert-error">{error}</div>}
        {ok && <div className="alert-ok">Salvo! O site público já reflete as alterações.</div>}

        <div className="card">
          <h3>Informações gerais</h3>
          <div className="form-grid">
            <label className="field"><span>Nome do ateliê</span><input value={f.atelieName} onChange={(e) => set('atelieName', e.target.value)} disabled={!writable} /></label>
            <label className="field"><span>WhatsApp (só números, com DDI)</span><input value={f.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value)} placeholder="5599999999999" inputMode="numeric" disabled={!writable} /></label>
            <label className="field"><span>Instagram (link)</span><input value={f.instagram} onChange={(e) => set('instagram', e.target.value)} placeholder="https://instagram.com/…" disabled={!writable} /></label>
            <label className="field"><span>Endereço do site</span><input value={f.siteUrl} onChange={(e) => set('siteUrl', e.target.value)} placeholder="https://ateliedalili.com.br" disabled={!writable} /></label>
            <label className="field span-all"><span>Mensagem padrão do WhatsApp</span>
              <textarea rows={2} value={f.whatsappMessage} onChange={(e) => set('whatsappMessage', e.target.value)} disabled={!writable}
                placeholder="Olá! Tenho interesse na peça *{nome}* (código {sku})…" /></label>
          </div>
          <p className="muted small" style={{ marginTop: 8 }}>Use <strong>{'{nome}'}</strong> e <strong>{'{sku}'}</strong> na mensagem — o site troca pelos dados da peça.</p>
        </div>

        <div className="card">
          <h3>Pagamento e frete</h3>
          <div className="form-grid">
            <label className="field"><span>Desconto no Pix (%)</span><input value={String(f.payment.pixDiscountPct)} onChange={(e) => setPay('pixDiscountPct', e.target.value)} inputMode="numeric" disabled={!writable} /></label>
            <label className="field"><span>Parcelas máximas (sem juros)</span><input value={String(f.payment.installmentsMax)} onChange={(e) => setPay('installmentsMax', e.target.value)} inputMode="numeric" disabled={!writable} /></label>
            <label className="field"><span>Frete grátis a partir de</span><input value={f.payment.freeShippingFrom} onChange={(e) => setPay('freeShippingFrom', e.target.value)} placeholder="R$ 599,00" disabled={!writable} /></label>
          </div>
        </div>

        <div className="card">
          <h3>Topo do site (Hero)</h3>
          <p className="muted small" style={{ marginTop: -6, marginBottom: 14 }}>Aparece só quando não houver banners abaixo. Use <strong>*texto*</strong> para destaque e quebre linhas com Enter.</p>
          <div className="form-grid">
            <label className="field"><span>Selo (eyebrow)</span><input value={f.content.heroEyebrow} onChange={(e) => setHero('heroEyebrow', e.target.value)} disabled={!writable} /></label>
            <label className="field"><span>Imagem (caminho/URL)</span><input value={f.content.heroImage} onChange={(e) => setHero('heroImage', e.target.value)} placeholder="images/… ou https://…" disabled={!writable} /></label>
            <label className="field span-all"><span>Título</span><textarea rows={2} value={f.content.heroTitle} onChange={(e) => setHero('heroTitle', e.target.value)} disabled={!writable} /></label>
            <label className="field span-all"><span>Subtítulo</span><textarea rows={2} value={f.content.heroSubtitle} onChange={(e) => setHero('heroSubtitle', e.target.value)} disabled={!writable} /></label>
          </div>
        </div>

        <div className="card">
          <h3>Seção "Sobre"</h3>
          <div className="form-grid">
            <label className="field"><span>Selo (eyebrow)</span><input value={f.content.sobreEyebrow} onChange={(e) => setHero('sobreEyebrow', e.target.value)} disabled={!writable} /></label>
            <label className="field"><span>Título</span><input value={f.content.sobreTitle} onChange={(e) => setHero('sobreTitle', e.target.value)} placeholder="Use *texto* p/ destaque" disabled={!writable} /></label>
            <label className="field span-all"><span>Parágrafo 1</span><textarea rows={3} value={f.content.sobreBody1} onChange={(e) => setHero('sobreBody1', e.target.value)} disabled={!writable} /></label>
            <label className="field span-all"><span>Parágrafo 2</span><textarea rows={3} value={f.content.sobreBody2} onChange={(e) => setHero('sobreBody2', e.target.value)} disabled={!writable} /></label>
          </div>
        </div>

        <div className="card">
          <div className="card-head-row"><h3>Banners (carrossel do topo)</h3>{writable && <button type="button" className="btn btn-ghost btn-sm" onClick={addBanner}><Plus size={15} /> Banner</button>}</div>
          <p className="muted small" style={{ marginTop: 4 }}>Se houver banners, eles substituem o Hero acima. Vazio = o site usa o Hero.</p>
          {f.banners.length === 0 && <div className="att-calm" style={{ marginTop: 12 }}>Nenhum banner — o site mostra o Hero acima.</div>}
          {f.banners.map((b, i) => (
            <div className="card" key={i} style={{ background: 'var(--surface-tint)', marginTop: 12, marginBottom: 0 }}>
              <div className="card-head-row" style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: '.9rem' }}>Banner {i + 1}</strong>
                {writable && <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveBanner(i, -1)} aria-label="Subir"><ArrowUp size={14} /></button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={i === f.banners.length - 1} onClick={() => moveBanner(i, 1)} aria-label="Descer"><ArrowDown size={14} /></button>
                  <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => removeBanner(i)} aria-label="Remover"><X size={14} /></button>
                </div>}
              </div>
              <div className="form-grid">
                <label className="field"><span>Selo (eyebrow)</span><input value={b.eyebrow} onChange={(e) => setBanner(i, 'eyebrow', e.target.value)} disabled={!writable} /></label>
                <label className="field"><span>Imagem (caminho/URL)</span><input value={b.image} onChange={(e) => setBanner(i, 'image', e.target.value)} placeholder="images/… ou https://…" disabled={!writable} /></label>
                <label className="field span-all"><span>Título</span><input value={b.title} onChange={(e) => setBanner(i, 'title', e.target.value)} disabled={!writable} /></label>
                <label className="field span-all"><span>Subtítulo</span><input value={b.subtitle} onChange={(e) => setBanner(i, 'subtitle', e.target.value)} disabled={!writable} /></label>
                <label className="field"><span>Texto do botão</span><input value={b.buttonText} onChange={(e) => setBanner(i, 'buttonText', e.target.value)} disabled={!writable} /></label>
                <label className="field"><span>Link do botão</span><input value={b.buttonLink} onChange={(e) => setBanner(i, 'buttonLink', e.target.value)} placeholder="#catalogo ou https://…" disabled={!writable} /></label>
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h3>Categorias da página inicial</h3>
          <p className="muted small" style={{ marginTop: 4 }}>
            Os círculos com foto logo abaixo do banner. Arraste para mudar a ordem; o site mostra
            os <b>5 primeiros</b> e acrescenta "Ver catálogo" no fim. Categoria sem peça ativa não
            aparece no site, mesmo estando aqui. Deixar a lista vazia = o site escolhe sozinho.
          </p>

          {f.homeCategorias.length === 0 && (
            <div className="att-calm" style={{ marginTop: 12 }}>
              Nenhuma escolhida — o site usa as categorias com mais peças, automaticamente.
            </div>
          )}

          {f.homeCategorias.map((c, i) => {
            const n = catalogo.find((x) => x.slug === c.slug)?.n;
            const semPecas = catalogo.length > 0 && !n;
            return (
              <div
                key={c.slug}
                className="card hc-item"
                style={{
                  background: 'var(--surface-tint)', marginTop: 10, marginBottom: 0,
                  outline: sobre === i && arrastando.current !== null && arrastando.current !== i ? '2px dashed var(--terracota)' : 'none',
                  opacity: arrastando.current === i ? 0.4 : 1,
                }}
                onDragOver={(e: DragEvent) => { if (arrastando.current !== null) { e.preventDefault(); setSobre(i); } }}
                onDrop={(e: DragEvent) => { e.preventDefault(); if (arrastando.current !== null) moveCat(arrastando.current, i); arrastando.current = null; setSobre(null); }}
              >
                <div className="card-head-row" style={{ marginBottom: 10, gap: 8 }}>
                  {writable && (
                    <span
                      draggable
                      onDragStart={() => { arrastando.current = i; }}
                      onDragEnd={() => { arrastando.current = null; setSobre(null); }}
                      title="Arraste para reordenar"
                      style={{ cursor: 'grab', display: 'inline-flex', color: 'var(--ink-faint)' }}
                    ><GripVertical size={16} /></span>
                  )}
                  <strong style={{ fontSize: '.9rem' }}>{i + 1}. {nomeCategoria(c.slug)}</strong>
                  <span className={semPecas ? 'pill pill-warn' : 'pill'} style={{ fontSize: '.7rem' }}>
                    {semPecas ? 'sem peças — não aparece' : (n ?? '—') + ' peças'}
                  </span>
                  <span style={{ flex: 1 }} />
                  {writable && <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveCat(i, i - 1)} aria-label={`Subir ${nomeCategoria(c.slug)}`}><ArrowUp size={14} /></button>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={i === f.homeCategorias.length - 1} onClick={() => moveCat(i, i + 1)} aria-label={`Descer ${nomeCategoria(c.slug)}`}><ArrowDown size={14} /></button>
                    <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => removeCat(i)} aria-label={`Tirar ${nomeCategoria(c.slug)} da home`}><X size={14} /></button>
                  </div>}
                </div>
                <div className="form-grid">
                  <label className="field span-all">
                    <span>Nome que aparece no círculo</span>
                    <input value={c.label} onChange={(e) => setCat(i, 'label', e.target.value)}
                      placeholder={nomeCategoria(c.slug) + ' (padrão)'} disabled={!writable} />
                  </label>
                </div>
              </div>
            );
          })}

          {writable && (
            <div style={{ marginTop: 14 }}>
              <p className="muted small" style={{ marginBottom: 6 }}>Adicionar categoria:</p>
              <div className="chips">
                {catalogo.filter((x) => !f.homeCategorias.some((c) => c.slug === x.slug)).map((x) => (
                  <button key={x.slug} type="button" className="chip" onClick={() => addCat(x.slug)}>
                    <Plus size={13} style={{ verticalAlign: '-2px' }} /> {nomeCategoria(x.slug)} <span className="muted">({x.n})</span>
                  </button>
                ))}
                {catalogo.length === 0 && <span className="muted small">Carregando as categorias do catálogo…</span>}
              </div>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head-row"><h3>Depoimentos</h3>{writable && <button type="button" className="btn btn-ghost btn-sm" onClick={addTesti}><Plus size={15} /> Depoimento</button>}</div>
          <p className="muted small" style={{ marginTop: 4 }}>Vazio = o site usa os depoimentos embutidos. A seção some do site se não houver nenhum.</p>
          {f.testimonials.length === 0 && <div className="att-calm" style={{ marginTop: 12 }}>Nenhum depoimento personalizado — o site usa os padrão.</div>}
          {f.testimonials.map((t, i) => (
            <div className="card" key={i} style={{ background: 'var(--surface-tint)', marginTop: 12, marginBottom: 0 }}>
              <div className="card-head-row" style={{ marginBottom: 10 }}>
                <strong style={{ fontSize: '.9rem' }}>Depoimento {i + 1}</strong>
                {writable && <button type="button" className="btn btn-ghost btn-sm btn-danger" onClick={() => removeTesti(i)} aria-label="Remover"><X size={14} /></button>}
              </div>
              <div className="form-grid">
                <label className="field"><span>Nome</span><input value={t.name} onChange={(e) => setTesti(i, 'name', e.target.value)} disabled={!writable} /></label>
                <label className="field"><span>Cidade/UF</span><input value={t.local} onChange={(e) => setTesti(i, 'local', e.target.value)} placeholder="São Paulo, SP" disabled={!writable} /></label>
                <label className="field span-all"><span>Texto</span><textarea rows={2} value={t.text} onChange={(e) => setTesti(i, 'text', e.target.value)} disabled={!writable} /></label>
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ background: 'var(--surface-tint)' }}>
          <h3><Info size={17} style={{ color: 'var(--terracota)' }} /> Benefícios, FAQ e rodapé</h3>
          <p className="muted small" style={{ marginTop: -6 }}>
            Esses blocos hoje são fixos no site. Deixo para uma etapa futura (exige mover o HTML deles para o banco) — me avise quando quiser.
          </p>
        </div>
      </form>
    </div>
  );
}
