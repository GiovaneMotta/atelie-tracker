-- =====================================================================
-- 0027_pagamento_validado.sql     NAO APLICADA — para revisao
--
-- DEPENDE DA 0026.
--
-- A versao da 0025 marcava o pedido como pago contando so com o
-- "payment_check disse que esta pago". Faltava a pergunta seguinte:
-- pago QUANTO? Ela recebia o valor e so o registrava no historico.
--
-- Esta versao recusa a confirmacao quando o valor nao bate.
--
-- UNIDADE E SEMANTICA — o ponto que mais confunde:
--   A InfinitePay trabalha em CENTAVOS e devolve DOIS valores:
--     amount       o que foi COBRADO
--     paid_amount  o que o cliente PAGOU, que pode ser MAIOR quando a
--                  taxa de parcelamento e repassada a ele
--                  (exemplo da documentacao: amount 1500, paid 1510)
--   Entao quem tem que bater com o total do pedido e o AMOUNT.
--   Comparar paid_amount recusaria toda venda parcelada com repasse.
--   paid_amount entra so no registro, para conferencia de caixa.
--
-- TRES RESULTADOS POSSIVEIS, e nenhum deles perde o dinheiro de vista:
--   ok          valor bateu, reserva de pe  -> pago, estoque baixado
--   divergente  valor nao bateu             -> NAO pago, marcado para analise
--   revisar     valor bateu, reserva vencida-> pagamento REGISTRADO,
--                                              estoque NAO baixado,
--                                              pedido vai para analise
--
-- O terceiro caso e o pagamento tardio. Confirmar entrega de uma peca
-- que ja foi reservada por outra cliente seria prometer o impossivel;
-- descartar o pagamento seria pior ainda. Entao registra e chama voce.
--
-- Rollback no fim.
-- =====================================================================

-- A 0025 criou a funcao com outra lista de parametros. Duas versoes com
-- nomes iguais deixariam o PostgREST sem saber qual chamar.
drop function if exists public.confirm_site_payment(text, text, text, numeric, text, text);

