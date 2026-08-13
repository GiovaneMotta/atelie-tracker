-- =====================================================================
-- 0005_automation_ai.sql — Automações (grafo), campanhas, tarefas,
-- base de conhecimento e configurações da IA (§7, §8, §23, §28, §32)
-- =====================================================================

-- ---------------------------------------------------------------------
-- AUTOMAÇÕES (§23) — modelo de GRAFO (nós + arestas), compatível com o
-- motor isomórfico ../crm/js/flow-graph.js (será movido p/ packages/shared).
-- ---------------------------------------------------------------------
create table public.automations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  trigger     jsonb not null default '{}',   -- {type:'keyword'|'new_conversation'|'stage'|'manual', ...}
  is_active   boolean not null default false,
  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_automations_updated before update on public.automations
  for each row execute function public.set_updated_at();

create table public.automation_nodes (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  node_key      text not null,          -- id do nó dentro do grafo
  type          text not null,          -- message|image|condition|wait|ai|ask|action|... (NODE_DEFS)
  data          jsonb not null default '{}',
  pos_x         real not null default 0,
  pos_y         real not null default 0,
  unique (automation_id, node_key)
);

create table public.automation_edges (
  id            uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  source_key    text not null,
  target_key    text not null,
  handle        text,                   -- ramo (ex: opção do menu / sim/não da condição)
  unique (automation_id, source_key, target_key, handle)
);

-- Execuções (§39, §47) — estado de cada rodada + proteção contra loop
create table public.automation_runs (
  id             uuid primary key default gen_random_uuid(),
  automation_id  uuid not null references public.automations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  customer_id    uuid references public.customers(id) on delete set null,
  current_node   text,
  session        jsonb not null default '{}',   -- variáveis/contexto da sessão
  status         text not null default 'running',  -- running|waiting|done|error|stopped
  steps_count    integer not null default 0,       -- limite anti-loop (§47)
  next_wake_at   timestamptz,                       -- p/ nós de espera (§26)
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index idx_runs_wake on public.automation_runs(next_wake_at) where status = 'waiting';
create trigger trg_runs_updated before update on public.automation_runs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- CAMPANHAS (§28) — segmentadas, com variáveis. Respeitam opt-out (§49).
-- ---------------------------------------------------------------------
create table public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  template    text not null,            -- mensagem com {{variaveis}}
  filters     jsonb not null default '{}',  -- segmentação (cidade, tag, etapa, etc.)
  status      text not null default 'rascunho',  -- rascunho|agendada|enviando|concluida|cancelada
  scheduled_at timestamptz,
  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_campaigns_updated before update on public.campaigns
  for each row execute function public.set_updated_at();

create table public.campaign_messages (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  rendered    text,
  status      text not null default 'pendente',  -- pendente|enviada|falhou|pulada(optout)
  error       text,
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index idx_campmsg_campaign on public.campaign_messages(campaign_id, status);

-- ---------------------------------------------------------------------
-- TAREFAS (§32) — para a equipe.
-- ---------------------------------------------------------------------
create table public.tasks (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  assignee_id uuid references public.staff(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  order_id    uuid references public.orders(id) on delete set null,
  priority    text not null default 'normal',   -- baixa|normal|alta
  status      text not null default 'aberta',   -- aberta|fazendo|concluida
  due_at      timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_tasks_assignee on public.tasks(assignee_id, status);
create trigger trg_tasks_updated before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- BASE DE CONHECIMENTO da IA (§7) — a IA consulta ANTES de responder.
-- ---------------------------------------------------------------------
create table public.knowledge_base (
  id          uuid primary key default gen_random_uuid(),
  category    text not null,            -- produtos|precos|pagamentos|fretes|prazos|trocas|faq|empresa|scripts
  title       text not null,
  content     text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index idx_kb_category on public.knowledge_base(category) where is_active;
create trigger trg_kb_updated before update on public.knowledge_base
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- CONFIGURAÇÕES da IA (§8) — singleton (uma linha). Regras/limites.
-- ---------------------------------------------------------------------
create table public.ai_settings (
  id              boolean primary key default true check (id),  -- garante 1 linha
  agent_name      text not null default 'Lili',
  persona         text,                 -- personalidade/tom
  formality       text default 'cordial',
  business_hours  jsonb not null default '{}',
  handoff_rules   jsonb not null default '{}',   -- quando transferir p/ humano
  forbidden_topics jsonb not null default '[]',
  max_discount_pct numeric(5,2) not null default 0,
  allowed_products jsonb not null default 'null',
  -- ferramentas críticas que a IA pode executar SEM humano (default: nenhuma) (§58)
  enabled_critical_tools jsonb not null default '[]',
  updated_at      timestamptz not null default now()
);
insert into public.ai_settings (id) values (true) on conflict do nothing;
create trigger trg_aisettings_updated before update on public.ai_settings
  for each row execute function public.set_updated_at();
