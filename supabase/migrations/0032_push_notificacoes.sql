-- =====================================================================
-- 0032_push_notificacoes.sql — Notificação push no celular (Web Push)
--
-- DOIS AVISOS, UM CAMINHO SÓ:
--   1. "Novo pedido recebido!"  -> pedido gravado pelo site (channel 'site')
--   2. "Venda aprovada!"        -> transição real do pedido para pago
--
-- POR QUE GATILHO, E NÃO EDITAR A create_site_order
-- O pedido do site nasce dentro da RPC `create_site_order`, que é o
-- caminho crítico da loja: preço, cupom, idempotência e validação de
-- produto. Reescrevê-la para "avisar o celular" colocaria a venda em
-- risco por causa de uma notificação. Em vez disso, um TRIGGER em
-- `orders` enfileira o aviso. A função de criar pedido não muda uma
-- vírgula, e o gatilho roda na MESMA TRANSAÇÃO: tentativa de pedido
-- que falha (produto esgotado, carrinho inválido) faz rollback e não
-- deixa aviso nenhum para trás.
--
-- POR QUE UMA FILA (push_outbox), E NÃO ENVIAR NA HORA
-- O Postgres não fala HTTPS com o serviço de push. Quem envia é o
-- painel (Cloudflare). A fila é o que garante que um aviso não se
-- perca se o painel estiver fora do ar no instante do pedido: a linha
-- fica lá até ser entregue, e a retentativa (pg_cron) a encontra.
--
-- DISPARO 100% NO SERVIDOR
-- `push_poke()` usa pg_net para "cutucar" o painel assim que a
-- transação fecha. Nada depende do navegador da cliente continuar
-- aberto: ela pode fechar a página no mesmo segundo.
--
-- UM AVISO DE CADA TIPO POR PEDIDO POR APARELHO
--   • `push_outbox` tem unique (order_id, kind) -> o evento é único;
--   • o envio por aparelho é travado em `idempotency_keys`, scope
--     'push', chave 'push:<tipo>:<pedido>:<aparelho>' (mesmo padrão do
--     pedido e da etiqueta). Reprocessar a fila não duplica nada.
--
-- SEGURANÇA
--   • `push_devices` guarda a inscrição do navegador (endpoint + chaves
--     do aparelho). RLS ligada e SEM política = invisível ao frontend;
--     só a service role lê/escreve, pela API do painel.
--   • As chaves VAPID NÃO ficam aqui: moram nas variáveis da Cloudflare.
--
-- ADITIVA e idempotente (if not exists / create or replace / on conflict).
-- Não altera pedidos, pagamentos, cupons, preços nem estoque.
-- Rollback completo no fim do arquivo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) PERMISSÃO (§36)
-- ---------------------------------------------------------------------
insert into public.permissions (key, description) values
  ('notifications.manage', 'Ativar notificações e gerenciar aparelhos autorizados')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, 'notifications.manage' from public.roles r where r.key = 'admin'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- 2) APARELHOS INSCRITOS
--    Um por navegador/celular. `endpoint` é a URL que o serviço de push
--    (FCM, Mozilla, WNS) deu para aquele navegador — é a identidade da
--    inscrição, por isso é a chave única.
-- ---------------------------------------------------------------------
create table if not exists public.push_devices (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid references public.staff(id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,          -- chave pública do aparelho (base64url)
  auth            text not null,          -- segredo de autenticação (base64url)
  label           text,                   -- apelido ("Celular da Lili")
  user_agent      text,
  active          boolean not null default true,
  failures        integer not null default 0,
  last_error      text,
  last_success_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.push_devices is
  'Celulares/navegadores inscritos para receber notificação push do painel. Só a service role acessa.';

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_push_devices_updated') then
    create trigger trg_push_devices_updated before update on public.push_devices
      for each row execute function public.set_updated_at();
  end if;
end $$;

create index if not exists idx_push_devices_active on public.push_devices(active) where active;

-- ---------------------------------------------------------------------
-- 3) FILA DE AVISOS
--    Uma linha por (pedido, tipo). O texto da notificação NÃO é guardado
--    aqui: é montado na hora do envio, lendo o pedido. Assim a fila não
--    vira uma segunda cópia dos dados da cliente.
-- ---------------------------------------------------------------------
create table if not exists public.push_outbox (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.orders(id) on delete cascade,
  kind          text not null check (kind in ('novo_pedido', 'venda_aprovada')),
  created_at    timestamptz not null default now(),
  dispatched_at timestamptz,              -- preenchido quando o painel conclui
  attempts      integer not null default 0,
  last_error    text,
  unique (order_id, kind)
);
comment on table public.push_outbox is
  'Fila durável de notificações push. unique(order_id, kind) = um aviso de cada tipo por pedido.';

create index if not exists idx_push_outbox_pendente
  on public.push_outbox(created_at) where dispatched_at is null;

-- ---------------------------------------------------------------------
-- 4) CONFIGURAÇÃO
--    `dispatch_url`: endereço do painel que envia de fato.
--    `push_dispatch_secret`: sorteado aqui, igual ao segredo do webhook
--    de pagamento (0025). Serve para o painel saber que quem cutucou foi
--    o banco. É OPCIONAL: o painel só exige o segredo se a variável
--    PUSH_DISPATCH_SECRET estiver cadastrada na Cloudflare.
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('push', jsonb_build_object(
     'dispatch_url', 'https://atelie-tracker.pages.dev/api/push-dispatch',
     'enabled', true))
