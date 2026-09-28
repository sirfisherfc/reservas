-- Sir Fisher Praia — reveillon-tests.sql
-- Testes automáticos do módulo de Réveillon. Rode no SQL Editor quando quiser:
-- tudo acontece dentro de uma transação que termina em ROLLBACK, então nada
-- fica gravado. Qualquer falha interrompe com "FALHOU: ...".
-- (O teste de concorrência de verdade — 20 chamadas HTTP simultâneas — está
-- descrito em docs/reveillon.md; aqui validamos a garantia do índice.)

begin;

-- 1. Preço: casos de referência ------------------------------------------------
do $$
declare
  v_lot uuid := (select id from public.rv_lots where name = 'Lote 1' limit 1);
  p jsonb;
begin
  p := public.rv_price_for_lot(v_lot, (select id from public.rv_table_types where code = 'lateral'), 8, 0);
  assert (p->>'total')::numeric = 2800 and (p->>'total_pix')::numeric = 2660 and (p->>'consumption_total')::numeric = 800,
    'FALHOU: lateral 8 adultos';
  p := public.rv_price_for_lot(v_lot, (select id from public.rv_table_types where code = 'lateral'), 12, 2);
  assert (p->>'total')::numeric = 4700 and (p->>'extra_chairs')::int = 6 and (p->>'consumption_total')::numeric = 1400,
    'FALHOU: lateral 12 adultos + 2 crianças';
  p := public.rv_price_for_lot(v_lot, (select id from public.rv_table_types where code = 'central'), 1, 0);
  assert (p->>'total')::numeric = 1500, 'FALHOU: central 1 pessoa paga as 4 incluídas';
  p := public.rv_price_for_lot(v_lot, (select id from public.rv_table_types where code = 'central'), 6, 0);
  assert (p->>'total')::numeric = 2200 and (p->>'consumption_total')::numeric = 600, 'FALHOU: central 6';
  p := public.rv_price_for_lot(v_lot, (select id from public.rv_table_types where code = 'bistro'), 1, 1);
  assert (p->>'total')::numeric = 700, 'FALHOU: bistrô 1 adulto + 1 criança';
  assert public.rv_party_error((select id from public.rv_table_types where code = 'lateral'), 17, 0, 0) like 'PARTY_TOO_LARGE%',
    'FALHOU: lateral acima de 16';
  assert public.rv_party_error((select id from public.rv_table_types where code = 'bistro'), 1, 0, 0) like 'PARTY_TOO_SMALL%',
    'FALHOU: bistrô com 1 pessoa';
  -- Pix de R$ X abate X ÷ 0,95 do valor cheio
  assert (select r.balance from public.rv_calc_price(2800, 800, 350, 100, 8, true, 100, 5, 30, 8, 0, null, 0, round(798 * 100 / 95.0, 2)) r) = 1960,
    'FALHOU: saldo após sinal no Pix';
end;
$$;

-- 2. Uma reserva ativa por mesa (índice único) + fluxo de status ---------------
do $$
declare
  v_table uuid := (select id from public.rv_tables where label = '01' limit 1);
  v_admin uuid := (select auth_user_id from public.app_users where role = 'admin' and active and auth_user_id is not null limit 1);
  v_booking uuid;
  v_ok boolean := false;
begin
  update public.rv_events set sales_open = true;
  perform set_config('request.jwt.claims', '{}', true);
  v_booking := (public.rv_create_prebooking(v_table, 8, 0, 0, '[TESTE] a', '85990000001', 'delivered@resend.dev',
                 (select id from public.rv_terms order by version desc limit 1), true)->>'id')::uuid;
  begin
    perform public.rv_create_prebooking(v_table, 8, 0, 0, '[TESTE] b', '85990000002', 'delivered+b@resend.dev',
              (select id from public.rv_terms order by version desc limit 1), true);
  exception when others then
    v_ok := sqlerrm like 'TABLE_TAKEN%';
  end;
  assert v_ok, 'FALHOU: segunda reserva na mesma mesa foi aceita';

  v_ok := false;
  begin
    insert into public.rv_bookings (public_code, event_id, table_id, customer_name, customer_phone, adults, status,
      snap_table_price, snap_table_consumption, snap_extra_chair_price, snap_extra_chair_consumption,
      snap_included_people, snap_allows_extra_chairs, snap_child_discount, snap_pix_discount_pct, snap_deposit_pct,
      total_amount, total_pix_amount, consumption_total, deposit_min_amount, source)
    select 'RV-TSTDUP', event_id, table_id, 'x', '85990000003', 8, 'sinal_pago', 1, 1, 1, 1, 8, true, 0, 5, 30, 1, 1, 1, 1, 'admin'
    from public.rv_bookings where id = v_booking;
  exception when unique_violation then
    v_ok := true;
  end;
  assert v_ok, 'FALHOU: índice único não barrou insert direto';

  -- admin registra o sinal no Pix → sinal_pago
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.rv_admin_register_payment(v_booking, 798, 'pix');
  assert (select status from public.rv_bookings where id = v_booking) = 'sinal_pago', 'FALHOU: sinal não mudou status';
  perform public.rv_admin_register_payment(v_booking, 1960, 'credito');
  assert (select status from public.rv_bookings where id = v_booking) = 'quitada', 'FALHOU: saldo não quitou';
