import {
  PDFDocument,
  type PDFFont,
  type PDFPage,
  rgb,
  StandardFonts,
} from "https://esm.sh/pdf-lib@1.17.1";

type Json = Record<string, unknown>;

const A4 = { width: 595.28, height: 841.89 };
const COLORS = {
  ink: rgb(18 / 255, 41 / 255, 61 / 255),
  coral: rgb(223 / 255, 91 / 255, 59 / 255),
  muted: rgb(92 / 255, 105 / 255, 114 / 255),
  line: rgb(225 / 255, 220 / 255, 210 / 255),
  cream: rgb(251 / 255, 247 / 255, 239 / 255),
};

const foodMeasures: Record<
  string,
  { label: string; units?: number; unit?: string }
> = {
  pasteizinhos: { label: "Pasteizinhos", units: 10, unit: "pastéis" },
  bolinha_peixe: { label: "Bolinha de peixe", units: 6, unit: "bolinhas" },
  crocante_carne_sol: {
    label: "Crocante de carne de sol",
    units: 6,
    unit: "bolinhos",
  },
  dadinho_tapioca: { label: "Dadinho de tapioca", units: 12, unit: "dadinhos" },
  principal: { label: "Prato principal", unit: "pratos" },
  principal_premium: { label: "Prato principal premium", unit: "pratos" },
  brownie: { label: "Brownie", unit: "unidades" },
  sobremesa: { label: "Sobremesa", unit: "unidades" },
};

const drinkLabels: Record<string, string> = {
  agua: "Água - unidades",
  refrigerante: "Refrigerante lata",
  suco: "Suco copo",
  credito_reais: "Crédito de consumo - R$",
  fichas: "Fichas de bebida",
  chope: "Chope - unidades de serviço",
  agua_refrigerante: "Água/refrigerante - unidades",
  cerveja_ou_chope: "Cerveja ou chope - unidades",
  alcoolicas_selecionadas: "Bebidas alcoólicas selecionadas - unidades",
};

function safe(value: unknown): string {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7EÀ-ÿ\n]/g, "-")
    .trim();
}

function money(value: unknown): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(value) || 0).replace(/\u00a0/g, " ");
}

function dateBR(value: unknown): string {
  const parts = String(value ?? "").slice(0, 10).split("-");
  return parts.length === 3
    ? `${parts[2]}/${parts[1]}/${parts[0]}`
    : safe(value);
}

function labelFromKey(key: string): string {
  return key.replaceAll("_", " ").replace(
    /\b\w/g,
    (letter) => letter.toUpperCase(),
  );
}

function foodQuantity(key: string, quantity: number): string {
  const measure = foodMeasures[key];
  if (!measure) return `${labelFromKey(key)}: ${quantity} porções`;
  if (measure.units) {
    return `${measure.label}: ${quantity} porções (${
      quantity * measure.units
    } ${measure.unit})`;
  }
  return `${measure.label}: ${quantity} ${measure.unit}`;
}

function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
): string[] {
  const result: string[] = [];
  for (const paragraph of safe(text).split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      result.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
        line = candidate;
      } else {
        result.push(line);
        line = word;
      }
    }
    if (line) result.push(line);
  }
  return result;
}

