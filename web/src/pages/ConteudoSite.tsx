import { useEffect, useState, type FormEvent } from 'react';
import { Info, Plus, ArrowUp, ArrowDown, X } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface Payment { pixDiscountPct: number; installmentsMax: number; freeShippingFrom: string; }
interface Hero { heroEyebrow: string; heroTitle: string; heroSubtitle: string; heroImage: string; }
interface Banner { eyebrow: string; title: string; subtitle: string; image: string; buttonText: string; buttonLink: string; }
interface Settings {
  atelieName: string; whatsappNumber: string; instagram: string; siteUrl: string;
  whatsappMessage: string; payment: Payment; content: Hero; banners: Banner[];
}
const EMPTY_BANNER: Banner = { eyebrow: '', title: '', subtitle: '', image: '', buttonText: 'Ver a coleção', buttonLink: '#catalogo' };

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

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ settings: Settings }>('/api/site-settings');
      setF({ ...data.settings, banners: Array.isArray(data.settings.banners) ? data.settings.banners : [] });
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao carregar.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

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

        <div className="card" style={{ background: 'var(--surface-tint)' }}>
          <h3><Info size={17} style={{ color: 'var(--terracota)' }} /> Depoimentos, benefícios e FAQ</h3>
          <p className="muted small" style={{ marginTop: -6 }}>
            A edição de depoimentos, benefícios/selos, FAQ e textos do rodapé chega na sequência (Fase D3) — mesmo mecanismo (banco + fallback no site).
          </p>
        </div>
      </form>
    </div>
  );
}
