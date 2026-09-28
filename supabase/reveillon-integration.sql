-- Sir Fisher Praia — reveillon-integration.sql
-- Liga o módulo de Réveillon à reserva comum, sem mudar o comportamento dos
-- outros dias:
--   1. 31/12/2026 bloqueado na reserva comum (blocked_dates — a lógica que já
--      existe recusa a data em get_available_time_slots e fn_create_reservation).
--   2. Aviso público com link para /reveillon.html quando o cliente escolhe a
--      data (restaurant_settings.special_date_notices, lido por reservations.js).
-- Idempotente.

insert into public.blocked_dates (date, reason, active)
values ('2026-12-31', 'Réveillon — vendido por mesa em /reveillon.html', true)
on conflict (date) do update set active = true, reason = excluded.reason;

insert into public.restaurant_settings (key, value, description, is_public)
values (
  'special_date_notices',
  jsonb_build_array(jsonb_build_object(
    'date', '2026-12-31',
    'message', 'Na noite de 31 de dezembro teremos o Réveillon, com mesas numeradas e vendidas antecipadamente. Escolha sua mesa na página do evento.',
    'cta', 'Ver mesas do Réveillon',
    'url', './reveillon.html'
  )),
  'Datas com reserva própria: em vez dos horários, a página de reserva mostra a mensagem e o link. Lista de {date, message, cta, url}.',
  true
)
on conflict (key) do nothing;
