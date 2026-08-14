/* =============================================================================
   flowEngine.ts — motor de automação (porte TS do crm/js/flow-graph.js).
   Isomórfico e sem dependência de DOM: alimenta o SIMULADOR agora e servirá
   ao worker do servidor depois. Modelo grafo (nodes + edges) — §23/§34.
   ============================================================================= */

export interface FlowNode { id: string; type: string; position: { x: number; y: number }; data: any; }
export interface FlowEdge { id: string; source: string; sourceHandle?: string; target: string; }
export interface Flow { id?: string; name?: string; status?: string; nodes: FlowNode[]; edges: FlowEdge[]; }

export interface NodeDef { label: string; ico: string; color: string; group: string; outputs: string[] | 'dynamic'; }

export const NODE_DEFS: Record<string, NodeDef> = {
  trigger:    { label: 'Gatilho',             ico: '⚡', color: '#E0A24E', group: 'Início',      outputs: ['out'] },
  message:    { label: 'Enviar mensagem',     ico: '💬', color: '#25D366', group: 'Comunicação', outputs: ['out'] },
  question:   { label: 'Pergunta / opções',   ico: '🔀', color: '#9B7BB8', group: 'Interação',   outputs: 'dynamic' },
  wait_input: { label: 'Aguardar resposta',   ico: '⌨️', color: '#5B8C6E', group: 'Interação',   outputs: ['out'] },
  condition:  { label: 'Condição (SE)',       ico: '❓', color: '#7BA7BC', group: 'Lógica',      outputs: ['yes', 'no'] },
  random:     { label: 'Randômico (A/B)',     ico: '🎲', color: '#7BA7BC', group: 'Lógica',      outputs: 'dynamic' },
  delay:      { label: 'Esperar',             ico: '⏱️', color: '#E0A24E', group: 'Tempo',       outputs: ['out'] },
  action:     { label: 'Ação no CRM',         ico: '⚙️', color: '#C06B4E', group: 'CRM',         outputs: ['out'] },
  handoff:    { label: 'Transferir p/ humano', ico: '🙋', color: '#B5544B', group: 'Fluxo',      outputs: [] },
  end:        { label: 'Encerrar',            ico: '🏁', color: '#7A6A61', group: 'Fluxo',       outputs: [] },
};

export function uid(p = 'n'): string { return p + Math.random().toString(36).slice(2, 9); }

export function nodeOutputs(node: FlowNode): string[] {
  if (node.type === 'question') return (node.data.options || []).map((o: any) => o.id);
  if (node.type === 'random') return (node.data.branches || []).map((b: any) => b.id);
  const def = NODE_DEFS[node.type];
  return def && Array.isArray(def.outputs) ? def.outputs : ['out'];
}

/** Rótulo amigável de uma saída (handle) para a UI. */
export function handleLabel(node: FlowNode, handle: string): string {
  if (handle === 'yes') return 'Se SIM';
  if (handle === 'no') return 'Se NÃO';
  if (node.type === 'question') return (node.data.options || []).find((o: any) => o.id === handle)?.label || 'Opção';
  if (node.type === 'random') return (node.data.branches || []).find((b: any) => b.id === handle)?.label || 'Caminho';
  return 'Próximo';
}

/* Layout automático em camadas (profundidade = X, ramo = Y). */
export function layout(nodes: FlowNode[], edges: FlowEdge[], rootId: string) {
  const COL = 230, ROW = 120;
  const depth: Record<string, number> = {}, seen: Record<string, boolean> = {};
  (function walk(id: string, d: number) {
    if (seen[id]) { depth[id] = Math.max(depth[id] || 0, d); return; }
    seen[id] = true; depth[id] = d;
    edges.filter((e) => e.source === id).forEach((e) => walk(e.target, d + 1));
  })(rootId, 0);
  const rowCount: Record<number, number> = {};
  nodes.forEach((n) => {
    const d = depth[n.id] || 0; rowCount[d] = rowCount[d] || 0;
    n.position = { x: 40 + d * COL, y: 30 + rowCount[d] * ROW }; rowCount[d]++;
  });
}

export interface Effect { kind: string; text?: string; image?: string | null; options?: { id: string; label: string }[]; data?: any; }
export interface RunResult { effects: Effect[]; status: string; }
export interface EngineHooks { fill?: (t: string) => string; applyAction?: (d: any, ctx: any) => void; context?: any; }

