import { useEffect, useState, type FormEvent } from 'react';
import { Info, ShieldCheck } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface Settings { metaPixelId: string; ga4Id: string; gtmId: string; [k: string]: any; }

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
      <form onSubmit={submit}>
        <div className="page-head">
          <div><div className="dash-ov">Crescimento</div><h1>Marketing</h1><p className="dash-sub">Rastreamento e, em breve, campanhas e cupons.</p></div>
          {writable && <div className="page-actions"><button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar alterações'}</button></div>}
        </div>

        {error && <div className="alert-error">{error}</div>}
        {ok && <div className="alert-ok">Salvo! O rastreamento entra em ação no site (respeitando o consentimento).</div>}

        <div className="card">
          <h3>Rastreamento</h3>
          <p className="muted small" style={{ marginTop: -6, marginBottom: 14 }}>Cole os IDs das ferramentas. Cada uma só é ativada quando tem ID <strong>e</strong> o visitante aceita os cookies.</p>
          <div className="form-grid">
            <label className="field"><span>Meta Pixel ID</span><input value={f.metaPixelId} onChange={(e) => set('metaPixelId', e.target.value)} placeholder="ex.: 123456789012345" inputMode="numeric" disabled={!writable} /></label>
            <label className="field"><span>Google Analytics 4 (Measurement ID)</span><input value={f.ga4Id} onChange={(e) => set('ga4Id', e.target.value)} placeholder="G-XXXXXXXXXX" disabled={!writable} /></label>
            <label className="field"><span>Google Tag Manager (Container ID)</span><input value={f.gtmId} onChange={(e) => set('gtmId', e.target.value)} placeholder="GTM-XXXXXXX" disabled={!writable} /></label>
          </div>
          <p className="note-soft" style={{ padding: '10px 0 0' }}><ShieldCheck size={15} style={{ color: 'var(--ok)' }} /> Consentimento (LGPD) respeitado: nada dispara antes do aceite. Já ativos hoje: PageView, ViewContent e Lead (WhatsApp).</p>
        </div>

        <div className="card" style={{ background: 'var(--surface-tint)' }}>
          <h3><Info size={17} style={{ color: 'var(--terracota)' }} /> Campanhas, cupons e gerador de UTM</h3>
          <p className="muted small" style={{ marginTop: -6 }}>Chegam nas Fases G/I. A captura de UTM e a atribuição por pedido já funcionam (aparecem no pedido e na ficha do cliente).</p>
        </div>
      </form>
    </div>
  );
}
