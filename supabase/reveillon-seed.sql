-- Sir Fisher Praia — reveillon-seed.sql
-- Dados iniciais do Réveillon 2027. Tudo editável depois em admin/reveillon.html.
-- Idempotente: não sobrescreve o que já existir (on conflict do nothing).
--
-- Textos aceitam marcadores que o site troca pelos valores do banco:
--   {pix_discount_pct} {deposit_pct} {hold_hours} {balance_due_date}
--   {child_discount} {child_max_age}
-- Modelos de WhatsApp aceitam:
--   {nome} {nome_completo} {codigo} {mesa} {tipo} {pessoas} {evento} {total} {total_pix}
--   {sinal} {sinal_pix} {saldo} {saldo_pix} {consumacao} {prazo}
--   {data_saldo} {pix_chave} {endereco}

insert into public.rv_events (
  slug, name, starts_at, ends_at, timezone, venue_name, address, menu_url,
  included_items, texts, whatsapp_templates, map,
  pix_key, pix_key_type, pix_holder, whatsapp_number,
  deposit_pct, pix_discount_pct, hold_hours, expiry_warning_hours, balance_due_date,
  child_discount, child_max_age, max_active_holds_per_contact, seat_limit,
  sales_open, emails_enabled, tracking
) values (
  'reveillon-2027',
  'Réveillon 2027',
  '2026-12-31 20:00:00-03',
  '2027-01-01 02:00:00-03',
  'America/Fortaleza',
  'Sir Fisher Praia',
  'Av. Beira Mar, 3421 — Meireles, Fortaleza/CE',
  'https://www.sirfisher.com.br',
  '["1 Chandon por mesa", "Welcome kit", "Brindes do patrocinador"]'::jsonb,
  jsonb_build_object(
    'hero_kicker', 'Réveillon 2027 · 31 de dezembro',
    'hero_title', 'Vire o ano de frente para o mar',
    'hero_subtitle', 'Das 20h às 2h, no Sir Fisher Praia. Escolha sua mesa no mapa e veja o valor na hora.',
    'included_title', 'Incluso em todas as mesas',
    'menu_note', 'Durante a noite servimos os pratos e bebidas do nosso cardápio, abatidos da consumação da mesa.',
    'pix_note', 'Pix: {pix_discount_pct}% de desconto sobre o valor final.',
    'card_note', 'Cartão de débito ou crédito: pagamento presencial, no restaurante ou na própria noite. Você paga na maquininha, com toda a segurança, sem links e sem risco de golpe.',
    'guarantee_note', 'A mesa fica garantida com o pagamento do sinal de {deposit_pct}% em até {hold_hours} horas. Sem o sinal, a pré-reserva expira e a mesa volta a ficar livre.',
    'balance_note', 'O saldo pode ser pago até {balance_due_date}.',
    'children_rules', jsonb_build_array(
      'Crianças de colo não pagam e não contam para o mínimo da mesa.',
      'Crianças até {child_max_age} anos têm {child_discount} de desconto cada.'
    ),
    'group_note', 'Grupo maior que o máximo da mesa? Faça mais de uma reserva e escolha mesas vizinhas no mapa.',
    'terms_summary', jsonb_build_array(
      'Reembolso integral se a desistência for comunicada por escrito em até 7 dias da contratação. Depois disso, não há reembolso, mas você pode indicar outras pessoas para usar a mesa. Nenhum reembolso após 25/12/2026.',
      'A consumação vale só na noite do evento, sem devolução em dinheiro nem uso posterior.',
      'Proibidos fogos e pirotecnia. Não é permitido trazer alimentos e bebidas, exceto champanhe e espumante. Rolha de destilado: R$ 50 por garrafa.',
      'Pessoas além do contratado estão sujeitas a aceite e cobrança proporcional.'
    ),
    'success_title', 'Pré-reserva feita!',
    'success_note', 'Sua mesa fica separada por {hold_hours} horas. Ela só fica garantida depois que recebermos o sinal.',
    'no_pix_message', 'Nossa equipe vai enviar a chave Pix pelo WhatsApp.',
    'closed_message', 'As vendas pelo site estão fechadas no momento. Fale com a gente pelo WhatsApp.'
  ),
  jsonb_build_object(
    'comprovante', E'Olá! Segue o comprovante do sinal do {evento}.\nReserva: {codigo}\nMesa: {mesa} ({tipo})\nResponsável: {nome}\nPessoas: {pessoas}\nTotal: {total} (no Pix: {total_pix})\nSinal: {sinal_pix} no Pix',
    'cobranca_sinal', E'Olá, {nome}! Aqui é do Sir Fisher Praia. Sua pré-reserva {codigo} da mesa {mesa} para o {evento} está aguardando o sinal: {sinal_pix} no Pix (ou {sinal} no cartão, presencial) até {prazo}.\nChave Pix: {pix_chave}\nDepois é só mandar o comprovante por aqui.',
    'sinal_recebido', E'Olá, {nome}! Recebemos seu sinal e a mesa {mesa} está garantida para o {evento}. 🎉\nSaldo: {saldo_pix} no Pix ou {saldo} no cartão (presencial), até {data_saldo}.',
    'lembrete_saldo', E'Olá, {nome}! Passando para lembrar do saldo da mesa {mesa} no {evento}: {saldo_pix} no Pix ou {saldo} no cartão (presencial), até {data_saldo}.\nChave Pix: {pix_chave}',
    'confirmacao_final', E'Olá, {nome}! Tudo certo: a mesa {mesa} está quitada para o {evento}. 🥂\nPessoas: {pessoas} · Consumação: {consumacao}\nEndereço: {endereco}\nAté lá!'
  ),
  '{"viewBox": [-20, 0, 940, 870], "decor": [{"kind": "sea", "shape": "polygon", "points": [[-20, 0], [920, 0], [920, 62], [-20, 105]], "label": "Mar"}, {"kind": "deck", "shape": "polygon", "points": [[25, 265], [220, 195], [890.0, 394.6], [832.0, 715.0], [25, 715]]}, {"kind": "tree", "shape": "circle", "points": [[90.0, 190.0]], "r": 78, "label": ""}, {"kind": "tree", "shape": "circle", "points": [[565.8, 420.1]], "r": 22, "label": ""}, {"kind": "wall", "shape": "polyline", "points": [[25, 265], [220, 195], [890.0, 394.6], [832.0, 715.0]], "label": "Mureta"}, {"kind": "kiosk", "shape": "ellipse", "points": [[185.0, 475.0]], "rx": 160, "ry": 104, "label": "Quiosque"}, {"kind": "dj", "shape": "circle", "points": [[250.0, 650.0]], "r": 36, "label": "DJ"}, {"kind": "hedge", "shape": "polyline", "points": [[25, 715], [301, 715]], "label": ""}, {"kind": "hedge", "shape": "polyline", "points": [[410, 715], [832.0, 715.0]], "label": ""}, {"kind": "street", "shape": "polygon", "points": [[-20, 782.5], [920, 782.5], [920, 870.0], [-20, 870.0]], "label": "Calçadão · Av. Beira Mar"}, {"kind": "label", "x": 356, "y": 752, "label": "▲ Entrada"}]}'::jsonb,
  '37889047000168', 'cnpj', null, '5585988544274',
  30, 5, 48, 12, '2026-12-20',
  100, 11, 3, 96,
  false, false, '{"ga4": false, "meta": false, "openai_ads": false}'::jsonb
)
on conflict (slug) do nothing;

