import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { formatDate } from '../lib/format';

interface Task {
  id: string; title: string; description: string | null; priority: string; status: string;
  due_at: string | null; assignee_id: string | null;
  assignee: { name: string } | null; customer: { name: string } | null;
}
interface StaffMember { id: string; name: string; }

const STATUS_LABEL: Record<string, string> = { aberta: 'Aberta', fazendo: 'Fazendo', concluida: 'Concluída' };
const NEXT: Record<string, string | null> = { aberta: 'fazendo', fazendo: 'concluida', concluida: null };
const PRIO_LABEL: Record<string, string> = { baixa: 'Baixa', normal: 'Normal', alta: 'Alta' };

export default function Tarefas() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Task | 'new' | null>(null);

  async function load() {
    setLoading(true);
    try {
      const q = filter ? `?status=${filter}` : '';
      const [t, s] = await Promise.all([
        apiFetch<{ tasks: Task[] }>(`/api/tasks${q}`),
        apiFetch<{ staff: StaffMember[] }>('/api/staff'),
      ]);
      setTasks(t.tasks); setStaff(s.staff);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [filter]);

  async function advance(t: Task) {
    const next = NEXT[t.status];
    if (!next) return;
    await apiFetch(`/api/tasks?id=${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: next }) });
    load();
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Tarefas</h1><p className="muted">{loading ? 'Carregando…' : `${tasks.length} tarefa(s)`}</p></div>
        <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Nova tarefa</button>
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        {['', 'aberta', 'fazendo', 'concluida'].map((s) => (
          <button key={s} className={`chip ${filter === s ? 'chip-on' : ''}`} onClick={() => setFilter(s)}>
            {s === '' ? 'Todas' : STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead><tr><th></th><th>Tarefa</th><th>Responsável</th><th>Prazo</th><th>Prioridade</th><th></th></tr></thead>
          <tbody>
            {!loading && tasks.length === 0 && <tr><td colSpan={6} className="muted center">Nenhuma tarefa.</td></tr>}
            {tasks.map((t) => (
              <tr key={t.id} className={t.status === 'concluida' ? 'task-done' : ''}>
                <td>
                  <input type="checkbox" checked={t.status === 'concluida'}
                    onChange={() => apiFetch(`/api/tasks?id=${t.id}`, { method: 'PATCH', body: JSON.stringify({ status: t.status === 'concluida' ? 'aberta' : 'concluida' }) }).then(load)} />
                </td>
                <td>
                  <strong>{t.title}</strong>
                  {t.customer && <div className="muted small">Cliente: {t.customer.name}</div>}
                </td>
                <td>{t.assignee?.name || '—'}</td>
                <td>{formatDate(t.due_at)}</td>
                <td><span className={`badge prio-${t.priority}`}>{PRIO_LABEL[t.priority] || t.priority}</span></td>
                <td className="right">
                  {NEXT[t.status] && <button className="btn-link" onClick={() => advance(t)}>→ {STATUS_LABEL[NEXT[t.status] as string]}</button>}
                  <button className="btn-link" style={{ marginLeft: 10 }} onClick={() => setEditing(t)}>editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && <TaskModal staff={staff} task={editing === 'new' ? undefined : editing}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function TaskModal({ staff, task, onClose, onSaved }: { staff: StaffMember[]; task?: Task; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    title: task?.title || '', description: task?.description || '', priority: task?.priority || 'normal',
    due_at: task?.due_at ? task.due_at.slice(0, 10) : '', assignee_id: task?.assignee_id || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const payload = { ...f, due_at: f.due_at || null, assignee_id: f.assignee_id || null };
      if (task) await apiFetch(`/api/tasks?id=${task.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      else await apiFetch('/api/tasks', { method: 'POST', body: JSON.stringify(payload) });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setBusy(false); }
  }

  async function remove() {
    if (!task || !confirm('Excluir esta tarefa?')) return;
    await apiFetch(`/api/tasks?id=${task.id}`, { method: 'DELETE' });
    onSaved();
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{task ? 'Editar tarefa' : 'Nova tarefa'}</h3>
        <form onSubmit={submit}>
          <label className="field"><span>Título *</span><input value={f.title} onChange={(e) => set('title', e.target.value)} required placeholder="Ex.: Separar pedido #1048" /></label>
          <label className="field"><span>Descrição</span><textarea rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} /></label>
          <label className="field"><span>Responsável</span>
            <select value={f.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
              <option value="">— Ninguém —</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></label>
          <label className="field"><span>Prioridade</span>
            <select value={f.priority} onChange={(e) => set('priority', e.target.value)}>
              <option value="baixa">Baixa</option><option value="normal">Normal</option><option value="alta">Alta</option>
            </select></label>
          <label className="field"><span>Prazo</span><input type="date" value={f.due_at} onChange={(e) => set('due_at', e.target.value)} /></label>
          {error && <div className="alert-error">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            {task && <button type="button" className="btn-link danger" onClick={remove} style={{ marginLeft: 'auto' }}>Excluir</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
