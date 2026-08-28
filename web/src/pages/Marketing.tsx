import { useEffect, useState, type FormEvent } from 'react';
import { Info, ShieldCheck, Copy, Check, Link2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface Settings { metaPixelId: string; ga4Id: string; gtmId: string; siteUrl?: string; [k: string]: any; }

export default function Marketing() {
  const { can } = useAuth();
  const writable = can('settings.write');
  const [f, setF] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState(false);
  const set = (k: keyof Settings, v: string) => setF((s) => s ? { ...s, [k]: v } : s);

  async function load() {
    setLoading(true);
    try { const d = await apiFetch<{ settings: Settings }>('/api/site-settings'); setF(d.settings); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    setBusy(true); setError(''); setOk(false);
    try {
      await apiFetch('/api/site-settings', { method: 'PATCH', body: JSON.stringify({ metaPixelId: f.metaPixelId, ga4Id: f.ga4Id, gtmId: f.gtmId }) });
      setOk(true); setTimeout(() => setOk(false), 3500);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); } finally { setBusy(false); }
  }

  if (loading || !f) return <div className="page"><p className="muted">Carregando…</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="dash-ov">Crescimento</div><h1>Marketing</h1><p className="dash-sub">Rastreamento e links de campanha (UTM).</p></div>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {ok && <div className="alert-ok">Salvo! O rastreamento entra em ação no site (respeitando o consentimento).</div>}

      <form onSubmit={submit}>
        <div className="card">
          <div className="card-head-row"><h3>Rastreamento</h3>{writable && <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Salvando…' : 'Salvar IDs'}</button>}</div>
          <p className="muted small" style={{ marginTop: 4, marginBottom: 14 }}>Cole os IDs das ferramentas. Cada uma só é ativada quando tem ID <strong>e</strong> o visitante aceita os cookies.</p>
          <div className="form-grid">
            <label className="field"><span>Meta Pixel ID</span><input value={f.metaPixelId} onChange={(e) => set('metaPixelId', e.target.value)} placeholder="ex.: 123456789012345" inputMode="numeric" disabled={!writable} /></label>
            <label className="field"><span>Google Analytics 4 (Measurement ID)</span><input value={f.ga4Id} onChange={(e) => set('ga4Id', e.target.value)} placeholder="G-XXXXXXXXXX" disabled={!writable} /></label>
            <label className="field"><span>Google Tag Manager (Container ID)</span><input value={f.gtmId} onChange={(e) => set('gtmId', e.target.value)} placeholder="GTM-XXXXXXX" disabled={!writable} /></label>
          </div>
          <p className="note-soft" style={{ padding: '10px 0 0' }}><ShieldCheck size={15} style={{ color: 'var(--ok)' }} /> Consentimento (LGPD) respeitado: nada dispara antes do aceite. Já ativos: PageView, ViewContent, AddToCart, InitiateCheckout, Purchase e Lead.</p>
        </div>
      </form>

      <UtmGenerator defaultBase={f.siteUrl || 'https://ateliedalili-site.pages.dev'} />

      <div className="card" style={{ background: 'var(--surface-tint)' }}>
        <h3><Info size={17} style={{ color: 'var(--terracota)' }} /> Campanhas e cupons</h3>
        <p className="muted small" style={{ marginTop: -6 }}>Chegam na Fase I. A origem/UTM de cada venda já aparece no pedido e na ficha do cliente.</p>
      </div>
    </div>
  );
}

const norm = (v: string) => v.trim().toLowerCase().replace(/\s+/g, '_');

function UtmGenerator({ defaultBase }: { defaultBase: string }) {
  const [base, setBase] = useState(defaultBase);
  const [g, setG] = useState({ source: 'instagram', medium: 'paid_social', campaign: '', content: '', term: '' });
  const [copied, setCopied] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('atelie-utm-recent') || '[]'); } catch { return []; } });
  const setv = (k: keyof typeof g, v: string) => setG((s) => ({ ...s, [k]: v }));

  let url = '';
  try {
    const u = new URL(base.includes('://') ? base : 'https://' + base);
    const add = (k: string, v: string) => { if (v.trim()) u.searchParams.set(k, norm(v)); };
    add('utm_source', g.source); add('utm_medium', g.medium); add('utm_campaign', g.campaign); add('utm_content', g.content); add('utm_term', g.term);
    url = u.toString();
  } catch { url = ''; }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); } catch {}
    setCopied(true); setTimeout(() => setCopied(false), 1500);
    const next = [text, ...recent.filter((r) => r !== text)].slice(0, 8);
    setRecent(next); try { localStorage.setItem('atelie-utm-recent', JSON.stringify(next)); } catch {}
  }

  return (
    <div className="card">
      <h3>Gerador de link com UTM</h3>
      <p className="muted small" style={{ marginTop: 4, marginBottom: 14 }}>Monte o link rastreável para usar no Instagram, anúncios, bio, etc. Cada venda vinda por ele já é atribuída à campanha no pedido e no cliente.</p>
      <div className="form-grid">
        <label className="field span-all"><span>Link de destino</span><input value={base} onChange={(e) => setBase(e.target.value)} placeholder="https://ateliedalili.com.br" /></label>
        <label className="field"><span>Origem (utm_source)</span><input value={g.source} onChange={(e) => setv('source', e.target.value)} placeholder="instagram, google, whatsapp…" /></label>
        <label className="field"><span>Mídia (utm_medium)</span><input value={g.medium} onChange={(e) => setv('medium', e.target.value)} placeholder="paid_social, organic, cpc…" /></label>
        <label className="field"><span>Campanha (utm_campaign)</span><input value={g.campaign} onChange={(e) => setv('campaign', e.target.value)} placeholder="saida_maternidade_agosto" /></label>
        <label className="field"><span>Conteúdo (utm_content)</span><input value={g.content} onChange={(e) => setv('content', e.target.value)} placeholder="reels_03, story_a…" /></label>
        <label className="field"><span>Termo (utm_term) — opcional</span><input value={g.term} onChange={(e) => setv('term', e.target.value)} placeholder="palavra-chave (ads)" /></label>
      </div>

      <div className="utm-out">
        <Link2 size={16} style={{ color: 'var(--ink-faint)', flexShrink: 0 }} />
        <code>{url || 'Preencha o link de destino…'}</code>
        <button type="button" className="btn btn-primary btn-sm" disabled={!url} onClick={() => copy(url)}>
          {copied ? <><Check size={14} /> Copiado</> : <><Copy size={14} /> Copiar</>}
        </button>
      </div>

      {recent.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div className="dash-ov" style={{ marginBottom: 8 }}>Recentes</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recent.map((r, i) => (
              <div key={i} className="utm-recent">
                <code>{r}</code>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(r)}><Copy size={13} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
