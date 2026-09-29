-- Sir Fisher Praia — reveillon-rls.sql
-- RLS, policies e grants do módulo de Réveillon.
--
-- Modelo de acesso (garantido no banco, não só na tela):
--   anon      — nenhuma tabela com dado pessoal ou valor. Lê SOMENTE
--               rv_table_state (id da mesa + estado) para o Realtime, e usa as
--               funções rv_public_event / rv_simulate / rv_create_prebooking.
--   operador  — lê config sem preço (tipos, mesas, termos) e o que as funções
--               rv_staff_board / rv_door_list devolvem, que não têm nenhuma
--               coluna financeira para quem não é admin. Nenhum grant em
--               rv_bookings, rv_payments, rv_booking_history, rv_lot_prices,
--               rv_lots nem rv_events (que tem o desconto de criança).
--   admin     — SELECT em tudo; escreve config direto; reservas e pagamentos
--               só pelas RPCs rv_admin_* (para sempre recalcular e auditar).
-- Toda policy declara "to <role>" (ver comentário no topo de rls.sql).

alter table public.rv_events enable row level security;
alter table public.rv_terms enable row level security;
alter table public.rv_table_types enable row level security;
alter table public.rv_tables enable row level security;
alter table public.rv_lots enable row level security;
alter table public.rv_lot_prices enable row level security;
alter table public.rv_bookings enable row level security;
alter table public.rv_payments enable row level security;
alter table public.rv_booking_history enable row level security;
alter table public.rv_table_state enable row level security;

-- Limpa policies antigas para o arquivo poder ser reaplicado.
do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where schemaname = 'public' and tablename like 'rv\_%'
  loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;

-- ---- config com valores: admin apenas ----
create policy rv_events_admin on public.rv_events
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy rv_lots_admin on public.rv_lots
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());
create policy rv_lot_prices_admin on public.rv_lot_prices
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ---- config sem valores: staff lê, admin escreve ----
create policy rv_types_select_staff on public.rv_table_types
  for select to authenticated using (public.fn_is_active_staff());
create policy rv_types_write_admin on public.rv_table_types
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy rv_tables_select_staff on public.rv_tables
  for select to authenticated using (public.fn_is_active_staff());
create policy rv_tables_write_admin on public.rv_tables
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

create policy rv_terms_select_staff on public.rv_terms
  for select to authenticated using (public.fn_is_active_staff());

-- ---- reservas / pagamentos / histórico: leitura só admin; escrita só RPC ----
create policy rv_bookings_select_admin on public.rv_bookings
  for select to authenticated using (public.fn_is_admin());
create policy rv_payments_select_admin on public.rv_payments
  for select to authenticated using (public.fn_is_admin());
create policy rv_history_select_admin on public.rv_booking_history
  for select to authenticated using (public.fn_is_admin());

-- ---- estado público das mesas (sem dado pessoal, sem valor) ----
create policy rv_table_state_select_all on public.rv_table_state
  for select to anon, authenticated using (true);

-- =========================================================================
-- GRANTS de tabela
-- =========================================================================
revoke all on public.rv_events, public.rv_terms, public.rv_table_types, public.rv_tables,
  public.rv_lots, public.rv_lot_prices, public.rv_bookings, public.rv_payments,
  public.rv_booking_history, public.rv_table_state
  from anon, authenticated;

grant select on public.rv_table_state to anon, authenticated;

grant select, update on public.rv_events to authenticated;
grant select on public.rv_terms to authenticated;
grant select, insert, update, delete on public.rv_table_types to authenticated;
grant select, insert, update, delete on public.rv_tables to authenticated;
grant select, insert, update, delete on public.rv_lots to authenticated;
grant select, insert, update, delete on public.rv_lot_prices to authenticated;
grant select on public.rv_bookings to authenticated;
grant select on public.rv_payments to authenticated;
grant select on public.rv_booking_history to authenticated;

-- =========================================================================
-- GRANTS de função — revoga o EXECUTE padrão de PUBLIC e libera só o necessário.
-- =========================================================================
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'rv\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end;
$$;

-- público
grant execute on function public.rv_public_event(text) to anon, authenticated;
grant execute on function public.rv_simulate(uuid, int, int, int) to anon, authenticated;
grant execute on function public.rv_create_prebooking(uuid, int, int, int, text, text, text, uuid, boolean, boolean, text, text, jsonb, text, boolean) to anon, authenticated;

-- staff (a própria função confere o perfil e o que devolve)
grant execute on function public.rv_staff_board(text) to authenticated;
grant execute on function public.rv_door_list(text) to authenticated;

-- admin (todas chamam rv_require_admin())
grant execute on function public.rv_booking_detail(uuid) to authenticated;
grant execute on function public.rv_admin_register_payment(uuid, numeric, text, timestamptz, text, text) to authenticated;
grant execute on function public.rv_admin_void_payment(uuid, text) to authenticated;
grant execute on function public.rv_admin_apply_discount(uuid, text, numeric, text) to authenticated;
grant execute on function public.rv_admin_mark_paid(uuid, text) to authenticated;
grant execute on function public.rv_admin_extend_hold(uuid, int) to authenticated;
grant execute on function public.rv_admin_set_hold(uuid, timestamptz) to authenticated;
grant execute on function public.rv_admin_cancel(uuid, text) to authenticated;
grant execute on function public.rv_admin_move(uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.rv_admin_update_booking(uuid, text, text, text, int, int, int, text, text, boolean) to authenticated;
grant execute on function public.rv_admin_set_table_block(uuid, boolean, text) to authenticated;
grant execute on function public.rv_admin_save_terms(uuid, text) to authenticated;
grant execute on function public.rv_admin_summary(text) to authenticated;
grant execute on function public.rv_admin_export(text) to authenticated;

-- Helpers internos (rv_calc_price, rv_price_for_*, rv_paid_*, rv_log,
-- rv_recalc_booking, rv_expire_due, rv_enqueue_email, rv_cron_tick,
-- rv_booking_payload, rv_table_live_state, triggers...) ficam SEM grant:
-- só são chamados de dentro das funções acima (que rodam como owner).

-- =========================================================================
-- Realtime: o site e o painel escutam mudanças em rv_table_state.
-- =========================================================================
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rv_table_state') then
    execute 'alter publication supabase_realtime add table public.rv_table_state';
  end if;
end;
$$;
