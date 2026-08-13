import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface KB { id: string; category: string; title: string; content: string; is_active: boolean; }

const CATEGORIES = [
  'produtos', 'precos', 'personalizacoes', 'pagamentos', 'fretes', 'prazos',
  'trocas', 'devolucoes', 'politicas', 'faq', 'empresa', 'scripts', 'regras',
];
const CAT_LABEL: Record<string, string> = {
  produtos: 'Produtos', precos: 'Preços', personalizacoes: 'Personalizações', pagamentos: 'Pagamentos',
  fretes: 'Fretes', prazos: 'Prazos', trocas: 'Trocas', devolucoes: 'Devoluções', politicas: 'Políticas',
  faq: 'Perguntas frequentes', empresa: 'Empresa', scripts: 'Scripts de atendimento', regras: 'Regras comerciais',
};

export default function Conhecimento() {
  const { can } = useAuth();
  const [items, setItems] = useState<KB[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<KB | 'new' | null>(null);
  const canEdit = can('ai.configure');

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ items: KB[] }>('/api/knowledge');
      setItems(data.items);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const byCat = CATEGORIES.map((c) => ({ cat: c, list: items.filter((i) => i.category === c) })).filter((g) => g.list.length > 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Base de Conhecimento</h1>
          <p className="muted">O que a IA vai consultar antes de responder (Fase 3). {loading ? '' : `${items.length} item(ns)`}</p>
        </div>
        {canEdit && <button className="btn btn-primary" onClick={() => setEditing('new')}>+ Novo conteúdo</button>}
      </div>

      {error && <div className="alert-error">{error}</div>}
      {!loading && items.length === 0 && (
        <div className="empty-card"><p className="empty-emoji">📚</p>
          <p><strong>Comece a ensinar a IA.</strong></p>
          <p className="muted">Cadastre preços, prazos, políticas, trocas, FAQ… A IA usará isso como fonte — nunca inventando informações.</p>
        </div>
      )}

      {byCat.map((g) => (
        <div className="card" key={g.cat}>
          <h3>{CAT_LABEL[g.cat] || g.cat}</h3>
          <div className="kb-list">
            {g.list.map((i) => (
              <div className={`kb-item ${!i.is_active ? 'kb-off' : ''}`} key={i.id}>
                <div className="kb-item-main">
                  <strong>{i.title}</strong>
                  <p className="muted">{i.content}</p>
                </div>
                <div className="kb-item-actions">
                  {!i.is_active && <span className="badge">inativo</span>}
                  {canEdit && <button className="btn-link" onClick={() => setEditing(i)}>editar</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {editing && canEdit && <KBModal item={editing === 'new' ? undefined : editing}
        onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}

function KBModal({ item, onClose, onSaved }: { item?: KB; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    category: item?.category || 'faq', title: item?.title || '', content: item?.content || '', is_active: item?.is_active ?? true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (item) await apiFetch(`/api/knowledge?id=${item.id}`, { method: 'PATCH', body: JSON.stringify(f) });
      else await apiFetch('/api/knowledge', { method: 'POST', body: JSON.stringify(f) });
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setBusy(false); }
  }

  async function remove() {
    if (!item || !confirm('Excluir este conteúdo?')) return;
    await apiFetch(`/api/knowledge?id=${item.id}`, { method: 'DELETE' });
    onSaved();
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{item ? 'Editar conteúdo' : 'Novo conteúdo'}</h3>
        <form onSubmit={submit}>
          <label className="field"><span>Categoria</span>
            <select value={f.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
            </select></label>
          <label className="field"><span>Título *</span><input value={f.title} onChange={(e) => set('title', e.target.value)} required placeholder="Ex.: Prazo de produção" /></label>
          <label className="field"><span>Conteúdo *</span><textarea rows={5} value={f.content} onChange={(e) => set('content', e.target.value)} required placeholder="Ex.: O prazo de produção é de 5 a 10 dias úteis…" /></label>
          <label className="field-check"><input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} /><span>Ativo (a IA pode usar)</span></label>
          {error && <div className="alert-error">{error}</div>}
          <div className="form-actions">
            <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
            {item && <button type="button" className="btn-link danger" onClick={remove} style={{ marginLeft: 'auto' }}>Excluir</button>}
          </div>
        </form>
      </div>
    </div>
  );
}
