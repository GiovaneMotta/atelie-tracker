-- =====================================================================
-- 0028_testes_checkout.sql        NAO EXECUTADO — para revisao
--
-- LEIA ISTO ANTES DE RODAR EM QUALQUER LUGAR
--
-- Este arquivo roda dentro de BEGIN ... ROLLBACK. Isso desfaz as LINHAS
-- que ele cria, mas NAO desfaz tudo, e vale saber exatamente o que
-- escapa:
--
--   * SEQUENCIAS NAO VOLTAM. order_number_seq avanca a cada pedido de
--     teste e nao recua no rollback. Resultado pratico: alguns numeros
--     de pedido ficam faltando na numeracao real. Nao quebra nada, mas
--     e um buraco visivel no historico.
--   * LOCKS SAO REAIS ENQUANTO A TRANSACAO VIVE. O teste trava linhas
--     de inventory e orders. Uma cliente comprando nesse instante
--     ESPERA ate o rollback. Num banco de producao isso e tempo de
--     resposta travado para gente de verdade.
--   * O ALTER TABLE da 0026 pega ACCESS EXCLUSIVE em inventory. Se a
--     migration for aplicada dentro da mesma transacao de teste, a
--     tabela inteira fica bloqueada ate o rollback.
--   * Efeitos fora do banco nao voltam: webhooks, Realtime, e-mails.
--     Este arquivo nao dispara nenhum, mas qualquer teste futuro que
--     chame as funcoes HTTP do site, sim.
--
-- POR ISSO A RECOMENDACAO E: rodar num projeto Supabase separado, de
-- staging, criado do supabase/setup/full_setup.sql + as migrations.
-- O plano gratuito permite um segundo projeto. Risco zero.
--
-- Se nao houver staging, o menos pior e rodar em producao fora do
-- horario de movimento, aceitando os quatro pontos acima. Isso e
-- decisao sua, nao minha.
-- =====================================================================

begin;

-- Cinto de seguranca: se qualquer asserção falhar, a transacao morre
-- e o rollback acontece de qualquer jeito.
do $$
declare
  v_prod     uuid;
  v_var      uuid;
  v_inv      uuid;
  v_pedido   jsonb;
  v_num          integer;
  v_num_expirado integer;   -- guarda o pedido que venceu, para o teste [13]
  v_order_id uuid;
  v_qtd      integer;
  v_res      integer;
  v_ret      jsonb;
  v_segredo  text;
  v_erro     text;
  v_payload  jsonb;
