// Leituras autenticadas existentes. Baixar PDF nunca registra pagamento ou envia mensagem.
export function canDownloadConfirmation(booking) {
  return ['sinal_pago', 'quitada'].includes(booking?.status)
    && Array.isArray(booking.payments)
    && booking.payments.some((p) => !p.voided_at && Number.isFinite(Number(p.amount)) && Number(p.amount) > 0);
}

export async function loadReveillonConfirmation(client, bookingId) {
  const detail = await client.rpc('rv_booking_detail', { p_booking_id: bookingId });
  if (detail.error) throw new Error('Não foi possível atualizar a reserva. Tente novamente.');
  const booking = detail.data;
  if (booking?.id !== bookingId || !canDownloadConfirmation(booking)) {
    throw new Error('O PDF fica disponível depois que o sinal é registrado na reserva.');
  }
  let termQuery = client.from('rv_terms').select('id,event_id,version,body')
    .eq('event_id', booking.event_id);
  termQuery = booking.terms_id
    ? termQuery.eq('id', booking.terms_id)
    : termQuery.order('version', { ascending: false }).limit(1);
  const [eventResult, termResult] = await Promise.all([
    client.from('rv_events').select('id,name,venue_name,address,starts_at,ends_at,timezone,included_items,texts,pix_key,pix_key_type,pix_holder,whatsapp_number,balance_due_date,child_max_age,hold_hours')
      .eq('id', booking.event_id).single(),
    termQuery.single(),
  ]);
  if (eventResult.error || termResult.error || !eventResult.data || !termResult.data) {
    throw new Error('Não foi possível carregar os detalhes e as regras do evento. Tente novamente.');
  }
  return { booking, event: eventResult.data, terms: termResult.data };
}