create or replace function public.confirm_site_payment(
  p_secret          text,
  p_order_nsu       text,
  p_transaction_nsu text    default null,
  p_amount          numeric default null,   -- CENTAVOS cobrados
  p_paid_amount     numeric default null,   -- CENTAVOS pagos (pode incluir taxa)
  p_capture_method  text    default null,
  p_receipt_url     text    default null,
  p_invoice_slug    text    default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_guardado  text;
  v_numero    integer;
  v_order     record;
  v_esperado  bigint;
  v_recebido  bigint;
  v_registro  jsonb;
begin
  -- 1) quem esta chamando
  select value #>> '{}' into v_guardado
    from public.app_settings where key = 'payment_webhook_secret';
  if v_guardado is null or p_secret is null or p_secret <> v_guardado then
    raise exception 'Nao autorizado.';
  end if;

  -- 2) a transacao precisa ter identidade; aviso sem transacao nao confirma nada
  if nullif(trim(coalesce(p_transaction_nsu, '')), '') is null then
    raise exception 'Aviso sem identificador de transacao.';
  end if;

  -- 3) que pedido e este
  v_numero := nullif(regexp_replace(coalesce(p_order_nsu, ''), '[^0-9]', '', 'g'), '')::integer;
  if v_numero is null then
    raise exception 'order_nsu invalido: %', p_order_nsu;
  end if;

  /* FOR UPDATE trava a linha ate o fim desta transacao. Dois avisos
     simultaneos da InfinitePay viram dois em fila: o segundo so le
     depois que o primeiro gravou, e cai no teste de duplicata abaixo.
     E a liberacao de reservas expiradas pula pedidos travados aqui,
     entao um pagamento em andamento nao tem a reserva puxada por baixo. */
  select * into v_order from public.orders where number = v_numero for update;
  if v_order.id is null then
    raise exception 'Pedido % nao encontrado.', v_numero;
  end if;

  -- 4) ja confirmado: responde ok e nao encosta em nada
  if v_order.payment_status = 'pago' then
    return jsonb_build_object('ok', true, 'duplicate', true, 'number', v_numero);
  end if;

  v_registro := jsonb_build_object(
    'number',          v_numero,
    'amount',          p_amount,
    'paid_amount',     p_paid_amount,
    'esperado',        round(v_order.total * 100),
    'capture_method',  p_capture_method,
    'transaction_nsu', p_transaction_nsu,
    'invoice_slug',    p_invoice_slug,
    'receipt_url',     p_receipt_url);

  -- 5) O VALOR BATE?  amount x total persistido, os dois em centavos
  v_esperado := round(v_order.total * 100)::bigint;
  v_recebido := round(coalesce(p_amount, -1))::bigint;

  if v_recebido <> v_esperado then
    update public.orders
       set review_reason = format('Valor divergente: cobrado %s, esperado %s (centavos)',
                                  v_recebido, v_esperado),
           updated_at = now()
     where id = v_order.id;

    insert into public.audit_logs(actor_id, action, entity, entity_id, new_value, reason)
    values (null, 'update', 'order', v_order.id::text, v_registro,
            'Pagamento RECUSADO: valor divergente');

    return jsonb_build_object('ok', false, 'motivo', 'valor_divergente',
                              'number', v_numero,
                              'esperado', v_esperado, 'recebido', v_recebido);
  end if;

  -- 6) A RESERVA AINDA EXISTE?
  --    Pedido cancelado aqui quer dizer reserva vencida (a 0026 cancela
  --    ao expirar). O dinheiro entrou, mas a peca pode nao estar mais la.
  if v_order.status = 'cancelado' then
    update public.orders
       set payment_status = 'pago',
           payment_method = coalesce(nullif(p_capture_method, ''), payment_method),
           review_reason  = coalesce(review_reason, '') ||
             case when coalesce(review_reason, '') = '' then '' else ' | ' end ||
             'Pagamento recebido depois da reserva expirar — conferir estoque antes de prometer entrega',
           updated_at = now()
     where id = v_order.id;
    -- status NAO muda: continua cancelado, entao o gatilho nao baixa
    -- estoque que talvez nao exista mais.

    insert into public.audit_logs(actor_id, action, entity, entity_id, new_value, reason)
    values (null, 'update', 'order', v_order.id::text, v_registro,
            'Pagamento APOS a expiracao: registrado, pedido para analise');

    return jsonb_build_object('ok', true, 'revisar', true, 'motivo', 'reserva_expirada',
                              'number', v_numero);
  end if;

  -- 7) Caminho normal: valor bateu e a peca esta reservada.
  --    O status 'pago' faz o gatilho mover reservado -> baixado.
  update public.orders
     set payment_status = 'pago',
         payment_method = coalesce(nullif(p_capture_method, ''), payment_method),
         status = case when status in ('rascunho', 'aguardando_pagamento')
                       then 'pago' else status end,
         reserved_until = null,          -- pago nao expira mais
         updated_at = now()
   where id = v_order.id;

  insert into public.audit_logs(actor_id, action, entity, entity_id, new_value, reason)
  values (null, 'update', 'order', v_order.id::text, v_registro,
          'Pagamento confirmado pela InfinitePay');

  return jsonb_build_object('ok', true, 'number', v_numero);
end;
$$;

revoke all on function public.confirm_site_payment(text, text, text, numeric, numeric, text, text, text) from public;
grant execute on function public.confirm_site_payment(text, text, text, numeric, numeric, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- Estorno devolve a peca.
-- payment_status = 'estornado' nao mexia em status, entao a peca ficava
-- baixada para sempre. Agora o pedido volta para cancelado, e o gatilho
-- da 0020 devolve o estoque sozinho.
-- ---------------------------------------------------------------------
--
-- ORDEM DOS GATILHOS: o Postgres dispara gatilhos BEFORE da mesma
-- tabela em ordem ALFABETICA. "trg_orders_estorno" vem antes de
-- "trg_orders_fase", entao a fase e recalculada depois desta mudanca de
-- status. Isso e frágil demais para se apoiar: por garantia, esta
-- funcao recalcula a fase ela mesma. Se a ordem mudar um dia, o
-- resultado continua certo.
create or replace function public.trg_order_estorno() returns trigger
language plpgsql as $$
begin
  if new.payment_status = 'estornado'
     and old.payment_status is distinct from 'estornado'
     and new.status not in ('cancelado') then
    new.status := 'cancelado';
    new.inventory_phase := public.inventory_fase(new.status);
    new.review_reason := coalesce(new.review_reason, 'Estorno: estoque devolvido');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_orders_estorno on public.orders;
create trigger trg_orders_estorno
  before update on public.orders
  for each row execute function public.trg_order_estorno();

-- =====================================================================
-- ROLLBACK
--   drop trigger if exists trg_orders_estorno on public.orders;
--   drop function if exists public.trg_order_estorno();
--   drop function if exists public.confirm_site_payment(text, text, text, numeric, numeric, text, text, text);
--   -- e reaplicar confirm_site_payment da 0025
-- =====================================================================
