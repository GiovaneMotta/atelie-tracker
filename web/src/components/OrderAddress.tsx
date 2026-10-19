/* ====================================================================
   Endereço de entrega do pedido.

   Até agora nenhuma tela do painel gravava orders.address_id: o pedido
   chegava em "Aguardando endereço" sem caminho de saída. Pior, o pedido
   criado pelo site nasce com um endereço só de CEP (create_site_order
   guarda label "Site" + cep), porque lá o CEP serve só para cotar frete.
   Entregar exige rua, número, bairro, cidade e UF.

   Aqui dá para completar o que veio do site, trocar por outro endereço
   do cliente ou cadastrar um novo.
   ==================================================================== */
import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { useAuth } from '../auth/AuthContext';

export interface Address {
  id: string;
  label?: string | null;
  recipient?: string | null;
  complement?: string | null;
  reference?: string | null;
  street: string | null;
  number: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  cep: string | null;
}

export function enderecoCompleto(a: Address | null | undefined): boolean {
  return Boolean(a && a.street && a.number && a.city && a.state);
}

export function faltaNoEndereco(a: Address): string[] {
  const falta: string[] = [];
  if (!a.street) falta.push('rua');
  if (!a.number) falta.push('número');
  if (!a.district) falta.push('bairro');
  if (!a.city) falta.push('cidade');
  if (!a.state) falta.push('UF');
  return falta;
}

export function resumoEndereco(a: Address): string {
  const linha1 = [a.street, a.number].filter(Boolean).join(', ');
  const linha2 = [a.district, a.city, a.state].filter(Boolean).join(' · ');
  const texto = [linha1, linha2, a.cep].filter(Boolean).join(' — ');
  return texto || '(apenas CEP)';
}

const VAZIO: Record<string, string> = {
  label: '', recipient: '', cep: '', street: '', number: '',
  complement: '', district: '', city: '', state: '', reference: '',
};

interface Props {
  orderId: string;
  customerId: string | null;
  address: Address | null;
  onChanged: () => void;
}

export default function OrderAddress({ orderId, customerId, address, onChanged }: Props) {
  const { can } = useAuth();
  const [lista, setLista] = useState<Address[]>([]);
  const [editando, setEditando] = useState(false);
  const [trocando, setTrocando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [f, setF] = useState<Record<string, string>>(VAZIO);

  const editavel = can('customers.write') && can('orders.write');
  const completo = enderecoCompleto(address);

  async function carregarLista() {
    if (!customerId) return;
    try {
      const d = await apiFetch<{ addresses: Address[] }>(`/api/customers?id=${customerId}`);
      setLista(d.addresses ?? []);
    } catch { setLista([]); }
  }

  function abrirEdicao() {
    setErro('');
    if (address) {
      setF({
        label: address.label ?? '', recipient: address.recipient ?? '', cep: address.cep ?? '',
        street: address.street ?? '', number: address.number ?? '', complement: address.complement ?? '',
        district: address.district ?? '', city: address.city ?? '', state: address.state ?? '',
        reference: address.reference ?? '',
      });
    } else {
      setF(VAZIO);
    }
    setEditando(true);
  }

  /* CEP preenche rua/bairro/cidade/UF; se não achar, a pessoa digita. */
  async function aoDigitarCep(cep: string) {
    setF((s) => ({ ...s, cep }));
    const limpo = cep.replace(/[^0-9]/g, '');
    if (limpo.length !== 8) return;
    try {
      const d = await apiFetch<{ street?: string; district?: string; city?: string; state?: string }>(`/api/cep?cep=${limpo}`);
      setF((s) => ({
        ...s,
        street: d.street || s.street,
        district: d.district || s.district,
        city: d.city || s.city,
        state: d.state || s.state,
      }));
    } catch { /* CEP não encontrado: segue no preenchimento manual */ }
  }

  async function salvar() {
    if (!customerId) { setErro('Vincule um cliente ao pedido antes de definir o endereço.'); return; }
    setBusy(true); setErro('');
    try {
      if (address) {
        await apiFetch(`/api/addresses?id=${address.id}`, { method: 'PATCH', body: JSON.stringify(f) });
      } else {
        const d = await apiFetch<{ address: Address }>('/api/addresses', {
          method: 'POST', body: JSON.stringify({ ...f, customer_id: customerId }),
        });
        await apiFetch(`/api/orders?id=${orderId}`, { method: 'PATCH', body: JSON.stringify({ address_id: d.address.id }) });
      }
      setEditando(false);
      onChanged();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar o endereço.');
    } finally { setBusy(false); }
  }

  async function usar(a: Address) {
    setBusy(true); setErro('');
    try {
      await apiFetch(`/api/orders?id=${orderId}`, { method: 'PATCH', body: JSON.stringify({ address_id: a.id }) });
      setTrocando(false);
      onChanged();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao trocar o endereço.');
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <h3>Endereço de entrega</h3>

      {!customerId && <p className="muted small">Vincule um cliente ao pedido para definir o endereço.</p>}

      {address && !editando && (
        <>
          <p>{resumoEndereco(address)}</p>
          {!completo && (
            <p className="aviso-incompleto">
              Endereço incompleto — falta {faltaNoEndereco(address).join(', ')}. Não dá para gerar etiqueta assim.
            </p>
          )}
        </>
      )}
      {!address && !editando && customerId && <p className="muted">Nenhum endereço definido.</p>}

      {editando && (
        <div className="form-grid">
          <label className="field"><span>CEP</span>
            <input value={f.cep} onChange={(e) => aoDigitarCep(e.target.value)} placeholder="00000-000" /></label>
          <label className="field"><span>Rua</span>
            <input value={f.street} onChange={(e) => setF({ ...f, street: e.target.value })} /></label>
          <label className="field"><span>Número</span>
            <input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></label>
          <label className="field"><span>Complemento</span>
            <input value={f.complement} onChange={(e) => setF({ ...f, complement: e.target.value })} /></label>
          <label className="field"><span>Bairro</span>
            <input value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} /></label>
          <label className="field"><span>Cidade</span>
            <input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
          <label className="field"><span>UF</span>
            <input value={f.state} maxLength={2} onChange={(e) => setF({ ...f, state: e.target.value.toUpperCase() })} /></label>
          <label className="field"><span>Destinatário</span>
            <input value={f.recipient} onChange={(e) => setF({ ...f, recipient: e.target.value })} placeholder="se for diferente do cliente" /></label>
          <label className="field span-all"><span>Ponto de referência</span>
            <input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></label>
        </div>
      )}

      {erro && <div className="alert-error">{erro}</div>}

      {editavel && (
        <div className="form-actions">
          {editando ? (
            <>
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={salvar}>
                {busy ? 'Salvando…' : 'Salvar endereço'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditando(false)}>Cancelar</button>
            </>
          ) : customerId ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={abrirEdicao}>
                {address ? (completo ? 'Editar' : 'Completar endereço') : 'Definir endereço'}
              </button>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { const abrir = !trocando; setTrocando(abrir); if (abrir) carregarLista(); }}>
                Usar outro
              </button>
            </>
          ) : null}
        </div>
      )}

      {trocando && !editando && (
        <div className="picker">
          {lista.filter((a) => a.id !== address?.id).length === 0 && (
            <p className="muted small">Este cliente não tem outros endereços.</p>
          )}
          {lista.filter((a) => a.id !== address?.id).map((a) => (
            <button key={a.id} className="picker-opt" disabled={busy} onClick={() => usar(a)}>
              {a.label ? a.label + ' — ' : ''}{resumoEndereco(a)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
