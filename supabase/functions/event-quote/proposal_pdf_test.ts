import { assertEquals, assertGreater } from "jsr:@std/assert@1.0.19";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { buildProposalPdf } from "./proposal_pdf.ts";

Deno.test("gera proposta PDF paginada com conteúdo comercial", async () => {
  const bytes = await buildProposalPdf({
    public_code: "EV-TESTE",
    proposal_version: 1,
    verification_code: "SF-TEST-2345",
    customer_name: "Cliente Teste",
    customer_phone: "85999999999",
    event_date: "2026-11-14",
    start_time: "18:00:00",
    duration_hours: 3,
    guests: 50,
    children: 0,
    public_snapshot: {
      name: "Só petiscos · Equilibrada",
      summary: "5 petiscos, cerca de 8 unidades por pessoa.",
      beverageDetail: "2 bebidas por convidado.",
      description: "Seleção dimensionada para o grupo.",
      mainFoods: ["Pasteizinhos", "Bolinha de peixe"],
      beverageLabel: "Água, refrigerante e suco",
      pricePerPerson: 89,
      total: 4450,
      additions: ["Hora adicional sob consulta"],
      notIncluded: ["Decoração"],
    },
    internal_snapshot: {
      foodStyle: "petiscos",
      beverageMode: "sem_alcool",
      portions: { pasteizinhos: 8, bolinha_peixe: 9, principal: 3 },
      drinks: { agua: 35, refrigerante: 35, suco: 15 },
    },
    proposal_terms: {
      validityDays: 5,
      depositPercent: 20,
      balanceDaysBefore: 7,
    },
  }, { loadImage: () => Promise.resolve(null) });
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assertGreater(bytes.length, 3000);
  const document = await PDFDocument.load(bytes);
  assertGreater(document.getPageCount(), 4);
});
