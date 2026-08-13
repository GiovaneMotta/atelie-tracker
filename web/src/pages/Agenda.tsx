import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api';
import { formatBRL } from '../lib/format';

interface Followup { id: string; title: string | null; interest: string | null; value: number | null;
  next_followup_at: string; customer: { name: string } | null; stage: { name: string } | null; }
interface Conv { id: string; external_id: string | null; last_message_preview: string | null;
  unread_count: number; ai_state: string; customer: { name: string } | null; }
interface Task { id: string; title: string; due_at: string; priority: string; customer: { name: string } | null; assignee: { name: string } | null; }

function when(iso: string, now: string) {
  const d = new Date(iso), n = new Date(now);
  const days = Math.floor((n.getTime() - d.getTime()) / 86400000);
  if (days > 0) return `atrasado ${days}d`;
  if (days === 0) return 'hoje';
  return 'hoje';
}

export default function Agenda() {
  const navigate = useNavigate();
  const [data, setData] = useState<{ now: string; followups: Followup[]; conversations: Conv[]; tasks: Task[] } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch<any>('/api/agenda').then(setData).catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="page"><div className="alert-error">{error}</div></div>;
  if (!data) return <div className="page"><p className="muted">Carregando…</p></div>;

  const total = data.followups.length + data.conversations.length + data.tasks.length;

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Agenda do dia</h1><p className="muted">O que precisa da sua atenção agora — {total} item(ns).</p></div>
      </div>

      <div className="agenda-grid">
        <section className="card">
          <h3>💬 Conversas aguardando <span className="count-pill">{data.conversations.length}</span></h3>
          {data.conversations.length === 0 && <p className="muted">Tudo respondido. 🎉</p>}
          {data.conversations.map((c) => (
            <div key={c.id} className="agenda-row" onClick={() => navigate('/inbox')}>
              <div><strong>{c.customer?.name || c.external_id}</strong>
                <div className="muted small">{c.last_message_preview || ''}</div></div>
              <span className="conv-unread">{c.unread_count}</span>
            </div>
          ))}
        </section>

        <section className="card">
          <h3>📌 Follow-ups <span className="count-pill">{data.followups.length}</span></h3>
          {data.followups.length === 0 && <p className="muted">Nenhum follow-up pendente.</p>}
          {data.followups.map((f) => (
            <div key={f.id} className="agenda-row" onClick={() => navigate('/funil')}>
              <div><strong>{f.title || f.customer?.name || 'Lead'}</strong>
                <div className="muted small">{f.stage?.name}{f.interest ? ` · ${f.interest}` : ''}</div></div>
              <div className="agenda-right">
                <span className="tag-when">{when(f.next_followup_at, data.now)}</span>
                {f.value != null && f.value > 0 && <div className="muted small">{formatBRL(f.value)}</div>}
              </div>
            </div>
          ))}
        </section>

        <section className="card">
          <h3>✅ Tarefas <span className="count-pill">{data.tasks.length}</span></h3>
          {data.tasks.length === 0 && <p className="muted">Sem tarefas para hoje.</p>}
          {data.tasks.map((t) => (
            <div key={t.id} className="agenda-row" onClick={() => navigate('/tarefas')}>
              <div><strong>{t.title}</strong>
                <div className="muted small">{t.assignee?.name || 'Sem responsável'}{t.customer ? ` · ${t.customer.name}` : ''}</div></div>
              <span className={`badge prio-${t.priority}`}>{when(t.due_at, data.now)}</span>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