begin
  raise notice '--- preparando peca de teste ---';

  insert into public.products (sku, name, slug, price_cash, status)
  values ('ZZ-TESTE-0028', 'Peca de teste 0028', 'peca-de-teste-0028', 100.00, 'ativo')
  returning id into v_prod;

  insert into public.product_variants (product_id, size, is_active, price_delta)
  values (v_prod, 'TESTE', true, 0)
  returning id into v_var;

  -- UMA unidade: e o suficiente para provar disputa
  insert into public.inventory (product_id, variant_id, quantity, reserved)
  values (v_prod, v_var, 1, 0)
  returning id into v_inv;

  select value #>> '{}' into v_segredo
    from public.app_settings where key = 'payment_webhook_secret';

  v_payload := jsonb_build_object(
    'idempotency_key', 'teste-0028-a',
    'channel', 'teste',
    'customer', jsonb_build_object('name', 'TESTE 0028'),
    'items', jsonb_build_array(
      jsonb_build_object('sku', 'ZZ-TESTE-0028', 'quantity', 1, 'size', 'TESTE')));

  -- =================================================================
  raise notice '[1] reserva da ultima peca deve passar';
  -- =================================================================
  v_pedido := public.create_site_order(v_payload);
  v_num := (v_pedido->>'number')::integer;
  select id into v_order_id from public.orders where number = v_num;

  select quantity, reserved into v_qtd, v_res from public.inventory where id = v_inv;
  if v_qtd <> 1 or v_res <> 1 then
    raise exception 'FALHOU [1]: esperava quantity 1 / reserved 1, veio % / %', v_qtd, v_res;
  end if;
  raise notice '    ok: quantity % reserved %', v_qtd, v_res;

  -- =================================================================
  raise notice '[2] SEGUNDA compra da mesma peca deve ser RECUSADA';
  -- =================================================================
  begin
    perform public.create_site_order(
      v_payload || jsonb_build_object('idempotency_key', 'teste-0028-b'));
    raise exception 'FALHOU [2]: a segunda compra passou, e nao devia';
  exception when others then
    get stacked diagnostics v_erro = message_text;
    if v_erro like '%FALHOU%' then raise; end if;
    raise notice '    ok: recusada com "%"', v_erro;
  end;

  select quantity, reserved into v_qtd, v_res from public.inventory where id = v_inv;
  if v_qtd <> 1 or v_res <> 1 then
    raise exception 'FALHOU [2]: a recusa sujou o estoque: % / %', v_qtd, v_res;
  end if;

  -- =================================================================
  raise notice '[3] valor divergente NAO confirma';
  -- =================================================================
  v_ret := public.confirm_site_payment(
    p_secret => v_segredo, p_order_nsu => 'PED-' || v_num,
    p_transaction_nsu => 'tx-teste-1',
    p_amount => 1,                 -- 1 centavo, contra 10000 esperados
    p_paid_amount => 1);
  if coalesce((v_ret->>'ok')::boolean, true) then
    raise exception 'FALHOU [3]: confirmou com valor errado: %', v_ret;
  end if;
  if (select payment_status from public.orders where id = v_order_id) = 'pago' then
    raise exception 'FALHOU [3]: pedido ficou pago mesmo com divergencia';
  end if;
  select quantity into v_qtd from public.inventory where id = v_inv;
  if v_qtd <> 1 then
    raise exception 'FALHOU [3]: baixou estoque numa divergencia';
  end if;
  raise notice '    ok: % ', v_ret->>'motivo';

  -- =================================================================
  raise notice '[4] transacao sem identificador NAO confirma';
  -- =================================================================
  begin
    perform public.confirm_site_payment(
      p_secret => v_segredo, p_order_nsu => 'PED-' || v_num,
      p_transaction_nsu => null, p_amount => 10000, p_paid_amount => 10000);
    raise exception 'FALHOU [4]: aceitou aviso sem transacao';
  exception when others then
    get stacked diagnostics v_erro = message_text;
    if v_erro like '%FALHOU%' then raise; end if;
    raise notice '    ok: %', v_erro;
  end;

  -- =================================================================
  raise notice '[5] segredo errado NAO confirma';
  -- =================================================================
  begin
    perform public.confirm_site_payment(
      p_secret => 'segredo-errado', p_order_nsu => 'PED-' || v_num,
      p_transaction_nsu => 'tx-teste-2', p_amount => 10000, p_paid_amount => 10000);
    raise exception 'FALHOU [5]: aceitou segredo errado';
  exception when others then
    get stacked diagnostics v_erro = message_text;
    if v_erro like '%FALHOU%' then raise; end if;
    raise notice '    ok: %', v_erro;
  end;

  -- =================================================================
  raise notice '[6] pedido inexistente NAO confirma';
  -- =================================================================
  begin
    perform public.confirm_site_payment(
      p_secret => v_segredo, p_order_nsu => 'PED-999999999',
      p_transaction_nsu => 'tx-teste-3', p_amount => 10000, p_paid_amount => 10000);
    raise exception 'FALHOU [6]: aceitou pedido que nao existe';
  exception when others then
    get stacked diagnostics v_erro = message_text;
    if v_erro like '%FALHOU%' then raise; end if;
    raise notice '    ok: %', v_erro;
  end;

  -- =================================================================
  raise notice '[7] valor certo confirma e BAIXA o estoque uma vez';
  -- =================================================================
  v_ret := public.confirm_site_payment(
    p_secret => v_segredo, p_order_nsu => 'PED-' || v_num,
    p_transaction_nsu => 'tx-teste-4',
    p_amount => 10000,             -- R$ 100,00 em centavos
    p_paid_amount => 10150,        -- pagou mais: taxa de parcelamento repassada
    p_capture_method => 'credit_card');
  if not coalesce((v_ret->>'ok')::boolean, false) then
    raise exception 'FALHOU [7]: nao confirmou com valor certo: %', v_ret;
  end if;
  select quantity, reserved into v_qtd, v_res from public.inventory where id = v_inv;
  if v_qtd <> 0 or v_res <> 0 then
    raise exception 'FALHOU [7]: esperava 0/0 depois da baixa, veio % / %', v_qtd, v_res;
  end if;
  raise notice '    ok: quantity % reserved % (paid_amount maior aceito)', v_qtd, v_res;

  -- =================================================================
  raise notice '[8] aviso DUPLICADO nao baixa de novo';
  -- =================================================================
  v_ret := public.confirm_site_payment(
    p_secret => v_segredo, p_order_nsu => 'PED-' || v_num,
    p_transaction_nsu => 'tx-teste-4', p_amount => 10000, p_paid_amount => 10150);
  if not coalesce((v_ret->>'duplicate')::boolean, false) then
    raise exception 'FALHOU [8]: nao reconheceu duplicata: %', v_ret;
  end if;
  select quantity, reserved into v_qtd, v_res from public.inventory where id = v_inv;
  if v_qtd <> 0 or v_res <> 0 then
    raise exception 'FALHOU [8]: baixou duas vezes: % / %', v_qtd, v_res;
  end if;
  raise notice '    ok: duplicata reconhecida, estoque intacto';

  -- =================================================================
  raise notice '[9] estorno devolve a peca';
  -- =================================================================
  update public.orders set payment_status = 'estornado' where id = v_order_id;
  select quantity, reserved into v_qtd, v_res from public.inventory where id = v_inv;
  if v_qtd <> 1 or v_res <> 0 then
    raise exception 'FALHOU [9]: estorno nao devolveu: % / %', v_qtd, v_res;
  end if;
  raise notice '    ok: voltou para quantity % reserved %', v_qtd, v_res;

  -- =================================================================
  raise notice '[10] reserva expirada devolve a peca';
  -- =================================================================
  v_pedido := public.create_site_order(
    v_payload || jsonb_build_object('idempotency_key', 'teste-0028-c'));
  v_num := (v_pedido->>'number')::integer;
  select id into v_order_id from public.orders where number = v_num;

  -- envelhece a reserva na marra
  v_num_expirado := v_num;
  update public.orders set reserved_until = now() - interval '1 minute'
   where id = v_order_id;

  perform public.liberar_reservas_expiradas();

  select quantity, reserved into v_qtd, v_res from public.inventory where id = v_inv;
  if v_qtd <> 1 or v_res <> 0 then
    raise exception 'FALHOU [10]: expiracao nao devolveu: % / %', v_qtd, v_res;
  end if;
  if (select status from public.orders where id = v_order_id) <> 'cancelado' then
    raise exception 'FALHOU [10]: pedido expirado nao foi cancelado';
  end if;
  raise notice '    ok: peca de volta e pedido cancelado';

  -- =================================================================
  raise notice '[11] pagamento TARDIO registra mas nao baixa';
  -- =================================================================
  v_ret := public.confirm_site_payment(
    p_secret => v_segredo, p_order_nsu => 'PED-' || v_num,
    p_transaction_nsu => 'tx-teste-5', p_amount => 10000, p_paid_amount => 10000,
    p_capture_method => 'pix');
  if not coalesce((v_ret->>'revisar')::boolean, false) then
    raise exception 'FALHOU [11]: nao marcou para analise: %', v_ret;
  end if;
  if (select payment_status from public.orders where id = v_order_id) <> 'pago' then
    raise exception 'FALHOU [11]: nao registrou o pagamento';
  end if;
  select quantity into v_qtd from public.inventory where id = v_inv;
  if v_qtd <> 1 then
    raise exception 'FALHOU [11]: baixou estoque que nao estava reservado';
  end if;
  if (select review_reason from public.orders where id = v_order_id) is null then
    raise exception 'FALHOU [11]: nao deixou motivo para analise';
  end if;
  raise notice '    ok: pagamento registrado, estoque intacto, pedido sinalizado';

  -- =================================================================
  raise notice '[12] reserva NAO vencida nao e liberada';
  -- =================================================================
  v_pedido := public.create_site_order(
    v_payload || jsonb_build_object('idempotency_key', 'teste-0028-d'));
  v_num := (v_pedido->>'number')::integer;
  perform public.liberar_reservas_expiradas();
  select reserved into v_res from public.inventory where id = v_inv;
  if v_res <> 1 then
    raise exception 'FALHOU [12]: liberou reserva que ainda valia';
  end if;
  raise notice '    ok: reserva de 60 minutos preservada';

  -- =================================================================
  raise notice '[13] carrinho igual depois da reserva vencer deve comprar de novo';
  -- =================================================================
  -- Mesma chave de idempotencia do pedido que expirou no teste [10].
  -- Antes do conserto, isso devolvia o pedido cancelado em vez de criar
  -- um novo, e a cliente ficava sem conseguir comprar.
  update public.inventory set quantity = 2 where id = v_inv;  -- espaco para mais um
  v_pedido := public.create_site_order(
    v_payload || jsonb_build_object('idempotency_key', 'teste-0028-c'));
  if (v_pedido->>'number')::integer = v_num_expirado then
    raise exception 'FALHOU [13]: devolveu o pedido cancelado em vez de um novo';
  end if;
  if (select status from public.orders
       where number = (v_pedido->>'number')::integer) <> 'aguardando_pagamento' then
    raise exception 'FALHOU [13]: o pedido novo nasceu em estado errado';
  end if;
  raise notice '    ok: pedido novo %, nao o cancelado %', v_pedido->>'number', v_num_expirado;

  raise notice '=== TODOS OS TESTES PASSARAM ===';
end;
$$;

-- Nada do que esta acima sobrevive a esta linha.
rollback;