on conflict (key) do nothing;

insert into public.app_settings (key, value)
select 'push_dispatch_secret', to_jsonb(encode(gen_random_bytes(24), 'hex'))
 where not exists (select 1 from public.app_settings where key = 'push_dispatch_secret');

-- ---------------------------------------------------------------------
-- 5) pg_net — o que permite o banco chamar o painel por HTTPS.
--    Se não der para criar aqui (permissão), ligue em
--    Database → Extensions → pg_net no painel do Supabase.
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    begin
      create extension pg_net;
    exception when others then
      raise notice 'pg_net não pôde ser criada aqui (%). Ligue em Database → Extensions.', sqlerrm;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6) O "cutucão": avisa o painel que há coisa na fila.
--    Blindada de propósito — QUALQUER erro aqui é engolido. Um pedido
--    jamais pode falhar porque a notificação não saiu.
-- ---------------------------------------------------------------------
create or replace function public.push_poke()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url     text;
  v_secret  text;
  v_headers text;
  v_on      boolean;
begin
  -- nada pendente: não incomoda o painel
  if not exists (select 1 from public.push_outbox where dispatched_at is null) then
    return;
  end if;

  select (value->>'dispatch_url'), coalesce((value->>'enabled')::boolean, true)
    into v_url, v_on
    from public.app_settings where key = 'push';
  if v_url is null or v_url = '' or not v_on then
    return;
  end if;

  select value #>> '{}' into v_secret
    from public.app_settings where key = 'push_dispatch_secret';

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    return;                       -- sem pg_net, a retentativa do painel resolve
  end if;

  v_headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'X-Push-Secret', coalesce(v_secret, '')
  )::text;

  /* Versões antigas da pg_net não têm `timeout_milliseconds`. Tenta com,
     e cai para a forma curta se a assinatura não existir. */
  begin
    execute format(
      'select net.http_post(url := %L, body := %L::jsonb, headers := %L::jsonb, timeout_milliseconds := 8000)',
      v_url, '{"source":"db"}', v_headers);
  exception when others then
    execute format(
      'select net.http_post(url := %L, body := %L::jsonb, headers := %L::jsonb)',
      v_url, '{"source":"db"}', v_headers);
  end;
exception when others then
  -- fila continua pendente; a retentativa pega depois
  raise notice 'push_poke falhou: %', sqlerrm;
end;
$$;
comment on function public.push_poke() is
  'Avisa o painel que há notificação pendente na fila (pg_net). Nunca propaga erro.';

