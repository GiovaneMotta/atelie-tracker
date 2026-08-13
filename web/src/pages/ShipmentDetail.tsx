import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import {
  formatBRL, formatDate, formatDateTime, formatWeight, maskCep, maskPhone, maskCpfCnpj,
  SHIPMENT_STATUS, SHIPMENT_STATUS_TONE, SHIPMENT_TIMELINE, TRACKING_CODE_LABEL,
} from '../lib/format';

interface TrackEvent { id: string; status: string; event_code: string | null; description: string | null; location: string | null; occurred_at: string | null; created_at: string; source: string; }
interface Shipment {
  id: string; status: string; carrier: string | null; service: string | null; service_code: string | null;
  price: number | null; declared_value: number | null; weight_kg: number | null; delivery_days: number | null;
  tracking_code: string | null; tracking_url: string | null; label_url: string | null; declaration_url: string | null;
  frenet_shipment_id: string | null; environment: string | null; last_error: string | null; created_at: string;
  checklist: Record<string, boolean> | null;
  recipient: any; sender: any;
  shipment_items: any[]; shipment_volumes: any[]; shipping_labels: any[]; tracking_events: TrackEvent[]; shipping_quotes: any[];
}

const CHECKLIST: { key: string; label: string }[] = [
  { key: 'dados_conferidos', label: 'Dados conferidos' },
  { key: 'pagamento_confirmado', label: 'Pagamento confirmado' },
  { key: 'produtos_conferidos', label: 'Produtos conferidos' },
  { key: 'frete_selecionado', label: 'Frete selecionado' },
  { key: 'etiqueta_gerada', label: 'Etiqueta gerada' },
  { key: 'pedido_embalado', label: 'Pedido embalado' },
  { key: 'postado', label: 'Postado' },
];

const TIMELINE_KEYS = SHIPMENT_TIMELINE.map((t) => t.key);

