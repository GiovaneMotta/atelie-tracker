import { useEffect, useState, type FormEvent } from 'react';
import { Info } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface Payment { pixDiscountPct: number; installmentsMax: number; freeShippingFrom: string; }
interface Settings {
  atelieName: string; whatsappNumber: string; instagram: string; siteUrl: string;
  whatsappMessage: string; payment: Payment;
}

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
      await apiFetch('/api/site-settings', { method: 'PATCH', body: JSON.stringify(f) });
      setOk(true);
      setTimeout(() => setOk(false), 3000);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); } finally { setBusy(false); }
  }

  if (loading || !f) return <div className="page"><p className="muted">Carregando…</p></div>;

  return (
    <div className="page">
      <form onSubmit={submit}>
        <div className="page-head">
          <div><div className="dash-ov">Site</div><h1>Conteúdo do site</h1><p className="dash-sub">Edite as informações do site sem mexer no código.</p></div>
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

        <div className="card" style={{ background: 'var(--surface-tint)' }}>
          <h3><Info size={17} style={{ color: 'var(--terracota)' }} /> Vitrine, banners e depoimentos</h3>
          <p className="muted small" style={{ marginTop: -6 }}>
            A edição de hero, banners, vitrines, depoimentos, benefícios e FAQ chega na próxima etapa (Fase D2) —
            eles serão movidos do código para o banco, com editor visual aqui e renderização automática no site.
          </p>
        </div>
      </form>
    </div>
  );
}
