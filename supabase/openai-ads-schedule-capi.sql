-- OpenAI Ads: appointment_scheduled pelo servidor, deduplicado com o Pixel
-- -----------------------------------------------------------------------------
-- O Pixel continua enviando a reserva no navegador. Esta trilha envia a mesma
-- conversao pela Conversions API, com o mesmo event_id, para dar resiliencia e
-- melhorar a correspondencia com identificadores normalizados em SHA-256.
-- Rode uma vez no SQL Editor. O script e idempotente.
-- -----------------------------------------------------------------------------

begin;

alter table public.ad_conversion_events
  drop constraint if exists ad_conversion_events_provider_check;
alter table public.ad_conversion_events
  add constraint ad_conversion_events_provider_check
  check (provider in ('openai_ads', 'ga4', 'meta'));

alter table public.ad_conversion_events
  drop constraint if exists ad_conversion_events_event_name_check;
alter table public.ad_conversion_events
  add constraint ad_conversion_events_event_name_check
  check (event_name in ('visit_realized', 'schedule'));

create or replace function public.fn_enqueue_openai_ads_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source = 'public_site' and new.accepted_policy then
    insert into public.ad_conversion_events (reservation_id, provider, event_name, event_id)
    values (new.id, 'openai_ads', 'schedule', 'sf-oai-sched-' || new.id::text)
    on conflict (reservation_id, provider, event_name) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_openai_ads_schedule on public.reservations;
create trigger trg_enqueue_openai_ads_schedule
  after insert on public.reservations
  for each row execute function public.fn_enqueue_openai_ads_schedule();

drop function if exists public.fn_claim_pending_openai_ads_conversions(int);
create function public.fn_claim_pending_openai_ads_conversions(p_limit int default 25)
returns table (
  queue_id uuid,
  event_id text,
  event_name text,
  oppref text,
  email text,
  phone text,
  external_id text,
  party_size int,
  landing_url text,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select e.id
    from public.ad_conversion_events e
    where e.provider = 'openai_ads'
      and e.status in ('pending', 'failed')
      and e.attempts < 10
    order by e.created_at
    limit greatest(1, least(coalesce(p_limit, 25), 1000))
    for update skip locked
  )
  update public.ad_conversion_events e
  set status = 'processing',
      attempts = e.attempts + 1,
      last_attempt_at = now(),
      last_error = null
  from public.reservations r
  where e.id in (select id from candidates)
    and r.id = e.reservation_id
  returning e.id,
            e.event_id,
            e.event_name,
            r.openai_oppref,
            r.customer_email_snapshot::text,
            r.customer_phone_snapshot,
            r.customer_id::text,
            r.party_size,
            r.attribution_landing_url,
            e.created_at;
end;
$$;

revoke all on function public.fn_enqueue_openai_ads_schedule() from public, anon, authenticated;
revoke all on function public.fn_claim_pending_openai_ads_conversions(int) from public, anon, authenticated;
grant execute on function public.fn_claim_pending_openai_ads_conversions(int) to service_role;

-- Envia apenas reservas ainda aceitas pela janela de sete dias da API.
insert into public.ad_conversion_events (reservation_id, provider, event_name, event_id, created_at)
select r.id, 'openai_ads', 'schedule', 'sf-oai-sched-' || r.id::text, r.created_at
from public.reservations r
where r.source = 'public_site'
  and r.accepted_policy
  and r.created_at >= now() - interval '6 days 23 hours'
on conflict (reservation_id, provider, event_name) do nothing;

notify pgrst, 'reload schema';

commit;
