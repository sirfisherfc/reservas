-- Sir Fisher Praia — reveillon-functions.sql
-- Funções, triggers e job pg_cron do módulo de Réveillon.
-- Todas SECURITY DEFINER com search_path fixo (mesmo padrão de functions.sql).
-- Grants ficam em reveillon-rls.sql.
--
-- Convenção de erro: 'CODIGO: mensagem amigável' — o front mostra o texto
-- depois dos dois-pontos (igual a fn_create_reservation).

-- =========================================================================
-- rv_calc_price — A ÚNICA função de cálculo de preço do módulo.
-- Pura (immutable): recebe preços e regras já resolvidos e devolve todos os
-- valores. Usada pela simulação pública, pela criação da reserva e pelo painel
-- (via rv_price_for_lot / rv_price_for_booking, que só buscam as entradas).
--
-- Regras:
--   pessoas sentadas = adultos + crianças (colo não conta, não paga)
--   cadeiras extras  = sentadas − pessoas incluídas (se o tipo permite)
--   subtotal         = mesa + extras
--   desc. crianças   = crianças × desconto unitário
--   desc. manual     = % sobre (subtotal − crianças) ou valor fixo
--   total            = subtotal − descontos
--   total no Pix     = total × (1 − %Pix)
--   consumação       = consumação da mesa + extras × consumação da extra
--   sinal mínimo     = total × %sinal
--   pagos            = soma "bruta": cada Pix de R$ X abate X ÷ (1 − %Pix)
--   saldo            = total − pagos (exibido também no valor Pix)
-- =========================================================================
create or replace function public.rv_calc_price(
  p_table_price numeric,
  p_table_consumption numeric,
  p_extra_chair_price numeric,
  p_extra_chair_consumption numeric,
  p_included_people int,
  p_allows_extra_chairs boolean,
  p_child_discount numeric,
  p_pix_discount_pct numeric,
  p_deposit_pct numeric,
  p_adults int,
  p_children int,
  p_manual_discount_type text default null,
  p_manual_discount_value numeric default 0,
  p_paid_gross numeric default 0
)
returns table (
  seated_people int,
  extra_chairs int,
  table_amount numeric,
  extra_chairs_amount numeric,
  children_discount numeric,
  manual_discount numeric,
  total numeric,
  total_pix numeric,
  consumption_total numeric,
  deposit_min numeric,
  deposit_min_pix numeric,
  paid_gross numeric,
  balance numeric,
  balance_pix numeric,
  deposit_remaining numeric,
  deposit_remaining_pix numeric
)
language sql
immutable
set search_path = public, pg_temp
as $$
  with a as (
    select
      greatest(coalesce(p_adults, 0), 0) + greatest(coalesce(p_children, 0), 0) as seated,
      greatest(coalesce(p_children, 0), 0) as kids,
      coalesce(p_pix_discount_pct, 0) as pix
  ), b as (
    select a.*,
      case when p_allows_extra_chairs then greatest(a.seated - p_included_people, 0) else 0 end as extra
    from a
  ), c as (
    select b.*,
      round(coalesce(p_table_price, 0), 2) as t_amt,
      round(b.extra * coalesce(p_extra_chair_price, 0), 2) as e_amt
    from b
  ), d as (
    select c.*,
      least(round(c.kids * coalesce(p_child_discount, 0), 2), c.t_amt + c.e_amt) as k_disc
    from c
  ), e as (
    select d.*,
      case p_manual_discount_type
        when 'pct' then round((d.t_amt + d.e_amt - d.k_disc)
                               * least(greatest(coalesce(p_manual_discount_value, 0), 0), 100) / 100, 2)
        when 'amount' then least(round(greatest(coalesce(p_manual_discount_value, 0), 0), 2),
                                 d.t_amt + d.e_amt - d.k_disc)
        else 0
      end as m_disc
    from d
  ), f as (
    select e.*,
      (e.t_amt + e.e_amt - e.k_disc - e.m_disc) as tot,
      round(greatest(coalesce(p_paid_gross, 0), 0), 2) as paid
    from e
  ), g as (
    select f.*,
      round(f.tot * coalesce(p_deposit_pct, 0) / 100, 2) as dep,
      -- tolerância de 1 centavo para arredondamentos da conversão Pix↔bruto
      case when f.tot - f.paid <= 0.01 then 0 else f.tot - f.paid end as bal
    from f
  ), h as (
    select g.*,
      case when g.dep - g.paid <= 0.01 then 0 else g.dep - g.paid end as dep_rem
    from g
  )
  select
    h.seated::int,
    h.extra::int,
    h.t_amt,
    h.e_amt,
    h.k_disc,
    h.m_disc,
    h.tot,
    round(h.tot * (100 - h.pix) / 100, 2),
    round(coalesce(p_table_consumption, 0) + h.extra * coalesce(p_extra_chair_consumption, 0), 2),
    h.dep,
    round(h.dep * (100 - h.pix) / 100, 2),
    h.paid,
    h.bal,
    round(h.bal * (100 - h.pix) / 100, 2),
    h.dep_rem,
    round(h.dep_rem * (100 - h.pix) / 100, 2)
  from h;
$$;

-- =========================================================================
-- Helpers
-- =========================================================================

-- Evento ativo (por slug, ou o mais recente ativo).
create or replace function public.rv_resolve_event(p_slug text default null)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.id from public.rv_events e
  where e.active = true and (p_slug is null or e.slug = p_slug)
  order by e.starts_at desc
  limit 1;
$$;

