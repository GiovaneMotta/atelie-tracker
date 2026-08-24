import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/api';

interface NavItemDef { to: string; label: string; icon: string; perm?: string; end?: boolean; }
interface NavGroup { title: string; items: NavItemDef[]; }

// ===== FOCO ATUAL: operação / logística (catálogo, pedidos, expedição) =====
// O atendimento no WhatsApp fica no TResCRM; aqui focamos no que ele não faz.
const NAV: NavGroup[] = [
  { title: 'Operação', items: [
    { to: '/', label: 'Dashboard', icon: '📊', end: true },
    { to: '/pedidos', label: 'Pedidos', icon: '📦', perm: 'orders.read' },
    { to: '/producao', label: 'Produção', icon: '🏭', perm: 'production.read' },
    { to: '/expedicao', label: 'Expedição', icon: '📮', perm: 'shipments.read', end: true },
    { to: '/envios', label: 'Envios', icon: '🚚', perm: 'shipments.read' },
    { to: '/calendario', label: 'Calendário', icon: '🗓️', perm: 'production.read' },
  ] },
  { title: 'Catálogo', items: [
    { to: '/produtos', label: 'Produtos', icon: '🧸', perm: 'products.read' },
    { to: '/precificacao', label: 'Precificação', icon: '💰', perm: 'products.read' },
  ] },
  { title: 'Gestão', items: [
    { to: '/financeiro', label: 'Financeiro', icon: '💵', perm: 'finance.read' },
    { to: '/clientes', label: 'Clientes', icon: '👥', perm: 'customers.read' },
    { to: '/tarefas', label: 'Tarefas', icon: '✅' },
  ] },
  { title: 'Configurações', items: [
    { to: '/config/frenet', label: 'Frenet', icon: '⚙️', perm: 'settings.read' },
    { to: '/config/logs', label: 'Logs', icon: '📋', perm: 'settings.read' },
  ] },
];

// ===== ESCONDIDOS (não deletados) — módulos de atendimento/marketing no
// WhatsApp. As páginas e rotas continuam existindo; basta mover de volta
// para NAV quando quisermos reativá-los (ex.: com um número dedicado).
// Agenda, Inbox, Funil, Automações, Campanhas, Conhecimento, Atendente IA, WhatsApp.
// ==========================================================================

const SITE_URL = 'https://ateliedalili-site.pages.dev';

export default function Layout() {
  const { me, signOut, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [env, setEnv] = useState<{ environment: string; partner_configured: boolean } | null>(null);

  useEffect(() => { apiFetch<{ environment: string; partner_configured: boolean }>('/api/frenet-env').then(setEnv).catch(() => setEnv(null)); }, []);

  const groups = useMemo(() => {
    const term = q.trim().toLowerCase();
    return NAV
      .map((g) => ({ ...g, items: g.items.filter((n) => (!n.perm || can(n.perm)) && (!term || n.label.toLowerCase().includes(term))) }))
      .filter((g) => g.items.length > 0);
  }, [q, can]);

  const initial = (me?.name || '?').charAt(0).toUpperCase();

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">🧸</span>
          <div className="brand-txt">
            <strong>Ateliê da Lili</strong>
            <span>Painel</span>
          </div>
        </div>

        <div className="nav-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
          </svg>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar no menu…" aria-label="Buscar no menu" />
        </div>

        <nav className="nav">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="nav-section">{g.title}</div>
              {g.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={Boolean(n.end)}
                  className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}
                  onClick={() => setOpen(false)}
                >
                  <span className="nav-ico">{n.icon}</span> {n.label}
                </NavLink>
              ))}
            </div>
          ))}
          {groups.length === 0 && <div className="nav-empty">Nada encontrado.</div>}
        </nav>

        <div className="sidebar-foot">
          <div className="who">
            <div className="who-avatar">{initial}</div>
            <div className="who-txt">
              <strong>{me?.name || '—'}</strong>
              <span>{me?.email}</span>
            </div>
          </div>
          <button className="btn btn-ghost btn-block" onClick={() => signOut()}>Sair</button>
        </div>
      </aside>

      <div className="content">
        <header className="topbar">
          <button className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label="Menu">☰</button>
          <div className="topbar-brand only-mobile"><span>🧸</span> Ateliê da Lili</div>
          <div className="topbar-spacer" />
          <a className="topbar-link" href={SITE_URL} target="_blank" rel="noreferrer" title="Abrir o site público">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" />
            </svg>
            Ver no site
          </a>
          <div className="topbar-user">
            <div className="who-avatar sm">{initial}</div>
          </div>
        </header>

        {env?.environment === 'homologacao' && (
          <div className="env-banner">⚠️ AMBIENTE DE HOMOLOGAÇÃO — envios e etiquetas são de teste{!env.partner_configured ? ' · Partner Token não configurado' : ''}.</div>
        )}
        <main className="main">
          <Outlet />
        </main>
      </div>

      {open && <div className="scrim" onClick={() => setOpen(false)} />}
    </div>
  );
}
