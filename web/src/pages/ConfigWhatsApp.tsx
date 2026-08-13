import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

interface Status { configured: boolean; valid: boolean; status: number; webhook_url: string; }

export default function ConfigWhatsApp() {
  const [st, setSt] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function test() {
    setLoading(true); setError('');
    try { setSt(await apiFetch<Status>('/api/wascript-test')); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro.'); } finally { setLoading(false); }
  }
  useEffect(() => { test(); }, []);

  function copy() {
    if (st?.webhook_url) { navigator.clipboard?.writeText(st.webhook_url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>WhatsApp (WaScript/WaSpeed)</h1><p className="muted">Status da conexão e configuração do recebimento.</p></div>
        <button className="btn btn-primary" onClick={test} disabled={loading}>{loading ? 'Testando…' : 'Testar conexão'}</button>
      </div>

      {error && <div className="alert-error">{error}</div>}

      <div className="card" style={{ maxWidth: 680 }}>
        <h3>Status</h3>
        {!st && <p className="muted">Verificando…</p>}
        {st && (
          <ul className="status-list">
            <li><span className={`dot ${st.configured ? 'ok' : 'bad'}`} />
              Token no Netlify (<code>WASCRIPT_TOKEN</code>): <strong>{st.configured ? 'configurado' : 'faltando'}</strong></li>
            <li><span className={`dot ${st.valid ? 'ok' : (st.configured ? 'bad' : '')}`} />
              Resposta da API: <strong>{st.valid ? 'OK ✓' : (st.configured ? `falhou (HTTP ${st.status || '—'})` : 'aguardando token')}</strong></li>
          </ul>
        )}
        {st && !st.configured && (
          <div className="alert-error" style={{ marginTop: 10 }}>
            Falta o token. No <strong>Netlify → Site settings → Environment variables</strong>, adicione
            a variável <code>WASCRIPT_TOKEN</code> com o token do WaSpeed e refaça o deploy (ou clique
            em <em>Trigger deploy</em>). Depois volte aqui e clique em “Testar conexão”.
          </div>
        )}
      </div>

      <div className="card" style={{ maxWidth: 680 }}>
        <h3>Receber mensagens (webhook)</h3>
        <p className="muted small">No painel do WaScript/WaSpeed, cadastre esta URL como webhook de mensagens recebidas:</p>
        <div className="copy-box">
          <code>{st?.webhook_url || '…'}</code>
          <button className="btn btn-ghost btn-sm" onClick={copy}>{copied ? 'Copiado ✓' : 'Copiar'}</button>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          Assim que a primeira mensagem real chegar, ela fica registrada e eu monto o “tradutor” do
          recebimento com o formato verdadeiro (sem inventar). Aí o Inbox passa a <strong>receber</strong>.
        </p>
      </div>

      <div className="card" style={{ maxWidth: 680 }}>
        <h3>Como funciona</h3>
        <ul className="status-list">
          <li>📤 <strong>Enviar</strong> já funciona assim que o token estiver configurado (Inbox → digitar → Enviar).</li>
          <li>📥 <strong>Receber</strong> depende do webhook acima + do formato real da 1ª mensagem.</li>
          <li>🔒 O token fica só no backend (Netlify) — nunca no navegador nem no código.</li>
        </ul>
      </div>
    </div>
  );
}
