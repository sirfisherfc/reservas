-- Upgrade incremental: ChatGPT Ads conversion measurement
-- Execute once in the Supabase SQL Editor on the existing project.

alter table public.reservations
  add column if not exists openai_oppref text check (openai_oppref is null or length(openai_oppref) <= 1024),
  add column if not exists utm_source text check (utm_source is null or length(utm_source) <= 255),
  add column if not exists utm_medium text check (utm_medium is null or length(utm_medium) <= 255),
  add column if not exists utm_campaign text check (utm_campaign is null or length(utm_campaign) <= 255),
  add column if not exists utm_content text check (utm_content is null or length(utm_content) <= 255),
  add column if not exists utm_term text check (utm_term is null or length(utm_term) <= 255),
  add column if not exists chatgpt_campaign_id text check (chatgpt_campaign_id is null or length(chatgpt_campaign_id) <= 255),
  add column if not exists chatgpt_ad_group_id text check (chatgpt_ad_group_id is null or length(chatgpt_ad_group_id) <= 255),
  add column if not exists chatgpt_ad_id text check (chatgpt_ad_id is null or length(chatgpt_ad_id) <= 255),
  add column if not exists attribution_landing_url text check (attribution_landing_url is null or length(attribution_landing_url) <= 2000),
  add column if not exists attribution_captured_at timestamptz;

create index if not exists idx_reservations_openai_oppref
  on public.reservations(openai_oppref) where openai_oppref is not null;

create table if not exists public.ad_conversion_events (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  provider text not null check (provider in ('openai_ads')),
  event_name text not null check (event_name in ('visit_realized')),
  event_id text not null unique,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'failed')),
  attempts int not null default 0 check (attempts >= 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique (reservation_id, provider, event_name)
);

create index if not exists idx_ad_conversion_events_pending
  on public.ad_conversion_events(status, created_at)
  where status in ('pending', 'failed');

alter table public.ad_conversion_events enable row level security;

-- A versão de fn_create_reservation com p_attribution vive em functions.sql
-- (fonte única). Aqui existia um wrapper de 12 argumentos SEM valores default:
-- como o site público não envia p_internal_notes, o PostgREST não conseguia
-- resolver a chamada e devolvia 404 (PGRST202) em toda reserva. Não recriar
-- este wrapper: rode functions.sql para atualizar a função.

create or replace function public.fn_enqueue_openai_ads_visit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'compareceu'
    and old.status is distinct from new.status
    and new.openai_oppref is not null then
    insert into public.ad_conversion_events (reservation_id, provider, event_name, event_id)
    values (new.id, 'openai_ads', 'visit_realized', 'sf-vr-' || new.id::text)
    on conflict (reservation_id, provider, event_name) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_openai_ads_visit on public.reservations;
create trigger trg_enqueue_openai_ads_visit
  after update of status on public.reservations
  for each row execute function public.fn_enqueue_openai_ads_visit();

create or replace function public.fn_claim_pending_openai_ads_conversions(p_limit int default 25)
returns table (queue_id uuid, event_id text, oppref text, occurred_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select e.id from public.ad_conversion_events e
    where e.provider = 'openai_ads' and e.status in ('pending', 'failed') and e.attempts < 10
    order by e.created_at
    limit greatest(1, least(coalesce(p_limit, 25), 1000))
    for update skip locked
  )
  update public.ad_conversion_events e
  set status = 'processing', attempts = e.attempts + 1, last_attempt_at = now(), last_error = null
  from public.reservations r
  where e.id in (select id from candidates) and r.id = e.reservation_id
  returning e.id, e.event_id, r.openai_oppref, e.created_at;
end;
$$;

create or replace function public.fn_finalize_openai_ads_conversion(
  p_id uuid, p_status text, p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_status not in ('sent', 'failed') then
    raise exception 'INVALID_INPUT: Status de evento invalido.';
  end if;
  update public.ad_conversion_events
  set status = p_status,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      last_error = case when p_status = 'failed' then left(coalesce(p_error, 'erro desconhecido'), 2000) else null end
  where id = p_id and status = 'processing';
end;
$$;

revoke execute on function public.fn_create_reservation(text, text, text, date, time, int, jsonb, text, boolean, boolean, text, text) from public;
revoke execute on function public.fn_enqueue_openai_ads_visit() from public;
revoke execute on function public.fn_claim_pending_openai_ads_conversions(int) from public;
revoke execute on function public.fn_finalize_openai_ads_conversion(uuid, text, text) from public;
grant execute on function public.fn_create_reservation(text, text, text, date, time, int, jsonb, text, boolean, boolean, text, text) to anon, authenticated;

-- A Edge Function send-openai-ads-conversions roda como service_role: sem estes
-- grants ela recebe 401 na checagem de staff (leitura de app_users) e não
-- consegue processar a fila de conversoes.
grant execute on function public.fn_claim_pending_openai_ads_conversions(int) to service_role;
grant execute on function public.fn_finalize_openai_ads_conversion(uuid, text, text) to service_role;
grant select on public.app_users to service_role;

notify pgrst, 'reload schema';
