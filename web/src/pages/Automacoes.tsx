import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import {
  NODE_DEFS, nodeOutputs, handleLabel, layout, validate, createEngine, uid,
  type FlowNode, type FlowEdge, type Flow, type Effect, type Issue,
} from '../lib/flowEngine';

interface Automation { id: string; name: string; trigger: any; is_active: boolean; }

const PALETTE = ['message', 'question', 'condition', 'random', 'delay', 'action', 'handoff', 'end'];
const NW = 200, HEAD_H = 46, ROW_H = 24;

function isTerminal(t: string) { return t === 'handoff' || t === 'end'; }
function nodeHeight(n: FlowNode) { return HEAD_H + (isTerminal(n.type) ? 0 : Math.max(1, nodeOutputs(n).length) * ROW_H); }
function portOut(n: FlowNode, i: number) { return { x: n.position.x + NW, y: n.position.y + HEAD_H + i * ROW_H + ROW_H / 2 }; }
function portIn(n: FlowNode) { return { x: n.position.x, y: n.position.y + HEAD_H / 2 }; }

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
        <div><h1>Automações</h1><p className="muted">Fluxos do robô — {loading ? '…' : `${list.length}`}. Construa arrastando os blocos, conecte as portas e teste no simulador.</p></div>
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
      <div className="card"><p className="muted small">⚙️ O robô dispara sozinho quando ligarmos o <strong>worker de fila</strong> + o recebimento do WhatsApp. Por ora, monte e <strong>teste no simulador</strong>.</p></div>
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
  const [saved, setSaved] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [drag, setDrag] = useState<any>(null);
  const [connecting, setConnecting] = useState<any>(null);
  const [panning, setPanning] = useState<any>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<{ automation: Automation; graph: Flow }>(`/api/automations?id=${id}`).then((d) => {
      setName(d.automation.name); setTrigger(d.automation.trigger || { type: 'manual' }); setActive(d.automation.is_active);
      let ns = d.graph.nodes, es = d.graph.edges;
      if (!ns.some((n) => n.type === 'trigger')) ns = [{ id: uid(), type: 'trigger', position: { x: 40, y: 60 }, data: { triggerType: 'manual' } }, ...ns];
      setNodes(ns); setEdges(es);
    }).catch(() => {});
  }, [id]);

  const triggerNode = nodes.find((n) => n.type === 'trigger');
  const node = nodes.find((n) => n.id === selected) || null;

  function canvasPoint(e: MouseEvent) {
    const el = canvasRef.current!; const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left + el.scrollLeft, y: e.clientY - r.top + el.scrollTop };
  }

  function addNode(type: string) {
    const p = canvasRef.current;
    const base = p ? { x: p.scrollLeft + 120, y: p.scrollTop + 120 } : { x: 120, y: 120 };
    const n: FlowNode = {
      id: uid(), type, position: { x: base.x + (nodes.length * 18) % 200, y: base.y },
      data: type === 'question' ? { text: '', options: [{ id: uid('o'), label: 'Opção 1' }] }
        : type === 'random' ? { branches: [{ id: uid('b'), label: 'A' }, { id: uid('b'), label: 'B' }] }
        : type === 'delay' ? { amount: 1, unit: 'day' }
        : type === 'action' ? { kind: 'add_tag', value: '' }
        : type === 'condition' ? { rules: [], logic: 'and' }
        : type === 'message' ? { text: '', imageUrl: '' } : {},
    };
    setNodes((c) => [...c, n]); setSelected(n.id);
    if (triggerNode && !edges.some((e) => e.source === triggerNode.id)) setEdge(triggerNode.id, 'out', n.id);
  }
  function updateData(nid: string, patch: any) { setNodes((c) => c.map((n) => n.id === nid ? { ...n, data: { ...n.data, ...patch } } : n)); }
  function removeNode(nid: string) { setNodes((c) => c.filter((n) => n.id !== nid)); setEdges((c) => c.filter((e) => e.source !== nid && e.target !== nid)); setSelected(null); }
  function getEdge(source: string, handle: string) { return edges.find((e) => e.source === source && (e.sourceHandle || 'out') === handle)?.target; }
  function setEdge(source: string, handle: string, target: string) {
    if (source === target) return;
    setEdges((c) => {
      const rest = c.filter((e) => !(e.source === source && (e.sourceHandle || 'out') === handle));
      return target ? [...rest, { id: uid('e'), source, sourceHandle: handle, target }] : rest;
    });
  }
  function removeEdge(edgeId: string) { setEdges((c) => c.filter((e) => e.id !== edgeId)); }
  function autoLayout() { if (!triggerNode) return; const ns = nodes.map((n) => ({ ...n })); layout(ns, edges, triggerNode.id); setNodes(ns); }

  async function save() {
    setSaved(false);
    const graph = { nodes, edges };
    setIssues(validate(graph));
    await apiFetch(`/api/automations?id=${id}`, { method: 'PATCH', body: JSON.stringify({ name, trigger, is_active: active, graph }) });
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  }

  // ---- interações do canvas ----
  function onCanvasMouseDown(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (!t.closest('.flow-node')) { // fundo → pan
      const el = canvasRef.current!;
      setPanning({ startX: e.clientX, startY: e.clientY, sl: el.scrollLeft, st: el.scrollTop });
      setSelected(null);
    }
  }
  function onCanvasMouseMove(e: MouseEvent) {
    if (connecting) { const p = canvasPoint(e); setConnecting((c: any) => c ? { ...c, x: p.x, y: p.y } : c); return; }
    if (drag) {
      const dx = e.clientX - drag.startX, dy = e.clientY - drag.startY;
      setNodes((c) => c.map((n) => n.id === drag.id ? { ...n, position: { x: Math.max(0, drag.ox + dx), y: Math.max(0, drag.oy + dy) } } : n));
      return;
    }
    if (panning) { const el = canvasRef.current!; el.scrollLeft = panning.sl - (e.clientX - panning.startX); el.scrollTop = panning.st - (e.clientY - panning.startY); }
  }
  function endInteractions() { setDrag(null); setConnecting(null); setPanning(null); }

  function startNodeDrag(e: MouseEvent, n: FlowNode) {
    setSelected(n.id);
    setDrag({ id: n.id, startX: e.clientX, startY: e.clientY, ox: n.position.x, oy: n.position.y });
  }
  function startConnect(e: MouseEvent, source: string, handle: string) {
    e.stopPropagation(); e.preventDefault();
    const p = canvasPoint(e); setConnecting({ source, handle, x: p.x, y: p.y });
  }
  function finishConnect(target: string) {
    if (connecting) { setEdge(connecting.source, connecting.handle, target); setConnecting(null); }
  }

  const canvasW = Math.max(1200, ...nodes.map((n) => n.position.x + NW + 80));
  const canvasH = Math.max(700, ...nodes.map((n) => n.position.y + nodeHeight(n) + 80));

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
        <div className="flow-issues">{issues.map((it, i) => <div key={i} className={it.level === 'error' ? 'issue-err' : 'issue-warn'}>{it.level === 'error' ? '⛔' : '⚠️'} {it.msg}</div>)}</div>
      )}

      <div className="flow-wrap">
        <div className="flow-palette">
          <strong>Blocos</strong>
          {PALETTE.map((t) => (
            <button key={t} className="palette-btn" onClick={() => addNode(t)}><span>{NODE_DEFS[t].ico}</span> {NODE_DEFS[t].label}</button>
          ))}
          <hr />
          <TriggerConfig trigger={trigger} setTrigger={setTrigger} />
          <p className="muted small" style={{ marginTop: 10 }}>💡 Arraste a bolinha da direita de um bloco até outro para conectar. Clique numa linha para apagá-la.</p>
        </div>

        <div className="flow-canvas" ref={canvasRef}
          onMouseDown={onCanvasMouseDown} onMouseMove={onCanvasMouseMove} onMouseUp={endInteractions} onMouseLeave={endInteractions}>
          <div className="flow-inner" style={{ width: canvasW, height: canvasH }}>
            <svg className="flow-edges" width={canvasW} height={canvasH}>
              {edges.map((e) => {
                const s = nodes.find((n) => n.id === e.source), t = nodes.find((n) => n.id === e.target);
                if (!s || !t) return null;
                const i = Math.max(0, nodeOutputs(s).indexOf(e.sourceHandle || 'out'));
                const a = portOut(s, i), b = portIn(t);
                const d = `M ${a.x} ${a.y} C ${a.x + 60} ${a.y}, ${b.x - 60} ${b.y}, ${b.x} ${b.y}`;
                return (
                  <g key={e.id} className="edge-g" onClick={() => removeEdge(e.id)}>
                    <path d={d} className="edge-hit" />
                    <path d={d} className="edge-path" />
                  </g>
                );
              })}
              {connecting && (() => {
                const s = nodes.find((n) => n.id === connecting.source); if (!s) return null;
                const i = Math.max(0, nodeOutputs(s).indexOf(connecting.handle));
                const a = portOut(s, i);
                return <path d={`M ${a.x} ${a.y} C ${a.x + 60} ${a.y}, ${connecting.x - 60} ${connecting.y}, ${connecting.x} ${connecting.y}`} className="edge-temp" />;
              })()}
            </svg>

            {nodes.map((n) => (
              <div key={n.id} className={`flow-node ${selected === n.id ? 'sel' : ''}`}
                style={{ left: n.position.x, top: n.position.y, width: NW, borderColor: NODE_DEFS[n.type]?.color }}
                onMouseDown={(e) => startNodeDrag(e, n)} onMouseUp={() => finishConnect(n.id)}>
                <div className="port port-in" title="entrada" />
                <div className="flow-node-head" style={{ background: NODE_DEFS[n.type]?.color }}>
                  <span>{NODE_DEFS[n.type]?.ico} {NODE_DEFS[n.type]?.label}</span>
                </div>
                <div className="flow-node-preview">{nodeSummary(n)}</div>
                {!isTerminal(n.type) && (
                  <div className="flow-node-outs">
                    {nodeOutputs(n).map((h) => (
                      <div className="out-row" key={h}>
                        <span className="out-label">{handleLabel(n, h)}</span>
                        <div className="port port-out" title="arraste para conectar" onMouseDown={(e) => startConnect(e, n.id, h)} />
                      </div>
                    ))}
                  </div>
                )}
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
  if (n.type === 'trigger') return `disparo: ${n.data.triggerType || 'manual'}`;
  if (n.type === 'message') return (n.data.imageUrl ? '🖼️ ' : '') + (n.data.text || '(sem texto)').slice(0, 46);
  if (n.type === 'question') return `${(n.data.options || []).length} opção(ões)`;
  if (n.type === 'random') return `${(n.data.branches || []).length} caminhos`;
  if (n.type === 'delay') return `esperar ${n.data.amount} ${n.data.unit}`;
  if (n.type === 'action') return `${n.data.kind}${n.data.value ? ': ' + n.data.value : ''}`;
  if (n.type === 'condition') return `${(n.data.rules || []).length} regra(s)`;
  if (n.type === 'handoff') return 'transfere p/ humano';
  if (n.type === 'end') return 'fim';
  return '';
}

function NodeConfig({ node, nodes, updateData, getEdge, setEdge, removeNode }: any) {
  const targets = nodes.filter((n: FlowNode) => n.id !== node.id);
  const opt = (t: FlowNode) => <option key={t.id} value={t.id}>{NODE_DEFS[t.type]?.ico} {nodeSummary(t) || NODE_DEFS[t.type]?.label}</option>;
  const Connect = ({ handle, label }: { handle: string; label: string }) => (
    <label className="field"><span>{label} →</span>
      <select value={getEdge(node.id, handle) || ''} onChange={(e) => setEdge(node.id, handle, e.target.value)}>
        <option value="">— nenhum —</option>{targets.map(opt)}
      </select></label>
  );

  return (
    <div>
      <div className="flow-config-head"><strong>{NODE_DEFS[node.type]?.ico} {NODE_DEFS[node.type]?.label}</strong>
        {node.type !== 'trigger' && <button className="btn-link danger" onClick={() => removeNode(node.id)}>excluir</button>}</div>
      {node.type === 'trigger' && <p className="muted small">Conecte a porta do gatilho ao primeiro bloco.</p>}

      {node.type === 'message' && (<>
        <label className="field"><span>Mensagem</span>
          <textarea rows={4} value={node.data.text || ''} onChange={(e) => updateData(node.id, { text: e.target.value })} placeholder="Olá {{nome}}! Como posso ajudar? 💛" /></label>
        <label className="field"><span>Imagem (URL, opcional)</span>
          <input value={node.data.imageUrl || ''} onChange={(e) => updateData(node.id, { imageUrl: e.target.value })} placeholder="https://…/foto.jpg" /></label>
      </>)}
      {node.type === 'delay' && (
        <div className="row-inline">
          <input type="number" min={1} value={node.data.amount || 1} onChange={(e) => updateData(node.id, { amount: Number(e.target.value) })} style={{ width: 80 }} />
          <select value={node.data.unit || 'day'} onChange={(e) => updateData(node.id, { unit: e.target.value })}>
            <option value="minute">minutos</option><option value="hour">horas</option><option value="day">dias</option>
          </select>
        </div>
      )}
      {node.type === 'action' && (<>
        <label className="field"><span>Ação</span>
          <select value={node.data.kind || 'add_tag'} onChange={(e) => updateData(node.id, { kind: e.target.value })}>
            <option value="add_tag">Adicionar etiqueta</option><option value="remove_tag">Remover etiqueta</option>
            <option value="set_stage">Mover etapa do funil</option><option value="set_field">Definir campo</option>
            <option value="create_task">Criar tarefa</option><option value="notify">Avisar equipe</option>
          </select></label>
        <label className="field"><span>Valor</span><input value={node.data.value || ''} onChange={(e) => updateData(node.id, { value: e.target.value })} placeholder="ex.: VIP / etapa / título" /></label>
      </>)}
      {node.type === 'condition' && <ConditionEditor node={node} updateData={updateData} />}
      {node.type === 'handoff' && (
        <label className="field"><span>Aviso (opcional)</span>
          <input value={node.data.message || ''} onChange={(e) => updateData(node.id, { message: e.target.value })} placeholder="Vou te transferir para uma atendente 💛" /></label>
      )}
      {node.type === 'question' && <BranchEditor node={node} nodes={nodes} updateData={updateData} getEdge={getEdge} setEdge={setEdge} field="options" title="Opções / botões" />}
      {node.type === 'random' && <BranchEditor node={node} nodes={nodes} updateData={updateData} getEdge={getEdge} setEdge={setEdge} field="branches" title="Caminhos (A/B)" />}

      {node.type !== 'question' && node.type !== 'random' && nodeOutputs(node).map((h: string) => (
        <Connect key={h} handle={h} label={h === 'yes' ? 'Se SIM' : h === 'no' ? 'Se NÃO' : 'Próximo'} />
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
          <option value="and">Todas (E)</option><option value="or">Qualquer (OU)</option>
        </select></label>
      {rules.map((r: any, i: number) => (
        <div className="row-inline" key={i}>
          <input placeholder="campo" value={r.field || ''} onChange={(e) => upd(i, { field: e.target.value })} />
          <select value={r.op || 'contains'} onChange={(e) => upd(i, { op: e.target.value })}>
            <option value="contains">contém</option><option value="eq">igual</option><option value="filled">preenchido</option>
            <option value="gt">maior</option><option value="lt">menor</option>
          </select>
          {r.op !== 'filled' && r.op !== 'empty' && <input placeholder="valor" value={r.value || ''} onChange={(e) => upd(i, { value: e.target.value })} />}
          <button className="btn-link" onClick={() => updateData(node.id, { rules: rules.filter((_: any, j: number) => j !== i) })}>✕</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => updateData(node.id, { rules: [...rules, { field: '', op: 'contains', value: '' }] })}>+ Regra</button>
    </div>
  );
}

function BranchEditor({ node, nodes, updateData, getEdge, setEdge, field, title }: any) {
  const items = node.data[field] || [];
  const targets = nodes.filter((n: FlowNode) => n.id !== node.id);
  const idPrefix = field === 'options' ? 'o' : 'b';
  return (
    <div>
      {field === 'options' && (
        <label className="field"><span>Pergunta</span>
          <textarea rows={2} value={node.data.text || ''} onChange={(e) => updateData(node.id, { text: e.target.value })} placeholder="O que você procura?" /></label>
      )}
      <span className="field-label">{title}</span>
      {items.map((o: any, i: number) => (
        <div className="opt-row" key={o.id}>
          <input value={o.label} onChange={(e) => updateData(node.id, { [field]: items.map((x: any, j: number) => j === i ? { ...x, label: e.target.value } : x) })} />
          <select value={getEdge(node.id, o.id) || ''} onChange={(e) => setEdge(node.id, o.id, e.target.value)}>
            <option value="">→ nenhum</option>
            {targets.map((t: FlowNode) => <option key={t.id} value={t.id}>{NODE_DEFS[t.type]?.ico} {nodeSummary(t) || NODE_DEFS[t.type]?.label}</option>)}
          </select>
          <button className="btn-link" onClick={() => updateData(node.id, { [field]: items.filter((_: any, j: number) => j !== i) })}>✕</button>
        </div>
      ))}
      <button className="btn btn-ghost btn-sm" onClick={() => updateData(node.id, { [field]: [...items, { id: uid(idPrefix), label: field === 'options' ? `Opção ${items.length + 1}` : String.fromCharCode(65 + items.length) }] })}>+ Adicionar</button>
    </div>
  );
}

function TriggerConfig({ trigger, setTrigger }: any) {
  return (
    <div>
      <strong>Gatilho</strong>
      <label className="field"><span>Disparar quando</span>
        <select value={trigger.type || 'manual'} onChange={(e) => setTrigger({ ...trigger, type: e.target.value })}>
          <option value="manual">Manual</option><option value="keyword">Palavra-chave</option>
          <option value="new_conversation">Nova conversa</option><option value="stage">Entrar em etapa</option>
        </select></label>
      {trigger.type === 'keyword' && (
        <label className="field"><span>Palavras (vírgula)</span>
          <input value={(trigger.keywords || []).join(', ')} onChange={(e) => setTrigger({ ...trigger, keywords: e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean) })} placeholder="oi, orçamento, preço" /></label>
      )}
    </div>
  );
}

function Simulator({ graph, onClose }: { graph: Flow; onClose: () => void }) {
  const [log, setLog] = useState<{ who: string; text: string; image?: string | null; options?: any[] }[]>([]);
  const [engine, setEngine] = useState<any>(null);
  const [input, setInput] = useState('');
  const [awaiting, setAwaiting] = useState<string>('');

  function render(res: any) {
    const items: any[] = [];
    res.effects.forEach((fx: Effect) => {
      if (fx.kind === 'message') items.push({ who: 'bot', text: fx.text || '', image: fx.image });
      else if (fx.kind === 'ask') items.push({ who: 'bot', text: fx.text || '', options: fx.options });
      else if (fx.kind === 'delay') items.push({ who: 'sys', text: `⏱️ espera ${fx.data?.amount} ${fx.data?.unit}` });
      else if (fx.kind === 'action') items.push({ who: 'sys', text: `⚙️ ${fx.data?.kind} ${fx.data?.value || ''}` });
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
    setEngine(eng); render(eng.start());
  }
  function choose(idv: string, label: string) { setLog((l) => [...l, { who: 'user', text: label }]); render(engine.choose(idv)); }
  function sendInput(e: FormEvent) { e.preventDefault(); if (!input.trim()) return; setLog((l) => [...l, { who: 'user', text: input }]); const v = input; setInput(''); render(engine.provideInput(v)); }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal sim-modal" onClick={(e) => e.stopPropagation()}>
        <div className="flow-config-head"><strong>▶ Simulador (não envia nada real)</strong><button className="btn-link" onClick={onClose}>fechar</button></div>
        <div className="sim-chat">
          {log.length === 0 && <p className="muted center">Clique em “Iniciar” para testar.</p>}
          {log.map((m, i) => (
            <div key={i} className={`sim-msg ${m.who}`}>
              {m.image && <img src={m.image} alt="" style={{ maxWidth: '100%', borderRadius: 8, marginBottom: 4 }} />}
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
