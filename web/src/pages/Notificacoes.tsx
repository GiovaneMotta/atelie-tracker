/* ================================================================
   Configurações › Notificações

   Uma tela com uma pergunta só: "este celular avisa quando entra
   pedido?" — e a lista de quem mais avisa.

   A permissão de notificação é do SISTEMA, não nossa: só o toque da
   pessoa no botão abre a caixa do navegador. Por isso a ação principal
   é explícita, e a tela fala claramente quando o navegador bloqueou
   (que é o caso em que nada que façamos aqui resolve).
   ================================================================ */
import { useEffect, useState } from 'react';
import {
  Bell, BellOff, BellRing, Smartphone, Trash2, Send, ShieldAlert,
  Share, Plus, RefreshCw,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import {
  carregarEstado, ativarNesteAparelho, desativarNesteAparelho, removerAparelho,
  renomearAparelho, enviarTeste, inscricaoAtual, hashDoEndpoint, sincronizarInscricao,
  suportaPush, permissaoAtual, instaladoComoApp, ehIOS,
  type Aparelho, type EstadoPush,
} from '../lib/push';

/** "Chrome · Android" a partir do user agent, sem bibliotecas. */
function apelidoDoNavegador(ua: string | null): string {
  if (!ua) return 'Aparelho';
  const nav = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const so = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iPhone'
      : /Windows/.test(ua) ? 'Windows'
        : /Mac OS X/.test(ua) ? 'Mac' : '';
  return so ? `${nav} · ${so}` : nav;
}

function quando(iso: string | null): string {
  if (!iso) return 'ainda não recebeu';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export default function Notificacoes() {
  const { can } = useAuth();
  const podeGerenciar = can('notifications.manage');

  const [estado, setEstado] = useState<EstadoPush | null>(null);
  const [meuHash, setMeuHash] = useState<string | null>(null);
  const [permissao, setPermissao] = useState(permissaoAtual());
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');

  const suportado = suportaPush();
  const iOSSemInstalar = ehIOS() && !instaladoComoApp();

  async function carregar() {
    setCarregando(true); setErro('');
    try {
      const [dados, sub] = await Promise.all([carregarEstado(), inscricaoAtual()]);
      setEstado(dados);
      setMeuHash(sub ? await hashDoEndpoint(sub.endpoint) : null);
      setPermissao(permissaoAtual());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar.');
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    /* Se o navegador trocou a inscrição sozinho, o servidor fica com o
       endereço velho. Reenviar aqui é barato e conserta em silêncio. */
    sincronizarInscricao();
  }, []);

  /* Este aparelho já está na lista do servidor? */
  const meuAparelho: Aparelho | undefined = meuHash
    ? estado?.devices.find((d) => d.hash === meuHash)
    : undefined;
  const ativoAqui = permissao === 'granted' && !!meuAparelho;

  async function ligar() {
    setOcupado(true); setMsg(''); setErro('');
    try {
      await ativarNesteAparelho(estado?.publicKey || '', apelidoDoNavegador(navigator.userAgent));
      setMsg('Pronto. Este aparelho vai avisar quando entrar pedido.');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ativar.');
      setPermissao(permissaoAtual());
    } finally { setOcupado(false); }
  }

  async function desligar() {
    setOcupado(true); setMsg(''); setErro('');
    try {
      await desativarNesteAparelho(meuAparelho?.id);
      setMsg('Este aparelho não recebe mais avisos.');
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível desligar.');
    } finally { setOcupado(false); }
  }

  async function testar() {
    setOcupado(true); setMsg(''); setErro('');
    try {
      const r = await enviarTeste();
      setMsg(r.enviados === 1
        ? 'Teste enviado para 1 aparelho. Deve chegar em alguns segundos.'
        : `Teste enviado para ${r.enviados} aparelhos.`
        + (r.removidos ? ` ${r.removidos} inscrição vencida foi removida.` : '')
        + (r.falhas ? ` ${r.falhas} falharam.` : ''));
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível enviar o teste.');
    } finally { setOcupado(false); }
  }

  async function remover(d: Aparelho) {
    if (!confirm(`Remover "${d.label || 'este aparelho'}"? Ele deixa de receber avisos.`)) return;
    setOcupado(true); setMsg(''); setErro('');
    try {
      if (d.hash === meuHash) await desativarNesteAparelho(d.id);
      else await removerAparelho(d.id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível remover.');
    } finally { setOcupado(false); }
  }

  async function renomear(d: Aparelho) {
    const novo = prompt('Nome deste aparelho:', d.label || '');
    if (novo === null) return;
    const limpo = novo.trim();
    if (!limpo) return;
    try { await renomearAparelho(d.id, limpo); await carregar(); }
    catch (e) { setErro(e instanceof Error ? e.message : 'Não foi possível renomear.'); }
  }

  if (!podeGerenciar) {
    return (
      <div className="page">
        <div className="empty-card">
          <p className="empty-emoji">🔒</p>
          <p><strong>Você não tem acesso a esta tela.</strong></p>
          <p className="muted">É preciso a permissão <code>notifications.manage</code>.</p>
        </div>
      </div>
    );
  }

  if (carregando) return <div className="page"><p className="muted">Carregando…</p></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="crumb muted">Configurações › Notificações</p>
          <h1>Notificações no celular</h1>
          <p className="dash-sub">Um aviso na tela quando entra pedido no site e quando uma venda é aprovada.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={carregar} disabled={ocupado}>
            <RefreshCw size={15} /> Atualizar
          </button>
          {!!estado?.devices.length && (
            <button className="btn btn-ghost" onClick={testar} disabled={ocupado || !estado?.configurado}>
              <Send size={15} /> Enviar teste
            </button>
          )}
        </div>
      </div>

      {msg && <div className="alert-ok">{msg}</div>}
      {erro && <div className="alert-error">{erro}</div>}

      {!estado?.configurado && (
        <div className="alert-warn">
          <strong>Falta cadastrar as chaves de notificação.</strong> As variáveis{' '}
          <code>VAPID_PUBLIC_KEY</code> e <code>VAPID_PRIVATE_KEY</code> precisam estar nas
          configurações do painel na Cloudflare. Enquanto isso, ninguém consegue ativar.
        </div>
      )}

      {/* ---------- ESTE APARELHO ---------- */}
      <div className="card">
        <h3>Este aparelho</h3>

        {/* iPhone vem ANTES de "não suportado" de propósito: no iOS o
            PushManager só existe depois de instalar na Tela de Início,
            então o teste de suporte falha justamente para quem ainda
            pode resolver. Mandar essa pessoa embora com "seu navegador
            não aceita" seria mentira — falta um passo, só. */}
        {iOSSemInstalar ? (
          <>
            <p style={{ marginBottom: 14 }}>
              <strong>Falta um passo:</strong> no iPhone, as notificações só funcionam com o
              painel instalado na Tela de Início. É rápido:
            </p>
            <ol className="muted" style={{ margin: '0 0 14px', paddingLeft: 20, lineHeight: 1.9 }}>
              <li>Toque em <Share size={14} style={{ verticalAlign: 'middle' }} /> <strong>Compartilhar</strong>, na barra de baixo do Safari</li>
              <li>Role e toque em <Plus size={14} style={{ verticalAlign: 'middle' }} /> <strong>Adicionar à Tela de Início</strong></li>
              <li>Confirme em <strong>Adicionar</strong></li>
              <li>Feche o Safari e abra o painel pelo <strong>ícone novo</strong> na sua tela</li>
              <li>Faça login de novo — <em>é normal</em>, o aplicativo instalado tem a sessão dele</li>
              <li>Volte nesta tela e o botão de ativar vai estar aqui</li>
            </ol>
            <p className="muted small">
              Precisa ser pelo <strong>Safari</strong>. Chrome, Firefox e o navegador de dentro do
              Instagram ou do WhatsApp não conseguem instalar no iPhone.
            </p>
          </>
        ) : !suportado ? (
          <>
            <p className="muted" style={{ marginBottom: 10 }}>
              Este navegador não aceita notificações.
            </p>
            <p className="muted small">
              Se você abriu o painel por um link dentro do <strong>Instagram</strong> ou do{' '}
              <strong>WhatsApp</strong>, é isso: o navegador embutido deles não recebe notificação.
              Abra <code>atelie-tracker.pages.dev</code> direto no <strong>Chrome</strong> (Android)
              ou no <strong>Safari</strong> (iPhone) e tente de novo.
            </p>
          </>
        ) : permissao === 'denied' ? (
          <>
            <p className="status-list" style={{ marginBottom: 10 }}>
              <span><ShieldAlert size={16} /> <strong>Bloqueado nas configurações do navegador.</strong></span>
            </p>
            <p className="muted small">
              O navegador guardou um "não" para este site, e só você pode desfazer: toque no cadeado
              (ou nos três pontos › Informações do site), encontre <strong>Notificações</strong> e
              mude para <strong>Permitir</strong>. Depois volte aqui e ative.
            </p>
          </>
        ) : ativoAqui ? (
          <>
            <ul className="status-list">
              <li><span className="dot ok" /> <strong>Ativado.</strong> Este aparelho recebe os avisos.</li>
              <li className="muted small">
                Último aviso recebido: {quando(meuAparelho?.last_success_at ?? null)}
              </li>
            </ul>
            <div className="page-actions" style={{ marginTop: 14 }}>
              <button className="btn btn-ghost" onClick={desligar} disabled={ocupado}>
                <BellOff size={15} /> Desligar neste aparelho
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ marginBottom: 14 }}>
              Ative para receber <strong>Novo pedido recebido!</strong> e <strong>Venda aprovada!</strong>{' '}
              neste aparelho, mesmo com o painel fechado.
            </p>
            <button className="btn btn-primary" onClick={ligar} disabled={ocupado || !estado?.configurado}>
              <BellRing size={15} /> {ocupado ? 'Ativando…' : 'Ativar neste aparelho'}
            </button>
            <p className="muted small" style={{ marginTop: 10 }}>
              O navegador vai perguntar se permite. É preciso responder <strong>Permitir</strong>.
            </p>
          </>
        )}
      </div>

      {/* ---------- APARELHOS AUTORIZADOS ---------- */}
      <div className="card">
        <div className="card-head-row">
          <h3>Aparelhos que recebem</h3>
          <span className="muted small">{estado?.devices.length || 0} cadastrado(s)</span>
        </div>

        {!estado?.devices.length ? (
          <p className="muted">
            Nenhum aparelho ainda. Ative acima — e repita em cada celular que deve ser avisado.
          </p>
        ) : (
          <ul className="status-list" style={{ gap: 14 }}>
            {estado.devices.map((d) => (
              <li key={d.id} style={{ alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <Smartphone size={17} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span>
                    <strong>{d.label || apelidoDoNavegador(d.user_agent)}</strong>
                    {d.hash === meuHash && <span className="pill pill-ok" style={{ marginLeft: 8, fontSize: '.72rem' }}>este aparelho</span>}
                    {!!d.failures && <span className="pill pill-warn" style={{ marginLeft: 8, fontSize: '.72rem' }}>{d.failures} falha(s)</span>}
                    <span className="muted small" style={{ display: 'block' }}>
                      {apelidoDoNavegador(d.user_agent)} · último aviso: {quando(d.last_success_at)}
                    </span>
                  </span>
                </span>
                <span style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => renomear(d)} disabled={ocupado}>Renomear</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => remover(d)} disabled={ocupado} title="Remover">
                    <Trash2 size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ---------- O QUE AVISA ---------- */}
      <div className="card">
        <h3>O que gera aviso</h3>
        <ul className="status-list">
          <li><Bell size={16} /> <span><strong>Novo pedido recebido!</strong> — quando um pedido do site é gravado.</span></li>
          <li><Bell size={16} /> <span><strong>Venda aprovada!</strong> — quando você registra o pagamento aqui no painel.</span></li>
        </ul>
        <p className="muted small" style={{ marginTop: 12 }}>
          Pedido cancelado não avisa, e rascunho criado à mão aqui no painel também não.
          Cada aviso sai <strong>uma vez só</strong> por pedido, por aparelho — mesmo que o
          sistema tente de novo. Tocar na notificação abre o pedido.
          {!!estado?.pendentes && <> Há <strong>{estado.pendentes}</strong> aviso(s) na fila aguardando envio.</>}
        </p>
      </div>
    </div>
  );
}
