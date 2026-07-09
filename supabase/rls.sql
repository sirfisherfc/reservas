-- Sir Fisher Praia — rls.sql
-- RLS habilitado em todas as tabelas + policies por perfil + grants.
-- anon nunca recebe grant de escrita em tabela nenhuma: toda escrita pública passa
-- pelas funções SECURITY DEFINER (fn_create_reservation, fn_cancel_reservation_public).
-- anon só tem SELECT liberado em restaurant_settings, filtrado por RLS a is_public = true.
--
-- IMPORTANTE: toda policy declara "to <role>" explicitamente. Sem isso, o Postgres
-- avalia TODAS as policies permissivas da tabela para QUALQUER papel que fizer a
-- consulta — inclusive as que chamam fn_is_admin()/fn_is_active_staff() — e como
-- essas funções não têm EXECUTE liberado para anon, a consulta falha com
-- "permission denied for function fn_is_admin" mesmo quando outra policy deveria
-- liberar o acesso. Faltar o "to" foi um bug real encontrado em teste manual.

alter table public.app_users enable row level security;
alter table public.customers enable row level security;
alter table public.reservations enable row level security;
alter table public.reservation_status_history enable row level security;
alter table public.restaurant_settings enable row level security;
alter table public.availability_rules enable row level security;
alter table public.blocked_dates enable row level security;
alter table public.blocked_time_slots enable row level security;
alter table public.notification_queue enable row level security;

-- =========================================================================
-- app_users
-- =========================================================================
create policy app_users_select_self_or_admin on public.app_users
  for select to authenticated
  using ((select auth.uid()) = auth_user_id or public.fn_is_admin());

create policy app_users_write_admin on public.app_users
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- =========================================================================
-- customers — leitura para staff; escrita só via fn_create_reservation (owner)
-- =========================================================================
create policy customers_select_staff on public.customers
  for select to authenticated
  using (public.fn_is_active_staff());

-- =========================================================================
-- reservations — sem policy de INSERT/DELETE para ninguém (só via função /
-- nunca deletável). Operador só escreve via RPCs (fn_update_reservation_status,
-- fn_update_internal_notes), que rodam como owner e ignoram RLS.
-- =========================================================================
create policy reservations_select_staff on public.reservations
  for select to authenticated
  using (public.fn_is_active_staff());

create policy reservations_update_admin on public.reservations
  for update to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- =========================================================================
-- reservation_status_history — somente leitura para staff; insert só via trigger
-- =========================================================================
create policy status_history_select_staff on public.reservation_status_history
  for select to authenticated
  using (public.fn_is_active_staff());

-- =========================================================================
-- restaurant_settings
-- =========================================================================
create policy settings_select_public on public.restaurant_settings
  for select to anon, authenticated
  using (is_public = true);

create policy settings_select_staff on public.restaurant_settings
  for select to authenticated
  using (public.fn_is_active_staff());

create policy settings_write_admin on public.restaurant_settings
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- =========================================================================
-- availability_rules
-- =========================================================================
create policy availability_rules_select_staff on public.availability_rules
  for select to authenticated
  using (public.fn_is_active_staff());

create policy availability_rules_write_admin on public.availability_rules
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- =========================================================================
-- blocked_dates
-- =========================================================================
create policy blocked_dates_select_staff on public.blocked_dates
  for select to authenticated
  using (public.fn_is_active_staff());

create policy blocked_dates_write_admin on public.blocked_dates
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- =========================================================================
-- blocked_time_slots
-- =========================================================================
create policy blocked_time_slots_select_staff on public.blocked_time_slots
  for select to authenticated
  using (public.fn_is_active_staff());

create policy blocked_time_slots_write_admin on public.blocked_time_slots
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- =========================================================================
-- notification_queue — admin apenas (sem UI na fase 1, preparado p/ fase 2)
-- =========================================================================
create policy notification_queue_admin on public.notification_queue
  for all to authenticated
  using (public.fn_is_admin()) with check (public.fn_is_admin());

-- =========================================================================
-- GRANTS de tabela (base necessária para RLS filtrar; anon só recebe o mínimo)
-- =========================================================================
grant usage on schema public to anon, authenticated;

grant select on public.restaurant_settings to anon;

grant select, insert, update, delete on public.app_users to authenticated;
grant select on public.customers to authenticated;
grant select, update on public.reservations to authenticated;
grant select on public.reservation_status_history to authenticated;
grant select, insert, update, delete on public.restaurant_settings to authenticated;
grant select, insert, update, delete on public.availability_rules to authenticated;
grant select, insert, update, delete on public.blocked_dates to authenticated;
grant select, insert, update, delete on public.blocked_time_slots to authenticated;
grant select, insert, update, delete on public.notification_queue to authenticated;

-- =========================================================================
-- GRANTS de função — Postgres concede EXECUTE a PUBLIC por padrão em toda
-- função nova; revogamos explicitamente antes de conceder só o necessário.
-- =========================================================================
revoke execute on function public.fn_set_updated_at() from public;
revoke execute on function public.fn_set_updated_by() from public;
revoke execute on function public.fn_set_created_by() from public;
revoke execute on function public.fn_log_reservation_status_change() from public;
revoke execute on function public.fn_claim_app_user() from public;
revoke execute on function public.get_available_time_slots(date, int) from public;
revoke execute on function public.fn_create_reservation(text, text, text, date, time, int, text, boolean, boolean, text, text) from public;
revoke execute on function public.fn_cancel_reservation_public(text) from public;
revoke execute on function public.fn_update_reservation_status(uuid, text, text) from public;
revoke execute on function public.fn_update_internal_notes(uuid, text) from public;
revoke execute on function public.fn_is_admin() from public;
revoke execute on function public.fn_is_active_staff() from public;
revoke execute on function public.fn_current_app_user_id() from public;

-- fn_set_updated_at / fn_set_updated_by / fn_set_created_by / fn_log_reservation_status_change
-- são funções de trigger: ninguém precisa (nem consegue) chamá-las diretamente via RPC.

grant execute on function public.get_available_time_slots(date, int) to anon, authenticated;
grant execute on function public.fn_create_reservation(text, text, text, date, time, int, text, boolean, boolean, text, text) to anon, authenticated;
grant execute on function public.fn_cancel_reservation_public(text) to anon, authenticated;

grant execute on function public.fn_update_reservation_status(uuid, text, text) to authenticated;
grant execute on function public.fn_update_internal_notes(uuid, text) to authenticated;
grant execute on function public.fn_claim_app_user() to authenticated;
grant execute on function public.fn_is_admin() to authenticated;
grant execute on function public.fn_is_active_staff() to authenticated;
grant execute on function public.fn_current_app_user_id() to authenticated;
