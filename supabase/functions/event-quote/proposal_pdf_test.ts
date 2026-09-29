import { assertEquals, assertGreater } from "jsr:@std/assert@1.0.19";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { buildProposalPdf } from "./proposal_pdf.ts";

Deno.test("gera proposta PDF paginada com conteúdo comercial", async () => {
  const bytes = await buildProposalPdf({
    public_code: "EV-TESTE",
    proposal_version: 1,
    customer_name: "Cliente Teste",
    customer_phone: "85999999999",
    event_date: "2026-11-14",
    start_time: "18:00:00",
    duration_hours: 3,
    guests: 50,
    children: 0,
    public_snapshot: {
      name: "Petiscos Equilibrada",
      description: "Seleção dimensionada para o grupo.",
      mainFoods: ["Pasteizinhos", "Bolinha de peixe"],
      beverageLabel: "Bebidas sem álcool incluídas",
      pricePerPerson: 89,
      total: 4450,
      additions: ["Hora adicional sob consulta"],
      notIncluded: ["Decoração"],
    },
    internal_snapshot: {
      portions: { pasteizinhos: 8, bolinha_peixe: 9 },
      drinks: { agua: 35, refrigerante: 35, suco: 15 },
    },
    proposal_terms: {
      validityDays: 5,
      depositPercent: 20,
      balanceDaysBefore: 7,
    },
  });
  assertEquals(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  assertGreater(bytes.length, 3000);
  const document = await PDFDocument.load(bytes);
  assertGreater(document.getPageCount(), 0);
});
