-- =====================================================================
-- 0006_infra.sql — Webhooks, logs de integração, auditoria, notificações,
-- idempotência, fila (jobs) e aprovações (§34, §37, §38, §39, §40, §66)
-- =====================================================================

-- ---------------------------------------------------------------------
-- IDEMPOTÊNCIA (§37) — evita duplicidade em etiqueta, pagamento, mensagem,
-- pedido e webhook. A API grava a chave ANTES de executar a operação.
-- ---------------------------------------------------------------------
create table public.idempotency_keys (
  key         text primary key,         -- ex: 'label:order:<uuid>' ou hash do webhook
  scope       text not null,            -- 'label'|'payment'|'message'|'order'|'webhook'
  result      jsonb,                    -- resposta memorizada p/ repetir sem reexecutar
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- WEBHOOKS (§38) — registra todo evento recebido (wascript/frenet/payment)
-- com payload, data, processamento e erro. Base p/ retry seguro.
-- ---------------------------------------------------------------------
create table public.webhooks (
  id           uuid primary key default gen_random_uuid(),
  source       text not null,           -- 'wascript'|'frenet'|'payment'
  event        text,
  payload      jsonb not null default '{}',
  headers      jsonb,
  processed    boolean not null default false,
  processed_at timestamptz,
  attempts     integer not null default 0,
  error        text,
  created_at   timestamptz not null default now()
);
create index idx_webhooks_unprocessed on public.webhooks(source, created_at) where not processed;

-- ---------------------------------------------------------------------
-- LOGS DE INTEGRAÇÃO (§40) — estruturados por categoria. NÃO gravar
-- tokens/dados sensíveis desnecessários (a API sanitiza antes de gravar).
-- ---------------------------------------------------------------------
create table public.integration_logs (
  id         uuid primary key default gen_random_uuid(),
  category   text not null,             -- AI|WHATSAPP|FRENET|PAYMENT|WEBHOOK|AUTOMATION|ERROR
  level      text not null default 'info',   -- info|warn|error
  message    text not null,
  context    jsonb,
  created_at timestamptz not null default now()
);
create index idx_intlogs_category on public.integration_logs(category, created_at desc);

-- ---------------------------------------------------------------------
-- AUDITORIA (§34) — quem alterou, o quê, quando, valor antigo/novo.
-- Especial p/ preço, desconto, pagamento, endereço, frete, etiqueta,
-- cancelamento. Preenchida pela API (não por trigger genérico, p/ manter
-- o "quem" = usuário autenticado da requisição).
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.staff(id) on delete set null,
  action      text not null,            -- 'update'|'create'|'delete'|'approve'|...
  entity      text not null,            -- 'order'|'payment'|'product'|'address'|'label'...
  entity_id   text,
  old_value   jsonb,
  new_value   jsonb,
  reason      text,
  created_at  timestamptz not null default now()
);
create index idx_audit_entity on public.audit_logs(entity, entity_id, created_at desc);

-- ---------------------------------------------------------------------
-- NOTIFICAÇÕES INTERNAS (§33) — para a equipe.
-- ---------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid references public.staff(id) on delete cascade,  -- null = broadcast
  type        text not null,            -- ai_needs_help|human_requested|payment_ok|address_invalid|label_ready|frenet_error|...
  title       text not null,
  body        text,
  link        text,
  is_read     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index idx_notifications_staff on public.notifications(staff_id, is_read, created_at desc);

-- ---------------------------------------------------------------------
-- CONFIG DE NOTIFICAÇÕES AO CLIENTE (§22) — liga/desliga cada mensagem
-- automática. Anti-duplicidade via sent_customer_notifications abaixo.
-- ---------------------------------------------------------------------
create table public.customer_notification_settings (
  key        text primary key,          -- 'payment_confirmed'|'order_confirmed'|'shipped'|'tracking'|'out_for_delivery'|'delivered'
  label      text not null,
  template   text not null,
  is_enabled boolean not null default true
);
insert into public.customer_notification_settings (key, label, template) values
  ('payment_confirmed','Pagamento confirmado','Oi {{nome}}! Recebemos seu pagamento do pedido #{{pedido}} 💛'),
  ('order_confirmed','Pedido confirmado','Seu pedido #{{pedido}} foi confirmado e já entrou na fila de produção.'),
  ('in_production','Pedido em produção','Boas notícias, {{nome}}! Seu pedido #{{pedido}} está sendo preparado com carinho.'),
  ('shipped','Pedido enviado','Seu pedido #{{pedido}} foi enviado! 🚚'),
  ('tracking','Código de rastreio','Rastreio do pedido #{{pedido}}: {{rastreio}}'),
  ('out_for_delivery','Saiu para entrega','Seu pedido #{{pedido}} saiu para entrega hoje! 🎉'),
  ('delivered','Pedido entregue','Seu pedido #{{pedido}} foi entregue. Esperamos que ame! 💛')
on conflict do nothing;

-- Registro do que já foi enviado (anti-duplicidade §22/§48)
create table public.sent_customer_notifications (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid references public.orders(id) on delete cascade,
  key         text not null,
  sent_at     timestamptz not null default now(),
  unique (order_id, key)
);

-- ---------------------------------------------------------------------
-- FILA / JOBS (§39) — operações demoradas (IA, envio, etiqueta, campanha,
-- tracking) processadas fora da requisição. Netlify Scheduled Functions
-- ou pg_cron consomem esta fila.
-- ---------------------------------------------------------------------
create table public.jobs (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,           -- 'send_message'|'ai_reply'|'generate_label'|'campaign_send'|'track_update'
  payload      jsonb not null default '{}',
  status       text not null default 'queued',  -- queued|running|done|failed
  run_after    timestamptz not null default now(),
  attempts     integer not null default 0,
  max_attempts integer not null default 5,
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index idx_jobs_ready on public.jobs(run_after) where status = 'queued';
create trigger trg_jobs_updated before update on public.jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- APROVAÇÕES HUMANAS (§66) — etiqueta, desconto, cancelamento, reembolso.
-- Registra quem aprovou e quando.
-- ---------------------------------------------------------------------
create table public.approvals (
  id           uuid primary key default gen_random_uuid(),
  type         text not null,           -- 'label'|'discount'|'cancel'|'refund'|'price_change'
  entity       text,                    -- 'order'|'payment'
  entity_id    text,
  requested_by text,                    -- 'ai' | staff_id
  payload      jsonb not null default '{}',
  status       text not null default 'pendente',  -- pendente|aprovado|rejeitado
  decided_by   uuid references public.staff(id) on delete set null,
  decided_at   timestamptz,
  created_at   timestamptz not null default now()
);
create index idx_approvals_pending on public.approvals(status, created_at) where status = 'pendente';