end;
$$;

-- 3. Expiração: vencida sem pagamento libera a mesa -----------------------------
do $$
declare
  v_table uuid := (select id from public.rv_tables where label = '02' limit 1);
  v_booking uuid;
begin
  perform set_config('request.jwt.claims', '{}', true);
  v_booking := (public.rv_create_prebooking(v_table, 8, 0, 0, '[TESTE] c', '85990000004', 'delivered+c@resend.dev',
                 (select id from public.rv_terms order by version desc limit 1), true)->>'id')::uuid;
  update public.rv_bookings set hold_expires_at = now() - interval '1 minute' where id = v_booking;
  assert public.rv_table_live_state(v_table) = 'livre', 'FALHOU: mesa vencida não aparece livre';
  perform public.rv_cron_tick();
  assert (select status from public.rv_bookings where id = v_booking) = 'expirada', 'FALHOU: cron não expirou';
end;
$$;

-- 4. Permissões por papel -------------------------------------------------------
do $$
begin
  assert not has_table_privilege('anon', 'public.rv_bookings', 'select'), 'FALHOU: anon lê rv_bookings';
  assert not has_table_privilege('anon', 'public.rv_payments', 'select'), 'FALHOU: anon lê rv_payments';
  assert not has_table_privilege('anon', 'public.rv_lot_prices', 'select'), 'FALHOU: anon lê rv_lot_prices';
  assert not has_table_privilege('anon', 'public.rv_events', 'select'), 'FALHOU: anon lê rv_events';
  assert not has_function_privilege('anon', 'public.rv_staff_board(text)', 'execute'), 'FALHOU: anon executa rv_staff_board';
  assert not has_function_privilege('anon', 'public.rv_booking_payload(uuid)', 'execute'), 'FALHOU: anon executa rv_booking_payload';
  assert not has_function_privilege('authenticated', 'public.rv_price_for_booking(uuid)', 'execute'), 'FALHOU: helper exposto';
end;
$$;

-- operador: 0 linhas nas tabelas com valor, e o mapa sem chave financeira
select set_config('request.jwt.claims',
  json_build_object('sub', (select auth_user_id from public.app_users where role = 'operator' and active and auth_user_id is not null limit 1),
                    'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_board text;
begin
  assert (select count(*) from public.rv_bookings) = 0, 'FALHOU: operador lê rv_bookings';
  assert (select count(*) from public.rv_payments) = 0, 'FALHOU: operador lê rv_payments';
  assert (select count(*) from public.rv_lot_prices) = 0, 'FALHOU: operador lê preços';
  assert (select count(*) from public.rv_events) = 0, 'FALHOU: operador lê rv_events';
  v_board := public.rv_staff_board()::text || public.rv_door_list()::text;
  assert v_board !~ '"(price|total|total_pix|paid_gross|paid_net|balance|deposit_min|customer_phone|customer_email|pix_key)"',
    'FALHOU: rv_staff_board/rv_door_list expõe valor ao operador';
  begin
    perform public.rv_admin_summary();
    raise exception 'FALHOU: operador leu o resumo financeiro';
  exception when others then
    assert sqlerrm like 'FORBIDDEN%', sqlerrm;
  end;
end;
$$;
reset role;

select 'TODOS OS TESTES PASSARAM' as resultado;
rollback;
