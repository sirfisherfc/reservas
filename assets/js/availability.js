// Consulta pública de configurações e horários disponíveis.
// Toda a validação "de verdade" acontece no banco (RPC get_available_time_slots / fn_create_reservation);
// aqui só buscamos e exibimos o que o banco permite.
import { supabase } from './supabaseClient.js';

const DEFAULT_SETTINGS = {
  min_party_size: 2,
  max_party_size: 10,
  same_day_cutoff_time: '12:00',
  advance_booking_days: 60,
  tolerance_minutes: 15,
  hold_release_minutes: 60,
  whatsapp_number: '',
};

export async function fetchPublicSettings() {
  const { data, error } = await supabase
    .from('restaurant_settings')
    .select('key,value')
    .eq('is_public', true);

  if (error || !data) {
    return { ...DEFAULT_SETTINGS };
  }

  const settings = { ...DEFAULT_SETTINGS };
  for (const row of data) {
    settings[row.key] = row.value;
  }
  return settings;
}

// Retorna { slots: [...] } ou { error: 'CODE' } sem lançar exceção,
// para a tela sempre poder mostrar uma mensagem amigável.
export async function fetchAvailableSlots(date, partySize) {
  const { data, error } = await supabase.rpc('get_available_time_slots', {
    p_date: date,
    p_party_size: partySize,
  });

  if (error) {
    const code = (error.message || '').split(':')[0].trim();
    return { slots: [], error: code || 'UNKNOWN' };
  }

  return { slots: data || [], error: null };
}

export function renderSlots(container, slots, selectedTime, onSelect) {
  container.innerHTML = '';

  if (!slots.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Nenhum horário disponível para essa data e quantidade de pessoas.';
    container.appendChild(p);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'slots-grid';

  for (const slot of slots) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'slot-btn';
    btn.textContent = slot.time_slot.slice(0, 5);
    btn.disabled = !slot.is_available;
    if (slot.time_slot === selectedTime) {
      btn.classList.add('is-selected');
    }
    btn.addEventListener('click', () => onSelect(slot.time_slot));
    grid.appendChild(btn);
  }

  container.appendChild(grid);
}
