import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  LayoutDashboard, ShoppingBag, Factory, PackageCheck, Truck, Calendar,
  Package, Boxes, Tags, Wallet, Users, CheckSquare, Settings2, ScrollText,
  Globe, Megaphone, BarChart3, FileText, Search, ExternalLink, Menu,
} from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { apiFetch } from '../lib/api';

type Icon = ComponentType<{ size?: number; strokeWidth?: number }>;
interface NavItemDef { to: string; label: string; icon: Icon; perm?: string; end?: boolean; }
interface NavGroup { title: string; items: NavItemDef[]; }

// Foco atual: operação/logística. Atendimento (WhatsApp/IA) fica oculto por ora.
const NAV: NavGroup[] = [
  { title: 'Principal', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  ] },
  { title: 'Vendas', items: [
    { to: '/pedidos', label: 'Pedidos', icon: ShoppingBag, perm: 'orders.read' },
    { to: '/clientes', label: 'Clientes', icon: Users, perm: 'customers.read' },
    { to: '/financeiro', label: 'Financeiro', icon: Wallet, perm: 'finance.read' },
  ] },
  { title: 'Catálogo', items: [
    { to: '/produtos', label: 'Produtos', icon: Package, perm: 'products.read' },
    { to: '/estoque', label: 'Estoque', icon: Boxes, perm: 'products.read' },
    { to: '/precificacao', label: 'Precificação', icon: Tags, perm: 'products.read' },
  ] },
  { title: 'Operação', items: [
    { to: '/producao', label: 'Produção', icon: Factory, perm: 'production.read' },
    { to: '/expedicao', label: 'Expedição', icon: PackageCheck, perm: 'shipments.read', end: true },
    { to: '/envios', label: 'Envios', icon: Truck, perm: 'shipments.read' },
    { to: '/calendario', label: 'Calendário', icon: Calendar, perm: 'production.read' },
    { to: '/tarefas', label: 'Tarefas', icon: CheckSquare },
  ] },
  { title: 'Site', items: [
    { to: '/site/conteudo', label: 'Conteúdo', icon: Globe, perm: 'settings.read' },
    { to: '/site/seo', label: 'SEO', icon: Search, perm: 'settings.read' },
  ] },
  { title: 'Crescimento', items: [
    { to: '/marketing', label: 'Marketing', icon: Megaphone, perm: 'settings.read' },
    { to: '/analytics', label: 'Analytics', icon: BarChart3, perm: 'orders.read' },
    { to: '/relatorios', label: 'Relatórios', icon: FileText, perm: 'orders.read' },
  ] },
  { title: 'Sistema', items: [
    { to: '/config', label: 'Configurações', icon: Settings2, perm: 'settings.read', end: true },
    { to: '/config/logs', label: 'Logs', icon: ScrollText, perm: 'settings.read' },
  ] },
];

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
          <span className="brand-mark">A</span>
          <div className="brand-txt">
            <strong>Ateliê da Lili</strong>
            <span>Painel</span>
          </div>
        </div>

        <div className="nav-search">
          <Search size={15} strokeWidth={2} />
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
                  <n.icon size={17} strokeWidth={1.9} /> {n.label}
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
          <button className="icon-btn" onClick={() => setOpen((v) => !v)} aria-label="Menu"><Menu size={22} /></button>
          <div className="topbar-brand only-mobile"><span className="brand-mark">A</span> Ateliê da Lili</div>
          <div className="topbar-spacer" />
          <a className="topbar-link" href={SITE_URL} target="_blank" rel="noreferrer" title="Abrir o site público">
            <ExternalLink size={15} /> Ver no site
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
