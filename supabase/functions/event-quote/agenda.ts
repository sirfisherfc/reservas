/**
 * Horários de reserva que precisam ser bloqueados quando um evento é
 * confirmado: todo horário cuja mesa ainda estaria ocupada no início do evento
 * (horário + duração da mesa > início) e que começa antes do fim do evento.
 */
export function slotsToBlock(
  slots: string[],
  startTime: string,
  durationHours: number,
  tableMinutes: number,
): string[] {
  const minutes = (value: string) =>
    Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const start = minutes(startTime);
  const end = start + durationHours * 60;
  return slots
    .filter((slot) => {
      const at = minutes(slot);
      return at + tableMinutes > start && at < end;
    })
    .sort();
}
