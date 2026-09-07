-- Verificacao cruzada da desduplicacao do Meta
-- -----------------------------------------------------------------------------
-- O painel "Desduplicacao de evento" do Meta precisa de volume e de tempo para
-- concluir, e no dia 07/09/2026 ainda dizia "seus dados ainda estao sendo
-- analisados". Isso nao pode virar motivo para segurar a campanha.
--
-- O token da CAPI e somente escrita (leitura devolve "(#100) Missing
-- Permission"), o que e o correto do ponto de vista de seguranca. Entao a
-- conferencia e feita ao contrario: esta view entrega o numero que o Meta
-- DEVERIA mostrar, e a comparacao com a tela leva dez segundos.
--
-- COMO LER
--   reservas_site == eventos_enviados      -> nossa ponta esta correta
--   Meta mostra ~= reservas_site           -> desduplicacao funcionando
--   Meta mostra ~= reservas_site * 2       -> desduplicacao FALHOU: o Pixel e a
--                                             CAPI estao sendo contados em
--                                             separado. Conferir o event_id.
--
-- Cada reserva do site gera exatamente um Schedule pelo navegador (Pixel) e um
-- pelo servidor (CAPI), com o mesmo event_id. O Meta deve contar UM.
--
-- Rode uma unica vez no SQL Editor. E idempotente.
-- -----------------------------------------------------------------------------

create or replace view public.app_meta_desduplicacao as
with dias as (
  select generate_series(
    (now() at time zone 'America/Fortaleza')::date - interval '29 days',
    (now() at time zone 'America/Fortaleza')::date,
    interval '1 day'
  )::date as dia
),
reservas as (
  select (r.created_at at time zone 'America/Fortaleza')::date as dia,
         count(*) as n
  from public.reservations r
  where r.source = 'public_site'
  group by 1
),
fila as (
  select (e.created_at at time zone 'America/Fortaleza')::date as dia,
         count(*) as enfileirados,
         count(*) filter (where e.status = 'sent')   as enviados,
         count(*) filter (where e.status = 'failed') as falhas,
         count(*) filter (where e.status in ('pending','processing')) as na_fila
  from public.ad_conversion_events e
  where e.provider = 'meta' and e.event_name = 'schedule'
  group by 1
)
select
  d.dia,
  coalesce(r.n, 0)            as reservas_site,
  coalesce(f.enfileirados, 0) as eventos_enfileirados,
  coalesce(f.enviados, 0)     as eventos_enviados,
  coalesce(f.falhas, 0)       as eventos_com_falha,
  coalesce(f.na_fila, 0)      as eventos_pendentes,
  -- O que o Meta deve mostrar em "Programar" se a desduplicacao funcionar.
  case when d.dia >= date '2026-09-07' then coalesce(r.n, 0) end as meta_esperado_com_desduplicacao,
  -- O que apareceria se ela falhasse: Pixel e CAPI contados em separado.
  case when d.dia >= date '2026-09-07' then coalesce(r.n, 0) * 2 end as meta_sintoma_de_falha,
  case
    -- O gatilho trg_enqueue_meta_schedule so passou a existir em 07/09/2026.
    -- Sem este corte, todo dia anterior apareceria como ATENCAO — e um alarme
    -- que grita sem motivo ensina a ignorar o alarme.
    when d.dia < date '2026-09-07' then 'anterior a instrumentacao'
    when coalesce(r.n, 0) = 0 then 'sem reservas no dia'
    when coalesce(f.falhas, 0) > 0 then 'ATENCAO: evento com falha de envio'
    when coalesce(f.na_fila, 0) > 0 then 'aguardando drenagem'
    when coalesce(f.enviados, 0) = coalesce(r.n, 0) then 'ok'
    else 'ATENCAO: reservas sem evento na fila'
  end as situacao
from dias d
left join reservas r on r.dia = d.dia
left join fila f     on f.dia = d.dia
order by d.dia desc;

comment on view public.app_meta_desduplicacao is
  'Numero que o Meta deveria mostrar em Programar/Schedule. Se a tela do Meta '
  'bater com meta_esperado_com_desduplicacao, a desduplicacao funciona; se bater '
  'com meta_sintoma_de_falha (o dobro), o event_id divergiu entre Pixel e CAPI.';

grant select on public.app_meta_desduplicacao to authenticated, service_role;
