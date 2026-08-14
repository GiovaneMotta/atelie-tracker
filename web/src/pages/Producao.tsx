import { useEffect, useState, type FormEvent, type DragEvent } from 'react';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/format';

interface Sector { id: string; name: string; color: string; icon: string; position: number; is_final: boolean; }
interface Card {
  id: string; title: string; sector_id: string | null; status: string; priority: string;
  custom: Record<string, string>; due_at: string | null;
  customer: { name: string } | null; pedido: { number: number } | null;
}

const PRIO: Record<string, string> = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta' };

export default function Producao() {
  const [sectors, setSectors] = useState<Sector[]>([]);
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Card | null>(null);

  async function load() {
    setLoading(true);
    try {
      const d = await apiFetch<{ sectors: Sector[]; cards: Card[] }>('/api/production');
      setSectors(d.sectors); setCards(d.cards);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function move(cardId: string, sectorId: string) {
    const card = cards.find((c) => c.id === cardId);
    if (!card || card.sector_id === sectorId) return;
    setCards((cur) => cur.map((c) => c.id === cardId ? { ...c, sector_id: sectorId } : c)); // otimista
    try { await apiFetch(`/api/production?id=${cardId}`, { method: 'PATCH', body: JSON.stringify({ action: 'move', sector_id: sectorId }) }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro ao mover.'); load(); }
  }
  function onDrop(e: DragEvent, sectorId: string) { e.preventDefault(); const id = e.dataTransfer.getData('text/plain'); if (id) move(id, sectorId); }

  async function advance(card: Card) {
    try { await apiFetch(`/api/production?id=${card.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'advance' }) }); load(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Produção</h1><p className="muted">{loading ? 'Carregando…' : `${cards.length} peça(s) na linha`} · arraste entre os setores</p></div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Nova peça</button>
      </div>
      {error && <div className="alert-error">{error}</div>}

      <div className="kanban">
        {sectors.map((s) => {
          const items = cards.filter((c) => c.sector_id === s.id);
          return (
            <div key={s.id} className="kanban-col" onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, s.id)}>
              <div className="kanban-col-head">
                <span className="sector-ico" style={{ background: s.color }}>{s.icon}</span>
                <strong>{s.name}</strong>
                <span className="kanban-count">{items.length}</span>
              </div>
              <div className="kanban-cards">
                {items.map((c) => (
                  <div key={c.id} className="prod-card" draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', c.id)}
                    style={{ borderLeftColor: s.color }}>
                    <div onClick={() => setDetail(c)}>
                      <strong>{c.title}</strong>
                      {c.custom?.baby_name && <div className="muted small">👶 {c.custom.baby_name}</div>}
                      {c.customer && <div className="muted small">{c.customer.name}{c.pedido ? ` · #${c.pedido.number}` : ''}</div>}
                      <div className="prod-card-meta">
                        {c.priority !== 'normal' && <span className={`badge prio-${c.priority}`}>{PRIO[c.priority]}</span>}
                        {c.due_at && <span className="muted small">📅 {formatDate(c.due_at)}</span>}
                      </div>
                    </div>
                    {!s.is_final && <button className="btn btn-ghost btn-sm prod-advance" onClick={() => advance(c)}>Concluir →</button>}
                    {s.is_final && <span className="badge badge-ok">✓ Pronto</span>}
                  </div>
                ))}
                {items.length === 0 && <div className="kanban-empty">—</div>}
              </div>
            </div>
          );
        })}
      </div>

      {creating && <CardModal sectors={sectors} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {detail && <CardModal sectors={sectors} card={detail} onClose={() => setDetail(null)} onSaved={() => { setDetail(null); load(); }} />}
    </div>
  );
}

interface PickCustomer { id: string; name: string; }

