export default function Placeholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="page">
      <div className="page-head">
        <h1>{title}</h1>
      </div>
      <div className="empty-card">
        <p className="empty-emoji">🚧</p>
        <p><strong>Este módulo chega na {phase}.</strong></p>
        <p className="muted">
          A fundação (banco, login e API) já está pronta. As telas são construídas fase a fase,
          conforme o roadmap — cada uma ligada de verdade ao backend.
        </p>
      </div>
    </div>
  );
}
