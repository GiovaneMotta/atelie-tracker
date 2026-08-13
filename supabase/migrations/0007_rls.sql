-- =====================================================================
-- 0007_rls.sql — Row Level Security (§35, §36, §43)
-- Modelo de acesso:
--  • Escritas passam pela API (Netlify Functions) usando a SERVICE ROLE
--    key, que ignora RLS — lá ficam as checagens de permissão + auditoria.
--  • O app React lê via ANON key + JWT do usuário. RLS abaixo controla o
--    que cada membro da equipe consegue LER (inclui Realtime).
--  • Sem política de INSERT/UPDATE/DELETE = negado por padrão para o
--    frontend. Isso é intencional: nada de escrita direta do navegador.
--  • Mascaramento de CPF (§43) é feito na API conforme 'customers.cpf'
--    (RLS é por linha, não por coluna).
-- =====================================================================

-- Habilita RLS em todas as tabelas do schema public -----------------------------
do $$
declare t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t.tablename);
  end loop;
end $$;

-- Perfil próprio (não-recursivo: os helpers de permissão dependem desta
-- leitura, então ela NÃO pode chamar auth_has_permission). A visão de
-- "admin lê todos os membros" é servida pela API (service role).
create policy staff_self_read on public.staff
  for select using (id = auth.uid());

create policy staff_self_update on public.staff
  for update using (id = auth.uid()) with check (id = auth.uid());

-- Tabelas de referência de papéis: qualquer staff ativo lê --------------------
create policy roles_read       on public.roles            for select using (public.auth_is_staff());
create policy perms_read       on public.permissions      for select using (public.auth_is_staff());
create policy roleperm_read    on public.role_permissions for select using (public.auth_is_staff());
create policy staffroles_read  on public.staff_roles      for select using (public.auth_is_staff());

-- Helper macro via política: leitura por permissão -----------------------------
-- CLIENTES / ENDEREÇOS / TAGS / NOTAS
create policy customers_read on public.customers
  for select using (public.auth_has_permission('customers.read'));
create policy addresses_read on public.customer_addresses
  for select using (public.auth_has_permission('customers.read'));
create policy custtags_read on public.customer_tags
  for select using (public.auth_has_permission('customers.read'));
create policy tags_read on public.tags
  for select using (public.auth_is_staff());
create policy notes_read on public.notes
  for select using (public.auth_has_permission('customers.read'));
create policy aimem_read on public.ai_customer_memory
  for select using (public.auth_has_permission('customers.read'));

-- CATÁLOGO
create policy products_read on public.products
  for select using (public.auth_has_permission('products.read'));
create policy prodcat_read on public.product_categories
  for select using (public.auth_has_permission('products.read'));
create policy variants_read on public.product_variants
  for select using (public.auth_has_permission('products.read'));
create policy addons_read on public.product_addons
  for select using (public.auth_has_permission('products.read'));
create policy inventory_read on public.inventory
  for select using (public.auth_has_permission('products.read'));

-- FUNIL
create policy pipelines_read on public.pipelines
  for select using (public.auth_is_staff());
create policy stages_read on public.pipeline_stages
  for select using (public.auth_is_staff());
create policy leads_read on public.leads
  for select using (public.auth_is_staff());

-- INBOX
create policy conversations_read on public.conversations
  for select using (public.auth_has_permission('conversations.read'));
create policy convtags_read on public.conversation_tags
  for select using (public.auth_has_permission('conversations.read'));
create policy messages_read on public.messages
  for select using (public.auth_has_permission('conversations.read'));

-- PEDIDOS / FRETE / ENVIO
create policy orders_read on public.orders
  for select using (public.auth_has_permission('orders.read'));
create policy orderitems_read on public.order_items
  for select using (public.auth_has_permission('orders.read'));
create policy quotes_read on public.shipping_quotes
  for select using (public.auth_has_permission('orders.read'));
create policy shipments_read on public.shipments
  for select using (public.auth_has_permission('orders.read') or public.auth_has_permission('labels.read'));
create policy labels_read on public.shipping_labels
  for select using (public.auth_has_permission('labels.read'));
create policy tracking_read on public.tracking_events
  for select using (public.auth_has_permission('orders.read'));

-- PAGAMENTOS (sensível — só quem tem payments.read)
create policy payments_read on public.payments
  for select using (public.auth_has_permission('payments.read'));

-- AUTOMAÇÕES
create policy automations_read on public.automations
  for select using (public.auth_has_permission('automations.read'));
create policy autonodes_read on public.automation_nodes
  for select using (public.auth_has_permission('automations.read'));
create policy autoedges_read on public.automation_edges
  for select using (public.auth_has_permission('automations.read'));
create policy autoruns_read on public.automation_runs
  for select using (public.auth_has_permission('automations.read'));

-- CAMPANHAS / TAREFAS / KB / IA
create policy campaigns_read on public.campaigns
  for select using (public.auth_is_staff());
create policy campmsg_read on public.campaign_messages
  for select using (public.auth_is_staff());
create policy tasks_read on public.tasks
  for select using (public.auth_is_staff());
create policy kb_read on public.knowledge_base
  for select using (public.auth_is_staff());
create policy aisettings_read on public.ai_settings
  for select using (public.auth_is_staff());

-- INFRA
create policy notifications_read on public.notifications
  for select using (staff_id = auth.uid() or staff_id is null);
create policy custnotif_read on public.customer_notification_settings
  for select using (public.auth_is_staff());
create policy approvals_read on public.approvals
  for select using (public.auth_is_staff());
create policy audit_read on public.audit_logs
  for select using (public.auth_has_permission('audit.read'));
create policy intlogs_read on public.integration_logs
  for select using (public.auth_has_permission('audit.read'));

-- (webhooks, jobs, idempotency_keys, sent_customer_notifications ficam SEM
--  política = invisíveis ao frontend. Só a SERVICE ROLE os acessa.)
