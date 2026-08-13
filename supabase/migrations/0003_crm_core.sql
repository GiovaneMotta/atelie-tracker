-- =====================================================================
-- 0003_crm_core.sql — Funil (pipelines/etapas/leads) e Inbox
-- (conversas/mensagens) (§4, §10, §46, §60)
-- =====================================================================

-- ---------------------------------------------------------------------
-- PIPELINES e ETAPAS (§10) — kanban. Etapas configuráveis.
-- ---------------------------------------------------------------------
create table public.pipelines (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  key         text not null,             -- 'novo','primeiro_contato',...
  name        text not null,
  position    integer not null default 0,
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  color       text,
  unique (pipeline_id, key)
);
create index idx_stages_pipeline on public.pipeline_stages(pipeline_id, position);

-- Seed do funil padrão (§10)
insert into public.pipelines (id, name, is_default)
values ('00000000-0000-0000-0000-0000000000f1', 'Funil de vendas', true);

insert into public.pipeline_stages (pipeline_id, key, name, position, is_won, is_lost) values
  ('00000000-0000-0000-0000-0000000000f1','novo','Novo lead',0,false,false),
  ('00000000-0000-0000-0000-0000000000f1','primeiro_contato','Primeiro contato',1,false,false),
  ('00000000-0000-0000-0000-0000000000f1','interessado','Interessado',2,false,false),
  ('00000000-0000-0000-0000-0000000000f1','produto_escolhido','Produto escolhido',3,false,false),
  ('00000000-0000-0000-0000-0000000000f1','orcamento_enviado','Orçamento enviado',4,false,false),
  ('00000000-0000-0000-0000-0000000000f1','aguardando_pagamento','Aguardando pagamento',5,false,false),
  ('00000000-0000-0000-0000-0000000000f1','pago','Pago',6,false,false),
  ('00000000-0000-0000-0000-0000000000f1','aguardando_endereco','Aguardando endereço',7,false,false),
  ('00000000-0000-0000-0000-0000000000f1','aguardando_expedicao','Aguardando expedição',8,false,false),
  ('00000000-0000-0000-0000-0000000000f1','enviado','Enviado',9,false,false),
  ('00000000-0000-0000-0000-0000000000f1','entregue','Entregue',10,false,false),
  ('00000000-0000-0000-0000-0000000000f1','pos_venda','Pós-venda',11,true,false),
  ('00000000-0000-0000-0000-0000000000f1','perdido','Perdido',12,false,true);

-- ---------------------------------------------------------------------
-- LEADS (§10) — oportunidade de venda. Vinculado a um cliente (opcional
-- no primeiro contato) e a uma etapa do funil.
-- ---------------------------------------------------------------------
create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid references public.customers(id) on delete set null,
  pipeline_id  uuid not null references public.pipelines(id) on delete restrict,
  stage_id     uuid not null references public.pipeline_stages(id) on delete restrict,
  title        text,
  interest     text,                     -- ex: 'saída para menina'
  value        numeric(12,2),
  origin       text,
  owner_id     uuid references public.staff(id) on delete set null,
  next_followup_at timestamptz,          -- §26 follow-up agendado
  position     integer not null default 0,  -- ordem dentro da coluna do kanban
  won_at       timestamptz,
  lost_at      timestamptz,
  lost_reason  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_leads_stage    on public.leads(stage_id, position);
create index idx_leads_customer  on public.leads(customer_id);
create index idx_leads_followup  on public.leads(next_followup_at);
create trigger trg_leads_updated before update on public.leads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- CONVERSAS (§4). Uma por canal+contato. Estado da IA por conversa (§46).
-- ---------------------------------------------------------------------
create table public.conversations (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid references public.customers(id) on delete set null,
  channel       text not null default 'whatsapp',
  external_id   text,                    -- id/telefone do contato no WaScript
  assignee_id   uuid references public.staff(id) on delete set null,
  status        text not null default 'aberta',   -- aberta|pendente|resolvida
  ai_state      text not null default 'ativa',    -- ativa|pausada|humano|transferida (§46)
  priority      text not null default 'normal',   -- baixa|normal|alta
  unread_count  integer not null default 0,
  last_message_at   timestamptz,
  last_message_preview text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index idx_conv_channel_external on public.conversations(channel, external_id)
  where external_id is not null;
create index idx_conv_assignee on public.conversations(assignee_id);
create index idx_conv_status   on public.conversations(status, last_message_at desc);
create trigger trg_conv_updated before update on public.conversations
  for each row execute function public.set_updated_at();

create table public.conversation_tags (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  tag_id          uuid not null references public.tags(id) on delete cascade,
  primary key (conversation_id, tag_id)
);

-- ---------------------------------------------------------------------
-- MENSAGENS (§4). Histórico persistente. direction: in|out. type cobre
-- os formatos suportados (texto, imagem, áudio, doc, localização).
-- ---------------------------------------------------------------------
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  external_id     text,                  -- id da mensagem no WaScript (dedupe/idempotência)
  direction       text not null,         -- 'in' (recebida) | 'out' (enviada)
  sender          text not null default 'customer',  -- customer|human|ai|automation|system
  sender_staff_id uuid references public.staff(id) on delete set null,
  type            text not null default 'text',      -- text|image|video|audio|document|location
  body            text,                  -- texto/legenda
  media_url       text,                  -- URL no Storage
  media_mime      text,
  payload         jsonb,                 -- dados crus do provedor (localização, etc.)
  status          text not null default 'received',  -- received|queued|sent|delivered|read|failed
  error           text,
  created_at      timestamptz not null default now()
);
create unique index idx_messages_external on public.messages(external_id) where external_id is not null;
create index idx_messages_conv on public.messages(conversation_id, created_at);
