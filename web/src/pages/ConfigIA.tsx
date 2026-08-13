import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

interface Settings {
  agent_name: string; persona: string | null; formality: string;
  max_discount_pct: number; forbidden_topics: string[] | null;
}

export default function ConfigIA() {
  const { can } = useAuth();
  const canEdit = can('ai.configure');
  const [f, setF] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    apiFetch<{ settings: Settings }>('/api/ai-settings').then((d) => setF(d.settings)).catch((e) => setError(String(e)));
  }, []);

  if (!f) return <div className="page"><p className="muted">Carregando…</p></div>;
  const set = (k: keyof Settings, v: unknown) => setF((s) => s ? { ...s, [k]: v } : s);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!f) return;
    setBusy(true); setError(''); setSaved(false);
    try {
      await apiFetch('/api/ai-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          agent_name: f.agent_name, persona: f.persona, formality: f.formality,
          max_discount_pct: f.max_discount_pct,
          forbidden_topics: Array.isArray(f.forbidden_topics) ? f.forbidden_topics
            : String(f.forbidden_topics || '').split('\n').map((s) => s.trim()).filter(Boolean),
        }),
      });
      setSaved(true);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setBusy(false); }
  }

  const forbidden = Array.isArray(f.forbidden_topics) ? f.forbidden_topics.join('\n') : (f.forbidden_topics || '');

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Atendente virtual (IA)</h1><p className="muted">Personalidade e regras. A IA sempre usa a Base de Conhecimento como fonte.</p></div>
      </div>

      {!canEdit && <div className="alert-error">Você pode visualizar, mas só um admin edita as configurações da IA.</div>}
      {error && <div className="alert-error">{error}</div>}
      {saved && <div className="alert-ok">Configurações salvas ✓</div>}

      <form className="card" onSubmit={save} style={{ maxWidth: 640 }}>
        <label className="field"><span>Nome da atendente</span>
          <input value={f.agent_name} disabled={!canEdit} onChange={(e) => set('agent_name', e.target.value)} /></label>
        <label className="field"><span>Personalidade / tom de voz</span>
          <textarea rows={3} value={f.persona || ''} disabled={!canEdit} onChange={(e) => set('persona', e.target.value)}
            placeholder="Ex.: Simpática, acolhedora e delicada. Trata a cliente por você, usa emojis com moderação." /></label>
        <label className="field"><span>Formalidade</span>
          <select value={f.formality} disabled={!canEdit} onChange={(e) => set('formality', e.target.value)}>
            <option value="informal">Informal</option>
            <option value="cordial">Cordial</option>
            <option value="formal">Formal</option>
          </select></label>
        <label className="field"><span>Desconto máximo que a IA pode citar (%)</span>
          <input type="number" min={0} max={100} step={1} value={f.max_discount_pct} disabled={!canEdit}
            onChange={(e) => set('max_discount_pct', Number(e.target.value))} /></label>
        <label className="field"><span>Assuntos que a IA NÃO deve tratar (um por linha)</span>
          <textarea rows={3} value={forbidden} disabled={!canEdit}
            onChange={(e) => set('forbidden_topics', e.target.value.split('\n'))}
            placeholder={'reclamações graves\nquestões jurídicas\nreembolsos'} /></label>

        {canEdit && <button className="btn btn-primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>}
      </form>

      <div className="card" style={{ maxWidth: 640 }}>
        <h3>Como a IA funciona</h3>
        <ul className="status-list">
          <li>📚 Responde com base na <strong>Base de Conhecimento</strong> e no catálogo — nunca inventa.</li>
          <li>✍️ No Inbox, gera uma <strong>resposta sugerida</strong> — você revisa e envia (modo rascunho).</li>
          <li>🔒 Ações críticas (etiqueta, reembolso, desconto fora da regra) exigem aprovação humana.</li>
          <li>🔑 Para ativar, cadastre a variável <code>ANTHROPIC_API_KEY</code> no Netlify.</li>
        </ul>
      </div>
    </div>
  );
}
