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
  profile: "equilibrada",
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

Deno.test("open bar tem limite de três horas no rótulo e validação", () => {
  const q = buildQuote({ ...base, beverageMode: "open_bar" });
  assertMatch(q.options[0].beverageLabel, /3 horas/i);
  assertEquals(q.requestRiskLevel, "amarelo");
});

Deno.test("data bloqueada é vermelha", () => {
  const q = buildQuote(base, { blocked: true });
  assertEquals(q.requestRiskLevel, "vermelho");
});

Deno.test("configuração abaixo do piso de margem é vermelha", () => {
  const q = buildQuote(base, {}, {
    versionCode: "teste-margem-baixa",
    cmvRate: 0.90,
    serviceRate: 0.10,
    targetContributionMargin: 0.30,
    freelancerDay: 100,
  });
  assertEquals(q.requestRiskLevel, "vermelho");
});

Deno.test("alterar quantidade recalcula totais no servidor", () => {
  const a = buildQuote(base);
  const b = buildQuote({ ...base, guests: 55 });
  assertGreater(b.options[0].total, a.options[0].total);
  assertGreater(
    b.internal[0].portions.principal,
    a.internal[0].portions.principal,
  );
});

Deno.test("preço enviado pelo navegador não participa do contrato de entrada", () => {
  const tampered = { ...base, pricePerPerson: 1 } as QuoteInput & {
    pricePerPerson: number;
  };
  const q = buildQuote(tampered);
  assertGreater(q.options[0].pricePerPerson, 1);
});
