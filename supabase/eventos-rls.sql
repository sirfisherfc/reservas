-- Segurança do módulo de eventos. A superfície pública é somente a Edge Function.

alter table public.event_pricing_versions enable row level security;
alter table public.event_package_rules enable row level security;
alter table public.event_beverage_rules enable row level security;
alter table public.event_product_rules enable row level security;
alter table public.event_demand_baselines enable row level security;
alter table public.event_requests enable row level security;
alter table public.event_request_audit enable row level security;

revoke all on public.event_pricing_versions, public.event_package_rules,
  public.event_beverage_rules, public.event_product_rules,
  public.event_demand_baselines, public.event_requests,
  public.event_request_audit from anon, authenticated;

-- O service_role da Edge Function ignora RLS. Nenhuma tabela recebe grant para anon.
-- O painel também passa pela Edge Function, que valida auth.users + app_users e grava auditoria.
grant all on public.event_pricing_versions, public.event_package_rules,
  public.event_beverage_rules, public.event_product_rules,
  public.event_demand_baselines, public.event_requests,
  public.event_request_audit to service_role;
grant usage, select on sequence public.event_request_audit_id_seq to service_role;

drop policy if exists event_requests_deny_anon on public.event_requests;
create policy event_requests_deny_anon on public.event_requests for all to anon using (false) with check (false);

drop policy if exists event_request_audit_deny_anon on public.event_request_audit;
create policy event_request_audit_deny_anon on public.event_request_audit for all to anon using (false) with check (false);
