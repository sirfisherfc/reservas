/**
 * Feriados que mudam o movimento da casa: nacionais, móveis, Ceará e Fortaleza,
 * mais as vésperas de Natal e Ano-Novo. Para a demanda, feriado conta como
 * domingo e véspera de feriado (inclusive domingo antes de feriado) conta
 * como sábado.
 */

const FIXED: Record<string, string> = {
  "01-01": "Confraternização Universal",
  "03-19": "São José (Ceará)",
  "03-25": "Data Magna do Ceará",
  "04-21": "Tiradentes",
  "05-01": "Dia do Trabalho",
  "08-15": "Nossa Senhora da Assunção (Fortaleza)",
  "09-07": "Independência",
  "10-12": "Nossa Senhora Aparecida",
  "11-02": "Finados",
  "11-15": "Proclamação da República",
  "11-20": "Consciência Negra",
  "12-24": "Véspera de Natal",
  "12-25": "Natal",
  "12-31": "Véspera de Ano-Novo",
};

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), em UTC ao meio-dia. */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const shift = (d: Date, days: number) =>
  new Date(d.getTime() + days * 86400000);

function movable(year: number): Record<string, string> {
  const e = easter(year);
  return {
    [iso(shift(e, -48))]: "Carnaval",
    [iso(shift(e, -47))]: "Carnaval",
    [iso(shift(e, -2))]: "Sexta-feira Santa",
    [iso(shift(e, 60))]: "Corpus Christi",
  };
}

/** Nome do feriado na data (AAAA-MM-DD), ou null. */
export function holidayName(date: string): string | null {
  const year = Number(date.slice(0, 4));
  return FIXED[date.slice(5, 10)] ?? movable(year)[date] ?? null;
}

/**
 * Dia da semana (ISO, 1 = segunda … 7 = domingo) usado para estimar o
 * movimento: feriado vira domingo; véspera de feriado vira sábado.
 */
export function demandWeekday(
  date: string,
): { weekday: number; note: string | null } {
  const d = new Date(`${date}T12:00:00Z`);
  const weekday = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  const holiday = holidayName(date);
  if (holiday) {
    return { weekday: 7, note: `Feriado (${holiday}): movimento de domingo.` };
  }
  const next = holidayName(iso(shift(d, 1)));
  if (next && weekday !== 6) {
    return {
      weekday: 6,
      note: `Véspera de feriado (${next}): movimento de sábado.`,
    };
  }
  return { weekday, note: null };
}
