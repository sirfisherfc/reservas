-- Sir Fisher Praia — seed.sql
-- Valores iniciais. Tudo aqui é editável depois pelo painel (Configurações / Bloqueios).

insert into public.restaurant_settings (key, value, description, is_public) values
  ('capacity_total', '96', 'Capacidade física total da casa (pessoas). Informativo/marketing.', true),
  ('reservable_percentage', '30', 'Percentual da capacidade oferecido para reserva online (conceitual/marketing).', true),
  ('min_party_size', '2', 'Quantidade mínima de pessoas por reserva.', true),
  ('max_party_size', '10', 'Quantidade máxima de pessoas por reserva feita pelo site. Acima disso, WhatsApp.', true),
  ('same_day_cutoff_time', '"12:00"', 'Horário de corte para reservas no mesmo dia.', true),
  ('advance_booking_days', '60', 'Quantos dias à frente o cliente pode reservar.', true),
  ('tolerance_minutes', '15', 'Tolerância de chegada, em minutos, antes da reserva poder ser liberada.', true),
  ('hold_release_minutes', '60', 'Minutos sem check-in após os quais a mesa pode ser liberada.', true),
  ('whatsapp_number', '""', 'Número de WhatsApp do restaurante (só dígitos, com DDI+DDD). Preencher no painel.', true),
  ('whatsapp_message_template', '"Olá! Gostaria de falar sobre uma reserva no Sir Fisher Praia."', 'Mensagem padrão usada nos links de WhatsApp.', true)
on conflict (key) do nothing;

-- Grade de horários de exemplo (todos os dias da semana): almoço 12:00–15:00 e
-- jantar 18:00–22:30, de 30 em 30 minutos. Limite operacional inicial: 20
-- pessoas e/ou 5 reservas por horário, o que for atingido primeiro. Ajuste
-- livremente em Configurações > Grade de horários (inclusive para fechar dias
-- específicos da semana, bastando desabilitar todos os horários daquele dia).
with slots as (
  select generate_series('2000-01-01 12:00'::timestamp, '2000-01-01 15:00'::timestamp, interval '30 minutes')::time as time_slot
  union all
  select generate_series('2000-01-01 18:00'::timestamp, '2000-01-01 22:30'::timestamp, interval '30 minutes')::time
)
insert into public.availability_rules (weekday, time_slot, enabled, max_people, max_reservations)
select w.weekday, s.time_slot, true, 20, 5
from generate_series(0, 6) as w(weekday)
cross join slots as s
on conflict (weekday, time_slot) do nothing;
