/* ================================================================
   push — o lado do navegador das notificações.

   Três coisas acontecem aqui, nesta ordem:
     1. registrar o Service Worker (sem ele o navegador não entrega
        push nenhum, nem com permissão concedida);
     2. pedir a permissão à pessoa — e só ela pode conceder: nenhum
        código consegue "ligar" notificação por fora;
     3. criar a inscrição com a chave pública VAPID do painel e mandar
        o endereço para o servidor guardar.

   Nada aqui fala com cliente: as notificações são do painel, para
   quem administra a loja.
   ================================================================ */
import { apiFetch } from './api';

export type EstadoPermissao = 'default' | 'granted' | 'denied' | 'indisponivel';

export interface Aparelho {
  id: string;
  label: string | null;
  user_agent: string | null;
  active: boolean;
  failures: number;
  last_error: string | null;
  last_success_at: string | null;
  created_at: string;
  meu: boolean;
  hash: string;
}

export interface EstadoPush {
  publicKey: string | null;
  configurado: boolean;
  devices: Aparelho[];
  pendentes: number;
}

/** O navegador tem tudo o que o push exige? (iOS só fora do Safari antigo) */
export function suportaPush(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export function permissaoAtual(): EstadoPermissao {
  if (!suportaPush()) return 'indisponivel';
  return Notification.permission as EstadoPermissao;
}

/** Instalado na tela de início? (no iOS o push só funciona assim) */
export function instaladoComoApp(): boolean {
  return typeof window !== 'undefined'
    && (window.matchMedia?.('(display-mode: standalone)').matches
      || (navigator as unknown as { standalone?: boolean }).standalone === true);
}

export function ehIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/* A chave VAPID viaja em base64url; o PushManager quer bytes. */
function chaveParaBytes(base64url: string): Uint8Array {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Hash do endpoint — igual ao que a API calcula, para a tela saber
    qual item da lista é o aparelho que está na mão da pessoa. */
export async function hashDoEndpoint(endpoint: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  let bin = '';
  const u8 = new Uint8Array(d);
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 16);
}

export async function registrarServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!suportaPush()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

export async function inscricaoAtual(): Promise<PushSubscription | null> {
  if (!suportaPush()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

export async function carregarEstado(): Promise<EstadoPush> {
  return apiFetch<EstadoPush>('/api/push');
}

/** Pede permissão, inscreve e guarda no servidor. Devolve o hash do
    aparelho recém-inscrito. Lança Error com mensagem amigável. */
export async function ativarNesteAparelho(publicKey: string, label?: string): Promise<string> {
  if (!suportaPush()) throw new Error('Este navegador não aceita notificações.');
  if (!publicKey) throw new Error('As chaves de notificação ainda não foram cadastradas na Cloudflare.');

  const reg = await registrarServiceWorker();
  if (!reg) throw new Error('Não foi possível preparar o aplicativo para receber avisos.');
  await navigator.serviceWorker.ready;

  const permissao = await Notification.requestPermission();
  if (permissao !== 'granted') {
    throw new Error(permissao === 'denied'
      ? 'As notificações estão bloqueadas nas configurações do navegador para este site.'
      : 'Permissão não concedida.');
  }

  /* Se já existe inscrição com OUTRA chave VAPID (chave trocada), ela
     precisa sair antes — o navegador recusa duas chaves ao mesmo tempo. */
  const antiga = await reg.pushManager.getSubscription();
  if (antiga) {
    const atual = antiga.options?.applicationServerKey;
    const mesma = atual
      ? new Uint8Array(atual).toString() === chaveParaBytes(publicKey).toString()
      : false;
    if (!mesma) await antiga.unsubscribe();
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: chaveParaBytes(publicKey) as BufferSource,
  });

  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  await apiFetch('/api/push', {
    method: 'POST',
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, label }),
  });
  return hashDoEndpoint(sub.endpoint);
}

/** Reenvia a inscrição que já existe (rotação de chave do navegador).
    Silenciosa: é manutenção, não ação da pessoa. */
export async function sincronizarInscricao(): Promise<void> {
  try {
    if (permissaoAtual() !== 'granted') return;
    const sub = await inscricaoAtual();
    if (!sub) return;
    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    await apiFetch('/api/push', {
      method: 'POST',
      body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
    });
  } catch { /* sem permissão ou offline: tenta de novo no próximo acesso */ }
}

/** Desliga neste aparelho: cancela no navegador e remove do servidor. */
export async function desativarNesteAparelho(deviceId?: string): Promise<void> {
  const sub = await inscricaoAtual();
  if (sub) await sub.unsubscribe().catch(() => {});
  if (deviceId) await apiFetch(`/api/push?id=${deviceId}`, { method: 'DELETE' });
}

export async function removerAparelho(id: string): Promise<void> {
  await apiFetch(`/api/push?id=${id}`, { method: 'DELETE' });
}

export async function renomearAparelho(id: string, label: string): Promise<void> {
  await apiFetch(`/api/push?id=${id}`, { method: 'PATCH', body: JSON.stringify({ label }) });
}

export async function enviarTeste(): Promise<{ enviados: number; falhas: number; removidos: number }> {
  return apiFetch('/api/push?action=teste', { method: 'POST' });
}
