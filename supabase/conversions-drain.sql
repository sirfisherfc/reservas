-- Drenagem automatica da fila de conversoes
-- -----------------------------------------------------------------------------
-- Sem isto, a fila ad_conversion_events so era processada quando alguem marcava
-- uma reserva como "compareceu" no painel. Isso servia para o evento de
-- comparecimento, mas nao para o `Schedule` do Meta, que nasce no momento em que
-- a reserva e criada: um evento poderia ficar pendente por dias e chegar tarde
-- demais para otimizar a campanha (a CAPI descarta o que passa de 7 dias).
--
-- DESENHO ATUAL (revisto em 07/09/2026): gatilho + rede de seguranca horaria.
--
--   1. Um gatilho em ad_conversion_events dispara a drenagem no instante em que
--      o evento entra na fila. Latencia de segundos, nao de minutos.
--   2. O pg_cron roda de hora em hora apenas como rede de seguranca, para
--      recolher o que falhou e precisa de nova tentativa.
--
-- POR QUE MUDOU
--   A versao anterior rodava o cron a cada 5 minutos, 288 vezes por dia, quase
--   sempre com a fila vazia (a casa faz ~1,4 reservas/dia pelo site). Cada
--   execucao vazia custava 3 consultas ao banco e uma linha de log — ruido que
--   atrapalha justamente quando se precisa achar um erro de verdade. O novo
--   desenho faz ~25 execucoes/dia e ainda assim entrega mais rapido.
--
--   Uma correcao ao comentario anterior: eu havia justificado o cron alegando
--   que um gatilho teria "corrida entre o commit e a chamada HTTP". Isso esta
--   errado para o pg_net — ele ENFILEIRA a requisicao dentro da transacao e um
--   worker de fundo so despacha o que ja foi commitado. A corrida nao existe.
--
-- MARGEM DE SEGURANCA
--   Meta desduplica eventos recebidos em ate 48h e descarta apos 7 dias; o GA4
--   Measurement Protocol descarta acima de 72h. Uma espera de ate 1 hora, no
--   pior caso de falha, fica muito dentro de todos os prazos.
--
-- Rode uma unica vez no SQL Editor. E idempotente.
-- -----------------------------------------------------------------------------

create schema if not exists private;

-- O segredo fica em tabela, nao no corpo da funcao: pg_get_functiondef e
-- legivel por qualquer papel com acesso ao catalogo, e nao ha motivo para
-- expor o token ali.
create table if not exists private.integration_secrets (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table private.integration_secrets enable row level security;
revoke all on private.integration_secrets from public, anon, authenticated;

create or replace function private.fn_drain_conversion_queue()
returns void
language plpgsql
security definer
set search_path = private, public, extensions, pg_temp
as $$
declare
  v_secret text;
begin
  select value into v_secret
  from private.integration_secrets
  where key = 'conversions_trigger_secret';

  if v_secret is null then
    return;  -- sem segredo configurado, nao ha o que fazer
  end if;

  perform net.http_post(
    url := 'https://lucpxoynpvogkvzepagi.supabase.co/functions/v1/send-openai-ads-conversions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-openai-ads-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
end;
$$;

revoke all on function private.fn_drain_conversion_queue() from public, anon, authenticated;

-- Gatilho: drena assim que o evento entra na fila -----------------------------
-- Statement-level de proposito. Se um dia uma transacao inserir varias linhas
-- de uma vez, queremos UMA chamada HTTP, nao uma por linha.

create or replace function private.fn_nudge_conversion_drain()
returns trigger
language plpgsql
security definer
set search_path = private, public, extensions, pg_temp
as $$
begin
  -- A medicao nunca pode derrubar a reserva de um cliente: por isso o erro nao
  -- se propaga. Mas engolir em silencio esconderia um gatilho quebrado para
  -- sempre — a fila continuaria drenando de hora em hora e ninguem notaria.
  -- Por isso: RAISE WARNING, que vai para o log do Postgres sem abortar nada.
  begin
    perform private.fn_drain_conversion_queue();
  exception when others then
    raise warning 'nudge da fila de conversoes falhou (%): %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function private.fn_nudge_conversion_drain() from public, anon, authenticated;

drop trigger if exists trg_nudge_conversion_drain on public.ad_conversion_events;
create trigger trg_nudge_conversion_drain
  after insert on public.ad_conversion_events
  for each statement execute function private.fn_nudge_conversion_drain();

-- Rede de seguranca: de hora em hora, so para o que falhou ---------------------
-- Nao ha risco de envio duplicado se o cron e o gatilho coincidirem: as funcoes
-- fn_claim_pending_* usam FOR UPDATE SKIP LOCKED.

select cron.unschedule('drenar-fila-conversoes')
where exists (select 1 from cron.job where jobname = 'drenar-fila-conversoes');

select cron.schedule(
  'drenar-fila-conversoes',
  '0 * * * *',
  $cron$ select private.fn_drain_conversion_queue(); $cron$
);
