-- Mensuracao GA4: atribuicao de sessao na reserva + comparecimento server-side
-- -----------------------------------------------------------------------------
-- Complementa openai-ads.sql. O caminho do ChatGPT Ads segue intacto: aqui
-- criamos uma trilha paralela com provider 'ga4', para nao arriscar a fila que
-- ja esta em producao.
--
-- Por que isto existe: a Measurement Protocol do GA4 exige um client_id para
-- amarrar o evento a alguem. Sem gravar o client_id na reserva, nao ha como
-- enviar o comparecimento — que e a unica conversao que de fato fatura.
--
-- Rode uma unica vez no SQL Editor. E idempotente.
-- -----------------------------------------------------------------------------

-- 1. Identificadores de sessao e origem na reserva -----------------------------
-- Ate aqui a reserva so guardava origem quando havia UTM na URL. Para trafego
-- direto, organico e de story do Instagram, nada era gravado — nem a pagina de
-- entrada. Estas colunas cobrem o caso e permitem cruzar a linha do banco com
-- a sessao do GA4.

alter table public.reservations
  add column if not exists ga_client_id text,
  add column if not exists ga_session_id text,
  add column if not exists attribution_referrer text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_ga_client_id_check'
  ) then
    alter table public.reservations
      add constraint reservations_ga_client_id_check
      check (ga_client_id is null or length(ga_client_id) <= 64);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_ga_session_id_check'
  ) then
    alter table public.reservations
      add constraint reservations_ga_session_id_check
      check (ga_session_id is null or length(ga_session_id) <= 64);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'reservations_attribution_referrer_check'
  ) then
    alter table public.reservations
      add constraint reservations_attribution_referrer_check
      check (attribution_referrer is null or length(attribution_referrer) <= 2000);
  end if;
end;
$$;

create index if not exists idx_reservations_ga_client_id
  on public.reservations(ga_client_id) where ga_client_id is not null;

-- 2. A fila passa a aceitar o provider 'ga4' -----------------------------------

alter table public.ad_conversion_events
  drop constraint if exists ad_conversion_events_provider_check;

alter table public.ad_conversion_events
  add constraint ad_conversion_events_provider_check
  check (provider in ('openai_ads', 'ga4'));

-- 3. Enfileira o comparecimento para o GA4 ------------------------------------
-- Espelha fn_enqueue_openai_ads_visit, trocando a condicao de oppref por
-- client_id. Uma reserva com os dois identificadores gera duas linhas, uma por
-- provider, e a constraint unique (reservation_id, provider, event_name)
-- garante que cada uma seja enviada uma vez so.

create or replace function public.fn_enqueue_ga4_visit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'compareceu'
    and old.status is distinct from new.status
    and new.ga_client_id is not null then
    insert into public.ad_conversion_events (reservation_id, provider, event_name, event_id)
    values (new.id, 'ga4', 'visit_realized', 'sf-ga4-vr-' || new.id::text)
    on conflict (reservation_id, provider, event_name) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_ga4_visit on public.reservations;
create trigger trg_enqueue_ga4_visit
  after update of status on public.reservations
  for each row execute function public.fn_enqueue_ga4_visit();

-- 4. Reivindica a fila do GA4 --------------------------------------------------
-- Devolve o que a Measurement Protocol precisa: client_id, session_id e o
-- tamanho do grupo, para o evento chegar com valor em BRL.

create or replace function public.fn_claim_pending_ga4_conversions(p_limit int default 25)
returns table (
  queue_id uuid,
  event_id text,
  client_id text,
  session_id text,
  party_size int,
  occurred_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  with candidates as (
    select e.id from public.ad_conversion_events e
    where e.provider = 'ga4' and e.status in ('pending', 'failed') and e.attempts < 10
    order by e.created_at
    limit greatest(1, least(coalesce(p_limit, 25), 1000))
    for update skip locked
  )
  update public.ad_conversion_events e
  set status = 'processing', attempts = e.attempts + 1, last_attempt_at = now(), last_error = null
  from public.reservations r
  where e.id in (select id from candidates) and r.id = e.reservation_id
  returning e.id, e.event_id, r.ga_client_id, r.ga_session_id, r.party_size, e.created_at;
end;
$$;

revoke all on function public.fn_claim_pending_ga4_conversions(int) from public, anon, authenticated;

-- fn_finalize_openai_ads_conversion opera sobre ad_conversion_events por id e
-- ja serve os dois providers. Nao foi duplicada de proposito.
