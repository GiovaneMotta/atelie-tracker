export function formatBRL(value: number | string | null | undefined): string {
  const n = typeof value === 'string' ? parseBRL(value) : Number(value || 0);
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

/** "R$ 1.349,90" | "349,00" | "349.9" -> número. */
export function parseBRL(input: string | number | null | undefined): number {
  if (typeof input === 'number') return input;
  if (!input) return 0;
  let s = String(input).replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // vírgula = decimal BR
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const ORDER_STATUS: Record<string, string> = {
  rascunho: 'Rascunho',
  em_atendimento: 'Em atendimento',
  aguardando_pagamento: 'Aguardando pagamento',
  pago: 'Pago',
  aguardando_endereco: 'Aguardando endereço',
  aguardando_etiqueta: 'Aguardando etiqueta',
  etiqueta_gerada: 'Etiqueta gerada',
  postado: 'Postado',
  em_transito: 'Em trânsito',
  saiu_entrega: 'Saiu para entrega',
  entregue: 'Entregue',
  problema: 'Problema na entrega',
  pos_venda: 'Pós-venda',
  cancelado: 'Cancelado',
};

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatWeight(kg: number | string | null | undefined): string {
  const n = Number(kg) || 0;
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg`;
}

export const onlyDigits = (s: unknown): string => String(s ?? '').replace(/\D/g, '');

export function maskCep(v: string): string {
  const d = onlyDigits(v).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
export function maskPhone(v: string): string {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
export function maskCpfCnpj(v: string): string {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11) {
    return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  }
  return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
}

/** Estados internos do envio (§18) — rótulo e tom (classe de badge). */
export const SHIPMENT_STATUS: Record<string, string> = {
  rascunho: 'Rascunho',
  cotando: 'Cotando',
  cotado: 'Cotado',
  aguardando_confirmacao: 'Aguardando confirmação',
  gerando: 'Gerando etiqueta…',
  etiqueta_gerada: 'Etiqueta gerada',
  postado: 'Postado',
  em_transito: 'Em trânsito',
  saiu_entrega: 'Saiu para entrega',
  entregue: 'Entregue',
  problema: 'Problema',
  cancelado: 'Cancelado',
  erro: 'Erro',
};
export const SHIPMENT_STATUS_TONE: Record<string, string> = {
  entregue: 'ok', etiqueta_gerada: 'ok', postado: 'info', em_transito: 'info',
  saiu_entrega: 'info', aguardando_confirmacao: 'warn', gerando: 'warn',
  problema: 'bad', erro: 'bad', cancelado: 'muted',
};

/** Rótulo humano do código original de rastreio da Frenet (§25). */
export const TRACKING_CODE_LABEL: Record<string, string> = {
  '18': 'Aguardando coleta', '0': 'Postado', '1': 'Em trânsito', '2': 'Atraso',
  '3': 'Devolvido', '4': 'Extraviado', '5': 'Saiu para entrega', '9': 'Entregue',
};

/** Etapas da timeline do envio (§22). */
export const SHIPMENT_TIMELINE = [
  { key: 'cotado', label: 'Cotação' },
  { key: 'aguardando_confirmacao', label: 'Serviço escolhido' },
  { key: 'etiqueta_gerada', label: 'Etiqueta gerada' },
  { key: 'postado', label: 'Postado' },
  { key: 'em_transito', label: 'Em trânsito' },
  { key: 'saiu_entrega', label: 'Saiu para entrega' },
  { key: 'entregue', label: 'Entregue' },
];

/** Próximos status válidos a partir do atual (espelha a máquina de estados do banco §53). */
export const NEXT_STATUS: Record<string, string[]> = {
  /* Reservar a peca acontece ao entrar em 'aguardando_pagamento'.
     'em_atendimento' existe para a conversa que ainda nao fechou. */
  rascunho: ['em_atendimento', 'aguardando_pagamento', 'cancelado'],
  em_atendimento: ['aguardando_pagamento', 'cancelado'],
  aguardando_pagamento: ['pago', 'cancelado'],
  pago: ['aguardando_endereco', 'aguardando_etiqueta', 'cancelado'],
  aguardando_endereco: ['aguardando_etiqueta', 'cancelado'],
  aguardando_etiqueta: ['etiqueta_gerada', 'cancelado'],
  etiqueta_gerada: ['postado', 'cancelado'],
  postado: ['em_transito', 'entregue', 'problema'],
  em_transito: ['saiu_entrega', 'entregue', 'problema'],
  saiu_entrega: ['entregue', 'problema'],
  entregue: ['pos_venda'],
  problema: ['em_transito', 'entregue', 'cancelado'],
  pos_venda: [],
  cancelado: [],
};

/* Imagens do produto vivem no site publico, nao no painel. */
export const SITE_BASE = 'https://ateliedalili-site.pages.dev';

function isAbsolute(u: string): boolean {
  return u.startsWith('http://') || u.startsWith('https://');
}

/** Caminho relativo do catalogo -> URL absoluta no site. */
export function displaySrc(u: string): string {
  if (isAbsolute(u)) return u;
  let rel = u;
  while (rel.startsWith('/')) rel = rel.slice(1);
  return SITE_BASE + '/' + rel;
}

/** Versao leve (500px) da mesma foto:
    images/menina/g001-1.jpg -> images/menina/thumb/g001-1.jpg
    URL absoluta (ex.: storage do Supabase) nao tem miniatura: devolve ela mesma. */
export function thumbSrc(u: string): string {
  if (isAbsolute(u)) return u;
  const corte = u.lastIndexOf('/');
  if (corte < 0) return displaySrc(u);
  return displaySrc(u.slice(0, corte) + '/thumb/' + u.slice(corte + 1));
}
