import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { formatBRL } from '../lib/format';

interface Sender {
  name: string; document: string; phone: string; email: string;
  cep: string; street: string; number: string; complement: string; district: string; city: string; state: string;
}
interface Box { weight_kg: number; length_cm: number; width_cm: number; height_cm: number; }
interface Settings {
  environment: 'homologacao' | 'producao';
  cep_origem: string; label_format: string; use_frenet_registration: boolean;
  box: Box; sender: Sender;
  base_urls: { whitelabel: string; quote: string };
  webhook_url: string;
  tokens: { client_configured: boolean; partner_configured: boolean };
}
interface TestResult { ok: boolean; environment?: string; mode?: string; message?: string; reason?: string; wallet?: { balance: number; bonusBalance: number; labelLimit: number; walletLimit: number }; services_found?: number; }

export default function FreteSettings() {
  const { can } = useAuth();
  const canWrite = can('settings.write');
  const [s, setS] = useState<Settings | null>(null);
  const [webhookSecret, setWebhookSecret] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<TestResult | null>(null);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    try {
      const data = await apiFetch<{ settings: Settings; webhook_secret_configured: boolean }>('/api/frenet-settings');
      setS(data.settings); setWebhookSecret(data.webhook_secret_configured);
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao carregar.'); } finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function setField<K extends keyof Settings>(k: K, v: Settings[K]) { setS((cur) => cur ? { ...cur, [k]: v } : cur); }
  function setSender<K extends keyof Sender>(k: K, v: string) { setS((cur) => cur ? { ...cur, sender: { ...cur.sender, [k]: v } } : cur); }
  function setBox<K extends keyof Box>(k: K, v: number) { setS((cur) => cur ? { ...cur, box: { ...cur.box, [k]: v } } : cur); }

  async function save() {
    if (!s) return;
    setSaving(true); setMsg(''); setError('');
    try {
      const data = await apiFetch<{ settings: Settings; webhook_secret_configured: boolean }>('/api/frenet-settings', {
        method: 'PATCH',
        body: JSON.stringify({
          environment: s.environment, cep_origem: s.cep_origem, label_format: s.label_format,
          use_frenet_registration: s.use_frenet_registration, box: s.box, sender: s.sender,
        }),
      });
      setS(data.settings); setWebhookSecret(data.webhook_secret_configured); setMsg('Configurações salvas.');
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); } finally { setSaving(false); }
  }

  async function testConnection() {
    setTesting(true); setTest(null);
    try {
      const data = await apiFetch<TestResult>('/api/frenet-test', { method: 'POST' });
      setTest(data);
    } catch (err) { setTest({ ok: false, reason: err instanceof Error ? err.message : 'Erro.' }); } finally { setTesting(false); }
  }

  if (loading) return <div className="page"><p className="muted">Carregando…</p></div>;
  if (!s) return <div className="page"><div className="alert-error">{error || 'Não foi possível carregar.'}</div></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div><p className="crumb muted">Configurações › Integrações</p><h1>Frenet — Expedição</h1></div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={testConnection} disabled={testing}>{testing ? 'Testando…' : 'Testar conexão'}</button>
          {canWrite && <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : 'Salvar'}</button>}
        </div>
      </div>

      {msg && <div className="alert-ok">{msg}</div>}
      {error && <div className="alert-error">{error}</div>}

      {test && (
        <div className={test.ok ? 'alert-ok' : 'alert-error'}>
          <strong>{test.ok ? '🟢 Conectado' : '🔴 Erro de conexão'}</strong> — {test.message || test.reason}
          {test.wallet && (
            <div className="small" style={{ marginTop: 4 }}>
              Saldo: {formatBRL(test.wallet.balance)} · Bônus: {formatBRL(test.wallet.bonusBalance)} · Limite de etiquetas: {test.wallet.labelLimit}
            </div>
          )}
        </div>
      )}

      {/* Status das credenciais (nunca exibimos os tokens) */}
      <div className="card">
        <h3>Credenciais</h3>
        <ul className="status-list">
          <li><span className={`dot ${s.tokens.client_configured ? 'ok' : 'bad'}`} /> Token do Cliente {s.tokens.client_configured ? 'configurado' : 'faltando'} <span className="muted small">(FRENET_API_TOKEN)</span></li>
          <li><span className={`dot ${s.tokens.partner_configured ? 'ok' : 'bad'}`} /> Partner Token {s.tokens.partner_configured ? 'configurado' : 'faltando'} <span className="muted small">(FRENET_PARTNER_TOKEN — necessário p/ etiqueta)</span></li>
        </ul>
        <p className="muted small" style={{ marginTop: 10 }}>
          🔒 Por segurança, os tokens ficam apenas nas variáveis de ambiente do Netlify (Site settings › Environment).
          Esta tela nunca exibe os valores. Sem o Partner Token, a cotação funciona, mas a geração de etiqueta fica indisponível.
        </p>
      </div>

      <div className="card">
        <h3>Ambiente e origem</h3>
        <div className="form-grid">
          <label className="field">
            <span>Ambiente</span>
            <select value={s.environment} onChange={(e) => setField('environment', e.target.value as Settings['environment'])} disabled={!canWrite}>
              <option value="homologacao">Homologação (testes)</option>
              <option value="producao">Produção (real)</option>
            </select>
          </label>
          <label className="field"><span>CEP de origem</span>
            <input value={s.cep_origem} onChange={(e) => setField('cep_origem', e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder="00000000" disabled={!canWrite} />
          </label>
          <label className="field"><span>Formato da etiqueta</span>
            <select value={s.label_format} onChange={(e) => setField('label_format', e.target.value)} disabled={!canWrite}>
              <option value="A4">A4</option><option value="A5">A5</option>
            </select>
          </label>
          <label className="field-check" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={s.use_frenet_registration} onChange={(e) => setField('use_frenet_registration', e.target.checked)} disabled={!canWrite} />
            <span>Usar remetente cadastrado na Frenet</span>
          </label>
        </div>
        <p className="muted small">Base WhiteLabel: <code>{s.base_urls.whitelabel}</code> · Cotação: <code>{s.base_urls.quote}</code></p>
      </div>

      <div className="card">
        <h3>Caixa padrão</h3>
        <p className="muted small">Usada quando o produto não informa peso/dimensões.</p>
        <div className="form-grid">
          <label className="field"><span>Peso (kg)</span><input type="number" step="0.001" value={s.box.weight_kg} onChange={(e) => setBox('weight_kg', Number(e.target.value))} disabled={!canWrite} /></label>
          <label className="field"><span>Comprimento (cm)</span><input type="number" value={s.box.length_cm} onChange={(e) => setBox('length_cm', Number(e.target.value))} disabled={!canWrite} /></label>
          <label className="field"><span>Largura (cm)</span><input type="number" value={s.box.width_cm} onChange={(e) => setBox('width_cm', Number(e.target.value))} disabled={!canWrite} /></label>
          <label className="field"><span>Altura (cm)</span><input type="number" value={s.box.height_cm} onChange={(e) => setBox('height_cm', Number(e.target.value))} disabled={!canWrite} /></label>
        </div>
      </div>

      {!s.use_frenet_registration && (
        <div className="card">
          <h3>Remetente (para a postagem)</h3>
          <div className="form-grid">
            <label className="field"><span>Nome / Razão social</span><input value={s.sender.name} onChange={(e) => setSender('name', e.target.value)} disabled={!canWrite} /></label>
            <label className="field"><span>CPF/CNPJ</span><input value={s.sender.document} onChange={(e) => setSender('document', e.target.value.replace(/\D/g, ''))} disabled={!canWrite} /></label>
            <label className="field"><span>Telefone</span><input value={s.sender.phone} onChange={(e) => setSender('phone', e.target.value.replace(/\D/g, ''))} disabled={!canWrite} /></label>
            <label className="field"><span>E-mail</span><input value={s.sender.email} onChange={(e) => setSender('email', e.target.value)} disabled={!canWrite} /></label>
            <label className="field"><span>CEP</span><input value={s.sender.cep} onChange={(e) => setSender('cep', e.target.value.replace(/\D/g, '').slice(0, 8))} disabled={!canWrite} /></label>
            <label className="field"><span>Endereço</span><input value={s.sender.street} onChange={(e) => setSender('street', e.target.value)} disabled={!canWrite} /></label>
            <label className="field"><span>Número</span><input value={s.sender.number} onChange={(e) => setSender('number', e.target.value)} disabled={!canWrite} /></label>
            <label className="field"><span>Complemento</span><input value={s.sender.complement} onChange={(e) => setSender('complement', e.target.value)} disabled={!canWrite} /></label>
            <label className="field"><span>Bairro</span><input value={s.sender.district} onChange={(e) => setSender('district', e.target.value)} disabled={!canWrite} /></label>
            <label className="field"><span>Cidade</span><input value={s.sender.city} onChange={(e) => setSender('city', e.target.value)} disabled={!canWrite} /></label>
            <label className="field"><span>UF</span><input value={s.sender.state} onChange={(e) => setSender('state', e.target.value.toUpperCase().slice(0, 2))} disabled={!canWrite} /></label>
          </div>
        </div>
      )}

      <div className="card">
        <h3>Webhook de rastreio</h3>
        <p className="small">Registre esta URL no painel da Frenet para receber atualizações automáticas:</p>
        <p><code>{s.webhook_url || '(defina SITE_URL no ambiente)'}</code></p>
        <p className="muted small">
          <span className={`dot ${webhookSecret ? 'ok' : 'bad'}`} /> Token de segurança do webhook {webhookSecret ? 'configurado' : 'não configurado'}
          {' '}(FRENET_WEBHOOK_TOKEN_NAME / FRENET_WEBHOOK_TOKEN_VALUE no Netlify).
        </p>
      </div>
    </div>
  );
}
