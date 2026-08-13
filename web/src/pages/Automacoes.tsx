import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import {
  NODE_DEFS, nodeOutputs, layout, validate, createEngine, uid,
  type FlowNode, type FlowEdge, type Flow, type Effect, type Issue,
} from '../lib/flowEngine';

interface Automation { id: string; name: string; trigger: any; is_active: boolean; }

const PALETTE = ['message', 'question', 'condition', 'delay', 'action', 'handoff', 'end'];
const NW = 172, NH = 60; // dimensões do card p/ desenhar as arestas

export default function Automacoes() {
  const { can } = useAuth();
  const [list, setList] = useState<Automation[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const canEdit = can('automations.write');

  async function load() {
    setLoading(true);
    try { const d = await apiFetch<{ automations: Automation[] }>('/api/automations'); setList(d.automations); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function create() {
    const d = await apiFetch<{ automation: Automation }>('/api/automations', { method: 'POST', body: JSON.stringify({ name: 'Novo fluxo' }) });
    setEditingId(d.automation.id);
  }

  if (editingId) return <FlowEditor id={editingId} onClose={() => { setEditingId(null); load(); }} />;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Automações</h1><p className="muted">Fluxos do robô — {loading ? '…' : `${list.length}`}. Construa, teste no simulador e ative.</p></div>
        {canEdit && <button className="btn btn-primary" onClick={create}>+ Novo fluxo</button>}
      </div>
      {error && <div className="alert-error">{error}</div>}
      <div className="card table-card">
        <table className="table">
          <thead><tr><th>Fluxo</th><th>Gatilho</th><th>Status</th></tr></thead>
          <tbody>
            {!loading && list.length === 0 && <tr><td colSpan={3} className="muted center">Nenhum fluxo ainda.</td></tr>}
            {list.map((a) => (
              <tr key={a.id} className="row-link" onClick={() => setEditingId(a.id)}>
                <td><strong>{a.name}</strong></td>
                <td>{a.trigger?.type || 'manual'}</td>
                <td><span className={`badge ${a.is_active ? 'badge-ok' : ''}`}>{a.is_active ? 'ativo' : 'pausado'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card"><p className="muted small">⚙️ O robô roda de verdade (dispara sozinho) quando ligarmos o <strong>worker de fila</strong> + o recebimento do WhatsApp (Fase 4b). Por ora, você já monta e <strong>testa no simulador</strong>.</p></div>
    </div>
  );
}

function FlowEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<any>({ type: 'manual', keywords: [] });
  const [active, setActive] = useState(false);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [drag, setDrag] = useState<any>(null);
  const [saved, setSaved] = useState(false);
  const [simOpen, setSimOpen] = useState(false);

  useEffect(() => {
    apiFetch<{ automation: Automation; graph: Flow }>(`/api/automations?id=${id}`).then((d) => {
      setName(d.automation.name); setTrigger(d.automation.trigger || { type: 'manual' }); setActive(d.automation.is_active);
      let ns = d.graph.nodes, es = d.graph.edges;
      if (!ns.some((n) => n.type === 'trigger')) {
        ns = [{ id: uid(), type: 'trigger', position: { x: 40, y: 40 }, data: { triggerType: 'manual' } }, ...ns];
      }
      setNodes(ns); setEdges(es);
    }).catch(() => {});
  }, [id]);

  const triggerNode = nodes.find((n) => n.type === 'trigger');
  const node = nodes.find((n) => n.id === selected) || null;

  function addNode(type: string) {
    const n: FlowNode = {
      id: uid(), type, position: { x: 80 + (nodes.length * 24) % 360, y: 180 },
      data: type === 'question' ? { text: '', options: [{ id: uid('o'), label: 'Opção 1' }] }
        : type === 'delay' ? { amount: 1, unit: 'day' }
        : type === 'action' ? { kind: 'add_tag', value: '' }
        : type === 'condition' ? { rules: [], logic: 'and' } : { text: '' },
    };
    setNodes((c) => [...c, n]); setSelected(n.id);
    // conecta o gatilho ao primeiro bloco automaticamente
    if (triggerNode && !edges.some((e) => e.source === triggerNode.id)) setEdge(triggerNode.id, 'out', n.id);
  }
  function updateData(nid: string, patch: any) { setNodes((c) => c.map((n) => n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)); }
  function removeNode(nid: string) { setNodes((c) => c.filter((n) => n.id !== nid)); setEdges((c) => c.filter((e) => e.source !== nid && e.target !== nid)); setSelected(null); }
  function getEdge(source: string, handle: string) { return edges.find((e) => e.source === source && (e.sourceHandle || 'out') === handle)?.target; }
  function setEdge(source: string, handle: string, target: string) {
    setEdges((c) => {
      const rest = c.filter((e) => !(e.source === source && (e.sourceHandle || 'out') === handle));
      return target ? [...rest, { id: uid('e'), source, sourceHandle: handle, target }] : rest;
    });
  }
  function autoLayout() { if (!triggerNode) return; const ns = nodes.map((n) => ({ ...n })); layout(ns, edges, triggerNode.id); setNodes(ns); }

  async function save() {
    setSaved(false);
    const graph = { nodes, edges };
    setIssues(validate(graph));
    await apiFetch(`/api/automations?id=${id}`, { method: 'PATCH', body: JSON.stringify({ name, trigger, is_active: active, graph }) });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  // Drag de nós
  function onMouseMove(e: React.MouseEvent) {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
    setNodes((c) => c.map((n) => n.id === drag.id ? { ...n, position: { x: Math.max(0, drag.ox + dx), y: Math.max(0, drag.oy + dy) } } : n));
  }

  const canvasW = Math.max(1000, ...nodes.map((n) => n.position.x + 240));
  const canvasH = Math.max(600, ...nodes.map((n) => n.position.y + 160));

  return (
    <div className="page flow-page">
      <div className="page-head">
        <div><p className="crumb"><button className="btn-link" onClick={onClose}>← Automações</button></p>
          <input className="flow-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="page-actions">
          <label className="field-check"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /><span>Ativo</span></label>
          <button className="btn btn-ghost" onClick={autoLayout}>Organizar</button>
          <button className="btn btn-ghost" onClick={() => setSimOpen(true)}>▶ Simular</button>
          <button className="btn btn-primary" onClick={save}>Salvar</button>
        </div>
      </div>

      {saved && <div className="alert-ok">Fluxo salvo ✓</div>}
      {issues.length > 0 && (
        <div className="flow-issues">
          {issues.map((it, i) => <div key={i} className={it.level === 'error' ? 'issue-err' : 'issue-warn'}>{it.level === 'error' ? '⛔' : '⚠️'} {it.msg}</div>)}
        </div>
      )}

      <div className="flow-wrap">
        <div className="flow-palette">
          <strong>Blocos</strong>
          {PALETTE.map((t) => (
            <button key={t} className="palette-btn" onClick={() => addNode(t)}>
              <span>{NODE_DEFS[t].ico}</span> {NODE_DEFS[t].label}
            </button>
          ))}
          <hr />
          <TriggerConfig trigger={trigger} setTrigger={setTrigger} />
        </div>

        <div className="flow-canvas" onMouseMove={onMouseMove} onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}>
          <div className="flow-inner" style={{ width: canvasW, height: canvasH }}>
            <svg className="flow-edges" width={canvasW} height={canvasH}>
              {edges.map((e) => {
                const s = nodes.find((n) => n.id === e.source), t = nodes.find((n) => n.id === e.target);
                if (!s || !t) return null;
                const sx = s.position.x + NW, sy = s.position.y + NH / 2, tx = t.position.x, ty = t.position.y + NH / 2;
                return <path key={e.id} d={`M ${sx} ${sy} C ${sx + 50} ${sy}, ${tx - 50} ${ty}, ${tx} ${ty}`} className="edge-path" />;
              })}
            </svg>
            {nodes.map((n) => (
              <div key={n.id} className={`flow-node ${selected === n.id ? 'sel' : ''}`}
                style={{ left: n.position.x, top: n.position.y, width: NW, borderColor: NODE_DEFS[n.type]?.color }}
                onMouseDown={(e) => { setSelected(n.id); setDrag({ id: n.id, startX: e.clientX, startY: e.clientY, ox: n.position.x, oy: n.position.y }); }}>
                <div className="flow-node-head" style={{ background: NODE_DEFS[n.type]?.color }}>
                  {NODE_DEFS[n.type]?.ico} {NODE_DEFS[n.type]?.label}
                </div>
                <div className="flow-node-body">{nodeSummary(n)}</div>
              </div>
            ))}
          </div>
        </div>

        {node && (
          <div className="flow-config">
            <NodeConfig node={node} nodes={nodes} updateData={updateData} getEdge={getEdge} setEdge={setEdge} removeNode={removeNode} />
          </div>
        )}
      </div>

      {simOpen && <Simulator graph={{ nodes, edges }} onClose={() => setSimOpen(false)} />}
    </div>
  );
}

function nodeSummary(n: FlowNode): string {
  if (n.type === 'trigger') return n.data.triggerType || 'manual';
  if (n.type === 'message') return (n.data.text || '(vazio)').slice(0, 40);
  if (n.type === 'question') return `${(n.data.options || []).length} opção(ões)`;
  if (n.type === 'delay') return `${n.data.amount} ${n.data.unit}`;
  if (n.type === 'action') return `${n.data.kind}: ${n.data.value || ''}`;
  if (n.type === 'condition') return `${(n.data.rules || []).length} regra(s)`;
  return '';
}

function NodeConfig({ node, nodes, updateData, getEdge, setEdge, removeNode }: any) {
  const targets = nodes.filter((n: FlowNode) => n.id !== node.id);
  const ConnectRow = ({ handle, label }: { handle: string; label: string }) => (
    <label className="field"><span>{label} →</span>
      <select value={getEdge(node.id, handle) || ''} onChange={(e) => setEdge(node.id, handle, e.target.value)}>
        <option value="">— nenhum —</option>
        {targets.map((t: FlowNode) => <option key={t.id} value={t.id}>{NODE_DEFS[t.type]?.ico} {nodeSummary(t) || NODE_DEFS[t.type]?.label}</option>)}
      </select></label>
  );

  return (
    <div>
      <div className="flow-config-head"><strong>{NODE_DEFS[node.type]?.ico} {NODE_DEFS[node.type]?.label}</strong>
        {node.type !== 'trigger' && <button className="btn-link danger" onClick={() => removeNode(node.id)}>excluir</button>}</div>
      {node.type === 'trigger' && <p className="muted small">Conecte o gatilho ao primeiro bloco do fluxo abaixo.</p>}

      {node.type === 'message' && (
        <label className="field"><span>Mensagem</span>
          <textarea rows={4} value={node.data.text || ''} onChange={(e) => updateData(node.id, { text: e.target.value })} placeholder="Olá {{nome}}! Como posso ajudar? 💛" /></label>
      )}
      {node.type === 'delay' && (
        <div className="row-inline">
          <input type="number" min={1} value={node.data.amount || 1} onChange={(e) => updateData(node.id, { amount: Number(e.target.value) })} style={{ width: 80 }} />
          <select value={node.data.unit || 'day'} onChange={(e) => updateData(node.id, { unit: e.target.value })}>
            <option value="minute">minutos</option><option value="hour">horas</option><option value="day">dias</option>
          </select>
        </div>
      )}
      {node.type === 'action' && (
        <>
          <label className="field"><span>Ação</span>
            <select value={node.data.kind || 'add_tag'} onChange={(e) => updateData(node.id, { kind: e.target.value })}>
              <option value="add_tag">Adicionar etiqueta</option><option value="remove_tag">Remover etiqueta</option>
              <option value="set_stage">Mover etapa do funil</option><option value="create_task">Criar tarefa</option>
            </select></label>
          <label className="field"><span>Valor</span><input value={node.data.value || ''} onChange={(e) => updateData(node.id, { value: e.target.value })} placeholder="ex.: VIP / nome da etapa / título da tarefa" /></label>
        </>
      )}
      {node.type === 'condition' && (
        <ConditionEditor node={node} updateData={updateData} />
      )}
      {node.type === 'handoff' && (
        <label className="field"><span>Aviso (opcional)</span>
          <input value={node.data.message || ''} onChange={(e) => updateData(node.id, { message: e.target.value })} placeholder="Vou te transferir para uma atendente 💛" /></label>
      )}
      {node.type === 'question' && (
        <QuestionEditor node={node} nodes={nodes} updateData={updateData} getEdge={getEdge} setEdge={setEdge} />
      )}

      {/* conexões de saída (exceto question, que conecta por opção) */}
      {node.type !== 'question' && nodeOutputs(node).map((h: string) => (
        <ConnectRow key={h} handle={h} label={h === 'yes' ? 'Se SIM' : h === 'no' ? 'Se NÃO' : 'Próximo'} />
      ))}
    </div>
  );
}

function ConditionEditor({ node, updateData }: any) {
  const rules = node.data.rules || [];
  const upd = (i: number, patch: any) => updateData(node.id, { rules: rules.map((r: any, j: number) => j === i ? { ...r, ...patch } : r) });
  return (
    <div>
      <label className="field"><span>Lógica</span>
        <select value={node.data.logic || 'and'} onChange={(e) => updateData(node.id, { logic: e.target.value })}>
          <option value="and">Todas as regras (E)</option><option value="or">Qualquer regra (OU)</option>
        </select></label>
      {rules.map((r: any, i: number) => (
        <div className="row-inline" key={i}>
          <input placeholder="campo/etiqueta" value={r.field || r.value || ''} onChange={(e) => upd(i, r.kind ? { value: e.target.value } : { field: e.target.value })} />
          <select value={r.op || 'contains'} onChange={(e) => upd(i, { op: e.target.value, kind: undefined })}>
            <option value="contains">contém</option><option value="eq">igual a</option><option value="filled">preenchido</option>
            <option value="gt">maior que</option><option value="lt">menor que</option>
          </select>
          {r.op !== 'filled' && r.op !== 'empty' && <input placeholder="valor" value={r.value || ''} onChange={(e) => upd(i, { value: e.target.value })} />}
          <button className="btn-link" onClick={() => updateData(node.id, { rules: rules.filter((_: any, j: number) => j !== i) })}>✕</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => updateData(node.id, { rules: [...rules, { field: '', op: 'contains', value: '' }] })}>+ Regra</button>
    </div>
  );
}

function QuestionEditor({ node, nodes, updateData, getEdge, setEdge }: any) {
  const options = node.data.options || [];
  const targets = nodes.filter((n: FlowNode) => n.id !== node.id);
  return (
    <div>
      <label className="field"><span>Pergunta</span>
        <textarea rows={2} value={node.data.text || ''} onChange={(e) => updateData(node.id, { text: e.target.value })} placeholder="O que você procura?" /></label>
      <span className="field-label">Opções (cada uma leva a um bloco)</span>
      {options.map((o: any, i: number) => (
        <div className="opt-row" key={o.id}>
          <input value={o.label} onChange={(e) => updateData(node.id, { options: options.map((x: any, j: number) => j === i ? { ...x, label: e.target.value } : x) })} />
          <select value={getEdge(node.id, o.id) || ''} onChange={(e) => setEdge(node.id, o.id, e.target.value)}>
            <option value="">→ nenhum</option>
            {targets.map((t: FlowNode) => <option key={t.id} value={t.id}>{NODE_DEFS[t.type]?.ico} {nodeSummary(t) || NODE_DEFS[t.type]?.label}</option>)}
          </select>
          <button className="btn-link" onClick={() => updateData(node.id, { options: options.filter((_: any, j: number) => j !== i) })}>✕</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => updateData(node.id, { options: [...options, { id: uid('o'), label: `Opção ${options.length + 1}` }] })}>+ Opção</button>
    </div>
  );
}

function TriggerConfig({ trigger, setTrigger }: any) {
  return (
    <div>
      <strong>Gatilho</strong>
      <label className="field"><span>Disparar quando</span>
        <select value={trigger.type || 'manual'} onChange={(e) => setTrigger({ ...trigger, type: e.target.value })}>
          <option value="manual">Manual</option>
          <option value="keyword">Palavra-chave</option>
          <option value="new_conversation">Nova conversa</option>
          <option value="stage">Entrar em etapa do funil</option>
        </select></label>
      {trigger.type === 'keyword' && (
        <label className="field"><span>Palavras (vírgula)</span>
          <input value={(trigger.keywords || []).join(', ')}
            onChange={(e) => setTrigger({ ...trigger, keywords: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })}
            placeholder="oi, orçamento, preço" /></label>
      )}
    </div>
  );
}

function Simulator({ graph, onClose }: { graph: Flow; onClose: () => void }) {
  const [log, setLog] = useState<{ who: string; text: string; options?: any[] }[]>([]);
  const [engine, setEngine] = useState<any>(null);
  const [input, setInput] = useState('');
  const [awaiting, setAwaiting] = useState<string>('');

  function render(res: any) {
    const items: any[] = [];
    res.effects.forEach((fx: Effect) => {
      if (fx.kind === 'message') items.push({ who: 'bot', text: fx.text || '' });
      else if (fx.kind === 'ask') items.push({ who: 'bot', text: fx.text || '', options: fx.options });
      else if (fx.kind === 'delay') items.push({ who: 'sys', text: `⏱️ espera ${fx.data?.amount} ${fx.data?.unit}` });
      else if (fx.kind === 'action') items.push({ who: 'sys', text: `⚙️ ação: ${fx.data?.kind} ${fx.data?.value || ''}` });
      else if (fx.kind === 'debug') items.push({ who: 'sys', text: fx.text || '' });
      else if (fx.kind === 'handoff') items.push({ who: 'sys', text: '🙋 transferido para humano' });
      else if (fx.kind === 'input') items.push({ who: 'bot', text: fx.text || '' });
      else if (fx.kind === 'end') items.push({ who: 'sys', text: '🏁 fim do fluxo' });
    });
    setLog((l) => [...l, ...items]);
    setAwaiting(res.status === 'await_input' ? 'input' : res.status === 'await_option' ? 'option' : '');
  }

  function start() {
    setLog([{ who: 'sys', text: '▶ fluxo iniciado' }]);
    const eng = createEngine(graph, { fill: (t) => (t || '').replace(/\{\{(\w+)\}\}/g, (_m, k) => ({ nome: 'Maria', produto: 'Jardim Rosa' } as any)[k] || `{${k}}`) });
    setEngine(eng);
    render(eng.start());
  }
  function choose(id: string, label: string) { setLog((l) => [...l, { who: 'user', text: label }]); render(engine.choose(id)); }
  function sendInput(e: FormEvent) { e.preventDefault(); if (!input.trim()) return; setLog((l) => [...l, { who: 'user', text: input }]); const v = input; setInput(''); render(engine.provideInput(v)); }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal sim-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flow-config-head"><strong>▶ Simulador (não envia nada real)</strong><button className="btn-link" onClick={onClose}>fechar</button></div>
        <div className="sim-chat">
          {log.length === 0 && <p className="muted center">Clique em “Iniciar” para testar o fluxo.</p>}
          {log.map((m, i) => (
            <div key={i} className={`sim-msg ${m.who}`}>
              <div>{m.text}</div>
              {m.options && <div className="sim-opts">{m.options.map((o: any) => <button key={o.id} className="chip" onClick={() => choose(o.id, o.label)}>{o.label}</button>)}</div>}
            </div>
          ))}
        </div>
        {awaiting === 'input' && (
          <form className="thread-compose" onSubmit={sendInput}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Resposta do cliente…" />
            <button className="btn btn-primary">Enviar</button>
          </form>
        )}
        <div className="form-actions"><button className="btn btn-ghost" onClick={start}>Iniciar</button></div>
      </div>
    </div>
  );
}
