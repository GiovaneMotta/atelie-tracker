import type { ComponentType } from 'react';
import { Check } from 'lucide-react';

type IconType = ComponentType<{ size?: number; strokeWidth?: number }>;

/** Página-esqueleto de um módulo que ainda será construído (Fase A monta a
 *  estrutura; as fases seguintes preenchem). Visual do design system. */
export default function Stub({ icon: Icon, title, subtitle, desc, bullets = [], phase }: {
  icon: IconType; title: string; subtitle?: string; desc?: string; bullets?: string[]; phase?: string;
}) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="dash-ov">Painel</div>
          <h1>{title}</h1>
          {subtitle && <p className="dash-sub">{subtitle}</p>}
        </div>
      </div>

      <div style={{
        maxWidth: 620, background: 'var(--surface)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-xs)', padding: '30px 30px 28px',
      }}>
        <div style={{
          width: 46, height: 46, borderRadius: 12, display: 'grid', placeItems: 'center',
          background: 'var(--terracota-tint)', color: 'var(--terracota)', marginBottom: 16,
        }}>
          <Icon size={22} strokeWidth={1.9} />
        </div>
        <h2 style={{ fontSize: '1.15rem', marginBottom: 6 }}>Em construção</h2>
        <p className="muted" style={{ marginBottom: bullets.length ? 18 : 4 }}>
          {desc || 'A base (banco, login, API e permissões) já está pronta. Esta tela é construída na fase indicada, ligada de verdade ao backend.'}
        </p>

        {bullets.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {bullets.map((b, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: '.9rem', color: 'var(--ink-soft)' }}>
                <span style={{ marginTop: 1, color: 'var(--terracota)', flexShrink: 0 }}><Check size={16} strokeWidth={2.2} /></span>
                {b}
              </li>
            ))}
          </ul>
        )}

        {phase && (
          <span style={{
            display: 'inline-block', marginTop: 22, fontSize: '.74rem', fontWeight: 600,
            color: 'var(--ink-soft)', background: 'var(--surface-tint)', border: '1px solid var(--line)',
            borderRadius: 999, padding: '5px 12px',
          }}>Planejado para a {phase}</span>
        )}
      </div>
    </div>
  );
}
