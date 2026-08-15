-- =====================================================================
-- 0014_finance.sql — FINANCEIRO / CAIXA (modelo SOA).
-- Entradas e saídas, categorias, saldo do mês. "Fim do mês sabendo o
-- resultado." Rode no SQL Editor do Supabase.
-- =====================================================================

insert into public.permissions (key, description) values
  ('finance.read',  'Ver financeiro/caixa'),
  ('finance.write', 'Lançar entradas/saídas')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['finance.read','finance.write']) k
where r.key in ('admin','financeiro')
on conflict do nothing;

create table public.cash_entries (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                       -- 'entrada' | 'saida'
  amount      numeric(12,2) not null,
  category    text,
  description text,
  entry_date  date not null default current_date,
  order_id    uuid references public.orders(id) on delete set null,
  created_by  uuid references public.staff(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index idx_cash_date on public.cash_entries(entry_date);

alter table public.cash_entries enable row level security;
create policy cash_read on public.cash_entries
  for select using (public.auth_has_permission('finance.read'));