export default function ShipmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const [s, setS] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ shipment: Shipment }>(`/api/shipments?id=${id}`);
      setS(data.shipment);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function generateLabel() {
    setBusy('label'); setError('');
    try { await apiFetch(`/api/shipment-label?id=${id}`, { method: 'POST' }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro ao gerar etiqueta.'); }
    finally { setBusy(''); }
  }
  async function refreshTracking() {
    setBusy('track');
    try { await apiFetch(`/api/shipment-tracking?id=${id}`, { method: 'POST' }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro ao atualizar rastreio.'); }
    finally { setBusy(''); }
  }
  async function cancelShipment() {
    if (!confirm('Cancelar este envio? Se a etiqueta já foi gerada, será cancelada na Frenet quando suportado.')) return;
    setBusy('cancel');
    try { await apiFetch(`/api/shipment-cancel?id=${id}`, { method: 'POST' }); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro ao cancelar.'); }
    finally { setBusy(''); }
  }
  async function toggleCheck(key: string, value: boolean) {
    setS((cur) => cur ? { ...cur, checklist: { ...(cur.checklist || {}), [key]: value } } : cur);
    try { await apiFetch(`/api/shipments?id=${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'checklist', checklist: { [key]: value } }) }); }
    catch { load(); }
  }
  function copyTracking() {
    if (!s?.tracking_code) return;
    navigator.clipboard?.writeText(s.tracking_code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); });
  }

  if (loading) return <div className="page"><p className="muted">Carregando…</p></div>;
  if (!s) return <div className="page"><div className="alert-error">{error || 'Envio não encontrado.'}</div></div>;

  const hasLabel = Boolean(s.label_url || s.frenet_shipment_id);
  const canGenerate = !hasLabel && !['cancelado', 'gerando'].includes(s.status) && Boolean(s.service_code) && can('labels.generate');
  const currentIdx = TIMELINE_KEYS.indexOf(s.status);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="crumb"><button className="btn-link" onClick={() => navigate('/envios')}>← Envios</button></p>
          <h1>Envio <span className="muted">#{s.id.slice(0, 8)}</span></h1>
          <p><span className={`badge badge-${SHIPMENT_STATUS_TONE[s.status] || 'muted'}`}>{SHIPMENT_STATUS[s.status] || s.status}</span>
            {s.environment === 'homologacao' && <span className="badge" style={{ marginLeft: 8 }}>homologação</span>}</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={refreshTracking} disabled={busy === 'track'}>{busy === 'track' ? 'Atualizando…' : '↻ Rastreio'}</button>
          {hasLabel && can('shipments.cancel') && s.status !== 'cancelado' && <button className="btn btn-ghost chip-danger" onClick={cancelShipment} disabled={busy === 'cancel'}>Cancelar</button>}
        </div>
      </div>

      {error && <div className="alert-error">{error}</div>}
      {s.last_error && s.status === 'erro' && <div className="alert-error"><strong>Último erro:</strong> {s.last_error}</div>}

      {/* Timeline (§22) */}
      <div className="card">
        <div className="timeline">
          {SHIPMENT_TIMELINE.map((t, i) => (
            <div key={t.key} className={`tl-step ${currentIdx >= i && currentIdx !== -1 ? 'done' : ''} ${s.status === t.key ? 'current' : ''}`}>
              <span className="tl-dot" /><span className="tl-label">{t.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Etiqueta (§19) */}
      <div className="card">
        <h3>Etiqueta</h3>
        {hasLabel ? (
          <>
            <div className="page-actions" style={{ flexWrap: 'wrap' }}>
              {s.label_url && <a className="btn btn-primary" href={s.label_url} target="_blank" rel="noreferrer">Abrir etiqueta</a>}
              {s.label_url && <a className="btn btn-ghost" href={s.label_url} target="_blank" rel="noreferrer">Imprimir</a>}
              {s.declaration_url && <a className="btn btn-ghost" href={s.declaration_url} target="_blank" rel="noreferrer">Declaração de conteúdo</a>}
              <button className="btn btn-ghost" onClick={copyTracking} disabled={!s.tracking_code}>{copied ? 'Copiado ✓' : 'Copiar rastreio'}</button>
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              Frenet Shipment ID: <code>{s.frenet_shipment_id || '—'}</code> · Rastreio: <code>{s.tracking_code || '—'}</code>
            </p>
          </>
        ) : (
          <>
            <p className="muted">Etiqueta ainda não gerada.</p>
            {canGenerate && <button className="btn btn-primary" onClick={generateLabel} disabled={busy === 'label'}>{busy === 'label' ? 'Gerando…' : 'Gerar etiqueta'}</button>}
            {!s.service_code && <p className="muted small">Selecione um serviço de frete antes de gerar a etiqueta.</p>}
          </>
        )}
      </div>

      <div className="two-col">
        <div>
          {/* Cliente + endereço */}
          <div className="card">
            <h3>Destinatário</h3>
            <div className="detail-grid">
              <div className="info"><span className="info-label">Nome</span><strong>{s.recipient?.name}</strong></div>
              <div className="info"><span className="info-label">CPF/CNPJ</span><span>{s.recipient?.document ? maskCpfCnpj(s.recipient.document) : '—'}</span></div>
              <div className="info"><span className="info-label">Telefone</span><span>{s.recipient?.phone ? maskPhone(s.recipient.phone) : '—'}</span></div>
            </div>
            <div className="notes">
              <p>{s.recipient?.street}, {s.recipient?.number} {s.recipient?.complement}</p>
              <p>{s.recipient?.district} — {s.recipient?.city}/{s.recipient?.state} · CEP {maskCep(s.recipient?.cep || '')}</p>
              {s.recipient?.reference && <p className="muted small">Ref: {s.recipient.reference}</p>}
            </div>
          </div>

          {/* Pedido */}
          <div className="card table-card">
            <table className="table compact">
              <thead><tr><th>Produto</th><th>Qtd</th><th className="right">Valor</th></tr></thead>
              <tbody>
                {(s.shipment_items || []).map((it) => <tr key={it.id}><td>{it.name}</td><td>{it.quantity}</td><td className="right">{formatBRL(it.unit_price * it.quantity)}</td></tr>)}
                {(!s.shipment_items || s.shipment_items.length === 0) && <tr><td colSpan={3} className="muted">Sem itens.</td></tr>}
              </tbody>
            </table>
          </div>

          {/* Rastreio (§23) */}
          <div className="card">
            <h3>Rastreamento</h3>
            {(!s.tracking_events || s.tracking_events.length === 0) && <p className="muted">Nenhum evento de rastreio ainda.</p>}
            <ul className="track-list">
              {(s.tracking_events || []).map((e) => (
                <li key={e.id}>
                  <span className="track-dot" />
                  <div>
                    <strong>{e.event_code && TRACKING_CODE_LABEL[e.event_code] ? TRACKING_CODE_LABEL[e.event_code] : (SHIPMENT_STATUS[e.status] || e.status)}</strong>
                    {e.description && <span className="muted"> — {e.description}</span>}
                    <div className="muted small">{formatDateTime(e.occurred_at || e.created_at)}{e.location ? ` · ${e.location}` : ''}{e.source === 'webhook' ? ' · webhook' : ''}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div>
          {/* Logística */}
          <div className="card">
            <h3>Logística</h3>
            <div className="info"><span className="info-label">Transportadora</span><span>{s.carrier || '—'}</span></div>
            <div className="info"><span className="info-label">Serviço</span><span>{s.service || '—'} <span className="muted small">({s.service_code || '—'})</span></span></div>
            <div className="totals slim">
              <div><span>Frete</span><strong>{s.price != null ? formatBRL(s.price) : '—'}</strong></div>
              <div><span>Valor declarado</span><span>{formatBRL(s.declared_value || 0)}</span></div>
              <div><span>Peso</span><span>{formatWeight(s.weight_kg)}</span></div>
              <div><span>Prazo</span><span>{s.delivery_days != null ? `${s.delivery_days} dia(s)` : '—'}</span></div>
              <div><span>Volumes</span><span>{s.shipment_volumes?.length || 0}</span></div>
              <div><span>Criado</span><span>{formatDate(s.created_at)}</span></div>
            </div>
          </div>

          {/* Checklist (§28) */}
          <div className="card">
            <h3>Checklist de expedição</h3>
            {CHECKLIST.map((c) => (
              <label key={c.key} className="field-check">
                <input type="checkbox" checked={Boolean(s.checklist?.[c.key])} disabled={!can('shipments.write')} onChange={(e) => toggleCheck(c.key, e.target.checked)} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