-- ---- termos (versão 1) ----
insert into public.rv_terms (event_id, version, body)
select e.id, 1, $terms$TERMOS E CONDIÇÕES — RÉVEILLON 2027 · SIR FISHER PRAIA

1. OBJETO
A reserva dá direito ao uso da mesa escolhida no mapa, na noite de 31/12/2026, das 20h às 2h de 01/01/2027, na Av. Beira Mar, 3421, Fortaleza/CE, com os itens inclusos informados na página do evento e o crédito de consumação correspondente ao tipo de mesa.

2. PRÉ-RESERVA, SINAL E SALDO
2.1. A pré-reserva separa a mesa pelo prazo informado na confirmação. A mesa só fica garantida após o pagamento do sinal mínimo dentro desse prazo. Sem o sinal, a pré-reserva expira automaticamente e a mesa volta a ficar disponível.
2.2. O saldo deve ser quitado até a data informada na página do evento.
2.3. Pagamento por Pix tem o desconto informado na página do evento. Cartão de débito ou crédito somente de forma presencial, no restaurante ou na noite do evento.

3. DESISTÊNCIA E REEMBOLSO
3.1. Reembolso integral dos valores pagos se a desistência for comunicada por escrito em até 7 (sete) dias da contratação.
3.2. Após esse prazo não há reembolso, mas o contratante pode indicar outras pessoas para utilizar a mesa, informando os nomes ao restaurante.
3.3. Nenhum reembolso será feito após 25/12/2026, independentemente da data de contratação.

