-- Contador publico de visitas do site institucional.
-- O valor inicial corresponde ao total de sessoes do GA4 ate 24/09/2026.

create table if not exists public.site_visit_counter (
  counter_key text primary key,
  total bigint not null check (total >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_visit_sessions (
  session_id uuid primary key,
  counted_at timestamptz not null default now()
);

alter table public.site_visit_counter enable row level security;
alter table public.site_visit_sessions enable row level security;

revoke all on table public.site_visit_counter from anon, authenticated;
revoke all on table public.site_visit_sessions from anon, authenticated;

insert into public.site_visit_counter (counter_key, total)
values ('sirfisher.com.br', 2322)
on conflict (counter_key) do update
set total = greatest(public.site_visit_counter.total, excluded.total);

create or replace function public.register_site_visit(p_session_id uuid)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
  v_total bigint;
begin
  insert into public.site_visit_sessions (session_id)
  values (p_session_id)
  on conflict (session_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update public.site_visit_counter
       set total = total + 1,
           updated_at = now()
     where counter_key = 'sirfisher.com.br'
     returning total into v_total;
  else
    select total
      into v_total
      from public.site_visit_counter
     where counter_key = 'sirfisher.com.br';
  end if;

  return v_total;
end;
$$;

revoke all on function public.register_site_visit(uuid) from public;
grant execute on function public.register_site_visit(uuid) to anon, authenticated, service_role;

