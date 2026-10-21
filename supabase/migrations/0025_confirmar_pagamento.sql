-- =====================================================================
-- 0025_confirmar_pagamento.sql
--
-- O webhook da InfinitePay precisa marcar o pedido como pago. Ele roda
-- na Cloudflare, com a chave anon, que nao escreve em orders — e nem
-- deveria. Entao a escrita mora aqui, numa funcao SECURITY DEFINER que
-- so aceita quem sabe um segredo.
--
-- Marcar como pago nao e so um campo: status 'pago' faz os gatilhos da
-- 0020 tirarem a peca da reserva e baixarem de verdade. Por isso a
-- funcao e IDEMPOTENTE — a InfinitePay reenvia o aviso enquanto nao
-- receber 200, e baixar duas vezes sumiria com peca que existe.
--
-- O segredo e sorteado aqui e NAO aparece em lugar nenhum do
-- repositorio. Depois de rodar, leia-o com a consulta no fim do
-- arquivo e cole na Cloudflare como PAGAMENTO_WEBHOOK_SECRET.
--
-- Rollback no fim.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Segredo compartilhado, sorteado uma vez
-- ---------------------------------------------------------------------
insert into public.app_settings (key, value)
select 'payment_webhook_secret', to_jsonb(encode(gen_random_bytes(24), 'hex'))
 where not exists (select 1 from public.app_settings where key = 'payment_webhook_secret');

-- ---------------------------------------------------------------------
-- 2) Confirmacao do pagamento
-- ---------------------------------------------------------------------
create or replace function public.confirm_site_payment(
  p_secret          text,
  p_order_nsu       text,
  p_transaction_nsu text default null,
  p_paid_amount     numeric default null,
  p_capture_method  text default null,
  p_receipt_url     text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guardado text;
  v_numero   integer;
  v_order    record;
begin
  select value #>> '{}' into v_guardado
    from public.app_settings where key = 'payment_webhook_secret';

  if v_guardado is null or p_secret is null or p_secret <> v_guardado then
    raise exception 'Nao autorizado.';
  end if;

  -- order_nsu chega como "PED-123"
  v_numero := nullif(regexp_replace(coalesce(p_order_nsu, ''), '[^0-9]', '', 'g'), '')::integer;
  if v_numero is null then
    raise exception 'order_nsu invalido: %', p_order_nsu;
  end if;

  select * into v_order from public.orders where number = v_numero;
  if v_order.id is null then
    raise exception 'Pedido % nao encontrado.', v_numero;
  end if;

  -- ja pago: responde ok sem mexer em nada (reenvio da InfinitePay)
  if v_order.payment_status = 'pago' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'number', v_numero);
  end if;

  update public.orders
     set payment_status = 'pago',
         payment_method = coalesce(nullif(p_capture_method, ''), payment_method),
         -- o status so avanca se ainda estava esperando: pedido que ja
         -- foi adiante na mao nao volta atras
         status = case when status in ('rascunho', 'aguardando_pagamento')
                       then 'pago' else status end
   where id = v_order.id;

  insert into public.audit_logs(actor_id, action, entity, entity_id, new_value, reason)
  values (null, 'update', 'order', v_order.id::text,
          jsonb_build_object('number', v_numero,
                             'paid_amount', p_paid_amount,
                             'capture_method', p_capture_method,
                             'transaction_nsu', p_transaction_nsu,
                             'receipt_url', p_receipt_url),
          'Pagamento confirmado pela InfinitePay');

  return jsonb_build_object('ok', true, 'number', v_numero);
end;
$$;

revoke all on function public.confirm_site_payment(text, text, text, numeric, text, text) from public;
grant execute on function public.confirm_site_payment(text, text, text, numeric, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 3) LEIA O SEGREDO E COLE NA CLOUDFLARE
--    Cloudflare -> o projeto do site -> Settings -> Environment
--    variables -> PAGAMENTO_WEBHOOK_SECRET
-- ---------------------------------------------------------------------
select value #>> '{}' as pagamento_webhook_secret
  from public.app_settings where key = 'payment_webhook_secret';

-- =====================================================================
-- ROLLBACK
--   drop function if exists public.confirm_site_payment(text, text, text, numeric, text, text);
--   delete from public.app_settings where key = 'payment_webhook_secret';
-- =====================================================================