export async function buildProposalPdf(request: Json): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const pub = (request.public_snapshot ?? {}) as Json;
  const internal = (request.internal_snapshot ?? {}) as Json;
  const terms = (request.proposal_terms ?? {}) as Json;
  const portions = (internal.portions ?? {}) as Record<string, number>;
  const drinks = (internal.drinks ?? {}) as Record<string, number>;
  const margin = 48;
  const contentWidth = A4.width - margin * 2;
  let page: PDFPage = pdf.addPage([A4.width, A4.height]);
  let y = 0;
  let pageNumber = 0;

  const newPage = () => {
    if (pageNumber > 0) page = pdf.addPage([A4.width, A4.height]);
    pageNumber += 1;
    y = A4.height - margin;
    page.drawText("SIR FISHER", {
      x: margin,
      y,
      size: 10,
      font: bold,
      color: COLORS.coral,
    });
    page.drawText(
      `Proposta ${safe(request.public_code)} - versão ${
        Number(request.proposal_version) || 1
      }`,
      {
        x: A4.width - margin - 230,
        y,
        size: 8,
        font: regular,
        color: COLORS.muted,
      },
    );
    y -= 22;
  };

  const ensure = (height: number) => {
    if (y - height < 58) newPage();
  };

  const line = (
    text: string,
    options: {
      size?: number;
      font?: PDFFont;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      gap?: number;
    } = {},
  ) => {
    const size = options.size ?? 10;
    const font = options.font ?? regular;
    const indent = options.indent ?? 0;
    const lines = wrap(text, font, size, contentWidth - indent);
    ensure(lines.length * (size + 4) + 4);
    for (const item of lines) {
      page.drawText(item, {
        x: margin + indent,
        y,
        size,
        font,
        color: options.color ?? COLORS.ink,
      });
      y -= size + 4;
    }
    y -= options.gap ?? 2;
  };

  const heading = (text: string) => {
    ensure(34);
    y -= 7;
    page.drawLine({
      start: { x: margin, y: y + 14 },
      end: { x: A4.width - margin, y: y + 14 },
      thickness: 0.7,
      color: COLORS.line,
    });
    line(text.toUpperCase(), {
      size: 9,
      font: bold,
      color: COLORS.coral,
      gap: 7,
    });
  };

  const item = (text: string) =>
    line(`- ${text}`, { size: 9.5, indent: 8, gap: 0 });

  newPage();
  page.drawRectangle({
    x: margin,
    y: y - 82,
    width: contentWidth,
    height: 82,
    color: COLORS.cream,
  });
  y -= 22;
  line("PROPOSTA DE EVENTO", { size: 23, font: bold, gap: 5 });
  line(`${safe(pub.name)} | ${safe(request.guests)} convidados`, {
    size: 12,
    font: bold,
    color: COLORS.muted,
  });
  y -= 17;

  heading("Evento e responsável");
  line(`Cliente: ${safe(request.customer_name)}`);
  line(`WhatsApp: ${safe(request.customer_phone)}`);
  line(
    `Data: ${dateBR(request.event_date)} às ${
      safe(request.start_time).slice(0, 5)
    } | Duração: ${safe(request.duration_hours)} horas`,
  );
  line(
    `Convidados: ${safe(request.guests)} | Crianças informadas: ${
      safe(request.children)
    }`,
  );

  heading("Experiência contratada");
  line(safe(pub.description), { color: COLORS.muted });
  for (const food of (pub.mainFoods as unknown[] ?? [])) item(safe(food));
  line(`Bebidas: ${safe(pub.beverageLabel)}`, { font: bold, gap: 4 });
  line("Atendimento e taxa de serviço incluídos no valor apresentado.", {
    color: COLORS.muted,
  });

  heading("Dimensionamento de alimentos");
  if (!Object.keys(portions).length) {
    item("Consumo individual ou dimensionamento não aplicável.");
  }
  for (const [key, quantity] of Object.entries(portions)) {
    item(foodQuantity(key, Number(quantity)));
  }
  line(
    "As quantidades acima formam o compromisso comercial desta versão e consideram o número de convidados informado.",
    { size: 8.5, color: COLORS.muted },
  );

  heading("Dimensionamento de bebidas");
  if (!Object.keys(drinks).length) {
    item("Bebidas cobradas diretamente de cada convidado.");
  }
  for (const [key, quantity] of Object.entries(drinks)) {
    item(`${drinkLabels[key] ?? labelFromKey(key)}: ${Number(quantity)}`);
  }

  heading("Investimento");
  line(`${money(pub.pricePerPerson)} por pessoa`, {
    size: 14,
    font: bold,
    gap: 2,
  });
  line(`Total da proposta: ${money(pub.total)}`, {
    size: 18,
    font: bold,
    color: COLORS.coral,
    gap: 4,
  });
  line(
    `Sinal para confirmação: ${
      Number(terms.depositPercent) || 20
    }% | Saldo até ${
      Number(terms.balanceDaysBefore) || 7
    } dias antes do evento.`,
  );

  heading("Adicionais e itens não incluídos");
  for (const addition of (pub.additions as unknown[] ?? [])) {
    item(`Sob consulta: ${safe(addition)}`);
  }
  for (const excluded of (pub.notIncluded as unknown[] ?? [])) {
    item(`Não incluído: ${safe(excluded)}`);
  }

  ensure(165);
  heading("Condições da proposta");
  item(
    `Validade: ${
      Number(terms.validityDays) || 5
    } dias corridos a partir da emissão.`,
  );
  item(
    "A data somente é confirmada após aceite expresso, pagamento do sinal e confirmação da equipe.",
  );
  item(
    "Mudanças de data, duração, quantidade de convidados, cardápio ou bebidas exigem novo cálculo.",
  );
  item(
    "Convidados adicionais são cobrados conforme o valor por pessoa desta proposta, sujeitos à capacidade.",
  );
  item(
    "Hora adicional, exclusividade e consumos além do contratado dependem de disponibilidade e aprovação prévia.",
  );
  item(
    "Cancelamento, reagendamento e devoluções seguem o contrato definitivo aceito pelas partes.",
  );
  if (safe(terms.additionalNotes)) {
    item(`Observações: ${safe(terms.additionalNotes)}`);
  }

  y -= 12;
  ensure(55);
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + 210, y },
    thickness: 0.7,
    color: COLORS.muted,
  });
  y -= 14;
  line("Aceite do cliente / responsável", { size: 8, color: COLORS.muted });

  const totalPages = pdf.getPageCount();
  pdf.getPages().forEach((pdfPage, index) => {
    pdfPage.drawText(
      `Sir Fisher | Av. Beira Mar, 3421 - Fortaleza | Página ${
        index + 1
      } de ${totalPages}`,
      {
        x: margin,
        y: 27,
        size: 7.5,
        font: regular,
        color: COLORS.muted,
      },
    );
  });

  pdf.setTitle(`Proposta de evento ${safe(request.public_code)}`);
  pdf.setAuthor("Sir Fisher");
  pdf.setSubject("Proposta comercial de evento");
  return await pdf.save();
}
