import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/AuthContext';
import Login from './pages/Login';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import CustomerDetail from './pages/CustomerDetail';
import Products from './pages/Products';
import Orders from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import Funil from './pages/Funil';
import Producao from './pages/Producao';
import Calendario from './pages/Calendario';
import Precificacao from './pages/Precificacao';
import Financeiro from './pages/Financeiro';
import Agenda from './pages/Agenda';
import Inbox from './pages/Inbox';
import Tarefas from './pages/Tarefas';
import Conhecimento from './pages/Conhecimento';
import Automacoes from './pages/Automacoes';
import ConfigIA from './pages/ConfigIA';
import ConfigWhatsApp from './pages/ConfigWhatsApp';
import Expedicao from './pages/Expedicao';
import NovoEnvio from './pages/NovoEnvio';
import Shipments from './pages/Shipments';
import ShipmentDetail from './pages/ShipmentDetail';
import FreteSettings from './pages/FreteSettings';
import Logs from './pages/Logs';
import Placeholder from './pages/Placeholder';
import Stub from './pages/Stub';
import Estoque from './pages/Estoque';
import ConteudoSite from './pages/ConteudoSite';
import Marketing from './pages/Marketing';
import Relatorios from './pages/Relatorios';
import Configuracoes from './pages/Configuracoes';
import { Search, BarChart3 } from 'lucide-react';
import type { ReactNode } from 'react';

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, me, loading, signOut } = useAuth();
  if (loading) return <div className="fullscreen-center muted">Carregando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  // Autenticado no Supabase, mas ainda não provisionado como membro (staff).
  if (!me) {
    return (
      <div className="fullscreen-center">
        <div className="empty-card">
          <p className="empty-emoji">🔒</p>
          <p><strong>Seu usuário ainda não tem acesso ao sistema.</strong></p>
          <p className="muted">Peça a um administrador para liberar seu cadastro (tabela <code>staff</code>).</p>
          <button className="btn btn-ghost" onClick={() => signOut()}>Sair</button>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="agenda" element={<Agenda />} />
        <Route path="producao" element={<Producao />} />
        <Route path="calendario" element={<Calendario />} />
        <Route path="precificacao" element={<Precificacao />} />
        <Route path="financeiro" element={<Financeiro />} />
        <Route path="clientes" element={<Customers />} />
        <Route path="clientes/:id" element={<CustomerDetail />} />
        <Route path="produtos" element={<Products />} />
        <Route path="pedidos" element={<Orders />} />
        <Route path="pedidos/:id" element={<OrderDetail />} />
        <Route path="expedicao" element={<Expedicao />} />
        <Route path="expedicao/novo" element={<NovoEnvio />} />
        <Route path="envios" element={<Shipments />} />
        <Route path="envios/:id" element={<ShipmentDetail />} />
        <Route path="config/frenet" element={<FreteSettings />} />
        <Route path="config/logs" element={<Logs />} />
        <Route path="funil" element={<Funil />} />
        <Route path="tarefas" element={<Tarefas />} />
        <Route path="conhecimento" element={<Conhecimento />} />
        <Route path="config/ia" element={<ConfigIA />} />
        <Route path="config/whatsapp" element={<ConfigWhatsApp />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="automacoes" element={<Automacoes />} />
        <Route path="estoque" element={<Estoque />} />
        <Route path="site/conteudo" element={<ConteudoSite />} />
        <Route path="site/seo" element={<Stub icon={Search} title="SEO" subtitle="Como a loja aparece no Google e nas redes."
          bullets={['Título e meta description (global e por página)', 'Open Graph e imagem de compartilhamento', 'SEO por produto (title, slug, descrição)', 'Sitemap e robots preservados']} phase="Fase E" />} />
        <Route path="marketing" element={<Marketing />} />
        <Route path="analytics" element={<Stub icon={BarChart3} title="Analytics" subtitle="Da visita à compra — o funil da loja."
          bullets={['Visitantes, sessões e conversão', 'Funil: visita → produto → carrinho → checkout → compra', 'Produtos mais vistos e mais vendidos', 'Origem dos visitantes e das vendas']} phase="Fase H" />} />
        <Route path="relatorios" element={<Relatorios />} />
        <Route path="config" element={<Configuracoes />} />
        <Route path="campanhas" element={<Navigate to="/marketing" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