/* Motor de execução — percorre o grafo emitindo efeitos (mensagens, perguntas…). */
export function createEngine(graph: Flow, hooks: EngineHooks = {}) {
  const byId = (id: string | null) => graph.nodes.find((n) => n.id === id) || null;
  const outTarget = (nodeId: string, handle?: string): string | null => {
    const e = graph.edges.find((ed) => ed.source === nodeId &&
      (handle ? ed.sourceHandle === handle : (ed.sourceHandle === 'out' || !ed.sourceHandle)));
    return e ? e.target : null;
  };
  const fill = (t: string) => (hooks.fill ? hooks.fill(t) : (t || ''));
  const S: any = { cursor: null, pending: null, context: hooks.context || { vars: {}, tags: [], fields: {} } };

  function run(): RunResult {
    const fx: Effect[] = [];
    let guard = 0;
    while (S.cursor && guard++ < 500) {
      const node = byId(S.cursor); if (!node) { S.cursor = null; break; }
      const d = node.data || {};
      switch (node.type) {
        case 'message': fx.push({ kind: 'message', text: fill(d.text), image: d.imageUrl || null }); S.cursor = outTarget(node.id); break;
        case 'delay': fx.push({ kind: 'delay', data: d }); S.cursor = outTarget(node.id); break;
        case 'random': {
          const branches = d.branches || [];
          const pick = branches.length ? branches[Math.floor(Math.random() * branches.length)] : null;
          fx.push({ kind: 'debug', text: 'Randômico → ' + (pick ? pick.label : '—') });
          S.cursor = pick ? outTarget(node.id, pick.id) : null; break;
        }
        case 'action': if (hooks.applyAction) hooks.applyAction(d, S.context); fx.push({ kind: 'action', data: d }); S.cursor = outTarget(node.id); break;
        case 'condition': { const res = evalCondition(d, S.context); fx.push({ kind: 'debug', text: 'Condição → ' + (res ? 'SIM' : 'NÃO') }); S.cursor = outTarget(node.id, res ? 'yes' : 'no'); break; }
        case 'question': fx.push({ kind: 'ask', text: fill(d.text), options: (d.options || []).map((o: any) => ({ id: o.id, label: o.label })) }); S.pending = node; return { effects: fx, status: 'await_option' };
        case 'wait_input': fx.push({ kind: 'input', text: fill(d.text || '') }); S.pending = node; return { effects: fx, status: 'await_input' };
        case 'handoff': fx.push({ kind: 'handoff', data: d }); S.cursor = null; return { effects: fx, status: 'handoff' };
        case 'end': fx.push({ kind: 'end' }); S.cursor = null; return { effects: fx, status: 'ended' };
        default: S.cursor = outTarget(node.id);
      }
      if (!S.cursor) break;
    }
    return { effects: fx, status: 'ended' };
  }
  function start(): RunResult {
    const trig = graph.nodes.find((n) => n.type === 'trigger') || graph.nodes[0];
    S.cursor = trig ? outTarget(trig.id, 'out') : null;
    return run();
  }
  function choose(handleId: string): RunResult {
    if (!S.pending) return { effects: [], status: 'ended' };
    S.cursor = outTarget(S.pending.id, handleId); S.pending = null; return run();
  }
  function provideInput(value: string): RunResult {
    if (!S.pending) return { effects: [], status: 'ended' };
    const d = S.pending.data || {}; if (d.saveTo) S.context.vars[d.saveTo] = value;
    S.cursor = outTarget(S.pending.id, 'out'); S.pending = null; return run();
  }
  return { start, choose, provideInput, state: S };
}

export function evalCondition(d: any, ctx: any): boolean {
  const rules = d.rules || []; if (!rules.length) return true;
  const test = (r: any) => {
    const tags = ctx.tags || [];
    if (r.kind === 'has_tag') return tags.indexOf(r.value) >= 0;
    if (r.kind === 'not_tag') return tags.indexOf(r.value) < 0;
    const field = (ctx.fields || {})[r.field] != null ? ctx.fields[r.field] : (ctx.vars || {})[r.field];
    const a = String(field == null ? '' : field).toLowerCase();
    const b = String(r.value == null ? '' : r.value).toLowerCase();
    switch (r.op) {
      case 'eq': return a === b; case 'neq': return a !== b;
      case 'contains': return a.indexOf(b) >= 0; case 'ncontains': return a.indexOf(b) < 0;
      case 'gt': return parseFloat(a) > parseFloat(b); case 'lt': return parseFloat(a) < parseFloat(b);
      case 'filled': return a !== ''; case 'empty': return a === '';
      default: return false;
    }
  };
  return d.logic === 'or' ? rules.some(test) : rules.every(test);
}

export interface Issue { level: 'error' | 'warn'; node?: string; msg: string; }
export function validate(graph: Flow): Issue[] {
  const issues: Issue[] = [];
  const nodes = graph.nodes || [], edges = graph.edges || [];
  if (!nodes.some((n) => n.type === 'trigger')) issues.push({ level: 'error', msg: 'O fluxo não tem um gatilho.' });
  nodes.forEach((n) => {
    if (n.type === 'message' && !(n.data.text || '').trim()) issues.push({ level: 'warn', node: n.id, msg: 'Mensagem vazia.' });
    if (n.type === 'question') {
      if (!(n.data.options || []).length) issues.push({ level: 'error', node: n.id, msg: 'Pergunta sem opções.' });
      (n.data.options || []).forEach((o: any) => { if (!edges.some((e) => e.source === n.id && e.sourceHandle === o.id)) issues.push({ level: 'warn', node: n.id, msg: `A opção "${o.label}" não leva a nenhum bloco.` }); });
    }
    if (n.type === 'condition' && !(n.data.rules || []).length) issues.push({ level: 'warn', node: n.id, msg: 'Condição sem regra.' });
    const outs = nodeOutputs(n);
    if (outs.length && !['handoff', 'end'].includes(n.type) && n.type !== 'question') {
      if (!edges.some((e) => e.source === n.id)) issues.push({ level: 'warn', node: n.id, msg: (NODE_DEFS[n.type]?.label || 'Bloco') + ' sem próximo bloco.' });
    }
  });
  return issues;
}
