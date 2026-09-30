import {
  assertEquals,
  assertGreater,
  assertMatch,
} from "jsr:@std/assert@1.0.19";
import { buildQuote, type QuoteInput } from "./pricing.ts";

const base: QuoteInput = {
  date: "2026-10-14",
  startTime: "12:00",
  durationHours: 3,
  guests: 30,
  children: 0,
  foodStyle: "refeicao",
  beverageMode: "sem_alcool",
  profile: "comparar",
};

Deno.test("30 pessoas em almoço de semana gera preço fechado com atendimento", () => {
  const q = buildQuote(base, { demandDataAvailable: true });
  assertEquals(q.options.length, 3);
  assertEquals(q.options[0].serviceIncluded, true);
  assertGreater(q.options[0].total, 0);
});

Deno.test("50 pessoas sexta com chope exige conferência", () => {
  const q = buildQuote({
    ...base,
    date: "2026-10-16",
    guests: 50,
    foodStyle: "petiscos",
    beverageMode: "chope",
  });
  assertEquals(q.requestRiskLevel, "amarelo");
});

Deno.test("60 pessoas sábado sem exclusividade nunca vira confirmação", () => {
  const q = buildQuote({
    ...base,
    date: "2026-10-17",
    guests: 60,
    foodStyle: "petiscos",
  });
  assertMatch(q.options[0].validationMessage, /valida|disponibilidade/i);
});

Deno.test("80 pessoas sábado com exclusividade usa piso de oportunidade", () => {
  const q = buildQuote({
    ...base,
    date: "2026-12-19",
    guests: 80,
    exclusive: true,
  }, { demandDataAvailable: true, opportunityCostTotal: 12000 });
  assertGreater(q.options[0].total, 11999);
  assertEquals(q.requestRiskLevel, "amarelo");
});

Deno.test("100 pessoas com duração maior recomenda equipe adicional", () => {
  const q = buildQuote({ ...base, guests: 100, durationHours: 5 }, {
    demandDataAvailable: true,
  });
  assertGreater(q.internal[0].freelancerCount, 1);
});

Deno.test("chope + coquetel conta álcool só para adultos e exige conferência", () => {
  const q = buildQuote({
    ...base,
    guests: 40,
    children: 10,
    beverageMode: "chope_coquetel",
  });
  assertEquals(q.internal[0].drinks.chope, 60);
  assertEquals(q.internal[0].drinks.coquetel, 30);
  assertEquals(q.internal[0].drinks.agua, 16);
  assertEquals(q.internal[0].drinks.suco, 12);
  assertEquals(q.requestRiskLevel, "amarelo");
});

Deno.test("cada hora além de 3 acrescenta 10% ao valor do cardápio", () => {
  const three = buildQuote(base, { demandDataAvailable: true });
  const five = buildQuote({ ...base, durationHours: 5 }, {
    demandDataAvailable: true,
  });
  assertEquals(five.internal[0].extraHours, 2);
  assertEquals(
    Math.round(five.internal[0].listPriceTotal),
    Math.round(three.internal[0].listPriceTotal * 1.2),
  );
  assertGreater(five.options[0].total, three.options[0].total * 1.1);
});

Deno.test("perfil escolhido devolve só aquele perfil", () => {
  const q = buildQuote({ ...base, profile: "essencial" });
  assertEquals(q.options.length, 1);
  assertMatch(q.options[0].name, /Essencial/);
});

Deno.test("petiscos + lanche serve 1 lanche por convidado", () => {
  const q = buildQuote({
    ...base,
    guests: 47,
    foodStyle: "petiscos_principal",
  });
  assertEquals(q.internal.every((o) => o.portions.lanche === 47), true);
});

Deno.test("opção de bebida desconhecida é recusada", () => {
  let message = "";
  try {
    buildQuote({
      ...base,
      beverageMode: "open_bar" as QuoteInput["beverageMode"],
    });
  } catch (error) {
    message = (error as Error).message;
  }
  assertMatch(message, /bebidas inválida/);
});

Deno.test("data bloqueada é vermelha", () => {
  const q = buildQuote(base, { blocked: true });
  assertEquals(q.requestRiskLevel, "vermelho");
});

Deno.test("CMV alto é segurado pelo piso de custo", () => {
  const q = buildQuote(base, {}, {
    versionCode: "teste-margem-baixa",
    cmvRate: 0.90,
    serviceRate: 0.10,
    targetContributionMargin: 0.30,
    freelancerDay: 100,
  });
  assertEquals(q.internal[0].priceDriver, "custo");
  assertGreater(q.internal[0].estimatedContributionMargin, 0.29);
});

Deno.test("alterar quantidade recalcula totais no servidor", () => {
  const a = buildQuote(base);
  const b = buildQuote({ ...base, guests: 55 });
  assertGreater(b.options[0].total, a.options[0].total);
  assertGreater(
    b.internal[0].portions.travessa_essencial,
    a.internal[0].portions.travessa_essencial,
  );
});