-- Lote vigente: primeiro ativo (por ordem) dentro da vigência.
create or replace function public.rv_current_lot(p_event_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select l.id from public.rv_lots l
  where l.event_id = p_event_id
    and l.active = true
    and (l.starts_at is null or l.starts_at <= now())
    and (l.ends_at is null or l.ends_at > now())
  order by l.sort_order, l.starts_at nulls first, l.created_at
  limit 1;
$$;

-- Soma "bruta" paga: Pix vale amount ÷ (1 − %Pix), cartão vale o próprio valor.
create or replace function public.rv_paid_gross(p_booking_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(
    case when p.method = 'pix'
      then round(p.amount * 100 / (100 - b.snap_pix_discount_pct), 2)
      else p.amount
    end), 0)
  from public.rv_bookings b
  join public.rv_payments p on p.booking_id = b.id and p.voided_at is null
  where b.id = p_booking_id;
$$;

-- Soma do dinheiro efetivamente recebido (sem conversão).
create or replace function public.rv_paid_net(p_booking_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(p.amount), 0)
  from public.rv_payments p
  where p.booking_id = p_booking_id and p.voided_at is null;
$$;

-- Preço de uma composição num lote (simulação pública e criação).
-- p_paid_gross permite simular "depois do sinal" com a mesma função.
drop function if exists public.rv_price_for_lot(uuid, uuid, int, int, text, numeric);
create or replace function public.rv_price_for_lot(
  p_lot_id uuid,
  p_table_type_id uuid,
  p_adults int,
  p_children int,
  p_manual_discount_type text default null,
  p_manual_discount_value numeric default 0,
  p_paid_gross numeric default 0
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(r)
  from public.rv_lot_prices lp
  join public.rv_lots l on l.id = lp.lot_id
  join public.rv_events e on e.id = l.event_id
  join public.rv_table_types tt on tt.id = lp.table_type_id
  cross join lateral public.rv_calc_price(
    lp.table_price, lp.table_consumption, lp.extra_chair_price, lp.extra_chair_consumption,
    tt.included_people, tt.allows_extra_chairs,
    e.child_discount, e.pix_discount_pct, e.deposit_pct,
    p_adults, p_children, p_manual_discount_type, p_manual_discount_value, p_paid_gross
  ) r
  where lp.lot_id = p_lot_id and lp.table_type_id = p_table_type_id;
$$;

-- Preço de uma reserva existente (snapshot + pagamentos). Usado pelo painel.
create or replace function public.rv_price_for_booking(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select to_jsonb(r) || jsonb_build_object('paid_net', public.rv_paid_net(b.id))
  from public.rv_bookings b
  cross join lateral public.rv_calc_price(
    b.snap_table_price, b.snap_table_consumption, b.snap_extra_chair_price, b.snap_extra_chair_consumption,
    b.snap_included_people, b.snap_allows_extra_chairs,
    b.snap_child_discount, b.snap_pix_discount_pct, b.snap_deposit_pct,
    b.adults, b.children, b.manual_discount_type, b.manual_discount_value,
    public.rv_paid_gross(b.id)
  ) r
  where b.id = p_booking_id;
$$;

-- Valida a composição de pessoas contra o tipo de mesa. Retorna null se ok,
-- ou 'CODIGO: mensagem'.
create or replace function public.rv_party_error(
  p_table_type_id uuid,
  p_adults int,
  p_children int,
  p_infants int,
  p_allow_below_min boolean default false
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  t public.rv_table_types%rowtype;
  v_seated int;
begin
  select * into t from public.rv_table_types where id = p_table_type_id;
  if not found then
    return 'TABLE_NOT_FOUND: Mesa não encontrada.';
  end if;
  if coalesce(p_adults, -1) < 0 or coalesce(p_children, -1) < 0 or coalesce(p_infants, -1) < 0 then
    return 'INVALID_PARTY_SIZE: Quantidade de pessoas inválida.';
  end if;
  if p_adults < 1 then
    return 'INVALID_PARTY_SIZE: Informe pelo menos 1 adulto responsável pela mesa.';
  end if;
  v_seated := p_adults + p_children;
  if v_seated > t.max_people then
    return format('PARTY_TOO_LARGE: %s: máximo de %s pessoas (crianças de colo não contam). Para um grupo maior, faça mais de uma reserva.', t.name, t.max_people);
  end if;
  if v_seated < t.min_people and not coalesce(p_allow_below_min, false) then
    return format('PARTY_TOO_SMALL: %s: mínimo de %s pessoas (crianças de colo não contam).', t.name, t.min_people);
  end if;
  if p_infants > t.max_infants then
    return format('TOO_MANY_INFANTS: Esta mesa aceita no máximo %s crianças de colo.', t.max_infants);
  end if;
  return null;
end;
$$;

-- Pessoas sentadas (adultos + crianças) nas reservas ativas das mesas que
-- contam no limite do evento (laterais e centrais; bistrô fica fora).
-- Pré-reserva vencida e sem pagamento não conta (a mesa já está livre).
create or replace function public.rv_seats_used(p_event_id uuid, p_exclude_booking uuid default null)
returns int
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(b.adults + b.children), 0)::int
  from public.rv_bookings b
  join public.rv_tables t on t.id = b.table_id
  join public.rv_table_types tt on tt.id = t.table_type_id
  where b.event_id = p_event_id
    and tt.counts_toward_limit
    and (p_exclude_booking is null or b.id <> p_exclude_booking)
    and (b.status in ('sinal_pago', 'quitada')
         or (b.status = 'pre_reserva'
             and (b.hold_expires_at is null or b.hold_expires_at > now()
                  or exists (select 1 from public.rv_payments p where p.booking_id = b.id and p.voided_at is null))));
$$;

-- Confere o limite de cadeiras do evento. Null = ok; senão 'CODIGO: mensagem'.
create or replace function public.rv_seat_limit_error(
  p_event_id uuid,
  p_table_type_id uuid,
  p_adults int,
  p_children int,
  p_exclude_booking uuid default null
)
returns text
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit int;
  v_counts boolean;
  v_used int;
  v_free int;
begin
  select e.seat_limit into v_limit from public.rv_events e where e.id = p_event_id;
  select tt.counts_toward_limit into v_counts from public.rv_table_types tt where tt.id = p_table_type_id;
  if v_limit is null or not coalesce(v_counts, false) then
    return null;
  end if;
  v_used := public.rv_seats_used(p_event_id, p_exclude_booking);
  v_free := greatest(v_limit - v_used, 0);
  if coalesce(p_adults, 0) + coalesce(p_children, 0) > v_free then
    if v_free = 0 then
      return 'SEAT_LIMIT: As cadeiras das mesas laterais e centrais esgotaram. Ainda pode haver bistrô livre, ou fale conosco pelo WhatsApp.';
    end if;
    return format('SEAT_LIMIT: Restam só %s lugares nas mesas laterais e centrais. Reduza a quantidade de pessoas ou fale conosco pelo WhatsApp.', v_free);
  end if;
  return null;
end;
$$;

-- Estado vivo de uma mesa. Pré-reserva vencida e sem nenhum pagamento já conta
-- como livre, mesmo antes do cron gravar 'expirada'.
create or replace function public.rv_table_live_state(p_table_id uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when not t.active or t.blocked then 'bloqueada'
    when exists (
      select 1 from public.rv_bookings b
      where b.table_id = t.id and b.status in ('sinal_pago', 'quitada')
    ) then 'reservada'
    when exists (
      select 1 from public.rv_bookings b
      where b.table_id = t.id and b.status = 'pre_reserva'
        and (b.hold_expires_at is null or b.hold_expires_at > now()
             or exists (select 1 from public.rv_payments p where p.booking_id = b.id and p.voided_at is null))
    ) then 'negociacao'
    else 'livre'
  end
  from public.rv_tables t
  where t.id = p_table_id;
$$;

-- Grava no histórico, descobrindo quem é o ator pela sessão.
create or replace function public.rv_log(
  p_booking_id uuid,
  p_action text,
  p_old_status text,
  p_new_status text,
  p_details jsonb default '{}'::jsonb,
  p_fallback_actor text default 'system'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_role text;
begin
  select au.id, au.role into v_id, v_role
  from public.app_users au
  where au.auth_user_id = auth.uid() and au.active = true;

  insert into public.rv_booking_history (booking_id, action, old_status, new_status, details, actor_user_id, actor_type)
  values (p_booking_id, p_action, p_old_status, p_new_status, coalesce(p_details, '{}'::jsonb),
          v_id, coalesce(v_role, p_fallback_actor));
end;
$$;

create or replace function public.rv_require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.fn_is_admin() then
    raise exception 'FORBIDDEN: Ação exclusiva de administradores.';
  end if;
  return public.fn_current_app_user_id();
end;
$$;

-- Payload comum dos e-mails e das mensagens (dados da reserva + evento + valores).
create or replace function public.rv_booking_payload(p_booking_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'public_code', b.public_code,
    'name', b.customer_name,
    'email', b.customer_email,
    'phone', b.customer_phone,
    'status', b.status,
    'adults', b.adults,
    'children', b.children,
    'infants', b.infants,
    'party_size', b.adults + b.children,
    'hold_expires_at', b.hold_expires_at,
    'table_label', t.label,
    'table_type', tt.name,
    'event_name', e.name,
    'event_starts_at', e.starts_at,
    'event_ends_at', e.ends_at,
    'timezone', e.timezone,
    'address', e.address,
    'menu_url', e.menu_url,
    'balance_due_date', e.balance_due_date,
    'pix_key', e.pix_key,
    'pix_key_type', e.pix_key_type,
    'pix_holder', e.pix_holder,
    'pix_discount_pct', b.snap_pix_discount_pct,
    'deposit_pct', b.snap_deposit_pct,
    'whatsapp', e.whatsapp_number,
    'price', public.rv_price_for_booking(b.id)
  )
  from public.rv_bookings b
  join public.rv_tables t on t.id = b.table_id
  join public.rv_table_types tt on tt.id = t.table_type_id
  join public.rv_events e on e.id = b.event_id
  where b.id = p_booking_id;
$$;

-- Enfileira um e-mail do réveillon (idempotente por reserva+tipo).
-- Só enfileira se o evento estiver com emails_enabled = true.
create or replace function public.rv_enqueue_email(p_booking_id uuid, p_type text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
  v_email citext;
begin
  if p_type not in ('rv_prebooking', 'rv_expiry_warning', 'rv_deposit_received', 'rv_paid_in_full') then
    raise exception 'INVALID_NOTIFICATION_TYPE';
  end if;

  select e.emails_enabled, b.customer_email into v_enabled, v_email
  from public.rv_bookings b join public.rv_events e on e.id = b.event_id
  where b.id = p_booking_id;

  if not coalesce(v_enabled, false) or v_email is null then
    return false;
  end if;

  if exists (select 1 from public.notification_queue q where q.rv_booking_id = p_booking_id and q.type = p_type) then
    return false;
  end if;

  insert into public.notification_queue (rv_booking_id, type, channel, status, payload)
  values (p_booking_id, p_type, 'email', 'pending', public.rv_booking_payload(p_booking_id));
  return true;
end;
$$;

-- Recalcula e grava os totais da reserva a partir do snapshot, e ajusta o
-- status conforme o que foi pago (sobe e desce). Nunca mexe em cancelada/expirada.
create or replace function public.rv_recalc_booking(p_booking_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.rv_bookings%rowtype;
  v_price jsonb;
  v_total numeric;
  v_balance numeric;
  v_dep numeric;
  v_dep_rem numeric;
  v_paid numeric;
  v_new text;
  v_hold_hours int;
begin
  select * into b from public.rv_bookings where id = p_booking_id for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND: Reserva não encontrada.';
  end if;

  v_price := public.rv_price_for_booking(b.id);
  v_total := (v_price->>'total')::numeric;
  v_balance := (v_price->>'balance')::numeric;
  v_dep := (v_price->>'deposit_min')::numeric;
  v_dep_rem := (v_price->>'deposit_remaining')::numeric;
  v_paid := (v_price->>'paid_gross')::numeric;

  v_new := b.status;
  if b.status in ('pre_reserva', 'sinal_pago', 'quitada') then
    if v_total > 0 and v_balance = 0 then
      v_new := 'quitada';
    elsif v_paid > 0 and v_dep_rem = 0 then
      v_new := 'sinal_pago';
    else
      v_new := 'pre_reserva';
    end if;
    -- "Marcada como quitada" manualmente (cortesia/arredondamento) é
    -- preservada enquanto nada que mexe em valor mudar: só rebaixa se o saldo
    -- aumentou em relação ao momento em que foi marcada.
    if b.status = 'quitada' and v_new <> 'quitada'
       and coalesce((select (h.details->>'balance')::numeric
                     from public.rv_booking_history h
                     where h.booking_id = b.id and h.action = 'marcada_quitada'
                     order by h.created_at desc limit 1), -1) >= v_balance then
      v_new := 'quitada';
    end if;
  end if;

  select e.hold_hours into v_hold_hours from public.rv_events e where e.id = b.event_id;

  update public.rv_bookings set
    total_amount = v_total,
    total_pix_amount = (v_price->>'total_pix')::numeric,
    consumption_total = (v_price->>'consumption_total')::numeric,
    deposit_min_amount = v_dep,
    status = v_new,
    deposit_paid_at = case
      when v_new in ('sinal_pago', 'quitada') then coalesce(deposit_paid_at, now())
      else null end,
    paid_in_full_at = case when v_new = 'quitada' then coalesce(paid_in_full_at, now()) else null end,
    -- voltou para pré-reserva (ex.: estorno): ganha um prazo novo se o antigo já venceu
    hold_expires_at = case
      when v_new = 'pre_reserva' and b.status <> 'pre_reserva'
        then greatest(coalesce(hold_expires_at, now()), now() + make_interval(hours => v_hold_hours))
      else hold_expires_at end
  where id = b.id;

  if v_new <> b.status then
    perform public.rv_log(b.id, 'status_automatico', b.status, v_new,
      jsonb_build_object('paid_gross', v_paid, 'total', v_total, 'deposit_min', v_dep));
    if v_new = 'sinal_pago' and b.status = 'pre_reserva' then
      perform public.rv_enqueue_email(b.id, 'rv_deposit_received');
    elsif v_new = 'quitada' then
      perform public.rv_enqueue_email(b.id, 'rv_paid_in_full');
    end if;
  end if;

  return v_new;
end;
$$;

-- Expira pré-reservas vencidas SEM nenhum pagamento (todas, ou só de uma mesa).
-- Pré-reserva com pagamento parcial não expira: aparece como "sinal incompleto".
create or replace function public.rv_expire_due(p_table_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
  v_count int := 0;
begin
  for r in
    select b.id from public.rv_bookings b
    where b.status = 'pre_reserva'
      and b.hold_expires_at is not null
      and b.hold_expires_at <= now()
      and (p_table_id is null or b.table_id = p_table_id)
      and not exists (select 1 from public.rv_payments p where p.booking_id = b.id and p.voided_at is null)
    for update skip locked
  loop
    update public.rv_bookings set status = 'expirada', expired_at = now() where id = r.id;
    perform public.rv_log(r.id, 'expirada', 'pre_reserva', 'expirada',
      jsonb_build_object('motivo', 'prazo do sinal vencido'), 'system');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- =========================================================================
-- Triggers
-- =========================================================================
create or replace function public.rv_refresh_table_state(p_table_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Sempre toca updated_at: o Realtime avisa o painel de qualquer mudança
  -- na reserva da mesa (sem expor dado nenhum — a linha só tem o estado).
  insert into public.rv_table_state (table_id, event_id, state, updated_at)
  select t.id, t.event_id, public.rv_table_live_state(t.id), now()
  from public.rv_tables t where t.id = p_table_id
  on conflict (table_id) do update
    set state = excluded.state, updated_at = excluded.updated_at;
end;
$$;

create or replace function public.rv_tg_booking_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.rv_refresh_table_state(new.table_id);
  if tg_op = 'UPDATE' and old.table_id is distinct from new.table_id then
    perform public.rv_refresh_table_state(old.table_id);
  end if;
  return null;
end;
$$;

create or replace function public.rv_tg_payment_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.rv_refresh_table_state((select b.table_id from public.rv_bookings b where b.id = new.booking_id));
  return null;
end;
$$;

create or replace function public.rv_tg_table_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.rv_refresh_table_state(new.id);
  return null;
end;
$$;

drop trigger if exists trg_rv_bookings_state on public.rv_bookings;
create trigger trg_rv_bookings_state
  after insert or update on public.rv_bookings
  for each row execute function public.rv_tg_booking_state();

drop trigger if exists trg_rv_payments_state on public.rv_payments;
create trigger trg_rv_payments_state
  after insert or update on public.rv_payments
  for each row execute function public.rv_tg_payment_state();

drop trigger if exists trg_rv_tables_state on public.rv_tables;
create trigger trg_rv_tables_state
  after insert or update of blocked, active, table_type_id on public.rv_tables
  for each row execute function public.rv_tg_table_state();

drop trigger if exists trg_rv_events_updated_at on public.rv_events;
create trigger trg_rv_events_updated_at before update on public.rv_events
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_rv_events_updated_by on public.rv_events;
create trigger trg_rv_events_updated_by before update on public.rv_events
  for each row execute function public.fn_set_updated_by();
drop trigger if exists trg_rv_types_updated_at on public.rv_table_types;
create trigger trg_rv_types_updated_at before update on public.rv_table_types
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_rv_tables_updated_at on public.rv_tables;
create trigger trg_rv_tables_updated_at before update on public.rv_tables
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_rv_lots_updated_at on public.rv_lots;
create trigger trg_rv_lots_updated_at before update on public.rv_lots
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_rv_lot_prices_updated_at on public.rv_lot_prices;
create trigger trg_rv_lot_prices_updated_at before update on public.rv_lot_prices
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_rv_bookings_updated_at on public.rv_bookings;
create trigger trg_rv_bookings_updated_at before update on public.rv_bookings
  for each row execute function public.fn_set_updated_at();
drop trigger if exists trg_rv_bookings_updated_by on public.rv_bookings;
create trigger trg_rv_bookings_updated_by before update on public.rv_bookings
  for each row execute function public.fn_set_updated_by();

-- =========================================================================
-- PÚBLICO — dados do evento + mapa com ocupação (sem nomes/valores de reservas)
-- =========================================================================
create or replace function public.rv_public_event(p_slug text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_lot_id uuid;
  v_result jsonb;
begin
  v_event_id := public.rv_resolve_event(p_slug);
  if v_event_id is null then
    raise exception 'EVENT_NOT_FOUND: Evento não encontrado.';
  end if;
  v_lot_id := public.rv_current_lot(v_event_id);

  select jsonb_build_object(
    'event', jsonb_build_object(
      'id', e.id, 'slug', e.slug, 'name', e.name,
      'starts_at', e.starts_at, 'ends_at', e.ends_at, 'timezone', e.timezone,
      'venue_name', e.venue_name, 'address', e.address, 'menu_url', e.menu_url,
      'included_items', e.included_items, 'texts', e.texts, 'map', e.map,
      'whatsapp_number', e.whatsapp_number,
      'whatsapp_template', e.whatsapp_templates->'comprovante',
      'deposit_pct', e.deposit_pct, 'pix_discount_pct', e.pix_discount_pct,
      'hold_hours', e.hold_hours, 'balance_due_date', e.balance_due_date,
      'child_discount', e.child_discount, 'child_max_age', e.child_max_age,
      'sales_open', e.sales_open and v_lot_id is not null and now() < e.starts_at,
      'tracking', e.tracking
    ),
    'lot', (select jsonb_build_object('id', l.id, 'name', l.name, 'ends_at', l.ends_at)
            from public.rv_lots l where l.id = v_lot_id),
    'terms', (select jsonb_build_object('id', t.id, 'version', t.version, 'body', t.body)
              from public.rv_terms t where t.event_id = e.id
              order by t.version desc limit 1),
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tt.id, 'code', tt.code, 'name', tt.name, 'description', tt.description,
        'color', tt.color, 'min_people', tt.min_people, 'included_people', tt.included_people,
        'max_people', tt.max_people, 'allows_extra_chairs', tt.allows_extra_chairs,
        'max_infants', tt.max_infants,
        'table_price', lp.table_price, 'table_consumption', lp.table_consumption,
        'extra_chair_price', lp.extra_chair_price, 'extra_chair_consumption', lp.extra_chair_consumption
      ) order by tt.sort_order)
      from public.rv_table_types tt
      left join public.rv_lot_prices lp on lp.table_type_id = tt.id and lp.lot_id = v_lot_id
      where tt.event_id = e.id), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'type_id', t.table_type_id,
        'x', t.x, 'y', t.y, 'w', t.w, 'h', t.h, 'rotation', t.rotation, 'shape', t.shape,
        -- público só distingue livre / em negociação / reservada
        'state', case s.st when 'bloqueada' then 'reservada' else s.st end
      ) order by t.sort_order, t.label)
      from public.rv_tables t
      cross join lateral (select public.rv_table_live_state(t.id) as st) s
      where t.event_id = e.id and t.active = true), '[]'::jsonb)
  ) into v_result
  from public.rv_events e
  where e.id = v_event_id;

  return v_result;
end;
$$;

-- Simulação pública: mesmo cálculo que será gravado na reserva.
create or replace function public.rv_simulate(
  p_table_id uuid,
  p_adults int,
  p_children int default 0,
  p_infants int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  t public.rv_tables%rowtype;
  e public.rv_events%rowtype;
  v_lot_id uuid;
  v_err text;
  v_state text;
  v_price jsonb;
begin
  select * into t from public.rv_tables where id = p_table_id and active = true;
  if not found then
    raise exception 'TABLE_NOT_FOUND: Mesa não encontrada.';
  end if;
  select * into e from public.rv_events where id = t.event_id;
  v_lot_id := public.rv_current_lot(e.id);
  if v_lot_id is null then
    raise exception 'SALES_CLOSED: As vendas não estão abertas no momento.';
  end if;

  v_err := coalesce(public.rv_party_error(t.table_type_id, p_adults, p_children, p_infants, false),
                    public.rv_seat_limit_error(e.id, t.table_type_id, p_adults, p_children));
  v_state := public.rv_table_live_state(t.id);
  v_price := public.rv_price_for_lot(v_lot_id, t.table_type_id, greatest(p_adults, 0), greatest(p_children, 0));

  return jsonb_build_object(
    'valid', v_err is null and v_state = 'livre',
    'error_code', coalesce(split_part(v_err, ':', 1), case when v_state <> 'livre' then 'TABLE_TAKEN' end),
    'message', coalesce(nullif(trim(substr(v_err, strpos(v_err, ':') + 1)), ''),
                        case when v_state <> 'livre' then 'Esta mesa não está mais disponível. Escolha outra no mapa.' end),
    'table', jsonb_build_object('id', t.id, 'label', t.label, 'state', case v_state when 'bloqueada' then 'reservada' else v_state end),
    'lot_id', v_lot_id,
    'price', v_price,
    -- saldo depois de pagar exatamente o sinal mínimo (mesma função de preço)
    'after_deposit', public.rv_price_for_lot(v_lot_id, t.table_type_id, greatest(p_adults, 0), greatest(p_children, 0),
                                             null, 0, (v_price->>'deposit_min')::numeric),
    'hold_hours', e.hold_hours,
    'hold_expires_at_preview', now() + make_interval(hours => e.hold_hours),
    'balance_due_date', e.balance_due_date,
    'deposit_pct', e.deposit_pct,
    'pix_discount_pct', e.pix_discount_pct
  );
end;
$$;

-- =========================================================================
-- rv_create_prebooking — criação transacional (site público e admin).
-- Anti-colisão em duas camadas: trava a linha da mesa (FOR UPDATE, serializa
-- quem clicou na mesma mesa) + índice único parcial (garantia final).
-- Admin: pode criar abaixo do mínimo (p_allow_below_min), sem limite de
-- vendas abertas, sem exigir aceite dos termos e com observação interna.
-- =========================================================================
create or replace function public.rv_create_prebooking(
  p_table_id uuid,
  p_adults int,
  p_children int,
  p_infants int,
  p_name text,
  p_phone text,
  p_email text,
  p_terms_id uuid default null,
  p_accept_terms boolean default false,
  p_marketing_opt_in boolean default false,
  p_notes text default null,
  p_honeypot text default null,
  p_attribution jsonb default '{}'::jsonb,
  p_internal_notes text default null,
  p_allow_below_min boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_is_admin boolean;
  v_actor uuid;
  t public.rv_tables%rowtype;
  tt public.rv_table_types%rowtype;
  e public.rv_events%rowtype;
  lp public.rv_lot_prices%rowtype;
  v_lot_id uuid;
  v_err text;
  v_terms_current uuid;
  v_phone_digits text;
  v_email citext;
  v_recent int;
  v_holds int;
  v_customer_id uuid;
  v_code text;
  v_booking_id uuid;
  v_price jsonb;
  v_hold timestamptz;
begin
  if p_honeypot is not null and length(trim(p_honeypot)) > 0 then
    raise exception 'HONEYPOT: Não foi possível concluir sua reserva.';
  end if;

  v_is_admin := public.fn_is_admin();
  v_actor := case when v_is_admin then public.fn_current_app_user_id() end;

  -- ---- entrada ----
  p_name := trim(coalesce(p_name, ''));
  if length(p_name) = 0 then
    raise exception 'INVALID_INPUT: Informe o nome do responsável.';
  end if;
  if length(p_name) > 120 then
    raise exception 'INVALID_INPUT: Nome muito longo.';
  end if;
  v_phone_digits := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  if length(v_phone_digits) < 10 or length(v_phone_digits) > 13 then
    raise exception 'INVALID_INPUT: Informe um WhatsApp válido, com DDD.';
  end if;
  v_email := nullif(trim(coalesce(p_email, '')), '')::citext;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_INPUT: Informe um e-mail válido.';
  end if;
  if v_email is null and not v_is_admin then
    raise exception 'INVALID_INPUT: Informe um e-mail válido.';
  end if;
  if p_notes is not null and length(p_notes) > 500 then
    raise exception 'INVALID_INPUT: Observação muito longa.';
  end if;
  if not v_is_admin then
    p_internal_notes := null;
    p_allow_below_min := false;
  elsif p_internal_notes is not null and length(p_internal_notes) > 2000 then
    raise exception 'INVALID_INPUT: Observação interna muito longa.';
  end if;
  if p_attribution is null or jsonb_typeof(p_attribution) <> 'object' or length(p_attribution::text) > 4000 then
    p_attribution := '{}'::jsonb;
  end if;

  -- ---- trava a mesa: quem clicou na mesma mesa espera aqui, em fila ----
  select * into t from public.rv_tables where id = p_table_id and active = true for update;
  if not found then
    raise exception 'TABLE_NOT_FOUND: Mesa não encontrada.';
  end if;
  select * into tt from public.rv_table_types where id = t.table_type_id;
  select * into e from public.rv_events where id = t.event_id;

  if not e.active then
    raise exception 'SALES_CLOSED: As vendas não estão abertas no momento.';
  end if;
  if not v_is_admin and (not e.sales_open or now() >= e.starts_at) then
    raise exception 'SALES_CLOSED: As vendas pelo site estão encerradas. Fale conosco pelo WhatsApp.';
  end if;

  v_lot_id := public.rv_current_lot(e.id);
  if v_lot_id is null then
    raise exception 'SALES_CLOSED: Não há lote de vendas aberto no momento.';
  end if;
  select * into lp from public.rv_lot_prices where lot_id = v_lot_id and table_type_id = tt.id;
  if not found then
    raise exception 'SALES_CLOSED: Este tipo de mesa não está à venda no lote atual.';
  end if;

  select tr.id into v_terms_current from public.rv_terms tr
  where tr.event_id = e.id order by tr.version desc limit 1;
  if not v_is_admin then
    if not coalesce(p_accept_terms, false) then
      raise exception 'TERMS_REQUIRED: É necessário ler e aceitar os termos do evento.';
    end if;
    if p_terms_id is null or p_terms_id is distinct from v_terms_current then
      raise exception 'TERMS_OUTDATED: Os termos foram atualizados. Recarregue a página e confira antes de continuar.';
    end if;
  end if;

  v_err := public.rv_party_error(tt.id, p_adults, p_children, p_infants, p_allow_below_min);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  if t.blocked then
    raise exception 'TABLE_TAKEN: Esta mesa não está disponível. Escolha outra no mapa.';
  end if;

  -- ---- anti-abuso (só público) ----
  if not v_is_admin then
    select count(*) into v_recent from public.rv_bookings b
    where b.created_at > now() - interval '10 minutes'
      and (regexp_replace(b.customer_phone, '\D', '', 'g') = v_phone_digits or b.customer_email = v_email);
    if v_recent >= 3 then
      raise exception 'DUPLICATE_REQUEST: Recebemos várias solicitações recentes com esses dados. Aguarde alguns minutos e tente novamente.';
    end if;

    select count(*) into v_holds from public.rv_bookings b
    where b.event_id = e.id and b.status = 'pre_reserva'
      and (b.hold_expires_at is null or b.hold_expires_at > now())
      and (regexp_replace(b.customer_phone, '\D', '', 'g') = v_phone_digits or b.customer_email = v_email);
    if v_holds >= e.max_active_holds_per_contact then
      raise exception 'TOO_MANY_HOLDS: Você já tem % pré-reservas aguardando sinal. Envie o comprovante ou fale conosco pelo WhatsApp para reservar mais mesas.', v_holds;
    end if;
  end if;

  -- ---- libera pré-reserva vencida desta mesa e confere ocupação ----
  perform public.rv_expire_due(t.id);
  if exists (select 1 from public.rv_bookings b
             where b.table_id = t.id and b.status in ('pre_reserva', 'sinal_pago', 'quitada')) then
    raise exception 'TABLE_TAKEN: Esta mesa acabou de ser reservada por outra pessoa. Escolha outra no mapa.';
  end if;

  -- Limite de cadeiras do evento: trava o evento para que duas reservas
  -- simultâneas em mesas diferentes não passem juntas do limite.
  perform 1 from public.rv_events where id = e.id for update;
  v_err := public.rv_seat_limit_error(e.id, tt.id, p_adults, p_children);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  -- ---- cliente (CRM compartilhado com a reserva comum) ----
  select c.id into v_customer_id from public.customers c
  where regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') = v_phone_digits
  limit 1;
  if v_customer_id is null and v_email is not null then
    select c.id into v_customer_id from public.customers c where c.email = v_email limit 1;
  end if;
  if v_customer_id is null then
    insert into public.customers (name, email, phone, marketing_opt_in, marketing_opt_in_at)
    values (p_name, v_email, p_phone, coalesce(p_marketing_opt_in, false),
            case when p_marketing_opt_in then now() end)
    returning customers.id into v_customer_id;
  elsif coalesce(p_marketing_opt_in, false) then
    update public.customers c set
      marketing_opt_in = true,
      marketing_opt_in_at = coalesce(c.marketing_opt_in_at, now())
    where c.id = v_customer_id;
  end if;

  loop
    v_code := 'RV-' || upper(substr(encode(extensions.gen_random_bytes(4), 'hex'), 1, 6));
    exit when not exists (select 1 from public.rv_bookings b where b.public_code = v_code);
  end loop;

  v_price := public.rv_price_for_lot(v_lot_id, tt.id, p_adults, p_children);
  v_hold := now() + make_interval(hours => e.hold_hours);

  begin
    insert into public.rv_bookings (
      public_code, event_id, table_id, lot_id, customer_id,
      customer_name, customer_phone, customer_email,
      adults, children, infants, customer_notes, internal_notes,
      status, hold_expires_at,
      snap_table_price, snap_table_consumption, snap_extra_chair_price, snap_extra_chair_consumption,
      snap_included_people, snap_allows_extra_chairs, snap_child_discount,
      snap_pix_discount_pct, snap_deposit_pct,
      total_amount, total_pix_amount, consumption_total, deposit_min_amount,
      terms_id, terms_accepted_at, marketing_opt_in, source, attribution,
      below_min_override, created_by_user_id
    ) values (
      v_code, e.id, t.id, v_lot_id, v_customer_id,
      p_name, p_phone, v_email,
      p_adults, p_children, p_infants, nullif(trim(coalesce(p_notes, '')), ''), nullif(trim(coalesce(p_internal_notes, '')), ''),
      'pre_reserva', v_hold,
      lp.table_price, lp.table_consumption, lp.extra_chair_price, lp.extra_chair_consumption,
      tt.included_people, tt.allows_extra_chairs, e.child_discount,
      e.pix_discount_pct, e.deposit_pct,
      (v_price->>'total')::numeric, (v_price->>'total_pix')::numeric,
      (v_price->>'consumption_total')::numeric, (v_price->>'deposit_min')::numeric,
      case when coalesce(p_accept_terms, false) or not v_is_admin then v_terms_current end,
      case when coalesce(p_accept_terms, false) then now() end,
      coalesce(p_marketing_opt_in, false),
      case when v_is_admin then 'admin' else 'public_site' end,
      p_attribution,
      (p_adults + p_children) < tt.min_people,
      v_actor
    ) returning rv_bookings.id into v_booking_id;
  exception when unique_violation then
    raise exception 'TABLE_TAKEN: Esta mesa acabou de ser reservada por outra pessoa. Escolha outra no mapa.';
  end;

  perform public.rv_log(v_booking_id, 'criada', null, 'pre_reserva',
    jsonb_build_object('mesa', t.label, 'lote', v_lot_id, 'total', v_price->'total',
                       'origem', case when v_is_admin then 'admin' else 'site' end),
    'customer');
  perform public.rv_enqueue_email(v_booking_id, 'rv_prebooking');

  return public.rv_booking_payload(v_booking_id) || jsonb_build_object('id', v_booking_id);
end;
$$;

-- =========================================================================
-- STAFF (admin + operador) — mapa e portaria. Operador NUNCA recebe valores:
-- as chaves financeiras só são adicionadas ao JSON quando fn_is_admin().
-- =========================================================================
create or replace function public.rv_staff_board(p_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin boolean;
  v_event_id uuid;
  v_result jsonb;
begin
  if not public.fn_is_active_staff() then
    raise exception 'FORBIDDEN: Acesso restrito à equipe.';
  end if;
  v_admin := public.fn_is_admin();
  v_event_id := public.rv_resolve_event(p_slug);
  if v_event_id is null then
    raise exception 'EVENT_NOT_FOUND: Evento não encontrado.';
  end if;

  perform public.rv_expire_due(null);

  select jsonb_build_object(
    'role', case when v_admin then 'admin' else 'operator' end,
    'now', now(),
    'event', jsonb_build_object(
      'id', e.id, 'slug', e.slug, 'name', e.name, 'starts_at', e.starts_at, 'ends_at', e.ends_at,
      'timezone', e.timezone, 'map', e.map, 'address', e.address
    ) || case when v_admin then jsonb_build_object(
      'whatsapp_templates', e.whatsapp_templates, 'whatsapp_number', e.whatsapp_number,
      'pix_key', e.pix_key, 'pix_key_type', e.pix_key_type, 'pix_holder', e.pix_holder,
      'balance_due_date', e.balance_due_date, 'hold_hours', e.hold_hours,
      'deposit_pct', e.deposit_pct, 'pix_discount_pct', e.pix_discount_pct
    ) else '{}'::jsonb end,
    'types', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tt.id, 'code', tt.code, 'name', tt.name, 'color', tt.color,
        'min_people', tt.min_people, 'included_people', tt.included_people, 'max_people', tt.max_people,
        'max_infants', tt.max_infants
      ) order by tt.sort_order)
      from public.rv_table_types tt where tt.event_id = e.id), '[]'::jsonb),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'label', t.label, 'type_id', t.table_type_id,
        'x', t.x, 'y', t.y, 'w', t.w, 'h', t.h, 'rotation', t.rotation, 'shape', t.shape,
        'active', t.active, 'blocked', t.blocked, 'block_reason', t.block_reason,
        'state', public.rv_table_live_state(t.id),
        'booking', (
          select jsonb_build_object(
            'id', b.id, 'public_code', b.public_code, 'status', b.status,
            'customer_name', b.customer_name, 'adults', b.adults, 'children', b.children,
            'infants', b.infants, 'customer_notes', b.customer_notes, 'internal_notes', b.internal_notes,
            'hold_expires_at', b.hold_expires_at
          ) || case when v_admin then jsonb_build_object(
            'customer_phone', b.customer_phone, 'customer_email', b.customer_email,
            'price', public.rv_price_for_booking(b.id)
          ) else '{}'::jsonb end
          from public.rv_bookings b
          where b.table_id = t.id and b.status in ('pre_reserva', 'sinal_pago', 'quitada')
          limit 1)
      ) order by t.sort_order, t.label)
      from public.rv_tables t where t.event_id = e.id), '[]'::jsonb)
  ) into v_result
  from public.rv_events e where e.id = v_event_id;

  return v_result;
