-- =====================================================================
-- 0001_init.sql — Extensões, helpers, papéis e usuários (equipe)
-- Alvo: Postgres (Supabase). Fonte da verdade do banco (§55, §35, §36).
-- =====================================================================

create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists citext;      -- e-mail case-insensitive
create extension if not exists pg_trgm;     -- busca fuzzy por nome (gin_trgm_ops)

-- Trigger genérico de updated_at ------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- EQUIPE (usuários internos). Estende auth.users do Supabase.
-- O login/sessão é do Supabase Auth; aqui ficam os dados de perfil.
-- ---------------------------------------------------------------------
create table public.staff (
  id           uuid primary key references auth.users(id) on delete cascade,
  name         text not null,
  email        citext unique,
  phone        text,
  avatar_url   text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_staff_updated before update on public.staff
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- PAPÉIS e PERMISSÕES (§36). Papéis-base: ADMIN, ATENDENTE, EXPEDICAO,
-- FINANCEIRO. Um membro pode ter mais de um papel. Permissões granulares
-- por papel dão flexibilidade sem mexer no código.
-- ---------------------------------------------------------------------
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         text unique not null,        -- 'admin' | 'atendente' | 'expedicao' | 'financeiro'
  name        text not null,
  description text,
  is_system   boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.permissions (
  key         text primary key,            -- ex: 'orders.read', 'labels.generate'
  description text not null
);

create table public.role_permissions (
  role_id        uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id, permission_key)
);

create table public.staff_roles (
  staff_id   uuid not null references public.staff(id) on delete cascade,
  role_id    uuid not null references public.roles(id) on delete cascade,
  primary key (staff_id, role_id)
);

-- Seed dos papéis-base ---------------------------------------------------------
insert into public.roles (key, name, description, is_system) values
  ('admin',      'Administrador', 'Acesso total ao sistema',                 true),
  ('atendente',  'Atendente',     'Conversas, leads e criação de pedidos',   true),
  ('expedicao',  'Expedição',     'Frete, etiquetas, rastreio e expedição',  true),
  ('financeiro', 'Financeiro',    'Pagamentos, reembolsos e relatórios',     true);

-- Seed do catálogo de permissões (chaves usadas pela API e pela RLS) -----------
insert into public.permissions (key, description) values
  ('customers.read',   'Ver clientes'),
  ('customers.write',  'Criar/editar clientes'),
  ('customers.cpf',    'Ver CPF completo (dado sensível)'),
  ('products.read',    'Ver produtos'),
  ('products.write',   'Criar/editar produtos e preços'),
  ('orders.read',      'Ver pedidos'),
  ('orders.write',     'Criar/editar pedidos'),
  ('orders.cancel',    'Cancelar pedidos'),
  ('payments.read',    'Ver pagamentos'),
  ('payments.refund',  'Emitir reembolso'),
  ('conversations.read',  'Ver conversas'),
  ('conversations.write', 'Responder conversas'),
  ('shipping.quote',   'Cotar frete'),
  ('labels.generate',  'Gerar etiqueta'),
  ('labels.read',      'Ver/imprimir etiquetas'),
  ('automations.read', 'Ver automações'),
  ('automations.write','Editar automações'),
  ('campaigns.write',  'Criar/enviar campanhas'),
  ('ai.configure',     'Configurar IA e base de conhecimento'),
  ('settings.write',   'Alterar configurações do sistema'),
  ('audit.read',       'Ver trilha de auditoria');

-- ADMIN recebe todas as permissões
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p where r.key = 'admin';

-- ATENDENTE: conversas, clientes, produtos (leitura), pedidos, cotação de frete
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['customers.read','customers.write','products.read','orders.read',
               'orders.write','conversations.read','conversations.write','shipping.quote']) k
where r.key = 'atendente';

-- EXPEDIÇÃO: pedidos (leitura), frete, etiquetas, rastreio
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['orders.read','shipping.quote','labels.generate','labels.read',
               'customers.read','products.read']) k
where r.key = 'expedicao';

-- FINANCEIRO: pagamentos, reembolsos, pedidos (leitura), auditoria
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r,
  unnest(array['payments.read','payments.refund','orders.read','audit.read','customers.read']) k
where r.key = 'financeiro';

-- ---------------------------------------------------------------------
-- Helper de permissão (usado na RLS e pela API). SECURITY DEFINER para
-- poder ler as tabelas de papéis independentemente da RLS do chamador.
-- ---------------------------------------------------------------------
create or replace function public.auth_has_permission(perm text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.staff_roles sr
    join public.role_permissions rp on rp.role_id = sr.role_id
    where sr.staff_id = auth.uid()
      and rp.permission_key = perm
  );
$$;

create or replace function public.auth_is_staff()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where id = auth.uid() and is_active);
$$;
