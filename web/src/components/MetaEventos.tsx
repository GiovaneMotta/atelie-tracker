/* ================================================================
   MetaEventos — o que o painel mandou para a Meta, e o que travou.

   Construí a fila de envio e não dei nenhuma forma de olhar para ela.
   Fila invisível é fila que ninguém conserta: um Purchase que falhou
   ficaria parado para sempre, e a venda simplesmente não existiria
   para a Meta — sem nenhum sinal de que algo deu errado.

   Aqui dá para ver cada venda enviada, o erro inteiro quando falha, e
   reenviar os pendentes. O reenvio é seguro de repetir: o event_id é
   derivado do pedido e tem índice único, então clicar duas vezes não
   cria duas vendas.
   ================================================================ */
import { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatDateTime } from '../lib/format';

interface Evento {
  event_id: string;
  event_name: string;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  order_id: string | null;
}

const SELO: Record<string, { txt: string; cls: string }> = {
  enviado: { txt: 'Enviado', cls: 'pill pill-ok' },
  pendente: { txt: 'Na fila', cls: 'pill' },
  erro: { txt: 'Falhou', cls: 'pill pill-bad' },
};

export default function MetaEventos({ writable }: { writable: boolean }) {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [pendentes, setPendentes] = useState(0);
  const [carregando, setCarregando] = useState(true);
  const [reenviando, setReenviando] = useState(false);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);

  async function carregar() {
    setCarregando(true); setErro('');
    try {
      const d = await apiFetch<{ eventos: Evento[]; pendentes: number }>('/api/meta-capi');
      setEventos(d.eventos || []); setPendentes(d.pendentes || 0);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler a fila.');
    } finally { setCarregando(false); }
  }
  useEffect(() => { carregar(); }, []);

  async function reenviar() {
    setReenviando(true); setErro('');
    try {
      await apiFetch('/api/meta-capi', { method: 'POST', body: JSON.stringify({ retry: true }) });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao reenviar.');
    } finally { setReenviando(false); }
  }

  return (
    <div className="card">
      <div className="card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Vendas enviadas à Meta</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={carregar} disabled={carregando}>
            <RefreshCw size={14} /> Atualizar
          </button>
          {writable && pendentes > 0 && (
            <button type="button" className="btn btn-primary btn-sm" onClick={reenviar} disabled={reenviando}>
              {reenviando ? 'Reenviando…' : `Reenviar ${pendentes} pendente${pendentes > 1 ? 's' : ''}`}
            </button>
          )}
        </div>
      </div>

      <p className="muted small">
        O <b>Purchase</b> sai daqui quando você registra o pagamento de um pedido — não do
        site. Reenviar é seguro: cada venda tem um identificador único, então repetir não
        gera venda dobrada.
      </p>

      {erro && <div className="alert-error">{erro}</div>}

      {!carregando && eventos.length === 0 && (
        <p className="muted small">
          Nenhuma venda enviada ainda. A primeira sai quando você marcar um pedido como pago.
        </p>
      )}

      {eventos.length > 0 && (
        <table className="table">
          <thead><tr><th>Quando</th><th>Evento</th><th>Status</th><th className="right">Tentativas</th><th></th></tr></thead>
          <tbody>
            {eventos.map((e) => {
              const selo = SELO[e.status] || SELO.pendente;
              const icone = e.status === 'enviado' ? <CheckCircle2 size={14} />
                : e.status === 'erro' ? <AlertTriangle size={14} /> : <Clock size={14} />;
              return (
                <tr key={e.event_id}>
                  <td className="mono small">{formatDateTime(e.sent_at || e.created_at)}</td>
                  <td>{e.event_name}</td>
                  <td><span className={selo.cls}>{icone} {selo.txt}</span></td>
                  <td className="right mono">{e.attempts}</td>
                  <td className="right">
                    {e.last_error && (
                      <button type="button" className="btn-link"
                        onClick={() => setAberto(aberto === e.event_id ? null : e.event_id)}>
                        {aberto === e.event_id ? 'esconder' : 'ver erro'}
                      </button>
                    )}
                    {aberto === e.event_id && e.last_error && (
                      <pre style={{
                        textAlign: 'left', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        fontSize: 11, marginTop: 6, padding: 8, background: 'var(--cream-2)',
                        borderRadius: 6,
                      }}>{e.last_error}</pre>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