revoke all on function public.push_poke() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 7) Enfileirar — o único ponto que escreve na fila.
-- ---------------------------------------------------------------------
create or replace function public.push_enqueue(p_order uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new integer := 0;
begin
  insert into public.push_outbox(order_id, kind)
  values (p_order, p_kind)
  on conflict (order_id, kind) do nothing;

  get diagnostics v_new = row_count;
  if v_new > 0 then
    perform public.push_poke();
  end if;
exception when others then
  raise notice 'push_enqueue falhou (%): %', p_kind, sqlerrm;
end;
$$;
revoke all on function public.push_enqueue(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 8) GATILHO 1 — pedido novo do site
--    SÓ channel 'site'. Rascunho criado à mão no painel (channel
--    'manual') e pedido de teste (channel 'teste') NÃO avisam.
--    O pedido do site nasce 'rascunho' desde a 0030 (modelo sob
--    encomenda) — é o estado normal dele, não um pedido pela metade.
-- ---------------------------------------------------------------------
create or replace function public.push_trg_order_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.channel = 'site' and coalesce(new.status, '') <> 'cancelado' then
    perform public.push_enqueue(new.id, 'novo_pedido');
  end if;
  return null;
end;
$$;

revoke all on function public.push_trg_order_insert() from public, anon, authenticated;

drop trigger if exists trg_push_order_insert on public.orders;
create trigger trg_push_order_insert
  after insert on public.orders
  for each row execute function public.push_trg_order_insert();

-- ---------------------------------------------------------------------
-- 9) GATILHO 2 — venda aprovada
--    "Registrar pagamento" no painel grava payment_status='pago' e
--    depois avança status até 'pago' (dois PATCH). O webhook da
--    InfinitePay (0025) faz as duas coisas de uma vez. Qualquer um dos
--    caminhos é a mesma venda, então o gatilho aceita os dois e o
--    unique da fila garante UM aviso só.
--    Pedido cancelado não avisa.
-- ---------------------------------------------------------------------
create or replace function public.push_trg_order_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.status, '') = 'cancelado' then
    return null;
  end if;
  if (new.payment_status = 'pago' and coalesce(old.payment_status, '') <> 'pago')
     or (new.status = 'pago' and coalesce(old.status, '') <> 'pago') then
    perform public.push_enqueue(new.id, 'venda_aprovada');
  end if;
  return null;
end;
$$;

revoke all on function public.push_trg_order_paid() from public, anon, authenticated;

drop trigger if exists trg_push_order_paid on public.orders;
create trigger trg_push_order_paid
  after update of status, payment_status on public.orders
  for each row execute function public.push_trg_order_paid();

-- ---------------------------------------------------------------------
-- 10) RLS — tabelas criadas depois da 0007, então habilitamos aqui.
--     SEM política = ninguém lê pelo navegador. Só a service role.
-- ---------------------------------------------------------------------
alter table public.push_devices enable row level security;
alter table public.push_outbox  enable row level security;

-- ---------------------------------------------------------------------
-- 11) RETENTATIVA (pg_cron) — rede de segurança.
--     Se o painel estava fora do ar quando o pedido entrou, o cutucão
--     se perdeu. A cada minuto o banco verifica se sobrou algo na fila.
--     Não cria carga: sem pendência, push_poke() retorna na hora.
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      create extension pg_cron;
    exception when others then
      raise notice 'pg_cron não pôde ser criada aqui (%). Ligue em Database → Extensions.', sqlerrm;
    end;
  end if;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    begin
      if exists (select 1 from cron.job where jobname = 'push-dispatch-retry') then
        perform cron.unschedule('push-dispatch-retry');
      end if;
      perform cron.schedule('push-dispatch-retry', '* * * * *', 'select public.push_poke()');
    exception when others then
      raise notice 'agendamento da retentativa falhou: %', sqlerrm;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 12) CONFERÊNCIA — o que rodou
-- ---------------------------------------------------------------------
select
  (select count(*) from pg_extension where extname = 'pg_net')  as pg_net_ligada,
  (select count(*) from pg_extension where extname = 'pg_cron') as pg_cron_ligada,
  (select count(*) from pg_trigger
    where tgname in ('trg_push_order_insert', 'trg_push_order_paid')) as gatilhos,
  (select value #>> '{}' from public.app_settings where key = 'push_dispatch_secret')
    as segredo_para_a_cloudflare;

-- =====================================================================
-- ROLLBACK (desfaz tudo o que este arquivo criou)
-- ---------------------------------------------------------------------
-- do $$ begin
--   if exists (select 1 from pg_extension where extname = 'pg_cron')
--      and exists (select 1 from cron.job where jobname = 'push-dispatch-retry')
--   then perform cron.unschedule('push-dispatch-retry'); end if;
-- end $$;
-- drop trigger if exists trg_push_order_insert on public.orders;
-- drop trigger if exists trg_push_order_paid   on public.orders;
-- drop function if exists public.push_trg_order_insert();
-- drop function if exists public.push_trg_order_paid();
-- drop function if exists public.push_enqueue(uuid, text);
-- drop function if exists public.push_poke();
-- drop table if exists public.push_outbox;
-- drop table if exists public.push_devices;
-- delete from public.app_settings where key in ('push', 'push_dispatch_secret');
-- delete from public.idempotency_keys where scope = 'push';
-- delete from public.role_permissions where permission_key = 'notifications.manage';
-- delete from public.permissions where key = 'notifications.manage';
-- =====================================================================
