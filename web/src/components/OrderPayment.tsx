/* ====================================================================
   Pagamento do pedido.

   O estado é consequência de um fato: registra-se a forma de pagamento,
   e o status do pedido avança junto. A sequência de PATCH é a MESMA de
   sempre — é ela que o backend usa para disparar o Purchase (CAPI).
   Aqui só adicionamos confirmação e um aviso claro desse disparo, e a
   possibilidade de abrir o formulário a partir da "ação principal".
   ==================================================================== */
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

export const FORMAS: { key: string; label: string }[] = [
  { key: 'pix', label: 'Pix' },
  { key: 'cartao', label: 'Cartão' },
  { key: 'link', label: 'Link de pagamento' },
  { key: 'dinheiro', label: 'Dinheiro' },
  { key: 'transferencia', label: 'Transferência' },
];

const SITUACAO: Record<string, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
  estornado: 'Estornado',
  falhou: 'Falhou',
};

interface Props {
  orderId: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  onChanged: () => void;
  /** Incrementado pela "ação principal" para abrir e rolar até aqui. */
  openSignal?: number;
}

export default function OrderPayment({ orderId, status, paymentStatus, paymentMethod, onChanged, openSignal = 0 }: Props) {
  const { can } = useAuth();
  const ref = useRef<HTMLDivElement>(null);
  const [registrando, setRegistrando] = useState(false);
  const [forma, setForma] = useState(paymentMethod || 'pix');
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');

  const pago = paymentStatus === 'pago';
  const podeEditar = can('orders.write');

  // A "ação principal recomendada" (na tela do pedido) pede para abrir aqui.
  useEffect(() => {
    if (openSignal > 0 && !pago && podeEditar) {
      setRegistrando(true);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  async function registrar() {
    const formaLabel = FORMAS.find((f) => f.key === forma)?.label || forma;
    if (!confirm(
      `Registrar o pagamento (${formaLabel}) e confirmar a venda?\n\n` +
      'Isto dispara o evento de compra (Purchase) para a Meta. Não deve ser desfeito sem motivo.'
    )) return;
    setBusy(true); setErro('');
    try {
      await apiFetch(`/api/orders?id=${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ payment_status: 'pago', payment_method: forma }),
      });
      /* O status do pedido é consequência: se ainda estava esperando o
         pagamento, ele anda sozinho. Em rascunho é preciso passar por
         'aguardando_pagamento' primeiro — a máquina de estados do banco
         não aceita pular etapa. */
      if (status === 'aguardando_pagamento') {
        await apiFetch(`/api/orders?id=${orderId}`, { method: 'PATCH', body: JSON.stringify({ status: 'pago' }) });
      } else if (status === 'rascunho') {
        await apiFetch(`/api/orders?id=${orderId}`, { method: 'PATCH', body: JSON.stringify({ status: 'aguardando_pagamento' }) });
        await apiFetch(`/api/orders?id=${orderId}`, { method: 'PATCH', body: JSON.stringify({ status: 'pago' }) });
      }
      setRegistrando(false);
      onChanged();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao registrar o pagamento.');
    } finally { setBusy(false); }
  }

  async function estornar() {
    if (!confirm('Marcar o pagamento como ESTORNADO?\n\nUse quando a cobrança foi devolvida ao cliente.')) return;
    setBusy(true); setErro('');
    try {
      await apiFetch(`/api/orders?id=${orderId}`, {
        method: 'PATCH', body: JSON.stringify({ payment_status: 'estornado' }),
      });
      onChanged();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao estornar.');
    } finally { setBusy(false); }
  }

  return (
    <div className="card" ref={ref} id="card-pagamento">
      <h3>Pagamento</h3>
      <p>
        <span className={'badge' + (pago ? ' badge-ok' : '')}>{SITUACAO[paymentStatus] || paymentStatus}</span>
        {paymentMethod && <span className="muted small"> · {FORMAS.find((f) => f.key === paymentMethod)?.label || paymentMethod}</span>}
      </p>

      {registrando && (
        <>
          <div className="form-grid">
            <label className="field"><span>Forma de pagamento</span>
              <select value={forma} onChange={(e) => setForma(e.target.value)}>
                {FORMAS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
            </label>
          </div>
          <p className="muted small" style={{ marginTop: 2 }}>
            Ao confirmar, a venda é registrada e o <strong>Purchase</strong> é enviado para a Meta.
          </p>
        </>
      )}

      {erro && <div className="alert-error">{erro}</div>}

      {podeEditar && (
        <div className="form-actions">
          {registrando ? (
            <>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={registrar}>
                {busy ? 'Registrando…' : 'Confirmar pagamento'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setRegistrando(false)}>Cancelar</button>
            </>
          ) : pago ? (
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={estornar}>Marcar como estornado</button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={() => setRegistrando(true)}>Registrar pagamento</button>
          )}
        </div>
      )}
    </div>
  );
}
