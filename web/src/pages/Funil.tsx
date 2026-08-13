import { useEffect, useState, type FormEvent, type DragEvent } from 'react';
import { apiFetch } from '../lib/api';
import { formatBRL } from '../lib/format';

interface Stage { id: string; key: string; name: string; position: number; is_won: boolean; is_lost: boolean; color: string | null; }
interface Lead {
  id: string; stage_id: string; title: string | null; interest: string | null; value: number | null;
  origin: string | null; customer: { name: string; whatsapp: string | null; phone: string | null } | null;
}

export default function Funil() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Lead | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ stages: Stage[]; leads: Lead[] }>('/api/leads');
      setStages(data.stages);
      setLeads(data.leads);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function moveLead(leadId: string, stageId: string) {
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage_id === stageId) return;
    setLeads((cur) => cur.map((l) => l.id === leadId ? { ...l, stage_id: stageId } : l)); // otimista
    try {
      await apiFetch(`/api/leads?id=${leadId}`, { method: 'PATCH', body: JSON.stringify({ stage_id: stageId }) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao mover.');
      load(); // reverte
    }
  }

  function onDrop(e: DragEvent, stageId: string) {
    e.preventDefault();
    const leadId = e.dataTransfer.getData('text/plain') || dragId;
    if (leadId) moveLead(leadId, stageId);
    setDragId(null);
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Funil de vendas</h1><p className="muted">{loading ? 'Carregando…' : `${leads.length} lead(s) · arraste os cards entre as etapas`}</p></div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Novo lead</button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="kanban">
        {stages.map((st) => {
          const items = leads.filter((l) => l.stage_id === st.id);
          const total = items.reduce((s, l) => s + Number(l.value || 0), 0);
          return (
            <div key={st.id} className="kanban-col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, st.id)}>
              <div className="kanban-col-head">
                <span className={`stage-dot ${st.is_won ? 'won' : st.is_lost ? 'lost' : ''}`} />
                <strong>{st.name}</strong>
                <span className="kanban-count">{items.length}</span>
              </div>
              {total > 0 && <div className="kanban-total">{formatBRL(total)}</div>}
              <div className="kanban-cards">
                {items.map((l) => (
                  <div key={l.id} className="lead-card" draggable
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', l.id); setDragId(l.id); }}
                    onClick={() => setEditing(l)}>
                    <strong>{l.title || l.customer?.name || 'Sem título'}</strong>
                    {l.customer && <div className="muted small">{l.customer.name}</div>}
                    {l.interest && <div className="lead-interest">{l.interest}</div>}
                    {l.value != null && l.value > 0 && <div className="lead-value">{formatBRL(l.value)}</div>}
                  </div>
                ))}
                {items.length === 0 && <div className="kanban-empty">—</div>}
              </div>
            </div>
          );
        })}
      </div>

      {creating && <LeadModal stages={stages} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <LeadModal stages={stages} lead={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

interface PickCustomer { id: string; name: string; whatsapp: string | null; phone: string | null; }

function LeadModal({ stages, lead, onClose, onSaved }: { stages: Stage[]; lead?: Lead; onClose: () => void; onSaved: () => void }) {
  const [title, setTitle] = useState(lead?.title || '');
  const [interest, setInterest] = useState(lead?.interest || '');
  const [value, setValue] = useState(lead?.value != null ? String(lead.value) : '');
  const [stageId, setStageId] = useState(lead?.stage_id || stages[0]?.id || '');
  const [custQuery, setCustQuery] = useState('');
  const [custResults, setCustResults] = useState<PickCustomer[]>([]);
  const [customer, setCustomer] = useState<PickCustomer | null>(lead?.customer ? { id: '', ...lead.customer } as any : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function searchCustomers(q: string) {
    setCustQuery(q);
    if (q.trim().length < 2) { setCustResults([]); return; }
    const data = await apiFetch<{ customers: PickCustomer[] }>(`/api/customers?search=${encodeURIComponent(q)}`);
    setCustResults(data.customers.slice(0, 6));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    const payload: Record<string, unknown> = {
      title, interest, value: value ? Number(value.replace(',', '.')) : null, stage_id: stageId,
    };
    if (customer?.id) payload.customer_id = customer.id;
    try {
      if (lead) await apiFetch(`/api/leads?id=${lead.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await apiFetch('/api/leads', { method: 'POST', body: JSON.stringify(payload) });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setBusy(false); }
  }

  async function remove() {
    if (!lead || !confirm('Excluir este lead?')) return;
    await apiFetch(`/api/leads?id=${lead.id}`, { method: 'DELETE' });
    onSaved();
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{lead ? 'Editar lead' : 'Novo lead'}</h3>
        <form onSubmit={submit}>
          <label className="field"><span>Título</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Saída para menina — Maria" /></label>
          <label className="field"><span>Interesse</span>
            <input value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="Ex.: modelo Jardim Rosa, RN" /></label>
          <label className="field"><span>Valor estimado (R$)</span>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="0,00" /></label>
          <label className="field"><span>Etapa</span>
            <select value={stageId} onChange={(e) => setStageId(e.target.value)}>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <div className="field"><span>Cliente (opcional)</span>
            {customer
              ? <div className="picked">{customer.name} <button type="button" className="btn-link" onClick={() => setCustomer(null)}>trocar</button></div>
              : (
                <div className="picker">
                  <input placeholder="Buscar cliente…" value={custQuery} onChange={(e) => searchCustomers(e.target.value)} />
                  {custResults.map((c) => <button type="button" key={c.id} className="picker-opt" onClick={() => { setCustomer(c); setCustResults([]); setCustQuery(''); }}>{c.name} <span className="muted">{c.whatsapp || c.phone}</span></button>)}
                </div>
              )}
          </div>
          {error && <div className="alert-error">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            {lead && <button type="button" className="btn-link danger" onClick={remove} style={{ marginLeft: 'auto' }}>Excluir</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
