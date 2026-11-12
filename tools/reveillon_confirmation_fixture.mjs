// Dados fictícios para validar o documento, sem leitura de clientes reais.
export const event = {
  id: 'event-fixture', name: 'Réveillon 2027', venue_name: 'Sir Fisher',
  address: 'Av. Beira Mar, 3421 - Meireles, Fortaleza/CE',
  starts_at: '2026-12-31T23:00:00Z', ends_at: '2027-01-01T05:00:00Z',
  timezone: 'America/Fortaleza', balance_due_date: '2026-12-20',
  pix_key: '', pix_key_type: 'cnpj', pix_holder: '', whatsapp_number: '5585988544274',
  child_max_age: 11, hold_hours: 48, pix_discount_pct: 5,
  included_items: ['1 Chandon por mesa', 'Welcome kit', 'Brindes do patrocinador'],
  texts: {
    menu_note: 'Durante a noite servimos os pratos e bebidas do nosso cardápio, abatidos da consumação da mesa.',
    card_note: 'Cartão de débito ou crédito: pagamento presencial, no restaurante ou na própria noite. Você paga na maquininha, com toda a segurança, sem links e sem risco de golpe.',
    children_rules: ['Crianças de colo não pagam e não contam para o mínimo da mesa.', 'Crianças até {child_max_age} anos têm {child_discount} de desconto cada.'],
    faq: ['Dá para ver a queima de fogos? | Da orla dá para ver a queima oficial do Aterro e também as de vários clubes e hotéis da Beira-Mar.', 'Tem música? | DJ e cantor ao vivo durante toda a noite.'],
  },
};

export const booking = {
  id: 'booking-fixture', event_id: event.id, public_code: 'RV-EXEMPLO',
  table_id: 'table-fixture', table_type: 'Bistrô', table_label: 'B09',
  customer_name: 'Cliente de Exemplo', customer_phone: 'CONTATO_PRIVADO',
  customer_email: 'EMAIL_PRIVADO', internal_notes: 'NOTA_INTERNA_PRIVADA',
  manual_discount_reason: 'MOTIVO_INTERNO_PRIVADO',
  status: 'sinal_pago', adults: 2, children: 0, infants: 0,
  history: [],
  snap_pix_discount_pct: 8, snap_deposit_pct: 30, snap_child_discount: 100,
  terms_id: 'terms-original', terms_accepted_at: '2026-11-10T03:26:00Z',
  payments: [{ id: 'payment-fixture', amount: 220.80, method: 'pix',
    payer_name: 'PAGADOR_PRIVADO', notes: 'NOTA_PAGAMENTO_PRIVADA', created_by: 'USUARIO_PRIVADO' }],
  price: { total: 800, total_pix: 736, paid_net: 220.80, paid_gross: 240,
    balance: 560, balance_pix: 515.20, consumption_total: 200,
    children_discount: 0, manual_discount: 0 },
};

export const terms = {
  id: 'terms-original', event_id: event.id, version: 1,
  body: 'TERMOS E CONDIÇÕES\n\n1. CONSUMAÇÃO\nCrédito válido somente na noite do evento, sem restituição em dinheiro.\n\n2. REGRAS\nProibidos fogos e pirotecnia.',
};
