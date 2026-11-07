-- Regressão do sinal aceito pelo painel. Executar após a migration
-- 20261107175623 do gestao. As fixtures e os pagamentos terminam em ROLLBACK.
begin;

do $test$
declare
  v_event uuid;
  v_type uuid;
  v_table uuid;
  v_booking uuid;
  v_payment uuid;
  v_second uuid;
  v_admin uuid;
  v_method text;
  v_amount numeric;
  v_price jsonb;
  v_rejected boolean;
begin
  select auth_user_id into v_admin from public.app_users
  where role = 'admin' and active and auth_user_id is not null limit 1;
  assert v_admin is not null, 'FALHOU: teste precisa de administrador ativo';
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  insert into public.rv_events(slug, name, starts_at, ends_at, emails_enabled)
  values ('teste-sinal-' || gen_random_uuid(), 'Teste transacional do sinal',
          now() + interval '60 days', now() + interval '61 days', false)
  returning id into v_event;
  insert into public.rv_table_types(event_id, code, name, min_people, included_people, max_people)
  values (v_event, 'teste', 'Mesa de teste', 1, 8, 8) returning id into v_type;
  insert into public.rv_tables(event_id, table_type_id, label)
  values (v_event, v_type, 'TESTE') returning id into v_table;
  insert into public.rv_bookings(public_code, event_id, table_id, customer_name, customer_phone,
    adults, status, hold_expires_at, snap_table_price, snap_table_consumption,
    snap_extra_chair_price, snap_extra_chair_consumption, snap_included_people,
    snap_allows_extra_chairs, snap_child_discount, snap_pix_discount_pct, snap_deposit_pct,
    total_amount, total_pix_amount, consumption_total, deposit_min_amount, source)
  values ('TESTE-' || gen_random_uuid(), v_event, v_table, 'Cliente de teste', '85990000000',
    8, 'pre_reserva', now() + interval '48 hours', 2800, 800, 350, 100, 8, true, 100, 5, 30,
    2800, 2660, 800, 840, 'admin') returning id into v_booking;

  assert public.rv_recalc_booking(v_booking) = 'pre_reserva', 'FALHOU: sem pagamento deve aguardar sinal';
  v_price := public.rv_price_for_booking(v_booking);
  assert (v_price->>'deposit_min')::numeric = 840 and (v_price->>'deposit_min_pix')::numeric = 798,
    'FALHOU: sugestão de 30% mudou';

  foreach v_amount in array array[null::numeric, 0, -1, 0.001, 'NaN'::numeric, 'Infinity'::numeric]
  loop
    v_rejected := false;
    begin
      perform public.rv_admin_register_payment(v_booking, v_amount, 'pix');
    exception when others then
      v_rejected := sqlerrm like 'INVALID_INPUT:%';
    end;
    assert v_rejected, 'FALHOU: valor inválido foi aceito';
  end loop;
  assert not exists(select 1 from public.rv_payments where booking_id = v_booking),
    'FALHOU: recusa gravou pagamento';

  foreach v_method in array array['pix', 'debito', 'credito'] loop
    perform public.rv_admin_register_payment(v_booking, 0.01, v_method);
    select id into v_payment from public.rv_payments where booking_id = v_booking and voided_at is null;
    assert (select status = 'sinal_pago' and deposit_paid_at is not null from public.rv_bookings where id = v_booking),
      'FALHOU: R$ 0,01 não confirmou sinal';
    assert (public.rv_price_for_booking(v_booking)->>'deposit_remaining')::numeric > 0,
      'FALHOU: pagamento de teste deveria estar abaixo de 30%';
    assert public.rv_table_live_state(v_table) = 'reservada', 'FALHOU: mapa não confirmou a mesa';
    assert public.rv_recalc_booking(v_booking) = 'sinal_pago', 'FALHOU: recálculo rebaixou sinal';
    perform public.rv_admin_apply_discount(v_booking, 'amount', 10, 'Teste do desconto');
    assert (select status from public.rv_bookings where id = v_booking) = 'sinal_pago',
      'FALHOU: desconto rebaixou sinal';
    perform public.rv_admin_apply_discount(v_booking, null, 0, 'Retirar desconto de teste');

    perform public.rv_admin_register_payment(v_booking, 1, v_method);
    select id into v_second from public.rv_payments
    where booking_id = v_booking and voided_at is null and id <> v_payment;
    perform public.rv_admin_void_payment(v_second, 'Teste de estorno parcial');
    assert (select status from public.rv_bookings where id = v_booking) = 'sinal_pago',
      'FALHOU: estorno parcial retirou sinal ainda recebido';
    update public.rv_bookings set hold_expires_at = now() - interval '1 hour' where id = v_booking;
    perform public.rv_admin_void_payment(v_payment, 'Teste de estorno total');
    assert (select status = 'pre_reserva' and deposit_paid_at is null and hold_expires_at > now()
            from public.rv_bookings where id = v_booking), 'FALHOU: estorno total não reabriu pré-reserva';
  end loop;

  -- Total zero com um centavo segue como sinal pago (caso de cortesia).
  update public.rv_bookings set snap_table_price = 0 where id = v_booking;
  perform public.rv_admin_register_payment(v_booking, 0.01, 'pix');
  assert (select status from public.rv_bookings where id = v_booking) = 'sinal_pago',
    'FALHOU: total zero com um centavo deve confirmar sinal';
  select id into v_payment from public.rv_payments where booking_id = v_booking and voided_at is null;
  perform public.rv_admin_void_payment(v_payment, 'Fim do teste de total zero');
  update public.rv_bookings set snap_table_price = 2800 where id = v_booking;

  -- Quitar o total positivo tem prioridade sobre sinal pago.
  perform public.rv_admin_register_payment(v_booking, 798, 'pix');
  assert (select status from public.rv_bookings where id = v_booking) = 'sinal_pago',
    'FALHOU: sinal padrão não confirmou';
  perform public.rv_admin_register_payment(v_booking, 1960, 'credito');
  assert (select status = 'quitada' and paid_in_full_at is not null from public.rv_bookings where id = v_booking),
    'FALHOU: pagamento do saldo não quitou';

  update public.rv_bookings set status = 'cancelada' where id = v_booking;
  assert public.rv_recalc_booking(v_booking) = 'cancelada', 'FALHOU: recálculo reativou cancelada';
  update public.rv_bookings set status = 'expirada' where id = v_booking;
  assert public.rv_recalc_booking(v_booking) = 'expirada', 'FALHOU: recálculo reativou expirada';

  perform set_config('request.jwt.claims', '{}', true);
  v_rejected := false;
  begin
    perform public.rv_admin_register_payment(v_booking, 0.01, 'pix');
  exception when others then
    v_rejected := sqlerrm like 'FORBIDDEN:%';
  end;
  assert v_rejected, 'FALHOU: pagamento sem administrador aceito';
  assert not has_function_privilege('anon', 'public.rv_admin_register_payment(uuid,numeric,text,timestamptz,text,text)', 'execute'),
    'FALHOU: anon pode registrar pagamento';
  assert not has_function_privilege('authenticated', 'public.rv_recalc_booking(uuid)', 'execute'),
    'FALHOU: helper interno exposto';
  assert not exists(select 1 from public.notification_queue where rv_booking_id = v_booking),
    'FALHOU: fixture enfileirou notificação';
end;
$test$;

select 'TESTES DO SINAL PASSARAM' as resultado;
rollback;
