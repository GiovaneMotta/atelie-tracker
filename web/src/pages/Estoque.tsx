import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface Item {
  product_id: string; name: string; sku: string | null; image: string | null;
  quantity: number; min_qty: number; reserved: number; tracked: boolean;
  status: 'esgotado' | 'baixo' | 'ok';
}
interface Summary { esgotados: number; baixo: number; ok: number; total: number; }

const SITE_BASE = 'https://ateliedalili-site.pages.dev';
const src = (u: string | null) => !u ? '' : (/^https?:\/\//i.test(u) ? u : `${SITE_BASE}/${u.replace(/^\/+/, '')}`);
const STATUS: Record<string, { label: string; pill: string }> = {
  esgotado: { label: 'Esgotado', pill: 'pill pill-bad' },
  baixo: { label: 'Estoque baixo', pill: 'pill pill-warn' },
  ok: { label: 'Disponível', pill: 'pill pill-ok' },
};

export default function Estoque() {
  const { can } = useAuth();
  const writable = can('products.write');
  const [items, setItems] = useState<Item[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [statusF, setStatusF] = useState('');
  const [edit, setEdit] = useState<Item | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: Item[]; summary: Summary }>('/api/inventory');
      setItems(data.items); setSummary(data.summary);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const term = q.trim().toLowerCase();
  const filtered = items.filter((i) =>
    (!term || i.name.toLowerCase().includes(term) || (i.sku || '').toLowerCase().includes(term)) &&
    (!statusF || i.status === statusF));

  return (
    <div className="page">
      <div className="page-head">
        <div><div className="dash-ov">Catálogo</div><h1>Estoque</h1><p className="dash-sub">Controle de estoque dos produtos.</p></div>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="stat-strip" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat"><div className="stat-lb">Esgotados</div><div className="stat-vl" style={{ color: 'var(--bad)' }}>{summary?.esgotados ?? '—'}</div></div>
        <div className="stat"><div className="stat-lb">Estoque baixo</div><div className="stat-vl" style={{ color: 'var(--warn)' }}>{summary?.baixo ?? '—'}</div></div>
        <div className="stat"><div className="stat-lb">Disponíveis</div><div className="stat-vl" style={{ color: 'var(--ok)' }}>{summary?.ok ?? '—'}</div></div>
      </div>

      <div className="filters" style={{ marginBottom: 16 }}>
        <div className="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome ou SKU…" /></div>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value)}>
          <option value="">Todos</option>
          <option value="esgotado">Esgotados</option>
          <option value="baixo">Estoque baixo</option>
          <option value="ok">Disponíveis</option>
        </select>
      </div>

      <div className="card table-card">
        <table className="table">
          <thead><tr><th></th><th>Produto</th><th>SKU</th><th className="right">Atual</th><th className="right">Mínimo</th><th>Status</th>{writable && <th></th>}</tr></thead>
          <tbody>
            {!loading && filtered.length === 0 && <tr><td colSpan={writable ? 7 : 6} className="muted center">Nenhum produto encontrado.</td></tr>}
            {filtered.map((i) => (
              <tr key={i.product_id}>
                <td>{i.image ? <img src={src(i.image)} alt="" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover', display: 'block' }} loading="lazy" /> : <div style={{ width: 34, height: 34, borderRadius: 8, background: 'var(--cream-2)' }} />}</td>
                <td><strong>{i.name}</strong></td>
                <td className="mono">{i.sku || '—'}</td>
                <td className="right mono">{i.tracked ? i.quantity : '—'}</td>
                <td className="right mono">{i.tracked ? i.min_qty : '—'}</td>
                <td><span className={STATUS[i.status].pill}>{STATUS[i.status].label}</span></td>
                {writable && <td className="right"><button className="btn btn-ghost btn-sm" onClick={() => setEdit(i)}>Ajustar</button></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {edit && <AdjustModal item={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

function AdjustModal({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const [delta, setDelta] = useState('');
  const [min, setMin] = useState(String(item.min_qty || 0));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const d = parseInt(delta.replace(/[^\d-]/g, ''), 10);
  const preview = item.quantity + (Number.isFinite(d) ? d : 0);

  async function save() {
    setBusy(true); setError('');
    try {
      await apiFetch('/api/inventory', {
        method: 'POST',
        body: JSON.stringify({
          product_id: item.product_id,
          delta: Number.isFinite(d) ? d : 0,
          min_qty: parseInt(min, 10) || 0,
          reason: reason || (Number.isFinite(d) && d !== 0 ? (d > 0 ? 'Entrada manual' : 'Saída manual') : 'Ajuste de mínimo'),
        }),
      });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); setBusy(false); }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Ajustar estoque</h3>
        <p className="muted small" style={{ marginTop: -8, marginBottom: 14 }}>{item.name} · atual <strong>{item.tracked ? item.quantity : 0}</strong></p>
        {error && <div className="alert-error">{error}</div>}
        <label className="field"><span>Entrada (+) ou saída (−)</span>
          <input value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="ex.: 10 ou -3" inputMode="numeric" /></label>
        {delta.trim() !== '' && <p className="muted small" style={{ marginTop: -6, marginBottom: 12 }}>Novo estoque: <strong>{Math.max(0, preview)}</strong></p>}
        <label className="field"><span>Estoque mínimo (alerta)</span>
          <input value={min} onChange={(e) => setMin(e.target.value)} inputMode="numeric" /></label>
        <label className="field"><span>Motivo (opcional)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ex.: compra de tecido, ajuste de contagem…" /></label>
        <div className="form-actions" style={{ margin: '8px 0 0' }}>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
