import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { supabase } from '../lib/supabase';

interface Conv {
  id: string; external_id: string | null; status: string; ai_state: string;
  unread_count: number; last_message_preview: string | null; last_message_at: string | null;
  customer: { id: string; name: string } | null;
}
interface ConvDetail extends Conv {
  customer: { id: string; name: string; whatsapp: string | null; phone: string | null; document: string | null } | null;
}
interface Msg {
  id: string; direction: string; sender: string; type: string; body: string | null;
  status: string; error: string | null; created_at: string;
}

function timeOf(iso: string | null) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function Inbox() {
  const [list, setList] = useState<Conv[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conv, setConv] = useState<ConvDetail | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);

  async function loadList() {
    try {
      const data = await apiFetch<{ conversations: Conv[] }>('/api/conversations');
      setList(data.conversations);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); }
  }

  async function loadConversation(id: string) {
    const data = await apiFetch<{ conversation: ConvDetail; messages: Msg[] }>(`/api/conversations?id=${id}`);
    setConv(data.conversation);
    setMessages(data.messages);
    if (data.conversation.unread_count > 0) {
      apiFetch(`/api/conversations?id=${id}`, { method: 'PATCH', body: JSON.stringify({ mark_read: true }) }).then(loadList).catch(() => {});
    }
  }

  // Lista + realtime das conversas
  useEffect(() => {
    loadList();
    const ch = supabase.channel('inbox-convos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => loadList())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  // Conversa ativa + realtime das mensagens dela
  useEffect(() => {
    if (!activeId) { setConv(null); setMessages([]); return; }
    loadConversation(activeId);
    const ch = supabase.channel(`inbox-msgs-${activeId}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${activeId}` },
        (payload) => setMessages((cur) => cur.some((m) => m.id === (payload.new as Msg).id) ? cur : [...cur, payload.new as Msg]))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [activeId]);

  useEffect(() => { threadRef.current?.scrollTo(0, threadRef.current.scrollHeight); }, [messages]);

  async function send(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || !activeId) return;
    setSending(true); setError('');
    try {
      const res = await apiFetch<{ message: Msg }>('/api/messages', {
        method: 'POST',
        headers: { 'Idempotency-Key': `${activeId}-${Date.now()}` },
        body: JSON.stringify({ conversation_id: activeId, body }),
      });
      setText('');
      setMessages((cur) => cur.some((m) => m.id === res.message.id) ? cur : [...cur, res.message]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar.');
    } finally { setSending(false); }
  }

  async function toggleAI() {
    if (!conv) return;
    const patch = conv.ai_state === 'humano' ? { release_to_ai: true } : { assume: true };
    const data = await apiFetch<{ conversation: ConvDetail }>(`/api/conversations?id=${conv.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
    setConv(data.conversation);
    loadList();
  }

  return (
    <div className="inbox">
      {/* LISTA */}
      <div className="inbox-list">
        <div className="inbox-list-head">
          <strong>Conversas</strong>
          <button className="btn-link" onClick={() => setStarting(true)}>+ Nova</button>
        </div>
        <div className="inbox-list-scroll">
          {list.length === 0 && <p className="muted center" style={{ padding: 20 }}>Nenhuma conversa ainda.</p>}
          {list.map((c) => (
            <button key={c.id} className={`conv-item ${activeId === c.id ? 'is-active' : ''}`} onClick={() => setActiveId(c.id)}>
              <div className="conv-avatar">{(c.customer?.name || c.external_id || '?').charAt(0).toUpperCase()}</div>
              <div className="conv-item-body">
                <div className="conv-item-top">
                  <strong>{c.customer?.name || c.external_id}</strong>
                  <span className="conv-time">{timeOf(c.last_message_at)}</span>
                </div>
                <div className="conv-item-bottom">
                  <span className="conv-preview">{c.last_message_preview || '—'}</span>
                  {c.unread_count > 0 && <span className="conv-unread">{c.unread_count}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* THREAD */}
      <div className="inbox-thread">
        {!conv && <div className="inbox-empty muted">Selecione uma conversa ou inicie uma nova. 💬</div>}
        {conv && (
          <>
            <div className="thread-head">
              <div>
                <strong>{conv.customer?.name || conv.external_id}</strong>
                <span className="muted small"> · {conv.external_id}</span>
              </div>
              <div className="thread-head-actions">
                <span className={`ai-pill ${conv.ai_state}`}>IA: {conv.ai_state}</span>
                <button className="btn btn-ghost btn-sm" onClick={toggleAI}>
                  {conv.ai_state === 'humano' ? 'Devolver p/ IA' : 'Assumir'}
                </button>
              </div>
            </div>

            <div className="thread-msgs" ref={threadRef}>
              {messages.map((m) => (
                <div key={m.id} className={`bubble ${m.direction === 'out' ? 'out' : 'in'}`}>
                  <div className="bubble-body">{m.body}</div>
                  <div className="bubble-meta">
                    {timeOf(m.created_at)}
                    {m.direction === 'out' && m.status === 'failed' && <span className="bubble-fail" title={m.error || ''}> · falhou</span>}
                    {m.direction === 'out' && m.status === 'sent' && <span> · enviado</span>}
                  </div>
                </div>
              ))}
              {messages.length === 0 && <p className="muted center">Sem mensagens ainda.</p>}
            </div>

            {error && <div className="alert-error" style={{ margin: '0 16px' }}>{error}</div>}

            <form className="thread-compose" onSubmit={send}>
              <input placeholder="Escreva uma mensagem…" value={text} onChange={(e) => setText(e.target.value)} />
              <button className="btn btn-primary" disabled={sending || !text.trim()}>{sending ? '…' : 'Enviar'}</button>
            </form>
          </>
        )}
      </div>

      {starting && <NewConversation onClose={() => setStarting(false)} onCreated={(id) => { setStarting(false); setActiveId(id); loadList(); }} />}
    </div>
  );
}

interface PickCustomer { id: string; name: string; whatsapp: string | null; phone: string | null; }

function NewConversation({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [phone, setPhone] = useState('');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickCustomer[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function searchCustomers(q: string) {
    setQuery(q);
    if (q.trim().length < 2) { setResults([]); return; }
    const data = await apiFetch<{ customers: PickCustomer[] }>(`/api/customers?search=${encodeURIComponent(q)}`);
    setResults(data.customers.slice(0, 6));
  }
  async function start(payload: { phone?: string; customer_id?: string }) {
    setBusy(true); setError('');
    try {
      const data = await apiFetch<{ conversation: { id: string } }>('/api/conversations', { method: 'POST', body: JSON.stringify(payload) });
      onCreated(data.conversation.id);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); setBusy(false); }
  }

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nova conversa</h3>
        <label className="field"><span>Telefone (com DDD)</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(99) 99999-9999" /></label>
        <div className="field"><span>ou buscar cliente</span>
          <div className="picker">
            <input placeholder="Nome do cliente…" value={query} onChange={(e) => searchCustomers(e.target.value)} />
            {results.map((c) => <button key={c.id} className="picker-opt" onClick={() => start({ customer_id: c.id })}>{c.name} <span className="muted">{c.whatsapp || c.phone}</span></button>)}
          </div>
        </div>
        {error && <div className="alert-error">{error}</div>}
        <div className="form-actions">
          <button className="btn btn-primary" disabled={busy || !phone.trim()} onClick={() => start({ phone })}>{busy ? '…' : 'Iniciar'}</button>
          <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