function CardModal({ sectors, card, onClose, onSaved }: { sectors: Sector[]; card?: Card; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    title: card?.title || '', priority: card?.priority || 'normal',
    due_at: card?.due_at ? card.due_at.slice(0, 10) : '',
    baby_name: card?.custom?.baby_name || '', color: card?.custom?.color || '',
    theme: card?.custom?.theme || '', size: card?.custom?.size || '', notes: card?.custom?.notes || '',
  });
  const [customer, setCustomer] = useState<PickCustomer | null>(card?.customer ? { id: '', name: card.customer.name } : null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickCustomer[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const sectorName = (id: string | null) => sectors.find((s) => s.id === id)?.name || '—';

  useEffect(() => {
    if (card) apiFetch<{ events: any[] }>(`/api/production?id=${card.id}`).then((d) => setEvents(d.events)).catch(() => {});
  }, [card]);

  async function searchCustomers(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    const d = await apiFetch<{ customers: PickCustomer[] }>(`/api/customers?search=${encodeURIComponent(q)}`);
    setResults(d.customers.slice(0, 6));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const payload: any = {
      title: f.title, priority: f.priority, due_at: f.due_at || null,
      custom: { baby_name: f.baby_name, color: f.color, theme: f.theme, size: f.size, notes: f.notes },
    };
    if (customer?.id) payload.customer_id = customer.id;
    try {
      if (card) await apiFetch(`/api/production?id=${card.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'update', ...payload }) });
      else await apiFetch('/api/production', { method: 'POST', body: JSON.stringify(payload) });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setBusy(false); }
  }
  async function act(action: string, extra?: any) {
    setError('');
    try { await apiFetch(`/api/production?id=${card!.id}`, { method: 'PATCH', body: JSON.stringify({ action, ...extra }) }); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); }
  }
  async function remove() { if (!card || !confirm('Excluir esta peça da produção?')) return; await apiFetch(`/api/production?id=${card.id}`, { method: 'DELETE' }); onSaved(); }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="flow-config-head">
          <strong>{card ? '🧵 Peça na produção' : '🧵 Nova peça'}</strong>
          {card && <span className="badge">{sectorName(card.sector_id)}</span>}
        </div>

        {card && (
          <div className="prod-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => act('start')}>Iniciar</button>
            <button className="btn btn-primary btn-sm" onClick={() => act('advance')}>Concluir setor →</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setReturning((v) => !v)}>Devolver</button>
          </div>
        )}
        {returning && (
          <div className="row-inline" style={{ marginBottom: 10 }}>
            <input placeholder="Motivo da devolução" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn btn-ghost btn-sm" disabled={!reason.trim()} onClick={() => act('return', { reason })}>Confirmar</button>
          </div>
        )}

        <form onSubmit={save}>
          <label className="field"><span>Título *</span><input value={f.title} onChange={(e) => set('title', e.target.value)} required placeholder="Ex.: Saída Jardim Rosa RN" /></label>
          <div className="form-grid">
            <label className="field"><span>👶 Nome do bebê</span><input value={f.baby_name} onChange={(e) => set('baby_name', e.target.value)} /></label>
            <label className="field"><span>Cor</span><input value={f.color} onChange={(e) => set('color', e.target.value)} /></label>
            <label className="field"><span>Tema</span><input value={f.theme} onChange={(e) => set('theme', e.target.value)} /></label>
            <label className="field"><span>Tamanho</span><input value={f.size} onChange={(e) => set('size', e.target.value)} placeholder="RN, P…" /></label>
            <label className="field"><span>Prioridade</span>
              <select value={f.priority} onChange={(e) => set('priority', e.target.value)}>
                <option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option>
              </select></label>
            <label className="field"><span>Entregar até</span><input type="date" value={f.due_at} onChange={(e) => set('due_at', e.target.value)} /></label>
          </div>
          <label className="field"><span>Observações</span><input value={f.notes} onChange={(e) => set('notes', e.target.value)} /></label>
          <div className="field"><span>Cliente</span>
            {customer ? <div className="picked">{customer.name} <button type="button" className="btn-link" onClick={() => setCustomer(null)}>trocar</button></div>
              : <div className="picker"><input placeholder="Buscar cliente…" value={query} onChange={(e) => searchCustomers(e.target.value)} />
                {results.map((c) => <button type="button" key={c.id} className="picker-opt" onClick={() => { setCustomer(c); setResults([]); setQuery(''); }}>{c.name}</button>)}</div>}
          </div>
          {error && <div className="alert-error">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Fechar</button>
            {card && <button type="button" className="btn-link danger" onClick={remove} style={{ marginLeft: 'auto' }}>Excluir</button>}
          </div>
        </form>

        {card && events.length > 0 && (
          <div className="prod-history">
            <h3>Histórico</h3>
            {events.map((ev) => (
              <div className="hist-row" key={ev.id}>
                <span className="hist-act">{ev.action}</span>
                <span className="muted small">{sectorName(ev.from_sector)} → {sectorName(ev.to_sector)}{ev.reason ? ` · ${ev.reason}` : ''}</span>
                <span className="muted small">{ev.actor?.name || ''} · {new Date(ev.created_at).toLocaleString('pt-BR')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
