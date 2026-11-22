-- Reativação de reserva expirada (rv_admin_reactivate). Executar após a
-- migration 20261122180000 do gestao. Usa um evento fictício próprio e
-- termina em ROLLBACK: nada fica gravado. O resultado esperado é
-- "TESTES DA REATIVACAO PASSARAM".
begin;

-- Executa um comando e devolve a mensagem de erro (ou null se passou).
create function pg_temp.rv_test_err(p_sql text) returns text
language plpgsql as $f$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$f$;

create function pg_temp.rv_test_booking(p_event uuid, p_table uuid, p_adults int, p_status text, p_hold timestamptz)
returns uuid
language sql as $f$
  insert into public.rv_bookings(public_code, event_id, table_id, customer_name, customer_phone,
    adults, status, hold_expires_at, snap_table_price, snap_table_consumption,
    snap_extra_chair_price, snap_extra_chair_consumption, snap_included_people,
    snap_allows_extra_chairs, snap_child_discount, snap_pix_discount_pct, snap_deposit_pct,
    total_amount, total_pix_amount, consumption_total, deposit_min_amount, source)
  values ('TESTE-' || gen_random_uuid(), p_event, p_table, 'Cliente de teste', '85990000000',
    p_adults, p_status, p_hold, 2800, 800, 350, 100, 8, true, 100, 5, 30,
    2800, 2660, 800, 840, 'admin')
  returning id;
$f$;

do $test$
declare
  v_admin uuid;
  v_claims text;
  v_event uuid;
  v_type uuid;
  v_t1 uuid;
  v_t2 uuid;
  v_t3 uuid;
  v_a uuid;
  v_b uuid;
  v_c uuid;
  v_d uuid;
  v_until timestamptz := date_trunc('minute', now() + interval '24 hours');
  v_err text;
  v_detail jsonb;
  v_hist jsonb;
