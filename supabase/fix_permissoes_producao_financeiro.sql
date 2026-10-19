-- =====================================================================
-- fix_permissoes_producao_financeiro.sql
--
-- Sintoma: "Produção" e "Financeiro" nao aparecem no menu do painel, e o
-- botao "Enviar para producao" nao aparece no pedido.
--
-- Causa: as permissoes dessas areas existem no codigo (o menu filtra por
-- production.read / finance.read), mas as migrations 0012 e 0014 nunca
-- foram aplicadas neste banco, entao nenhum papel as recebeu.
--
-- Idempotente: pode rodar quantas vezes quiser.
-- Rodar no SQL Editor do Supabase e depois sair e entrar no painel.
-- =====================================================================

-- 1) Garante que as permissoes existem no catalogo
insert into public.permissions (key, description) values
  ('production.read',  'Ver produção'),
  ('production.write', 'Mover e editar a produção'),
  ('finance.read',     'Ver financeiro'),
  ('finance.write',    'Lançar e editar financeiro')
on conflict (key) do nothing;

-- 2) Concede aos papeis certos
insert into public.role_permissions (role_id, permission_key)
select r.id, k
from public.roles r,
     unnest(array['production.read','production.write']) k
where r.key in ('admin','expedicao','atendente')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_key)
select r.id, k
from public.roles r,
     unnest(array['finance.read','finance.write']) k
where r.key in ('admin','financeiro')
on conflict do nothing;

-- 3) Confere o resultado: deve listar as 4 chaves para o admin
select r.key as papel, rp.permission_key
from public.role_permissions rp
join public.roles r on r.id = rp.role_id
where rp.permission_key in
      ('production.read','production.write','finance.read','finance.write')
order by r.key, rp.permission_key;
