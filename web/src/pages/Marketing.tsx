import { useEffect, useState, type FormEvent } from 'react';
import { ShieldCheck, Copy, Check, Link2, Plus, Trash2, Pencil, Ticket } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL } from '../lib/format';

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

      <CouponsManager writable={writable} />
    </div>
  );
}

interface Coupon {
  id: string; code: string; description: string | null; type: 'percent' | 'fixed';
  value: number; min_order: number; max_uses: number | null; uses_count: number;
  starts_at: string | null; expires_at: string | null; active: boolean;
}
type CouponForm = {
  code: string; description: string; type: 'percent' | 'fixed'; value: string;
  min_order: string; max_uses: string; starts_at: string; expires_at: string; active: boolean;
};
const EMPTY_COUPON: CouponForm = { code: '', description: '', type: 'percent', value: '', min_order: '', max_uses: '', starts_at: '', expires_at: '', active: true };
const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : '');
const showDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');

function CouponsManager({ writable }: { writable: boolean }) {
  const [list, setList] = useState<Coupon[] | null>(null);
  const [form, setForm] = useState<CouponForm>(EMPTY_COUPON);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setv = (k: keyof CouponForm, v: any) => setForm((s) => ({ ...s, [k]: v }));

  async function load() {
    try { const d = await apiFetch<{ coupons: Coupon[] }>('/api/coupons'); setList(d.coupons); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro ao carregar cupons.'); }
  }
  useEffect(() => { load(); }, []);

  function startNew() { setForm(EMPTY_COUPON); setEditingId(null); setOpen(true); setError(''); }
  function startEdit(c: Coupon) {
    setForm({ code: c.code, description: c.description || '', type: c.type, value: String(c.value),
      min_order: c.min_order ? String(c.min_order) : '', max_uses: c.max_uses != null ? String(c.max_uses) : '',
      starts_at: dateInput(c.starts_at), expires_at: dateInput(c.expires_at), active: c.active });
    setEditingId(c.id); setOpen(true); setError('');
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await apiFetch(`/api/coupons${editingId ? `?id=${editingId}` : ''}`,
        { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(form) });
      setOpen(false); setForm(EMPTY_COUPON); setEditingId(null); await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); } finally { setBusy(false); }
  }
  async function toggle(c: Coupon) {
    try {
      await apiFetch(`/api/coupons?id=${c.id}`, { method: 'PATCH', body: JSON.stringify({
        code: c.code, description: c.description, type: c.type, value: c.value, min_order: c.min_order,
        max_uses: c.max_uses, starts_at: c.starts_at, expires_at: c.expires_at, active: !c.active }) });
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); }
  }
  async function remove(c: Coupon) {
    if (!confirm(`Remover o cupom ${c.code}?`)) return;
    try { await apiFetch(`/api/coupons?id=${c.id}`, { method: 'DELETE' }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro ao remover.'); }
  }

  return (
    <div className="card">
      <div className="card-head-row">
        <h3><Ticket size={17} style={{ color: 'var(--terracota)', verticalAlign: '-3px', marginRight: 6 }} />Cupons de desconto</h3>
        {writable && !open && <button className="btn btn-primary btn-sm" onClick={startNew}><Plus size={15} /> Novo cupom</button>}
      </div>
      <p className="muted small" style={{ marginTop: 4, marginBottom: 14 }}>O cliente digita o cupom no carrinho; o desconto é validado no servidor e o pedido entra no CRM já com o valor certo.</p>

      {error && <div className="alert-error" style={{ marginBottom: 12 }}>{error}</div>}

      {open && (
        <form onSubmit={save} className="card" style={{ background: 'var(--surface-tint)', marginBottom: 16 }}>
          <div className="form-grid">
            <label className="field"><span>Código</span><input value={form.code} onChange={(e) => setv('code', e.target.value.toUpperCase())} placeholder="BEMVINDA10" required /></label>
            <label className="field"><span>Tipo de desconto</span>
              <select value={form.type} onChange={(e) => setv('type', e.target.value)}>
                <option value="percent">Porcentagem (%)</option>
                <option value="fixed">Valor fixo (R$)</option>
              </select></label>
            <label className="field"><span>{form.type === 'percent' ? 'Desconto (%)' : 'Desconto (R$)'}</span>
              <input value={form.value} onChange={(e) => setv('value', e.target.value)} inputMode="decimal" placeholder={form.type === 'percent' ? '10' : '20,00'} required /></label>
            <label className="field"><span>Pedido mínimo (R$) — opcional</span><input value={form.min_order} onChange={(e) => setv('min_order', e.target.value)} inputMode="decimal" placeholder="0,00" /></label>
            <label className="field"><span>Limite de usos — opcional</span><input value={form.max_uses} onChange={(e) => setv('max_uses', e.target.value)} inputMode="numeric" placeholder="ilimitado" /></label>
            <label className="field"><span>Descrição — opcional</span><input value={form.description} onChange={(e) => setv('description', e.target.value)} placeholder="Boas-vindas" /></label>
            <label className="field"><span>Início — opcional</span><input type="date" value={form.starts_at} onChange={(e) => setv('starts_at', e.target.value)} /></label>
            <label className="field"><span>Validade — opcional</span><input type="date" value={form.expires_at} onChange={(e) => setv('expires_at', e.target.value)} /></label>
            <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setv('active', e.target.checked)} style={{ width: 'auto' }} /><span style={{ margin: 0 }}>Ativo</span></label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn btn-primary btn-sm" disabled={busy}>{busy ? 'Salvando…' : (editingId ? 'Salvar alterações' : 'Criar cupom')}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setEditingId(null); }}>Cancelar</button>
          </div>
        </form>
      )}

      {list === null ? <p className="muted small">Carregando cupons…</p>
        : list.length === 0 ? <div className="att-calm">Nenhum cupom ainda. Crie o primeiro para oferecer descontos no site.</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table compact">
              <thead><tr><th>Código</th><th>Desconto</th><th>Mín.</th><th className="right">Usos</th><th>Validade</th><th>Status</th>{writable && <th></th>}</tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td><strong className="mono">{c.code}</strong>{c.description && <div className="muted small">{c.description}</div>}</td>
                    <td>{c.type === 'percent' ? `${c.value}%` : formatBRL(c.value)}</td>
                    <td>{c.min_order > 0 ? formatBRL(c.min_order) : '—'}</td>
                    <td className="right mono">{c.uses_count}{c.max_uses != null ? `/${c.max_uses}` : ''}</td>
                    <td>{showDate(c.expires_at)}</td>
                    <td><span className={`badge ${c.active ? 'badge-ok' : ''}`}>{c.active ? 'Ativo' : 'Inativo'}</span></td>
                    {writable && <td className="right" style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggle(c)}>{c.active ? 'Desativar' : 'Ativar'}</button>
                      <button className="btn btn-ghost btn-sm" onClick={() => startEdit(c)} aria-label="Editar"><Pencil size={14} /></button>
                      <button className="btn btn-ghost btn-sm btn-danger" onClick={() => remove(c)} aria-label="Remover"><Trash2 size={14} /></button>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