end;
$$;

-- Lista da portaria: sem valores (admin e operador).
create or replace function public.rv_door_list(p_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
begin
  if not public.fn_is_active_staff() then
    raise exception 'FORBIDDEN: Acesso restrito à equipe.';
  end if;
  v_event_id := public.rv_resolve_event(p_slug);
  perform public.rv_expire_due(null);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'table_label', t.label, 'table_type', tt.name, 'public_code', b.public_code,
      'status', b.status, 'customer_name', b.customer_name,
      'adults', b.adults, 'children', b.children, 'infants', b.infants,
      'people', b.adults + b.children,
      'customer_notes', b.customer_notes, 'internal_notes', b.internal_notes
    ) order by tt.sort_order, t.sort_order, t.label)
    from public.rv_bookings b
    join public.rv_tables t on t.id = b.table_id
    join public.rv_table_types tt on tt.id = t.table_type_id
    where b.event_id = v_event_id and b.status in ('pre_reserva', 'sinal_pago', 'quitada')
  ), '[]'::jsonb);
end;
$$;

-- =========================================================================
-- ADMIN — detalhe, ações e relatórios
-- =========================================================================
create or replace function public.rv_booking_detail(p_booking_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.rv_require_admin();
  return (
    select to_jsonb(b) || jsonb_build_object(
      'table_label', t.label, 'table_type', tt.name, 'table_type_id', tt.id,
      'lot_name', l.name, 'terms_version', tr.version,
      'price', public.rv_price_for_booking(b.id),
      'payments', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id, 'paid_at', p.paid_at, 'amount', p.amount, 'method', p.method,
          'payer_name', p.payer_name, 'notes', p.notes, 'created_at', p.created_at,
          'created_by', au.name, 'voided_at', p.voided_at, 'void_reason', p.void_reason
        ) order by p.paid_at)
        from public.rv_payments p left join public.app_users au on au.id = p.created_by_user_id
        where p.booking_id = b.id), '[]'::jsonb),
      'history', coalesce((
        select jsonb_agg(jsonb_build_object(
          'action', h.action, 'old_status', h.old_status, 'new_status', h.new_status,
          'details', h.details, 'actor_type', h.actor_type, 'actor_name', au.name,
          'created_at', h.created_at
        ) order by h.created_at)
        from public.rv_booking_history h left join public.app_users au on au.id = h.actor_user_id
        where h.booking_id = b.id), '[]'::jsonb),
      'discount_by', (select au.name from public.app_users au where au.id = b.manual_discount_by_user_id)
    )
    from public.rv_bookings b
    join public.rv_tables t on t.id = b.table_id
    join public.rv_table_types tt on tt.id = t.table_type_id
    left join public.rv_lots l on l.id = b.lot_id
    left join public.rv_terms tr on tr.id = b.terms_id
    where b.id = p_booking_id
  );
