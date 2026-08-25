import type { ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, CreditCard, Truck, Megaphone, Search, Globe, Users, Bell, ArrowRight,
} from 'lucide-react';

type IconType = ComponentType<{ size?: number; strokeWidth?: number }>;
interface Area { icon: IconType; title: string; desc: string; to?: string; ready?: boolean; }

const AREAS: Area[] = [
  { icon: Building2, title: 'Geral', desc: 'Dados da loja, contato, horário e informações da empresa.' },
  { icon: CreditCard, title: 'Pagamento', desc: 'InfinitePay — chaves, métodos e confirmação por webhook.' },
  { icon: Truck, title: 'Frete', desc: 'Frenet — origem, token e serviços de entrega.', to: '/config/frenet', ready: true },
  { icon: Megaphone, title: 'Marketing e rastreamento', desc: 'Meta Pixel, GA4, GTM e geração de UTMs.' },
  { icon: Search, title: 'SEO', desc: 'Título, descrição, Open Graph e indexação.' },
  { icon: Globe, title: 'Site / Conteúdo', desc: 'Textos, banners, vitrines e informações do site.', to: '/site/conteudo' },
  { icon: Users, title: 'Usuários e permissões', desc: 'Equipe, papéis e acessos (admin, atendente, expedição, financeiro).' },
  { icon: Bell, title: 'Notificações', desc: 'Alertas de novo pedido, pagamento, estoque e integrações.' },
];

export default function Configuracoes() {
  const navigate = useNavigate();
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="dash-ov">Sistema</div>
          <h1>Configurações</h1>
          <p className="dash-sub">Central de ajustes do painel e da loja.</p>
        </div>
      </div>

      <div className="settings-grid">
        {AREAS.map((a) => (
          <button
            key={a.title}
            className={`setting-card ${a.ready ? '' : 'is-soon'}`}
            onClick={() => a.to && navigate(a.to)}
            disabled={!a.to}
          >
            <div className="setting-ico"><a.icon size={19} strokeWidth={1.9} /></div>
            <div className="setting-bd">
              <div className="setting-top">
                <strong>{a.title}</strong>
                {a.ready ? <span className="pill pill-ok">Pronto</span> : <span className="pill">Em breve</span>}
              </div>
              <p>{a.desc}</p>
            </div>
            {a.to && <span className="setting-go"><ArrowRight size={16} /></span>}
          </button>
        ))}
      </div>
    </div>
  );
}
