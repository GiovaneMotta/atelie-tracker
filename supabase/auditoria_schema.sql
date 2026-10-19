-- =====================================================================
-- auditoria_schema.sql — confere se o banco tem TUDO que as migrations
-- deste repositorio criam.
--
-- Por que existe: as migrations sao aplicadas a mao no SQL Editor, entao
-- da para o codigo esperar uma tabela que ninguem criou. Foi o que
-- aconteceu com 0012 (producao), 0013 (precificacao) e 0014 (financeiro):
-- as telas existiam no painel e quebravam com
-- "Could not find the table 'public.production_cards' in the schema cache".
--
-- Somente leitura. Rode no SQL Editor sempre que aplicar migrations novas
-- ou desconfiar de uma tela que quebrou sem motivo.
-- Resultado esperado: nenhuma linha (ou so a linha "TUDO PRESENTE").
-- =====================================================================

select 'TABELA FALTANDO' as tipo, t as nome
from unnest(array[
  'staff','roles','permissions','role_permissions','staff_roles',
  'tags','customers','customer_addresses','customer_tags','notes','ai_customer_memory',
  'products','product_categories','product_variants','product_addons','inventory',
  'pipelines','pipeline_stages','leads','conversations','conversation_tags','messages',
  'orders','order_items','payments','shipping_quotes','shipments','shipping_labels','tracking_events',
  'automations','automation_nodes','automation_edges','automation_runs','campaigns',
  'campaign_messages','tasks','knowledge_base','ai_settings',
  'idempotency_keys','webhooks','integration_logs','audit_logs','notifications',
  'customer_notification_settings','sent_customer_notifications','jobs','approvals',
  'shipment_items','shipment_volumes','app_settings',
  'production_sectors','production_cards','production_events',
  'materials','product_materials','cash_entries','coupons'
]) t
where to_regclass('public.' || t) is null

union all

select 'FUNCAO FALTANDO', f
from unnest(array[
  'set_updated_at','auth_has_permission','auth_is_staff','enforce_order_transition',
  'staff_permissions','create_site_order','coupon_eval','validate_coupon',
  'public_catalog','public_config'
]) f
where not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = f
)

union all

select 'COLUNA FALTANDO', c.tab || '.' || c.col
from (values
  ('inventory','min_qty'), ('orders','coupon_code'), ('orders','utm'),
  ('products','featured'), ('products','sort_order')
) as c(tab, col)
where to_regclass('public.' || c.tab) is not null
  and not exists (
    select 1 from information_schema.columns ic
    where ic.table_schema = 'public' and ic.table_name = c.tab and ic.column_name = c.col
  )

order by 1, 2;
