-- Sir Fisher Praia — functions.sql
-- Todas as funções são SECURITY DEFINER com search_path fixo (evita hijacking e recursão de RLS).
-- Grants (quem pode executar o quê) ficam em rls.sql.

-- =========================================================================
-- Helpers de autorização (evitam recursão de RLS em app_users)
-- =========================================================================
create or replace function public.fn_is_active_staff()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_users
    where auth_user_id = auth.uid() and active = true
  );
$$;

create or replace function public.fn_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.app_users
    where auth_user_id = auth.uid() and active = true and role = 'admin'
  );
$$;

create or replace function public.fn_current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from public.app_users
  where auth_user_id = auth.uid() and active = true
  limit 1;
$$;

-- =========================================================================
-- fn_claim_app_user — vincula automaticamente um convite pendente (linha em
-- app_users cadastrada pelo admin só com e-mail) ao usuário Google que acabou
-- de fazer login com esse mesmo e-mail. Não faz nada se não houver convite.
-- =========================================================================
create or replace function public.fn_claim_app_user()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email citext;
begin
  if auth.uid() is null then
    return;
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    return;
  end if;

  update public.app_users
  set auth_user_id = auth.uid()
  where email = v_email
    and auth_user_id is null
    and active = true;
end;
$$;

-- =========================================================================
-- fn_request_access — idempotente. Quando alguém sem app_users faz login,
-- registra (ou consulta) um pedido de acesso. Retorna o status atual da
-- pessoa em relação ao painel: already_staff | deactivated | pending |
-- approved | rejected.
-- =========================================================================
create or replace function public.fn_request_access()
returns table (status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_email citext;
  v_name text;
  v_active boolean;
  v_existing_status text;
begin
  if v_uid is null then
    raise exception 'FORBIDDEN: Faça login para solicitar acesso.';
  end if;

  select au.active into v_active from public.app_users au where au.auth_user_id = v_uid;
  if found then
    return query select case when v_active then 'already_staff' else 'deactivated' end;
    return;
  end if;

  select ar.status into v_existing_status from public.access_requests ar where ar.auth_user_id = v_uid;
  if v_existing_status is not null then
    return query select v_existing_status;
    return;
  end if;

  select u.email, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    into v_email, v_name
  from auth.users u where u.id = v_uid;

  insert into public.access_requests (auth_user_id, email, name)
  values (v_uid, v_email, v_name);

  return query select 'pending'::text;
end;
$$;

-- =========================================================================
-- fn_review_access_request — só admin. Aprova (cria/ativa app_users com o
-- papel escolhido) ou recusa.
-- =========================================================================
create or replace function public.fn_review_access_request(
  p_request_id uuid,
  p_approve boolean,
  p_role text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_req public.access_requests%rowtype;
  v_admin_id uuid;
begin
  if not public.fn_is_admin() then
    raise exception 'FORBIDDEN: Apenas administradores podem revisar solicitações.';
  end if;

  select au.id into v_admin_id from public.app_users au
  where au.auth_user_id = auth.uid() and au.active = true;

  select * into v_req from public.access_requests where id = p_request_id;
  if not found then
    raise exception 'NOT_FOUND: Solicitação não encontrada.';
  end if;

  if v_req.status <> 'pending' then
    raise exception 'INVALID_INPUT: Esta solicitação já foi revisada.';
  end if;

  if p_approve then
    if p_role not in ('admin', 'operator') then
      raise exception 'INVALID_INPUT: Selecione um papel válido.';
    end if;

    insert into public.app_users (auth_user_id, email, name, role, active)
    values (v_req.auth_user_id, v_req.email, v_req.name, p_role, true)
    on conflict (email) do update set
      auth_user_id = excluded.auth_user_id,
      role = excluded.role,
      active = true,
      name = coalesce(excluded.name, public.app_users.name);

    update public.access_requests
    set status = 'approved', reviewed_by_user_id = v_admin_id, reviewed_at = now(), role_granted = p_role
    where id = p_request_id;
  else
    update public.access_requests
    set status = 'rejected', reviewed_by_user_id = v_admin_id, reviewed_at = now()
    where id = p_request_id;
  end if;
end;
$$;

-- =========================================================================
-- Triggers genéricos
-- =========================================================================
create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.fn_set_updated_by()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
begin
  v_actor := public.fn_current_app_user_id();
  if v_actor is not null then
    new.updated_by_user_id := v_actor;
  end if;
  return new;
end;
$$;

create or replace function public.fn_set_created_by()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.created_by_user_id := public.fn_current_app_user_id();
  return new;
end;
$$;

create trigger trg_app_users_updated_at before update on public.app_users
  for each row execute function public.fn_set_updated_at();
create trigger trg_customers_updated_at before update on public.customers
  for each row execute function public.fn_set_updated_at();
create trigger trg_reservations_updated_at before update on public.reservations
  for each row execute function public.fn_set_updated_at();
create trigger trg_restaurant_settings_updated_at before update on public.restaurant_settings
  for each row execute function public.fn_set_updated_at();
create trigger trg_availability_rules_updated_at before update on public.availability_rules
  for each row execute function public.fn_set_updated_at();

create trigger trg_reservations_updated_by before update on public.reservations
  for each row execute function public.fn_set_updated_by();
create trigger trg_restaurant_settings_updated_by before update on public.restaurant_settings
  for each row execute function public.fn_set_updated_by();

create trigger trg_blocked_dates_created_by before insert on public.blocked_dates
  for each row execute function public.fn_set_created_by();
create trigger trg_blocked_time_slots_created_by before insert on public.blocked_time_slots
  for each row execute function public.fn_set_created_by();

-- =========================================================================
-- fn_log_reservation_status_change — histórico automático (qualquer origem)
-- =========================================================================
create or replace function public.fn_log_reservation_status_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid;
  v_actor_role text;
  v_actor_type text;
  v_note text;
begin
  if new.status is distinct from old.status then
    select id, role into v_actor_id, v_actor_role
    from public.app_users
    where auth_user_id = auth.uid() and active = true;

    if v_actor_role is not null then
      v_actor_type := v_actor_role;
    elsif new.status = 'cancelada_cliente' then
      v_actor_type := 'customer';
    else
      v_actor_type := 'system';
    end if;

    v_note := nullif(current_setting('app.status_change_note', true), '');

    insert into public.reservation_status_history (
      reservation_id, old_status, new_status, changed_by_user_id, changed_by_type, note
    ) values (
      new.id, old.status, new.status, v_actor_id, v_actor_type, v_note
    );

    perform set_config('app.status_change_note', '', true);
  end if;
  return new;
end;
$$;

create trigger trg_reservation_status_history
  after update on public.reservations
  for each row execute function public.fn_log_reservation_status_change();

-- =========================================================================
-- get_available_time_slots — consulta pública de horários disponíveis
-- =========================================================================
create or replace function public.get_available_time_slots(p_date date, p_party_size int)
returns table (
  time_slot time,
  max_people int,
  max_reservations int,
  people_booked int,
  reservations_booked int,
  spots_remaining int,
  reservations_remaining int,
  is_available boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_staff boolean;
  v_min_party int;
  v_max_party int;
  v_cutoff time;
  v_advance_days int;
  v_duration_minutes int;
  v_pre_buffer_minutes int;
  v_weekday int;
begin
  if p_date is null or p_party_size is null or p_party_size <= 0 then
    raise exception 'INVALID_PARTY_SIZE: Quantidade de pessoas inválida.';
  end if;

  v_is_staff := public.fn_is_active_staff();

  select
    coalesce((select value from public.restaurant_settings where key = 'min_party_size') #>> '{}', '2')::int,
    coalesce((select value from public.restaurant_settings where key = 'max_party_size') #>> '{}', '10')::int,
    coalesce((select value from public.restaurant_settings where key = 'same_day_cutoff_time') #>> '{}', '12:00')::time,
    coalesce((select value from public.restaurant_settings where key = 'advance_booking_days') #>> '{}', '60')::int,
    coalesce((select value from public.restaurant_settings where key = 'table_duration_minutes') #>> '{}', '120')::int,
    coalesce((select value from public.restaurant_settings where key = 'pre_buffer_minutes') #>> '{}', '60')::int
  into v_min_party, v_max_party, v_cutoff, v_advance_days, v_duration_minutes, v_pre_buffer_minutes;

  if not v_is_staff then
    if p_party_size < v_min_party then
      raise exception 'INVALID_PARTY_SIZE: A quantidade mínima é de % pessoas.', v_min_party;
    end if;
    if p_party_size > v_max_party then
      raise exception 'PARTY_TOO_LARGE: Para grupos acima de % pessoas, fale conosco pelo WhatsApp.', v_max_party;
    end if;
    if p_date < current_date or p_date > current_date + v_advance_days then
      raise exception 'DATE_NOT_ALLOWED: Não é possível reservar para essa data.';
    end if;
    if p_date = current_date and localtime > v_cutoff then
      raise exception 'SAME_DAY_CUTOFF: Reservas para o mesmo dia são aceitas somente até %. Após esse horário, o atendimento funciona por ordem de chegada.', to_char(v_cutoff, 'HH24:MI');
    end if;
  end if;

  if exists (select 1 from public.blocked_dates bd where bd.date = p_date and bd.active = true) then
    return;
  end if;

  v_weekday := extract(dow from p_date);

  -- Cada reserva ocupa uma janela (margem antes + duração depois), não só o
  -- horário exato. Horários vizinhos cuja janela cobre este time_slot contam
  -- contra o limite de pessoas/reservas configurado para ele. Usamos
  -- aritmética de data+hora (timestamp), não só "time", para não quebrar perto
  -- da meia-noite (ex.: 22:30 + 2h de duração = 00:30 do dia seguinte).
  return query
    select
      r.time_slot,
      r.max_people,
      r.max_reservations,
      coalesce(booked.people_booked, 0)::int,
      coalesce(booked.reservations_booked, 0)::int,
      (r.max_people - coalesce(booked.people_booked, 0))::int as spots_remaining,
      (r.max_reservations - coalesce(booked.reservations_booked, 0))::int as reservations_remaining,
      (
        (r.max_people - coalesce(booked.people_booked, 0)) >= p_party_size
        and (r.max_reservations - coalesce(booked.reservations_booked, 0)) >= 1
      ) as is_available
    from public.availability_rules r
    left join lateral (
      select sum(res.party_size) as people_booked, count(*) as reservations_booked
      from public.reservations res
      where res.reservation_date = p_date
        and res.status = 'confirmada'
        and (p_date + r.time_slot) between
            ((p_date + res.reservation_time) - (v_pre_buffer_minutes || ' minutes')::interval)
            and ((p_date + res.reservation_time) + (v_duration_minutes || ' minutes')::interval)
    ) booked on true
    where r.weekday = v_weekday
      and r.enabled = true
      and not exists (
        select 1 from public.blocked_time_slots bts
        where bts.date = p_date and bts.time_slot = r.time_slot and bts.active = true
      )
    order by r.time_slot;
end;
$$;

-- =========================================================================
-- fn_create_reservation — validação + insert transacional (evita overbooking)
-- Usada pelo site público (anon) e pela criação manual do painel (authenticated).
-- Para chamadas autenticadas (staff), os limites de público (min/max pessoas,
-- corte de mesmo dia, janela de antecedência) são flexibilizados, pois nesse
-- caso um humano já mediou o pedido (ex.: grupo grande combinado por telefone).
-- Bloqueios de data/horário e limites físicos de capacidade valem sempre.
-- Ocupação considera janela de tempo (margem antes + duração depois), não só
-- o horário exato — ver comentário no bloco de checagem de limite abaixo.
-- =========================================================================
create or replace function public.fn_create_reservation(
  p_name text,
  p_email text,
  p_phone text,
  p_date date,
  p_time time,
  p_party_size int,
  p_notes text default null,
  p_marketing_opt_in boolean default false,
  p_accepted_policy boolean default false,
  p_honeypot text default null,
  p_internal_notes text default null
)
returns table (
  id uuid,
  public_code text,
  cancellation_token text,
  reservation_date date,
  reservation_time time,
  party_size int,
  status text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_staff boolean;
  v_actor_app_user_id uuid;
  v_source text;
  v_min_party int;
  v_max_party int;
  v_cutoff time;
  v_advance_days int;
  v_duration_minutes int;
  v_pre_buffer_minutes int;
  v_weekday int;
  v_rule public.availability_rules%rowtype;
  v_people_booked int;
  v_reservations_booked int;
  v_customer_id uuid;
  v_public_code text;
  v_token text;
  v_token_hash text;
  v_reservation_id uuid;
  v_recent_count int;
  v_phone_digits text;
begin
  if p_honeypot is not null and length(trim(p_honeypot)) > 0 then
    raise exception 'HONEYPOT: Não foi possível concluir sua reserva.';
  end if;

  select au.id into v_actor_app_user_id from public.app_users au
  where au.auth_user_id = auth.uid() and au.active = true;
  v_is_staff := v_actor_app_user_id is not null;
  v_source := case when v_is_staff then 'admin' else 'public_site' end;

  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'INVALID_INPUT: Informe o nome.';
  end if;
  if length(p_name) > 120 then
    raise exception 'INVALID_INPUT: Nome muito longo.';
  end if;
  if p_email is null or p_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_INPUT: Informe um e-mail válido.';
  end if;
  if p_phone is null or length(trim(p_phone)) < 8 then
    raise exception 'INVALID_INPUT: Informe um telefone válido.';
  end if;
  if not p_accepted_policy then
    raise exception 'INVALID_INPUT: É necessário aceitar as regras da reserva.';
  end if;
  if p_notes is not null and length(p_notes) > 500 then
    raise exception 'INVALID_INPUT: Observação muito longa.';
  end if;
  if p_party_size is null or p_party_size <= 0 or p_party_size > 1000 then
    raise exception 'INVALID_PARTY_SIZE: Quantidade de pessoas inválida.';
  end if;

  if not v_is_staff then
    p_internal_notes := null;
  elsif p_internal_notes is not null and length(p_internal_notes) > 2000 then
    raise exception 'INVALID_INPUT: Observação interna muito longa.';
  end if;

  select
    coalesce((select value from public.restaurant_settings where key = 'min_party_size') #>> '{}', '2')::int,
    coalesce((select value from public.restaurant_settings where key = 'max_party_size') #>> '{}', '10')::int,
    coalesce((select value from public.restaurant_settings where key = 'same_day_cutoff_time') #>> '{}', '12:00')::time,
    coalesce((select value from public.restaurant_settings where key = 'advance_booking_days') #>> '{}', '60')::int,
    coalesce((select value from public.restaurant_settings where key = 'table_duration_minutes') #>> '{}', '120')::int,
    coalesce((select value from public.restaurant_settings where key = 'pre_buffer_minutes') #>> '{}', '60')::int
  into v_min_party, v_max_party, v_cutoff, v_advance_days, v_duration_minutes, v_pre_buffer_minutes;

  if not v_is_staff then
    if p_party_size < v_min_party then
      raise exception 'INVALID_PARTY_SIZE: A quantidade mínima é de % pessoas.', v_min_party;
    end if;
    if p_party_size > v_max_party then
      raise exception 'PARTY_TOO_LARGE: Para grupos acima de % pessoas, fale conosco pelo WhatsApp.', v_max_party;
    end if;
    if p_date < current_date or p_date > current_date + v_advance_days then
      raise exception 'DATE_NOT_ALLOWED: Não é possível reservar para essa data.';
    end if;
    if p_date = current_date and localtime > v_cutoff then
      raise exception 'SAME_DAY_CUTOFF: Reservas para o mesmo dia são aceitas somente até %. Após esse horário, o atendimento funciona por ordem de chegada.', to_char(v_cutoff, 'HH24:MI');
    end if;

    v_phone_digits := regexp_replace(p_phone, '\D', '', 'g');
    select count(*) into v_recent_count
    from public.reservations
    where created_at > now() - interval '10 minutes'
      and (
        customer_email_snapshot = p_email::citext
        or regexp_replace(coalesce(customer_phone_snapshot, ''), '\D', '', 'g') = v_phone_digits
      );
    if v_recent_count >= 3 then
      raise exception 'DUPLICATE_REQUEST: Identificamos várias solicitações recentes com esses dados. Aguarde alguns minutos e tente novamente.';
    end if;
  else
    if p_date < current_date then
      raise exception 'DATE_NOT_ALLOWED: Não é possível reservar para uma data passada.';
    end if;
  end if;

  if exists (select 1 from public.blocked_dates where date = p_date and active = true) then
    raise exception 'DATE_BLOCKED: Este dia não está disponível para reservas.';
  end if;

  if exists (select 1 from public.blocked_time_slots where date = p_date and time_slot = p_time and active = true) then
    raise exception 'SLOT_BLOCKED: Este horário não está disponível nesta data.';
  end if;

  v_weekday := extract(dow from p_date);

  if not exists (select 1 from public.availability_rules where weekday = v_weekday and enabled = true) then
    raise exception 'DATE_NOT_ALLOWED: Não aceitamos reservas neste dia da semana.';
  end if;

  select * into v_rule from public.availability_rules
  where weekday = v_weekday and time_slot = p_time and enabled = true;

  if not found then
    raise exception 'SLOT_BLOCKED: Este horário não está disponível.';
  end if;

  -- Trava por dia inteiro: uma reserva pode afetar o cômputo de vários horários
  -- vizinhos ao mesmo tempo (janela de ocupação abaixo), então a serialização
  -- precisa ser por data, não mais só pelo horário exato.
  perform pg_advisory_xact_lock(hashtext(p_date::text));

  -- Mesma lógica de janela de ocupação (margem antes + duração depois) do
  -- get_available_time_slots, usando aritmética de timestamp para não quebrar
  -- perto da meia-noite.
  select coalesce(sum(res.party_size), 0), count(*)
    into v_people_booked, v_reservations_booked
  from public.reservations res
  where res.reservation_date = p_date
    and res.status = 'confirmada'
    and (p_date + p_time) between
        ((p_date + res.reservation_time) - (v_pre_buffer_minutes || ' minutes')::interval)
        and ((p_date + res.reservation_time) + (v_duration_minutes || ' minutes')::interval);

  if v_people_booked + p_party_size > v_rule.max_people then
    raise exception 'SLOT_FULL_PEOPLE: Este horário já atingiu o limite de pessoas.';
  end if;
  if v_reservations_booked + 1 > v_rule.max_reservations then
    raise exception 'SLOT_FULL_RESERVATIONS: Este horário já atingiu o limite de reservas.';
  end if;

  v_phone_digits := regexp_replace(p_phone, '\D', '', 'g');

  select c.id into v_customer_id from public.customers c
  where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_phone_digits and v_phone_digits <> ''
  limit 1;

  if v_customer_id is null and p_email is not null then
    select c.id into v_customer_id from public.customers c
    where c.email = p_email::citext
    limit 1;
  end if;

  if v_customer_id is null then
    insert into public.customers (name, email, phone, marketing_opt_in, marketing_opt_in_at, first_reservation_at, last_reservation_at)
    values (p_name, p_email, p_phone, p_marketing_opt_in, case when p_marketing_opt_in then now() else null end, now(), now())
    returning customers.id into v_customer_id;
  else
    update public.customers set
      name = p_name,
      email = coalesce(p_email, email),
      phone = coalesce(p_phone, phone),
      marketing_opt_in = marketing_opt_in or p_marketing_opt_in,
      marketing_opt_in_at = case when p_marketing_opt_in and marketing_opt_in_at is null then now() else marketing_opt_in_at end,
      last_reservation_at = now()
    where customers.id = v_customer_id;
  end if;

  loop
    v_public_code := 'SF-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
    exit when not exists (select 1 from public.reservations rc where rc.public_code = v_public_code);
  end loop;

  v_token := encode(extensions.gen_random_bytes(32), 'base64');
  v_token := replace(replace(replace(v_token, '/', '_'), '+', '-'), '=', '');
  v_token_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

  insert into public.reservations (
    public_code, customer_id, customer_name_snapshot, customer_email_snapshot, customer_phone_snapshot,
    reservation_date, reservation_time, party_size, status, customer_notes, internal_notes,
    cancellation_token_hash, source, created_by_user_id, accepted_policy, marketing_opt_in
  ) values (
    v_public_code, v_customer_id, p_name, p_email, p_phone,
    p_date, p_time, p_party_size, 'confirmada', p_notes, p_internal_notes,
    v_token_hash, v_source, v_actor_app_user_id, p_accepted_policy, p_marketing_opt_in
  ) returning reservations.id into v_reservation_id;

  insert into public.notification_queue (reservation_id, type, channel, status, payload)
  values (
    v_reservation_id, 'reservation_confirmation', 'email', 'pending',
    jsonb_build_object('public_code', v_public_code, 'email', p_email, 'date', p_date, 'time', p_time, 'party_size', p_party_size)
  );

  return query select
    r.id, r.public_code, v_token, r.reservation_date, r.reservation_time, r.party_size, r.status
  from public.reservations r where r.id = v_reservation_id;
end;
$$;

-- =========================================================================
-- fn_cancel_reservation_public — cancelamento via token seguro (nunca deleta)
-- =========================================================================
create or replace function public.fn_cancel_reservation_public(p_token text)
returns table (
  id uuid,
  public_code text,
  status text,
  reservation_date date,
  reservation_time time,
  already_cancelled boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hash text;
  v_reservation public.reservations%rowtype;
begin
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'NOT_FOUND: Link de cancelamento inválido.';
  end if;

  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');

  select * into v_reservation from public.reservations r
  where r.cancellation_token_hash = v_hash;

  if not found then
    raise exception 'NOT_FOUND: Não encontramos essa reserva. Verifique o link recebido.';
  end if;

  if v_reservation.status <> 'confirmada' then
    return query select
      v_reservation.id, v_reservation.public_code, v_reservation.status,
      v_reservation.reservation_date, v_reservation.reservation_time, true;
    return;
  end if;

  update public.reservations
  set status = 'cancelada_cliente', cancelled_at = now(), cancelled_by = 'customer'
  where reservations.id = v_reservation.id;

  return query select
    v_reservation.id, v_reservation.public_code, 'cancelada_cliente'::text,
    v_reservation.reservation_date, v_reservation.reservation_time, false;
end;
$$;

-- =========================================================================
-- fn_update_reservation_status — admin/operador (dispara o log automático)
-- =========================================================================
create or replace function public.fn_update_reservation_status(
  p_reservation_id uuid,
  p_new_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  select role into v_role from public.app_users
  where auth_user_id = auth.uid() and active = true;

  if v_role is null then
    raise exception 'FORBIDDEN: Você não tem permissão para alterar reservas.';
  end if;

  if p_new_status not in ('confirmada', 'cancelada_restaurante', 'compareceu', 'no_show', 'desistiu', 'recusada') then
    raise exception 'INVALID_INPUT: Status inválido.';
  end if;

  if p_note is not null and length(p_note) > 500 then
    raise exception 'INVALID_INPUT: Nota muito longa.';
  end if;

  perform set_config('app.status_change_note', coalesce(p_note, ''), true);

  update public.reservations
  set status = p_new_status,
      cancelled_at = case when p_new_status = 'cancelada_restaurante' then now() else cancelled_at end,
      cancelled_by = case when p_new_status = 'cancelada_restaurante' then v_role else cancelled_by end
  where id = p_reservation_id;

  if not found then
    raise exception 'NOT_FOUND: Reserva não encontrada.';
  end if;
end;
$$;

-- =========================================================================
-- fn_update_internal_notes — admin/operador
-- =========================================================================
create or replace function public.fn_update_internal_notes(
  p_reservation_id uuid,
  p_internal_notes text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.fn_is_active_staff() then
    raise exception 'FORBIDDEN: Você não tem permissão para editar esta reserva.';
  end if;

  if p_internal_notes is not null and length(p_internal_notes) > 2000 then
    raise exception 'INVALID_INPUT: Observação muito longa.';
  end if;

  update public.reservations
  set internal_notes = p_internal_notes
  where id = p_reservation_id;

  if not found then
    raise exception 'NOT_FOUND: Reserva não encontrada.';
  end if;
end;
$$;
