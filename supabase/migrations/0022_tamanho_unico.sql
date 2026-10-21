-- =====================================================================
-- 0022_tamanho_unico.sql
--
-- As saidas foram cadastradas com RN e P, mas na pratica a peca e uma
-- so, de 0 a 3 meses — o mesmo que a concorrencia vende como "Unico
-- 0-3 meses". Dois tamanhos que nao existem viram dois contadores de
-- estoque e uma escolha a mais para a cliente fazer antes de comprar.
--
-- Esta migration junta RN e P num tamanho so, nas pecas em que os dois
-- sao a mesma coisa:
--
--   40 pecas com RN + P   -> viram TAM U - 0 a 3 meses
--    3 pecas so com RN    -> viram TAM U - 0 a 3 meses
--    2 pecas com RN+P+M   -> NAO sao tocadas (M e outro tamanho de
--                            verdade; se tambem tiver que juntar, e
--                            decisao sua, nao minha)
--
-- O tamanho que sai NAO e apagado, e desativado. Apagar levaria junto
-- o variant_id dos pedidos ja feitos (ON DELETE SET NULL) e o estoque
-- daquela linha (ON DELETE CASCADE). Desativado, some do site e do
-- painel e o historico continua inteiro.
--
-- O estoque das linhas desativadas e somado na linha que fica, para
-- nenhuma peca contada sumir da prateleira.
--
-- Rollback no fim do arquivo.
-- =====================================================================

do $$
declare
  p          record;
  v_fica     uuid;
  v_soma_qtd integer;
  v_soma_res integer;
  v_min      integer;
  v_novo     constant text := 'TAM U - 0 a 3 meses';
begin
  for p in
    select v.product_id,
           array_agg(distinct upper(v.size)) as tamanhos
      from public.product_variants v
     where v.is_active and v.size is not null
     group by v.product_id
    having array_agg(distinct upper(v.size)) <@ array['RN', 'P']
  loop
    -- fica a variacao mais barata (normalmente RN), para nao encarecer
    select id into v_fica
      from public.product_variants
     where product_id = p.product_id and is_active and size is not null
     order by price_delta asc, (upper(size) = 'RN') desc
     limit 1;

    -- junta o que estava contado nas linhas que vao sair
    select coalesce(sum(i.quantity), 0), coalesce(sum(i.reserved), 0), coalesce(max(i.min_qty), 0)
      into v_soma_qtd, v_soma_res, v_min
      from public.inventory i
      join public.product_variants v on v.id = i.variant_id
     where v.product_id = p.product_id;

    update public.product_variants
       set size = v_novo
     where id = v_fica;

    update public.product_variants
       set is_active = false
     where product_id = p.product_id and id <> v_fica and is_active;

    if v_soma_qtd > 0 or v_soma_res > 0 then
      /* Limpa TODAS as linhas de estoque das variacoes desta peca e
         grava uma so. Apagar antes de inserir evita o ON CONFLICT: o
         indice unico de inventory.variant_id e parcial, e ON CONFLICT
         com indice parcial exige repetir o predicado — mais facil
         errar do que acertar. */
      delete from public.inventory i
       using public.product_variants v
       where i.variant_id = v.id
         and v.product_id = p.product_id;

      insert into public.inventory (product_id, variant_id, quantity, reserved, min_qty)
      values (p.product_id, v_fica, v_soma_qtd, v_soma_res, v_min);
    end if;
  end loop;
end;
$$;

-- Confira o resultado:
--   select p.sku, p.name, v.size, v.is_active
--     from public.products p join public.product_variants v on v.product_id = p.id
--    order by p.sku, v.is_active desc, v.size;

-- =====================================================================
-- ROLLBACK
--   Nao ha volta automatica: o nome do tamanho antigo (RN ou P) da
--   linha que ficou foi sobrescrito. Para desfazer, reative as linhas
--   desativadas e renomeie a que ficou de volta para RN:
--     update public.product_variants set is_active = true
--      where size in ('RN', 'P');
--     update public.product_variants set size = 'RN'
--      where size = 'TAM U - 0 a 3 meses';
--   O estoque somado continua na linha que ficou.
-- =====================================================================
