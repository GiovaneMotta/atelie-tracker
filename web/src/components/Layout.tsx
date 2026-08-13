import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/api';

interface NavItemDef { to: string; label: string; icon: string; perm?: string; end?: boolean; }

const NAV: NavItemDef[] = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/agenda', label: 'Agenda', icon: '📅' },
  { to: '/expedicao', label: 'Expedição', icon: '📮', perm: 'shipments.read', end: true },
  { to: '/envios', label: 'Envios', icon: '🚚', perm: 'shipments.read' },
  { to: '/inbox', label: 'Inbox', icon: '💬', perm: 'conversations.read' },
  { to: '/funil', label: 'Funil', icon: '🗂️' },
  { to: '/clientes', label: 'Clientes', icon: '👥', perm: 'customers.read' },
  { to: '/produtos', label: 'Produtos', icon: '🧸', perm: 'products.read' },
  { to: '/pedidos', label: 'Pedidos', icon: '📦', perm: 'orders.read' },
  { to: '/tarefas', label: 'Tarefas', icon: '✅' },
  { to: '/automacoes', label: 'Automações', icon: '🤖', perm: 'automations.read' },
  { to: '/campanhas', label: 'Campanhas', icon: '📣', perm: 'campaigns.write' },
  { to: '/conhecimento', label: 'Conhecimento', icon: '📚' },
  { to: '/config/ia', label: 'Atendente IA', icon: '✨' },
  { to: '/config/frenet', label: 'Frenet', icon: '⚙️', perm: 'settings.read' },
  { to: '/config/logs', label: 'Logs', icon: '📋', perm: 'settings.read' },
];

export default function Layout() {
  const { me, signOut, can } = useAuth();
  const [open, setOpen] = useState(false);
  const [env, setEnv] = useState<{ environment: string; partner_configured: boolean } | null>(null);

  useEffect(() => { apiFetch<{ environment: string; partner_configured: boolean }>('/api/frenet-env').then(setEnv).catch(() => setEnv(null)); }, []);

  const items = NAV.filter((n) => !n.perm || can(n.perm));

  return (
    <div className="shell">
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="brand">
          <span className="brand-mark">🧸</span>
          <div className="brand-txt">
            <strong>Ateliê da Lili</strong>
            <span>CRM</span>
          </div>
        </div>
        <nav className="nav">
          {items.map((n) => (
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
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <div className="who-avatar">{(me?.name || '?').charAt(0).toUpperCase()}</div>
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
          <strong>Ateliê da Lili · CRM</strong>
          <span />
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
