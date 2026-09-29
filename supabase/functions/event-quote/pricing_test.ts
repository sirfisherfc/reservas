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
  assertEquals(q.internal[0].drinks.agua, 20);
  assertEquals(q.requestRiskLevel, "amarelo");
});

Deno.test("cada hora além de 3 acrescenta 10% ao valor do cardápio", () => {
  const three = buildQuote(base, { demandDataAvailable: true });
  const five = buildQuote({ ...base, durationHours: 5 }, {
    demandDataAvailable: true,
  });
  assertEquals(five.internal[0].extraHours, 2);
  assertGreater(five.options[0].total, three.options[0].total * 1.19);
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
