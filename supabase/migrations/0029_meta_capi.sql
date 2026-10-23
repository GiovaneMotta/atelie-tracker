-- =====================================================================
-- 0029_meta_capi.sql        NAO APLICADA — para revisao
--
-- (O numero 0028 ficou com a bateria de testes em supabase/testes/.
--  Reusar aqui daria dois arquivos "0028" com propositos diferentes.)
--
-- Fila de eventos para a API de Conversoes da Meta.
--
-- POR QUE UMA TABELA, E NAO so um POST na hora do pagamento:
--
--   * O pagamento NAO pode depender da Meta. Se o Gerenciador de
--     Eventos estiver fora do ar, o pedido tem que ser marcado como
--     pago do mesmo jeito. Entao a gravacao vem primeiro e o envio e
--     uma segunda etapa, que pode falhar sem derrubar nada.
--   * Falhou? Fica pendente e e reenviado. Sem fila, o evento se perde
--     em silencio e a venda nunca chega a Meta.
--   * "Enviado" so depois de LER a resposta da Meta. Marcar como
--     entregue por ter disparado a requisicao e mentir para si mesmo.
--
-- IDEMPOTENCIA: event_id e unico e derivado do pedido
-- ('purchase-<order_id>'). Clicar duas vezes em "pago", ou dois pedidos
-- de reenvio ao mesmo tempo, esbarram no indice unico — nao viram duas
-- vendas. E e o mesmo event_id que o Pixel usaria, que e como a Meta
-- deduplica navegador x servidor.
--
-- ADITIVA: 1 tabela. Nao altera nada do que existe.
-- Rollback no fim.
-- =====================================================================

create table if not exists public.meta_events (
  id          uuid primary key default gen_random_uuid(),
  -- 'purchase-<order_id>': estavel, e o que a Meta usa para deduplicar
  event_id    text not null unique,
  event_name  text not null default 'Purchase',
  order_id    uuid references public.orders(id) on delete cascade,
  -- pendente | enviado | erro
  status      text not null default 'pendente',
  attempts    integer not null default 0,
  -- o que foi enviado, para conferir sem adivinhar
  payload     jsonb,
  -- o que a Meta respondeu, inteiro
  response    jsonb,
  last_error  text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_meta_events_pendentes
  on public.meta_events (created_at)
  where status <> 'enviado';

create index if not exists idx_meta_events_order
  on public.meta_events (order_id);

create trigger trg_meta_events_updated before update on public.meta_events
  for each row execute function public.set_updated_at();

comment on table public.meta_events is
  'Fila de eventos enviados a API de Conversoes da Meta. Uma linha por venda, event_id unico.';

-- RLS como no resto do schema: o navegador so LE, e a escrita e sempre
-- pela API, com service role.
-- A permissao e orders.read, nao settings: cada linha aqui e o espelho
-- de uma venda, e quem acompanha venda e quem precisa ver se o evento
-- saiu. (settings.read nao existe no schema; so settings.write.)
alter table public.meta_events enable row level security;
drop policy if exists meta_events_read on public.meta_events;
create policy meta_events_read on public.meta_events
  for select using (public.auth_has_permission('orders.read'));

-- =====================================================================
-- ROLLBACK
--   drop table if exists public.meta_events;
-- =====================================================================