4. CONSUMAÇÃO
O crédito de consumação vale exclusivamente na noite do evento, para itens do cardápio, sem devolução em dinheiro, troca ou uso em outra data. O valor não consumido não é restituído.

5. PESSOAS E CRIANÇAS
5.1. Cada tipo de mesa tem capacidade máxima. Pessoas além do contratado estão sujeitas a aceite do restaurante e a cobrança proporcional.
5.2. Crianças de colo não pagam e não contam para o mínimo da mesa. Crianças até 11 anos têm o desconto informado na página do evento.

6. REGRAS DO EVENTO
6.1. É proibido o uso de fogos de artifício e qualquer tipo de pirotecnia.
6.2. Não é permitido trazer alimentos e bebidas, exceto champanhe e espumante. Destilados trazidos pelo cliente estão sujeitos à taxa de rolha de R$ 50,00 por garrafa.

7. RESPONSABILIDADES
7.1. O restaurante não se responsabiliza por objetos pessoais, por veículos estacionados em via pública, nem por caso fortuito ou força maior, como chuva, falta de energia elétrica ou obras públicas.
7.2. O restaurante pode ajustar o espaço físico e a disposição das mesas, desde que isso não prejudique o evento.

8. DIREITO DE IMAGEM
O contratante e seus convidados autorizam, sem ônus, o uso de sua imagem em fotos e vídeos do evento, para divulgação do restaurante em seus canais.

9. FORO
Fica eleito o foro da comarca de Fortaleza/CE para dirimir quaisquer questões decorrentes desta contratação.

Ao marcar a caixa de aceite, o contratante declara ter lido e concordado com estes termos. A data e a hora do aceite ficam registradas.$terms$
from public.rv_events e where e.slug = 'reveillon-2027'
on conflict (event_id, version) do nothing;

-- ---- tipos de mesa ----
insert into public.rv_table_types (event_id, code, name, description, color, min_people, included_people, max_people, allows_extra_chairs, max_infants, sort_order, counts_toward_limit)
select e.id, v.code, v.name, v.description, v.color, v.min_people, v.included_people, v.max_people, v.allows_extra, v.max_infants, v.sort_order, v.code <> 'bistro'
from public.rv_events e
cross join (values
  ('lateral', 'Mesa lateral', 'Junto à mureta, de frente para a praia. Duas mesas unidas, 8 cadeiras.', '#2f6fb3', 8, 8, 16, true, 4, 1),
  ('central', 'Mesa central', 'No centro do salão. O valor cobre até 4 pessoas.', '#2e8b57', 1, 4, 8, true, 3, 2),
  ('bistro', 'Bistrô', 'Mesa alta para 2 pessoas.', '#7b4bb3', 2, 2, 2, false, 1, 3)
) as v(code, name, description, color, min_people, included_people, max_people, allows_extra, max_infants, sort_order)
where e.slug = 'reveillon-2027'
on conflict (event_id, code) do nothing;