begin
  select auth_user_id into v_admin from public.app_users
  where role = 'admin' and active and auth_user_id is not null limit 1;
  assert v_admin is not null, 'FALHOU: teste precisa de administrador ativo';
  v_claims := json_build_object('sub', v_admin, 'role', 'authenticated')::text;
  perform set_config('request.jwt.claims', v_claims, true);

  insert into public.rv_events(slug, name, starts_at, ends_at, emails_enabled, seat_limit)
  values ('teste-reativar-' || gen_random_uuid(), 'Teste transacional da reativação',
          now() + interval '60 days', now() + interval '61 days', false, 16)
  returning id into v_event;
  insert into public.rv_table_types(event_id, code, name, min_people, included_people, max_people)
  values (v_event, 'teste', 'Mesa de teste', 1, 8, 8) returning id into v_type;
  insert into public.rv_tables(event_id, table_type_id, label) values (v_event, v_type, 'T1') returning id into v_t1;
  insert into public.rv_tables(event_id, table_type_id, label) values (v_event, v_type, 'T2') returning id into v_t2;
  insert into public.rv_tables(event_id, table_type_id, label) values (v_event, v_type, 'T3') returning id into v_t3;

  -- 1. Pré-reserva vencida sem pagamento expira e libera a mesa.
  v_a := pg_temp.rv_test_booking(v_event, v_t1, 8, 'pre_reserva', now() - interval '1 hour');
  perform public.rv_expire_due(v_t1);
  assert (select status = 'expirada' and expired_at is not null from public.rv_bookings where id = v_a),
    'FALHOU: fixture não expirou';
  assert public.rv_table_live_state(v_t1) = 'livre', 'FALHOU: mesa não liberou após expirar';

  -- 2. Validações: só admin, prazo futuro e até o início do evento.
  perform set_config('request.jwt.claims', '{}', true);
  v_err := pg_temp.rv_test_err(format('select public.rv_admin_reactivate(%L, %L)', v_a, v_until));
  assert v_err like 'FORBIDDEN:%', 'FALHOU: reativação sem admin aceita: ' || coalesce(v_err, 'ok');
  perform set_config('request.jwt.claims', v_claims, true);
  v_err := pg_temp.rv_test_err(format('select public.rv_admin_reactivate(%L, %L)', v_a, now() + interval '1 minute'));
  assert v_err like 'INVALID_INPUT:%', 'FALHOU: prazo imediato aceito';
  v_err := pg_temp.rv_test_err(format('select public.rv_admin_reactivate(%L, %L)', v_a, now() + interval '90 days'));
  assert v_err like 'INVALID_INPUT:%', 'FALHOU: prazo depois do evento aceito';

  -- 3. Mesa bloqueada pelo admin para segurar o cliente: exige confirmação.
  perform public.rv_admin_set_table_block(v_t1, true, 'Cliente pagou');
  v_err := pg_temp.rv_test_err(format('select public.rv_admin_reactivate(%L, %L)', v_a, v_until));
  assert v_err like 'TABLE_BLOCKED:%', 'FALHOU: bloqueio retirado sem confirmação';
  assert (select status from public.rv_bookings where id = v_a) = 'expirada', 'FALHOU: recusa alterou a reserva';

  insert into public.notification_queue (rv_booking_id, type, channel, status, payload)
  values (v_a, 'rv_expiry_warning', 'email', 'sent', '{}'::jsonb);
  v_detail := public.rv_admin_reactivate(v_a, v_until, true);
  assert v_detail->>'status' = 'pre_reserva', 'FALHOU: detalhe não voltou como pré-reserva';
  assert (select status = 'pre_reserva' and hold_expires_at = v_until and expired_at is null
                 and total_amount = 2800 and snap_table_price = 2800
          from public.rv_bookings where id = v_a), 'FALHOU: reserva reativada com dados errados';
  assert (select not blocked and block_reason is null from public.rv_tables where id = v_t1),
    'FALHOU: bloqueio não foi retirado';
  assert public.rv_table_live_state(v_t1) = 'negociacao', 'FALHOU: mapa não mostra a pré-reserva';
  assert not exists (select 1 from public.notification_queue where rv_booking_id = v_a and type = 'rv_expiry_warning'),
    'FALHOU: aviso de expiração antigo impede novo aviso';
  select h.details into v_hist from public.rv_booking_history h
  where h.booking_id = v_a and h.action = 'reativada' and h.old_status = 'expirada'
    and h.new_status = 'pre_reserva' and h.actor_type = 'admin';
  assert v_hist is not null and (v_hist->>'desbloqueou')::boolean and v_hist->>'motivo_bloqueio' = 'Cliente pagou',
    'FALHOU: histórico da reativação incompleto';

  -- 4. Não reativa duas vezes; o pagamento segue o fluxo normal.
  v_err := pg_temp.rv_test_err(format('select public.rv_admin_reactivate(%L, %L)', v_a, v_until));
  assert v_err like 'INVALID_STATUS:%', 'FALHOU: reativou reserva que não está expirada';
  perform public.rv_admin_register_payment(v_a, 798, 'pix');
  assert (select status from public.rv_bookings where id = v_a) = 'sinal_pago', 'FALHOU: pagamento não confirmou o sinal';
  assert public.rv_table_live_state(v_t1) = 'reservada', 'FALHOU: mapa não confirmou a mesa';

  -- 5. Mesa com outra reserva ativa: recusa sem mexer em nada.
  v_b := pg_temp.rv_test_booking(v_event, v_t2, 8, 'pre_reserva', now() - interval '1 hour');
  perform public.rv_expire_due(v_t2);
  v_c := pg_temp.rv_test_booking(v_event, v_t2, 8, 'pre_reserva', now() + interval '48 hours');
  v_err := pg_temp.rv_test_err(format('select public.rv_admin_reactivate(%L, %L, true)', v_b, v_until));
  assert v_err like 'TABLE_TAKEN:%', 'FALHOU: duas reservas ativas na mesma mesa: ' || coalesce(v_err, 'ok');

  -- 6. Mesa em negociação é liberada sem confirmação extra.
  update public.rv_bookings set status = 'cancelada' where id = v_c;
  perform public.rv_admin_set_table_negotiating(v_t2, true, 'Segurando');
  v_detail := public.rv_admin_reactivate(v_b, v_until);
  assert (select not negotiating and negotiation_note is null from public.rv_tables where id = v_t2),
    'FALHOU: marcação de negociação não foi retirada';
  assert (select status from public.rv_bookings where id = v_b) = 'pre_reserva', 'FALHOU: reserva em mesa negociada não reativou';

  -- 7. Limite de cadeiras do evento (16 = 8 de A + 8 de B).
  v_d := pg_temp.rv_test_booking(v_event, v_t3, 1, 'pre_reserva', now() - interval '1 hour');
  perform public.rv_expire_due(v_t3);
  v_err := pg_temp.rv_test_err(format('select public.rv_admin_reactivate(%L, %L)', v_d, v_until));
  assert v_err like 'SEAT_LIMIT:%', 'FALHOU: reativação passou do limite de cadeiras: ' || coalesce(v_err, 'ok');
  assert (select status from public.rv_bookings where id = v_d) = 'expirada', 'FALHOU: recusa por limite alterou a reserva';

  -- 8. Permissões e e-mails.
  assert not has_function_privilege('anon', 'public.rv_admin_reactivate(uuid,timestamptz,boolean)', 'execute'),
    'FALHOU: anon pode reativar';
  assert has_function_privilege('authenticated', 'public.rv_admin_reactivate(uuid,timestamptz,boolean)', 'execute'),
    'FALHOU: painel sem permissão para reativar';
  assert not exists (select 1 from public.notification_queue where rv_booking_id in (v_a, v_b, v_c, v_d)),
    'FALHOU: fixture enfileirou notificação';
end;
$test$;

select 'TESTES DA REATIVACAO PASSARAM' as resultado;
rollback;
