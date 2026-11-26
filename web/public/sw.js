/* ================================================================
   Service Worker do painel — Ateliê da Lili

   Existe por DOIS motivos, nesta ordem:
     1. receber a notificação push quando o painel está fechado (sem
        Service Worker o navegador não entrega push nenhum);
     2. tornar o painel instalável como aplicativo no celular.

   O QUE ELE NÃO FAZ, DE PROPÓSITO: cache de JavaScript e CSS.
   O painel é atualizado a cada push no GitHub. Um cache de assets
   faria a Lili continuar vendo a versão velha depois de um deploy,
   com bugs já corrigidos. Aqui só a página de "sem conexão" fica
   guardada — todo o resto vai sempre à rede.
   ================================================================ */

const CACHE = 'atelie-offline-v1';
const OFFLINE = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.add(OFFLINE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

/* Rede sempre. Só se a navegação falhar é que mostramos a página de
   "sem conexão" — nada de servir app velho de cache. */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || new Response('Sem conexão.', {
      status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    }))),
  );
});

/* ---------------- NOTIFICAÇÃO ---------------- */
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = {}; }

  const titulo = d.title || 'Ateliê da Lili';
  const opcoes = {
    body: d.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: d.tag || 'atelie',
    data: { url: d.url || '/pedidos', kind: d.kind || '' },
    vibrate: [90, 50, 90],
    timestamp: Date.now(),
    lang: 'pt-BR',
  };
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

/* Tocou na notificação: abre o pedido. Se o painel já estiver aberto
   em alguma aba, reaproveita essa aba em vez de abrir outra. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || '/pedidos';

  event.waitUntil((async () => {
    const abas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const minhaOrigem = self.location.origin;
    for (const aba of abas) {
      if (new URL(aba.url).origin !== minhaOrigem) continue;
      await aba.focus();
      if ('navigate' in aba) {
        try { await aba.navigate(destino); } catch (e) { /* aba pode recusar; o foco já ajuda */ }
      }
      return;
    }
    await self.clients.openWindow(destino);
  })());
});

/* O navegador pode trocar a inscrição sozinho (rotação de chave).
   Reinscrevemos na hora para o push não parar. O painel não tem sessão
   aqui dentro para avisar o servidor, mas ele reenvia o endereço novo
   sozinho no próximo acesso (sincronizarInscricao, em lib/push.ts): o
   endereço velho recebe 410 no primeiro envio e sai da lista. */
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const antiga = event.oldSubscription || await self.registration.pushManager.getSubscription();
      const chave = antiga && antiga.options && antiga.options.applicationServerKey;
      if (!chave) return;
      await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: chave });
    } catch (e) { /* o painel reinscreve ao abrir */ }
  })());
});
