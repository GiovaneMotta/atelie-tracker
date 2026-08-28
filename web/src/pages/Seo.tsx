import { useEffect, useState, type FormEvent } from 'react';
import { Info, Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface Seo {
  metaTitle: string; metaDescription: string; keywords: string; ogImage: string;
  catalogoTitle: string; catalogoDescription: string;
}
interface Settings extends Record<string, any> { seo: Seo; siteUrl: string; }

function Counter({ n, max }: { n: number; max: number }) {
  return <span className="muted small" style={{ float: 'right', color: n > max ? 'var(--bad)' : undefined }}>{n}/{max}</span>;
}

function Snippet({ url, title, desc }: { url: string; title: string; desc: string }) {
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: '14px 16px', background: 'var(--surface)', maxWidth: 600 }}>
      <div className="mono small" style={{ color: 'var(--ink-soft)' }}>{url || 'ateliedalili-site.pages.dev'}</div>
      <div style={{ color: '#1a56c4', fontSize: '1.05rem', lineHeight: 1.3, margin: '2px 0 3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title || 'Título da página'}</div>
      <div style={{ color: 'var(--ink-soft)', fontSize: '.86rem', lineHeight: 1.45, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{desc || 'A descrição aparece aqui, resumindo a página para quem busca no Google.'}</div>
    </div>
  );
}

export default function SeoPage() {
  const { can } = useAuth();
  const writable = can('settings.write');
  const [f, setF] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);

  const setSeo = (k: keyof Seo, v: string) => setF((s) => s ? { ...s, seo: { ...s.seo, [k]: v } } : s);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ settings: Settings }>('/api/site-settings');
      setF(data.settings);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao carregar.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    setBusy(true); setError(''); setOk(false);
    try {
      await apiFetch('/api/site-settings', { method: 'PATCH', body: JSON.stringify({ seo: f.seo }) });
      setOk(true); setTimeout(() => setOk(false), 3500);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); } finally { setBusy(false); }
  }

  if (loading || !f) return <div className="page"><p className="muted">Carregando…</p></div>;
  const s = f.seo;
  const base = (f.siteUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');

  return (
    <div className="page">
      <form onSubmit={submit}>
        <div className="page-head">
          <div><div className="dash-ov">Site</div><h1>SEO</h1><p className="dash-sub">Como a loja aparece no Google e ao compartilhar links.</p></div>
          {writable && <div className="page-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}</button></div>}
        </div>

        {error && <div className="alert-error">{error}</div>}
        {ok && <div className="alert-ok">Salvo! O site público já reflete as alterações.</div>}

        <div className="card">
          <h3>Página inicial</h3>
          <p className="muted small" style={{ marginTop: -6, marginBottom: 14 }}>O que aparece na busca do Google para a home. Título ideal até ~60 caracteres; descrição até ~160.</p>
          <div className="form-grid">
            <label className="field span-all"><span>Título da página<Counter n={s.metaTitle.length} max={60} /></span>
              <input value={s.metaTitle} onChange={(e) => setSeo('metaTitle', e.target.value)} disabled={!writable} /></label>
            <label className="field span-all"><span>Descrição<Counter n={s.metaDescription.length} max={160} /></span>
              <textarea rows={3} value={s.metaDescription} onChange={(e) => setSeo('metaDescription', e.target.value)} disabled={!writable} /></label>
            <label className="field span-all"><span>Palavras-chave (separadas por vírgula)</span>
              <input value={s.keywords} onChange={(e) => setSeo('keywords', e.target.value)} placeholder="saída maternidade, enxoval bebê…" disabled={!writable} /></label>
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="muted small" style={{ marginBottom: 6 }}>Prévia no Google</div>
            <Snippet url={base} title={s.metaTitle} desc={s.metaDescription} />
          </div>
        </div>

        <div className="card">
          <h3>Página do catálogo</h3>
          <p className="muted small" style={{ marginTop: -6, marginBottom: 14 }}>Título e descrição da página que lista todas as peças (<span className="mono">catalogo.html</span>).</p>
          <div className="form-grid">
            <label className="field span-all"><span>Título da página<Counter n={s.catalogoTitle.length} max={60} /></span>
              <input value={s.catalogoTitle} onChange={(e) => setSeo('catalogoTitle', e.target.value)} disabled={!writable} /></label>
            <label className="field span-all"><span>Descrição<Counter n={s.catalogoDescription.length} max={160} /></span>
              <textarea rows={3} value={s.catalogoDescription} onChange={(e) => setSeo('catalogoDescription', e.target.value)} disabled={!writable} /></label>
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="muted small" style={{ marginBottom: 6 }}>Prévia no Google</div>
            <Snippet url={base ? `${base}/catalogo.html` : ''} title={s.catalogoTitle} desc={s.catalogoDescription} />
          </div>
        </div>

        <div className="card">
          <h3>Imagem de compartilhamento</h3>
          <p className="muted small" style={{ marginTop: -6, marginBottom: 14 }}>A imagem que aparece ao colar o link no WhatsApp, Instagram e Facebook. Recomendado 1200×630px.</p>
          <div className="form-grid">
            <label className="field span-all"><span>Imagem (caminho ou URL)</span>
              <input value={s.ogImage} onChange={(e) => setSeo('ogImage', e.target.value)} placeholder="images/og-cover.jpg ou https://…" disabled={!writable} /></label>
          </div>
          {s.ogImage && (
            <div style={{ marginTop: 12 }}>
              <img src={/^https?:\/\//i.test(s.ogImage) ? s.ogImage : (f.siteUrl ? f.siteUrl.replace(/\/$/, '') + '/' + s.ogImage.replace(/^\//, '') : s.ogImage)}
                alt="Prévia da imagem de compartilhamento" style={{ maxWidth: 360, width: '100%', borderRadius: 10, border: '1px solid var(--line)', display: 'block' }}
                onError={(e) => { (e.currentTarget.style.display = 'none'); }} />
            </div>
          )}
        </div>

        <div className="card" style={{ background: 'var(--surface-tint)' }}>
          <h3><Search size={17} style={{ color: 'var(--terracota)' }} /> SEO das páginas de produto</h3>
          <p className="muted small" style={{ marginTop: -6 }}>
            Cada produto já gera SEO automaticamente: título, descrição, link (canonical), imagem de compartilhamento e dados estruturados (preço, disponibilidade) a partir do próprio produto. O endereço amigável (<span className="mono">slug</span>) se edita na tela de <strong>Produtos</strong>.
          </p>
        </div>

        <div className="card" style={{ background: 'var(--surface-tint)' }}>
          <h3><Info size={17} style={{ color: 'var(--terracota)' }} /> Sitemap e robots</h3>
          <p className="muted small" style={{ marginTop: -6 }}>
            O <span className="mono">sitemap.xml</span> e o <span className="mono">robots.txt</span> do site continuam ativos e não são afetados por esta tela.
          </p>
        </div>
      </form>
    </div>
  );
}
