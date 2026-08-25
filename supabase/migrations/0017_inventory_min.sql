-- =====================================================================
-- 0017_inventory_min.sql — estoque mínimo por produto.
-- ADITIVA e segura: só adiciona 1 coluna. Não altera/remove nada.
-- O histórico de movimentações reaproveita audit_logs (entity='inventory').
-- Rollback: alter table public.inventory drop column if exists min_qty;
-- =====================================================================
alter table public.inventory add column if not exists min_qty integer not null default 0;
comment on column public.inventory.min_qty is 'Estoque mínimo p/ alerta de estoque baixo.';