Deno.test("preço enviado pelo navegador não participa do contrato de entrada", () => {
  const tampered = { ...base, pricePerPerson: 1 } as QuoteInput & {
    pricePerPerson: number;
  };
  const q = buildQuote(tampered);
  assertGreater(q.options[0].pricePerPerson, 1);
});

Deno.test("evento sai abaixo do valor de cardápio", () => {
  for (
    const foodStyle of ["petiscos", "petiscos_principal", "refeicao"] as const
  ) {
    const q = buildQuote({ ...base, guests: 60, foodStyle }, {
      demandDataAvailable: true,
    });
    for (const option of q.internal) {
      assertGreater(option.menuValueTotal, option.total);
    }
  }
});

Deno.test("mais convidados recebem desconto maior", () => {
  const small = buildQuote({ ...base, guests: 35 }).internal[1];
  const large = buildQuote({ ...base, guests: 90 }).internal[1];
  assertGreater(large.discountTarget, small.discountTarget);
});

Deno.test("horário forte dá menos desconto que horário vazio", () => {
  const weekdayLunch =
    buildQuote({ ...base, date: "2026-10-14", startTime: "14:00" }).internal[1];
  const saturdayNight =
    buildQuote({ ...base, date: "2026-10-17", startTime: "19:00" }).internal[1];
  assertGreater(
    weekdayLunch.discountBreakdown.horario,
    saturdayNight.discountBreakdown.horario,
  );
});

Deno.test("histórico de faturamento vira piso de oportunidade", () => {
  const q = buildQuote({ ...base, guests: 50 }, {
    demandIndex: 0.9,
    expectedWindowRevenue: 20000,
    capacity: 100,
  });
  assertEquals(q.internal[0].demandSource, "historico");
  assertEquals(q.internal[0].priceDriver, "oportunidade");
  assertGreater(q.internal[0].total, 9999);
});

Deno.test("CMV real substitui o provisório quando é plausível", () => {
  const q = buildQuote(base, { realCmvRate: 0.28 });
  assertEquals(q.internal[0].cmvRateUsed, 0.28);
  const absurd = buildQuote(base, { realCmvRate: 0.9 });
  assertEquals(absurd.internal[0].cmvRateUsed, 0.35);
});

Deno.test("cozinha é custo fixo; cozinheiro extra só acima de 60 convidados", () => {
  assertEquals(
    buildQuote({ ...base, guests: 60 }).internal[0].kitchenExtraCount,
    0,
  );
  assertEquals(
    buildQuote({ ...base, guests: 61 }).internal[0].kitchenExtraCount,
    1,
  );
  assertEquals(
    buildQuote({ ...base, guests: 95 }).internal[0].kitchenExtraCount,
    2,
  );
});

Deno.test("Completa tem desconto maior que Equilibrada, que tem maior que Essencial", () => {
  const [e, q, c] = buildQuote({ ...base, guests: 50 }).internal;
  assertGreater(q.discountTarget, e.discountTarget);
  assertGreater(c.discountTarget, q.discountTarget);
});

Deno.test("nível que empata com o de cima some da comparação", () => {
  const q = buildQuote({ ...base, guests: 90 }, {
    demandIndex: 1,
    expectedWindowRevenue: 30000,
    capacity: 100,
  });
  assertEquals(q.internal.length, 3);
  assertEquals(q.options.length, 1);
  assertMatch(q.options[0].name, /Completa/);
});

Deno.test("níveis têm diferença real de preço", () => {
  for (
    const foodStyle of ["petiscos", "petiscos_principal", "refeicao"] as const
  ) {
    const [e, q, c] = buildQuote({ ...base, guests: 50, foodStyle }).options;
    assertGreater(q.pricePerPerson - e.pricePerPerson, 7);
    assertGreater(c.pricePerPerson - q.pricePerPerson, 7);
  }
});

Deno.test("feriado conta como domingo e véspera como sábado", async () => {
  const { demandWeekday, holidayName } = await import("./holidays.ts");
  assertEquals(holidayName("2026-10-12"), "Nossa Senhora Aparecida");
  assertEquals(holidayName("2027-03-26"), "Sexta-feira Santa");
  assertEquals(holidayName("2027-02-09"), "Carnaval");
  assertEquals(demandWeekday("2026-10-12").weekday, 7);
  assertEquals(demandWeekday("2026-11-19").weekday, 6);
  assertEquals(demandWeekday("2026-10-13").weekday, 2);
  assertEquals(demandWeekday("2026-10-11").weekday, 6);
  const holiday =
    buildQuote({ ...base, date: "2026-10-12", startTime: "15:00" }).internal[1];
  const tuesday =
    buildQuote({ ...base, date: "2026-10-13", startTime: "15:00" }).internal[1];
  assertGreater(
    tuesday.discountBreakdown.horario,
    holiday.discountBreakdown.horario,
  );
});