-- ---- mesas + posição no mapa ----
-- Desenhado a partir da foto aérea e do croqui do Réveillon 2026 (mureta em
-- diagonal, quiosque oval, DJ ao lado do quiosque). Numeração 01-20 pela posição: beira da mureta
-- (01-08; a 05 é central de 4 lugares, ao lado da árvore), fileira do meio
-- (B09-B10 bistrôs, 11-14 centrais), fileira de trás (B15-B16 bistrôs, 17-20
-- centrais) e o bistrô B21 entre a 11 e a 17. Bistrô leva "B" só para
-- identificar; o número nunca se repete. Unidades do viewBox do mapa;
-- ajuste fino pelo modo "Editar mapa" do painel.
insert into public.rv_tables (event_id, table_type_id, label, x, y, w, h, rotation, shape, sort_order)
select e.id, tt.id, v.label, v.x, v.y, v.w, v.h, v.rotation, v.shape, v.sort_order
from public.rv_events e
join (values
  ('lateral', '01', 204.2, 248.0, 100, 50, 106.6, 'rect', 1),
  ('lateral', '02', 285.8, 272.3, 100, 50, 106.6, 'rect', 2),
  ('lateral', '03', 367.4, 296.6, 100, 50, 106.6, 'rect', 3),
  ('lateral', '04', 449.0, 320.9, 100, 50, 106.6, 'rect', 4),
  ('central', '05', 559.6, 331.8, 50, 50, 16.6, 'rect', 5),
  ('lateral', '06', 612.2, 369.6, 100, 50, 106.6, 'rect', 6),
  ('lateral', '07', 693.8, 393.9, 100, 50, 106.6, 'rect', 7),
  ('lateral', '08', 775.4, 418.2, 100, 50, 106.6, 'rect', 8),
  ('bistro', 'B09', 386.0, 400.0, 36, 36, 0, 'round', 9),
  ('bistro', 'B10', 374.0, 472.0, 36, 36, 0, 'round', 10),
  ('central', '11', 447.5, 472.5, 50, 50, 11, 'rect', 11),
  ('central', '12', 557.5, 490.0, 50, 50, 11, 'rect', 12),
  ('central', '13', 670.0, 510.0, 50, 50, 11, 'rect', 13),
  ('central', '14', 785.1, 535.0, 50, 50, 11, 'rect', 14),
  ('bistro', 'B15', 362.0, 544.0, 36, 36, 0, 'round', 15),
  ('bistro', 'B16', 350.0, 616.0, 36, 36, 0, 'round', 16),
  ('central', '17', 432.5, 639, 50, 50, 0, 'rect', 17),
  ('central', '18', 544.4, 639, 50, 50, 0, 'rect', 18),
  ('central', '19', 656.3, 639, 50, 50, 0, 'rect', 19),
  ('central', '20', 768.2, 639, 50, 50, 0, 'rect', 20),
  ('bistro', 'B21', 447.0, 562.8, 36, 36, 90, 'round', 21)
) as v(type_code, label, x, y, w, h, rotation, shape, sort_order) on true
join public.rv_table_types tt on tt.event_id = e.id and tt.code = v.type_code
where e.slug = 'reveillon-2027'
on conflict (event_id, label) do nothing;

-- ---- Lote 1 (ativo, sem vigência definida) ----
insert into public.rv_lots (event_id, name, active, sort_order)
select e.id, 'Lote 1', true, 1 from public.rv_events e where e.slug = 'reveillon-2027'
on conflict (event_id, name) do nothing;

insert into public.rv_lot_prices (lot_id, table_type_id, table_price, table_consumption, extra_chair_price, extra_chair_consumption)
select l.id, tt.id, v.price, v.consumption, v.extra_price, v.extra_consumption
from public.rv_events e
join public.rv_lots l on l.event_id = e.id and l.name = 'Lote 1'
join (values
  ('lateral', 2800.00, 800.00, 350.00, 100.00),
  ('central', 1500.00, 400.00, 350.00, 100.00),
  ('bistro',   800.00, 200.00,   0.00,   0.00)
) as v(type_code, price, consumption, extra_price, extra_consumption) on true
join public.rv_table_types tt on tt.event_id = e.id and tt.code = v.type_code
where e.slug = 'reveillon-2027'
on conflict (lot_id, table_type_id) do nothing;

-- ---- estado inicial das mesas (o trigger mantém daqui em diante) ----
select public.rv_refresh_table_state(t.id) from public.rv_tables t;