end;
$$;

create or replace function public.rv_admin_register_payment(
  p_booking_id uuid,
  p_amount numeric,
  p_method text,
  p_paid_at timestamptz default null,
  p_payer_name text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_status text;
  v_payment_id uuid;
begin
  v_actor := public.rv_require_admin();
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_INPUT: Informe um valor maior que zero.';
  end if;
  if p_method not in ('pix', 'debito', 'credito') then
    raise exception 'INVALID_INPUT: Forma de pagamento inválida.';
  end if;

  select b.status into v_status from public.rv_bookings b where b.id = p_booking_id for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND: Reserva não encontrada.';
  end if;
  if v_status not in ('pre_reserva', 'sinal_pago', 'quitada') then
    raise exception 'INVALID_STATUS: Não é possível registrar pagamento em reserva %.', v_status;
  end if;

  insert into public.rv_payments (booking_id, paid_at, amount, method, payer_name, notes, created_by_user_id)
  values (p_booking_id, coalesce(p_paid_at, now()), round(p_amount, 2), p_method,
          nullif(trim(coalesce(p_payer_name, '')), ''), nullif(trim(coalesce(p_notes, '')), ''), v_actor)
  returning id into v_payment_id;

  perform public.rv_log(p_booking_id, 'pagamento', v_status, v_status,
    jsonb_build_object('payment_id', v_payment_id, 'valor', round(p_amount, 2), 'forma', p_method,
                       'pagador', p_payer_name, 'data', coalesce(p_paid_at, now())));
  perform public.rv_recalc_booking(p_booking_id);
  return public.rv_booking_detail(p_booking_id);
end;
$$;

create or replace function public.rv_admin_void_payment(p_payment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_booking uuid;
  v_amount numeric;
begin
  v_actor := public.rv_require_admin();
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'INVALID_INPUT: Informe o motivo do estorno.';
  end if;
  update public.rv_payments set voided_at = now(), voided_by_user_id = v_actor, void_reason = trim(p_reason)
  where id = p_payment_id and voided_at is null
  returning booking_id, amount into v_booking, v_amount;
  if v_booking is null then
    raise exception 'PAYMENT_NOT_FOUND: Pagamento não encontrado ou já estornado.';
  end if;
  perform public.rv_log(v_booking, 'pagamento_estornado', null, null,
    jsonb_build_object('payment_id', p_payment_id, 'valor', v_amount, 'motivo', trim(p_reason)));
  perform public.rv_recalc_booking(v_booking);
  return public.rv_booking_detail(v_booking);
end;
$$;

create or replace function public.rv_admin_apply_discount(
  p_booking_id uuid,
  p_type text,
  p_value numeric,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  b public.rv_bookings%rowtype;
begin
  v_actor := public.rv_require_admin();
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'INVALID_INPUT: O motivo do desconto é obrigatório.';
  end if;
  if p_type is not null and p_type not in ('pct', 'amount') then
    raise exception 'INVALID_INPUT: Tipo de desconto inválido.';
  end if;
  if coalesce(p_value, 0) < 0 or (p_type = 'pct' and p_value > 100) then
    raise exception 'INVALID_INPUT: Valor de desconto inválido.';
  end if;

  select * into b from public.rv_bookings where id = p_booking_id for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND: Reserva não encontrada.';
  end if;
  if b.status not in ('pre_reserva', 'sinal_pago', 'quitada') then
    raise exception 'INVALID_STATUS: Reserva % não aceita desconto.', b.status;
  end if;

  update public.rv_bookings set
    manual_discount_type = case when coalesce(p_value, 0) = 0 then null else p_type end,
    manual_discount_value = case when p_type is null then 0 else coalesce(p_value, 0) end,
    manual_discount_reason = trim(p_reason),
    manual_discount_by_user_id = v_actor,
    manual_discount_at = now()
  where id = b.id;

  perform public.rv_log(b.id, 'desconto', b.status, b.status, jsonb_build_object(
    'tipo', p_type, 'valor', p_value, 'motivo', trim(p_reason),
    'anterior', jsonb_build_object('tipo', b.manual_discount_type, 'valor', b.manual_discount_value)));
  perform public.rv_recalc_booking(b.id);
  return public.rv_booking_detail(b.id);
end;
$$;

create or replace function public.rv_admin_mark_paid(p_booking_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.rv_bookings%rowtype;
  v_balance numeric;
begin
  perform public.rv_require_admin();
  select * into b from public.rv_bookings where id = p_booking_id for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND: Reserva não encontrada.';
  end if;
  if b.status not in ('pre_reserva', 'sinal_pago') then
    raise exception 'INVALID_STATUS: Reserva % não pode ser marcada como quitada.', b.status;
  end if;
  v_balance := (public.rv_price_for_booking(b.id)->>'balance')::numeric;
  if v_balance > 0 and (p_note is null or length(trim(p_note)) < 3) then
    raise exception 'NOTE_REQUIRED: Ainda há saldo de R$ %. Explique por que está quitando.', to_char(v_balance, 'FM999G990D00');
  end if;

  update public.rv_bookings set
    status = 'quitada',
    deposit_paid_at = coalesce(deposit_paid_at, now()),
    paid_in_full_at = now()
  where id = b.id;
  perform public.rv_log(b.id, 'marcada_quitada', b.status, 'quitada',
    jsonb_build_object('balance', v_balance, 'nota', nullif(trim(coalesce(p_note, '')), '')));
  perform public.rv_enqueue_email(b.id, 'rv_paid_in_full');
  return public.rv_booking_detail(b.id);
end;
$$;

create or replace function public.rv_admin_extend_hold(p_booking_id uuid, p_hours int)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.rv_bookings%rowtype;
  v_new timestamptz;
begin
  perform public.rv_require_admin();
  if p_hours is null or p_hours < 1 or p_hours > 720 then
    raise exception 'INVALID_INPUT: Informe de 1 a 720 horas.';
  end if;
  select * into b from public.rv_bookings where id = p_booking_id for update;
  if not found or b.status <> 'pre_reserva' then
    raise exception 'INVALID_STATUS: Só pré-reservas têm prazo para estender.';
  end if;
  v_new := greatest(coalesce(b.hold_expires_at, now()), now()) + make_interval(hours => p_hours);
  update public.rv_bookings set hold_expires_at = v_new where id = b.id;
  -- novo prazo = pode avisar de novo 12h antes
  delete from public.notification_queue q
   where q.rv_booking_id = b.id and q.type = 'rv_expiry_warning' and q.status in ('sent', 'failed', 'skipped');
  perform public.rv_log(b.id, 'prazo_estendido', b.status, b.status,
    jsonb_build_object('de', b.hold_expires_at, 'para', v_new, 'horas', p_hours));
  return public.rv_booking_detail(b.id);
end;
$$;

-- Prazo do sinal numa data/hora escolhida pelo admin (pode encurtar ou alongar).
-- Os botões +12h/+24h/+48h do painel só preenchem essa data.
create or replace function public.rv_admin_set_hold(p_booking_id uuid, p_until timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.rv_bookings%rowtype;
  v_starts timestamptz;
begin
  perform public.rv_require_admin();
  if p_until is null or p_until <= now() + interval '5 minutes' then
    raise exception 'INVALID_INPUT: Escolha uma data e hora no futuro.';
  end if;
  select * into b from public.rv_bookings where id = p_booking_id for update;
  if not found or b.status <> 'pre_reserva' then
    raise exception 'INVALID_STATUS: Só pré-reservas têm prazo para estender.';
  end if;
  select starts_at into v_starts from public.rv_events where id = b.event_id;
  if p_until > v_starts then
    raise exception 'INVALID_INPUT: O prazo não pode passar do início do evento.';
  end if;
  update public.rv_bookings set hold_expires_at = p_until where id = b.id;
  -- novo prazo = pode avisar de novo antes de expirar
  delete from public.notification_queue q
   where q.rv_booking_id = b.id and q.type = 'rv_expiry_warning' and q.status in ('sent', 'failed', 'skipped');
  perform public.rv_log(b.id, 'prazo_estendido', b.status, b.status,
    jsonb_build_object('de', b.hold_expires_at, 'para', p_until));
  return public.rv_booking_detail(b.id);
end;
$$;


create or replace function public.rv_admin_cancel(p_booking_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  b public.rv_bookings%rowtype;
begin
  v_actor := public.rv_require_admin();
  if p_reason is null or length(trim(p_reason)) < 3 then
    raise exception 'INVALID_INPUT: Informe o motivo do cancelamento.';
  end if;
  select * into b from public.rv_bookings where id = p_booking_id for update;
  if not found or b.status not in ('pre_reserva', 'sinal_pago', 'quitada') then
    raise exception 'INVALID_STATUS: Esta reserva não está ativa.';
  end if;
  update public.rv_bookings set status = 'cancelada', cancelled_at = now(),
    cancelled_by_user_id = v_actor, cancel_reason = trim(p_reason)
  where id = b.id;
  perform public.rv_log(b.id, 'cancelada', b.status, 'cancelada',
    jsonb_build_object('motivo', trim(p_reason), 'pago', public.rv_paid_net(b.id)));
  return public.rv_booking_detail(b.id);
end;
$$;

-- Mover de mesa. Com p_apply = false devolve só a prévia (preço novo), para o
-- painel mostrar a diferença antes de confirmar quando o tipo de mesa muda.
create or replace function public.rv_admin_move(
  p_booking_id uuid,
  p_new_table_id uuid,
  p_apply boolean default false,
  p_allow_below_min boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.rv_bookings%rowtype;
  t_old public.rv_tables%rowtype;
  t_new public.rv_tables%rowtype;
  tt public.rv_table_types%rowtype;
  lp public.rv_lot_prices%rowtype;
  v_lot uuid;
  v_err text;
  v_new_price jsonb;
  v_old_price jsonb;
begin
  perform public.rv_require_admin();
  select * into b from public.rv_bookings where id = p_booking_id;
  if not found or b.status not in ('pre_reserva', 'sinal_pago', 'quitada') then
    raise exception 'INVALID_STATUS: Esta reserva não está ativa.';
  end if;
  if b.table_id = p_new_table_id then
    raise exception 'INVALID_INPUT: A reserva já está nesta mesa.';
  end if;

  -- trava as duas mesas sempre na mesma ordem (evita deadlock)
  perform 1 from public.rv_tables where id in (b.table_id, p_new_table_id) order by id for update;
  select * into b from public.rv_bookings where id = p_booking_id for update;
  select * into t_old from public.rv_tables where id = b.table_id;
  select * into t_new from public.rv_tables where id = p_new_table_id and active = true;
  if not found or t_new.event_id <> b.event_id then
    raise exception 'TABLE_NOT_FOUND: Mesa de destino não encontrada.';
  end if;
  if t_new.blocked then
    raise exception 'TABLE_TAKEN: A mesa de destino está bloqueada.';
  end if;
  perform public.rv_expire_due(t_new.id);
  if exists (select 1 from public.rv_bookings x
             where x.table_id = t_new.id and x.status in ('pre_reserva', 'sinal_pago', 'quitada')) then
    raise exception 'TABLE_TAKEN: A mesa de destino já tem reserva.';
  end if;

  v_err := public.rv_party_error(t_new.table_type_id, b.adults, b.children, b.infants, p_allow_below_min or b.below_min_override);
  if v_err is not null then
    raise exception '%', v_err;
  end if;
  perform 1 from public.rv_events where id = b.event_id for update;
  v_err := public.rv_seat_limit_error(b.event_id, t_new.table_type_id, b.adults, b.children, b.id);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  v_old_price := public.rv_price_for_booking(b.id);

  if t_new.table_type_id <> t_old.table_type_id then
    select * into tt from public.rv_table_types where id = t_new.table_type_id;
    v_lot := coalesce(b.lot_id, public.rv_current_lot(b.event_id));
    select * into lp from public.rv_lot_prices where lot_id = v_lot and table_type_id = tt.id;
    if not found then
      v_lot := public.rv_current_lot(b.event_id);
      select * into lp from public.rv_lot_prices where lot_id = v_lot and table_type_id = tt.id;
      if not found then
        raise exception 'NO_PRICE: Não há preço para esse tipo de mesa.';
      end if;
    end if;
    select to_jsonb(r) into v_new_price from public.rv_calc_price(
      lp.table_price, lp.table_consumption, lp.extra_chair_price, lp.extra_chair_consumption,
      tt.included_people, tt.allows_extra_chairs, b.snap_child_discount, b.snap_pix_discount_pct,
      b.snap_deposit_pct, b.adults, b.children, b.manual_discount_type, b.manual_discount_value,
      public.rv_paid_gross(b.id)) r;
  else
    v_new_price := v_old_price;
  end if;

  if not coalesce(p_apply, false) then
    return jsonb_build_object('preview', true, 'from', t_old.label, 'to', t_new.label,
      'type_changed', t_new.table_type_id <> t_old.table_type_id,
      'old_price', v_old_price, 'new_price', v_new_price);
  end if;

  update public.rv_bookings set
    table_id = t_new.id,
    lot_id = case when t_new.table_type_id <> t_old.table_type_id then v_lot else lot_id end,
    snap_table_price = case when t_new.table_type_id <> t_old.table_type_id then lp.table_price else snap_table_price end,
    snap_table_consumption = case when t_new.table_type_id <> t_old.table_type_id then lp.table_consumption else snap_table_consumption end,
    snap_extra_chair_price = case when t_new.table_type_id <> t_old.table_type_id then lp.extra_chair_price else snap_extra_chair_price end,
    snap_extra_chair_consumption = case when t_new.table_type_id <> t_old.table_type_id then lp.extra_chair_consumption else snap_extra_chair_consumption end,
    snap_included_people = case when t_new.table_type_id <> t_old.table_type_id then tt.included_people else snap_included_people end,
    snap_allows_extra_chairs = case when t_new.table_type_id <> t_old.table_type_id then tt.allows_extra_chairs else snap_allows_extra_chairs end,
    below_min_override = below_min_override or coalesce(p_allow_below_min, false)
  where id = b.id;

  perform public.rv_log(b.id, 'movida', b.status, b.status, jsonb_build_object(
    'de', t_old.label, 'para', t_new.label,
    'total_antes', v_old_price->'total', 'total_depois', v_new_price->'total'));
  perform public.rv_recalc_booking(b.id);
  return public.rv_booking_detail(b.id);
end;
$$;

-- Editar dados da reserva (contato, pessoas, observações). Recalcula valores.
create or replace function public.rv_admin_update_booking(
  p_booking_id uuid,
  p_name text,
  p_phone text,
  p_email text,
  p_adults int,
  p_children int,
  p_infants int,
  p_customer_notes text,
  p_internal_notes text,
  p_allow_below_min boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  b public.rv_bookings%rowtype;
  v_type uuid;
  v_err text;
  v_email citext;
begin
  perform public.rv_require_admin();
  select * into b from public.rv_bookings where id = p_booking_id for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND: Reserva não encontrada.';
  end if;
  if length(trim(coalesce(p_name, ''))) = 0 or length(p_name) > 120 then
    raise exception 'INVALID_INPUT: Nome inválido.';
  end if;
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 10 then
    raise exception 'INVALID_INPUT: WhatsApp inválido.';
  end if;
  v_email := nullif(trim(coalesce(p_email, '')), '')::citext;
  if v_email is not null and v_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'INVALID_INPUT: E-mail inválido.';
  end if;
  select t.table_type_id into v_type from public.rv_tables t where t.id = b.table_id;
  v_err := public.rv_party_error(v_type, p_adults, p_children, p_infants, p_allow_below_min or b.below_min_override);
  if v_err is not null then
    raise exception '%', v_err;
  end if;
  perform 1 from public.rv_events where id = b.event_id for update;
  v_err := public.rv_seat_limit_error(b.event_id, v_type, p_adults, p_children, b.id);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  update public.rv_bookings set
    customer_name = trim(p_name), customer_phone = trim(p_phone), customer_email = v_email,
    adults = p_adults, children = p_children, infants = p_infants,
    customer_notes = nullif(trim(coalesce(p_customer_notes, '')), ''),
    internal_notes = nullif(trim(coalesce(p_internal_notes, '')), ''),
    below_min_override = below_min_override or coalesce(p_allow_below_min, false)
  where id = b.id;

  perform public.rv_log(b.id, 'editada', b.status, b.status, jsonb_build_object(
    'antes', jsonb_build_object('nome', b.customer_name, 'telefone', b.customer_phone, 'email', b.customer_email,
                                'adultos', b.adults, 'criancas', b.children, 'colo', b.infants),
    'depois', jsonb_build_object('nome', trim(p_name), 'telefone', trim(p_phone), 'email', v_email,
                                 'adultos', p_adults, 'criancas', p_children, 'colo', p_infants)));
  perform public.rv_recalc_booking(b.id);
  return public.rv_booking_detail(b.id);
end;
$$;

create or replace function public.rv_admin_set_table_block(p_table_id uuid, p_blocked boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.rv_require_admin();
  perform 1 from public.rv_tables where id = p_table_id for update;
  if not found then
    raise exception 'TABLE_NOT_FOUND: Mesa não encontrada.';
  end if;
  if p_blocked then
    perform public.rv_expire_due(p_table_id);
    if exists (select 1 from public.rv_bookings b
               where b.table_id = p_table_id and b.status in ('pre_reserva', 'sinal_pago', 'quitada')) then
      raise exception 'TABLE_HAS_BOOKING: Esta mesa tem reserva ativa. Mova ou cancele antes de bloquear.';
    end if;
  end if;
  update public.rv_tables set blocked = coalesce(p_blocked, false),
    block_reason = case when p_blocked then nullif(trim(coalesce(p_reason, '')), '') end
  where id = p_table_id;
end;
$$;

create or replace function public.rv_admin_save_terms(p_event_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_version int;
  v_id uuid;
begin
  v_actor := public.rv_require_admin();
  if p_body is null or length(trim(p_body)) < 20 then
    raise exception 'INVALID_INPUT: Texto dos termos muito curto.';
  end if;
  perform 1 from public.rv_events where id = p_event_id for update;
  select coalesce(max(version), 0) + 1 into v_version from public.rv_terms where event_id = p_event_id;
  insert into public.rv_terms (event_id, version, body, created_by_user_id)
  values (p_event_id, v_version, trim(p_body), v_actor)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'version', v_version);
end;
$$;

-- Resumo financeiro (só admin).
create or replace function public.rv_admin_summary(p_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
  v_result jsonb;
begin
  perform public.rv_require_admin();
  v_event_id := public.rv_resolve_event(p_slug);
  perform public.rv_expire_due(null);

  with bk as (
    select b.*, t.table_type_id, public.rv_price_for_booking(b.id) as pr
    from public.rv_bookings b join public.rv_tables t on t.id = b.table_id
    where b.event_id = v_event_id
  ), act as (
    select * from bk where status in ('pre_reserva', 'sinal_pago', 'quitada')
  ), by_type as (
    select tt.id, tt.code, tt.name, tt.color, tt.sort_order,
      (select count(*) from public.rv_tables t where t.table_type_id = tt.id and t.active) as tables_total,
      (select count(*) from public.rv_tables t where t.table_type_id = tt.id and t.active and t.blocked) as tables_blocked,
      tt.included_people * (select count(*) from public.rv_tables t where t.table_type_id = tt.id and t.active) as capacity,
      count(a.id) filter (where a.status in ('sinal_pago', 'quitada')) as sold,
      count(a.id) filter (where a.status = 'pre_reserva') as negotiating,
      coalesce(sum(a.adults + a.children) filter (where a.status in ('sinal_pago', 'quitada')), 0) as people_sold,
      coalesce(sum(a.adults + a.children), 0) as people_all,
      coalesce(sum(a.infants), 0) as infants,
      coalesce(sum(a.total_amount) filter (where a.status in ('sinal_pago', 'quitada')), 0) as total_sold,
      coalesce(sum(a.total_amount) filter (where a.status = 'pre_reserva'), 0) as total_negotiating
    from public.rv_table_types tt
    left join act a on a.table_type_id = tt.id
    where tt.event_id = v_event_id
    group by tt.id
  )
  select jsonb_build_object(
    'by_type', coalesce((select jsonb_agg(to_jsonb(bt) order by bt.sort_order) from by_type bt), '[]'::jsonb),
    'totals', jsonb_build_object(
      'bookings_active', (select count(*) from act),
      'bookings_sold', (select count(*) from act where status in ('sinal_pago', 'quitada')),
      'bookings_paid_in_full', (select count(*) from act where status = 'quitada'),
      'bookings_negotiating', (select count(*) from act where status = 'pre_reserva'),
      'deposit_incomplete', (select count(*) from act where status = 'pre_reserva' and (pr->>'paid_gross')::numeric > 0),
      'people_sold', (select coalesce(sum(adults + children), 0) from act where status in ('sinal_pago', 'quitada')),
      'people_all', (select coalesce(sum(adults + children), 0) from act),
      'children', (select coalesce(sum(children), 0) from act),
      'infants', (select coalesce(sum(infants), 0) from act),
      'capacity', (select coalesce(sum(capacity), 0) from by_type),
      'seat_limit', (select e.seat_limit from public.rv_events e where e.id = v_event_id),
      'seats_used', public.rv_seats_used(v_event_id),
      'bistro_capacity', (select coalesce(sum(capacity), 0) from by_type where code in (select tt.code from public.rv_table_types tt where tt.event_id = v_event_id and not tt.counts_toward_limit)),
      'bistro_people', (select coalesce(sum(people_all), 0) from by_type where code in (select tt.code from public.rv_table_types tt where tt.event_id = v_event_id and not tt.counts_toward_limit)),
      'total_sold', (select coalesce(sum(total_amount), 0) from act where status in ('sinal_pago', 'quitada')),
      'total_negotiating', (select coalesce(sum(total_amount), 0) from act where status = 'pre_reserva'),
      'received', (select coalesce(sum((pr->>'paid_net')::numeric), 0) from act),
      'received_on_cancelled', (select coalesce(sum((pr->>'paid_net')::numeric), 0) from bk where status in ('cancelada', 'expirada')),
      'to_receive', (select coalesce(sum((pr->>'balance')::numeric), 0) from act where status in ('sinal_pago', 'quitada')),
      'to_receive_pix', (select coalesce(sum((pr->>'balance_pix')::numeric), 0) from act where status in ('sinal_pago', 'quitada')),
      'consumption_committed', (select coalesce(sum(consumption_total), 0) from act where status in ('sinal_pago', 'quitada')),
      'consumption_negotiating', (select coalesce(sum(consumption_total), 0) from act where status = 'pre_reserva'),
      'children_discounts', (select coalesce(sum((pr->>'children_discount')::numeric), 0) from act),
      'manual_discounts', (select coalesce(sum((pr->>'manual_discount')::numeric), 0) from act),
      'pix_discounts', (select coalesce(sum((pr->>'paid_gross')::numeric - (pr->>'paid_net')::numeric), 0) from act),
      'by_method', coalesce((select jsonb_object_agg(m.method, m.total) from (
          select p.method, sum(p.amount) as total from public.rv_payments p
          join act on act.id = p.booking_id where p.voided_at is null group by p.method) m), '{}'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

-- Exportação completa (admin, com valores). O CSV é montado no navegador.
create or replace function public.rv_admin_export(p_slug text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event_id uuid;
begin
  perform public.rv_require_admin();
  v_event_id := public.rv_resolve_event(p_slug);
  perform public.rv_expire_due(null);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', b.id, 'table_id', b.table_id,
      'codigo', b.public_code, 'status', b.status, 'mesa', t.label, 'tipo', tt.name, 'lote', l.name,
      'responsavel', b.customer_name, 'whatsapp', b.customer_phone, 'email', b.customer_email,
      'adultos', b.adults, 'criancas', b.children, 'colo', b.infants,
      'cadeiras_extras', (pr->>'extra_chairs')::int,
      'valor_mesa', (pr->>'table_amount')::numeric, 'valor_extras', (pr->>'extra_chairs_amount')::numeric,
      'desconto_criancas', (pr->>'children_discount')::numeric, 'desconto_manual', (pr->>'manual_discount')::numeric,
      'motivo_desconto', b.manual_discount_reason,
      'total', (pr->>'total')::numeric, 'total_pix', (pr->>'total_pix')::numeric,
      'consumacao', (pr->>'consumption_total')::numeric, 'sinal_minimo', (pr->>'deposit_min')::numeric,
      'recebido', (pr->>'paid_net')::numeric, 'abatido', (pr->>'paid_gross')::numeric,
      'saldo', (pr->>'balance')::numeric, 'saldo_pix', (pr->>'balance_pix')::numeric,
      'prazo_sinal', b.hold_expires_at, 'criada_em', b.created_at, 'origem', b.source,
      'obs_cliente', b.customer_notes, 'obs_interna', b.internal_notes,
      'aceite_marketing', b.marketing_opt_in, 'aceite_termos_em', b.terms_accepted_at,
      'versao_termos', tr.version, 'motivo_cancelamento', b.cancel_reason
    ) order by tt.sort_order, t.sort_order, t.label, b.created_at)
    from public.rv_bookings b
    join public.rv_tables t on t.id = b.table_id
    join public.rv_table_types tt on tt.id = t.table_type_id
    left join public.rv_lots l on l.id = b.lot_id
    left join public.rv_terms tr on tr.id = b.terms_id
    cross join lateral (select public.rv_price_for_booking(b.id) as pr) x
    where b.event_id = v_event_id
  ), '[]'::jsonb);
end;
$$;

-- =========================================================================
-- Cron: expira pré-reservas vencidas e enfileira o aviso "expira em 12h".
-- SQL local puro (sem HTTP); roda a cada 15 min. A mesa já aparece livre no
-- segundo exato do vencimento (rv_table_live_state), o cron só grava o status.
-- =========================================================================
create or replace function public.rv_cron_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_expired int;
  v_warned int := 0;
  r record;
begin
  v_expired := public.rv_expire_due(null);

  for r in
    select b.id from public.rv_bookings b
    join public.rv_events e on e.id = b.event_id
    where b.status = 'pre_reserva'
      and e.expiry_warning_hours > 0
      and b.hold_expires_at > now()
      and b.hold_expires_at <= now() + make_interval(hours => e.expiry_warning_hours)
      and b.created_at < b.hold_expires_at - make_interval(hours => e.expiry_warning_hours)
      and not exists (select 1 from public.rv_payments p where p.booking_id = b.id and p.voided_at is null)
  loop
    if public.rv_enqueue_email(r.id, 'rv_expiry_warning') then
      v_warned := v_warned + 1;
    end if;
  end loop;

  return jsonb_build_object('expired', v_expired, 'warned', v_warned);
end;
$$;

create extension if not exists pg_cron;

do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'rv-reveillon-tick';
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
  perform cron.schedule('rv-reveillon-tick', '*/15 * * * *', 'select public.rv_cron_tick();');
end;
$$;
