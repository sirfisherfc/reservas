-- Meta Pixel + Conversions API com deduplicacao
-- -----------------------------------------------------------------------------
-- Terceira trilha da fila ad_conversion_events, ao lado de openai_ads e ga4.
-- Os caminhos existentes seguem intocados.
--
-- Diferenca importante para os outros dois: o evento do Meta e o `Schedule`,
-- disparado quando a reserva e CRIADA, nao quando a pessoa comparece. Por isso
-- o gatilho aqui e AFTER INSERT, e nao AFTER UPDATE OF status.
--
-- Deduplicacao: o Pixel no navegador e a CAPI no servidor mandam o mesmo
-- event_id ('sf-sched-' || id da reserva). O Meta descarta a copia.
--
-- Rode uma unica vez no SQL Editor. E idempotente.
-- -----------------------------------------------------------------------------

-- 1. Cookies de atribuicao do Meta -------------------------------------------
-- _fbp identifica o navegador; _fbc guarda o clique no anuncio (vem do fbclid).
-- Sao os parametros que mais elevam a taxa de correspondencia na CAPI depois
-- do e-mail, e sem eles o Meta rejeita o evento por "dados de cliente
-- insuficientes" (erro 2804050).

alter table public.reservations
  add column if not exists meta_fbp text,
  add column if not exists meta_fbc text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'reservations_meta_fbp_check') then
    alter table public.reservations add constraint reservations_meta_fbp_check
      check (meta_fbp is null or length(meta_fbp) <= 255);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reservations_meta_fbc_check') then
    alter table public.reservations add constraint reservations_meta_fbc_check
      check (meta_fbc is null or length(meta_fbc) <= 512);
  end if;
end;
$$;

-- 2. A fila aceita o provider 'meta' e o evento 'schedule' --------------------

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

-- 3. Enfileira o Schedule na criacao da reserva ------------------------------
-- Só para reservas do site publico: as criadas no painel pela equipe nao vieram
-- de midia e nao devem contaminar a otimizacao da campanha.

create or replace function public.fn_enqueue_meta_schedule()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.source = 'public_site' then
    insert into public.ad_conversion_events (reservation_id, provider, event_name, event_id)
    values (new.id, 'meta', 'schedule', 'sf-sched-' || new.id::text)
    on conflict (reservation_id, provider, event_name) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_meta_schedule on public.reservations;
create trigger trg_enqueue_meta_schedule
  after insert on public.reservations
  for each row execute function public.fn_enqueue_meta_schedule();

-- 4. Reivindica a fila do Meta -----------------------------------------------
-- Devolve o que a CAPI precisa. O e-mail e o telefone saem em texto puro daqui
-- e sao transformados em hash SHA-256 dentro da Edge Function, antes de sair
-- do nosso servidor — o Meta nunca recebe o dado bruto.

create or replace function public.fn_claim_pending_meta_conversions(p_limit int default 25)
returns table (
  queue_id uuid,
  event_id text,
  email text,
  phone text,
  fbp text,
  fbc text,
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
    select e.id from public.ad_conversion_events e
    where e.provider = 'meta' and e.status in ('pending', 'failed') and e.attempts < 10
    order by e.created_at
    limit greatest(1, least(coalesce(p_limit, 25), 1000))
    for update skip locked
  )
  update public.ad_conversion_events e
  set status = 'processing', attempts = e.attempts + 1, last_attempt_at = now(), last_error = null
  from public.reservations r
  where e.id in (select id from candidates) and r.id = e.reservation_id
  returning e.id, e.event_id, r.customer_email_snapshot::text, r.customer_phone_snapshot,
            r.meta_fbp, r.meta_fbc, r.party_size, r.attribution_landing_url, e.created_at;
end;
$$;

revoke all on function public.fn_claim_pending_meta_conversions(int) from public, anon, authenticated;
