import {
  clip,
  endPath,
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setCharacterSpacing,
  StandardFonts,
} from "https://esm.sh/pdf-lib@1.17.1";
import { BASE_HOURS, EXTRA_HOUR_RATE, ITEMS } from "./pricing.ts";

type Json = Record<string, unknown>;
type Color = ReturnType<typeof rgb>;

export interface PdfOptions {
  /** Carrega uma imagem de `site/assets/img/`. Sem retorno, a proposta sai sem aquela foto. */
  loadImage?: (file: string) => Promise<Uint8Array | null>;
}

const SITE_IMG = "https://www.sirfisher.com.br/assets/img/";
const W = 595.28;
const H = 841.89;
const M = 56;
const CW = W - M * 2;
const hex = (value: string) =>
  rgb(
    parseInt(value.slice(1, 3), 16) / 255,
    parseInt(value.slice(3, 5), 16) / 255,
    parseInt(value.slice(5, 7), 16) / 255,
  );
const C = {
  navy: hex("#12293d"),
  deep: hex("#0b1b29"),
  coral: hex("#df5b3b"),
  gold: hex("#b8925a"),
  goldSoft: hex("#e9d9bd"),
  cream: hex("#fbf7ef"),
  sand: hex("#f3ece0"),
  ink: hex("#1d2b36"),
  muted: hex("#5f6b74"),
  line: hex("#e3dccf"),
  white: rgb(1, 1, 1),
};

const COMPANY = {
  name: "SIR FISHER PRAIA COMÉRCIO DE ALIMENTOS LTDA",
  cnpj: "37.889.047/0001-68",
  address: "Av. Beira-Mar, 3421 · Meireles · Fortaleza/CE · CEP 60165-120",
  bank: "Banco do Brasil · Agência 2793-6 · Conta-corrente 93.957-7",
};

const PHOTOS: Record<string, string> = {
  pasteizinhos: "pasteizinhos-sir-fisher-660.jpg",
  bolinha_peixe: "bolinha-de-peixe-cremosa-sir-fisher-660.jpg",
  crocante_carne_sol: "crocante-carne-de-sol-sir-fisher-660.jpg",
  crocantes: "crocante-carne-de-sol-sir-fisher-660.jpg",
  dadinho_tapioca: "dadinho-de-tapioca-sir-fisher-660.jpg",
  crispy_chicken: "crispy-spicy-chicken-sir-fisher-660.jpg",
  newcastle: "newcastle-camarao-empanado-sir-fisher-660.jpg",
  isca_peixe: "isca-de-peixe-sir-fisher-660.jpg",
  lanche: "edimburger-sir-fisher-660.jpg",
  travessa_essencial: "peixe-grelhado-para-dividir-sir-fisher-660.jpg",
  travessa_equilibrada: "carne-de-sol-para-dividir-sir-fisher-660.jpg",
  travessa_completa: "file-mignon-para-dividir-sir-fisher-660.jpg",
  brownie: "brownie-de-chocolate-sir-fisher-660.jpg",
  brownie_sorvete: "brownie-com-sorvete-sir-fisher-660.jpg",
  principal: "peixe-grelhado-sir-fisher-660.jpg",
  principal_premium: "file-mignon-sir-fisher-660.jpg",
};

/** Itens de propostas da versão 1, mantidos para regerar PDFs antigos. */
const LEGACY_ITEMS: Record<
  string,
  { name: string; detail: string; unit: string }
> = {
  principal: {
    name: "Prato principal",
    detail: "Prato individual da casa.",
    unit: "pratos",
  },
  principal_premium: {
    name: "Prato principal premium",
    detail: "Prato individual da casa.",
    unit: "pratos",
  },
  sobremesa: {
    name: "Sobremesa",
    detail: "Sobremesa individual.",
    unit: "unidades",
  },
  acompanhamento: {
    name: "Acompanhamento",
    detail: "Batata ou macaxeira.",
    unit: "porções",
  },
};

const DRINKS: Record<string, string> = {
  agua: "Água mineral 500 ml",
  refrigerante: "Refrigerante lata 350 ml",
  suco: "Suco (copo 330 ml)",
  chope: "Chope Brahma 300 ml",
  coquetel: "Caipirinha ou caipiroska",
  credito_reais: "Crédito de consumo (R$)",
  fichas: "Fichas de bebida",
  agua_refrigerante: "Água ou refrigerante",
  cerveja_ou_chope: "Cerveja ou chope",
  alcoolicas_selecionadas: "Bebidas alcoólicas selecionadas",
};

const WEEKDAYS = [
  "domingo",
  "segunda-feira",
  "terça-feira",
  "quarta-feira",
  "quinta-feira",
  "sexta-feira",
  "sábado",
];
const MONTHS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

function safe(value: unknown): string {
  return String(value ?? "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x20-\x7E -ÿ\n•–—]/g, "-")
    .trim();
}

function money(value: unknown): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(Number(value) || 0).replace(/ /g, " ");
}

function parseDate(value: unknown): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""));
  return match
    ? new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], 12))
    : null;
}

const dateShort = (d: Date) =>
  `${String(d.getUTCDate()).padStart(2, "0")}/${
    String(d.getUTCMonth() + 1).padStart(2, "0")
  }/${d.getUTCFullYear()}`;
const dateLong = (d: Date) =>
  `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
const addDays = (d: Date, days: number) =>
  new Date(d.getTime() + days * 86400000);

function clock(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h${String(rest).padStart(2, "0")}` : `${h}h`;
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
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

async function defaultLoadImage(file: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(SITE_IMG + file, {
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

export async function buildProposalPdf(
  request: Json,
  options: PdfOptions = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const sansBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);

  const pub = (request.public_snapshot ?? {}) as Json;
  const internal = (request.internal_snapshot ?? {}) as Json;
  const configuration = (request.configuration ?? {}) as Json;
  const terms = (request.proposal_terms ?? {}) as Json;
  const portions = (internal.portions ?? {}) as Record<string, number>;
  const drinks = (internal.drinks ?? {}) as Record<string, number>;
  const foodStyle = String(internal.foodStyle ?? configuration.foodStyle ?? "");
  const beverageMode = String(
    internal.beverageMode ?? configuration.beverageMode ?? "",
  );

  const code = safe(request.public_code);
  const version = Number(request.proposal_version) || 1;
  const guests = Number(request.guests) || 0;
  const children = Number(request.children) || 0;
  const duration = Number(request.duration_hours) || BASE_HOURS;
  const startText = safe(request.start_time).slice(0, 5);
  const startMinutes = Number(startText.slice(0, 2)) * 60 +
    Number(startText.slice(3, 5));
  const endMinutes = startMinutes + duration * 60;
  const eventDate = parseDate(request.event_date);
  const issued = parseDate(request.proposal_generated_at) ?? new Date();
  const validityDays = Number(terms.validityDays) || 5;
  const depositPercent = Number(terms.depositPercent ?? 20);
  const balanceDays = Number(terms.balanceDaysBefore ?? 7);
  const cardPercent = Number(terms.cardSurchargePercent ?? 10);
  const total = Number(pub.total) || 0;
  const perPerson = Number(pub.pricePerPerson) || 0;
  const deposit = Math.round(total * depositPercent) / 100;
  const balance = Math.round((total - deposit) * 100) / 100;
  const balanceDate = eventDate ? addDays(eventDate, -balanceDays) : null;
  const confirmDate = eventDate ? addDays(eventDate, -7) : null;
  const validUntil = addDays(issued, validityDays);
  const drinksIncluded = Object.keys(drinks).length > 0 &&
    beverageMode !== "individual";
  const eventDateText = eventDate
    ? `${WEEKDAYS[eventDate.getUTCDay()]}, ${dateLong(eventDate)}`
    : safe(request.event_date);
  const scheduleText = `${clock(startMinutes)} às ${clock(endMinutes)} · ${
    plural(duration, "hora", "horas")
  }`;

  // Fotos
  const load = options.loadImage ?? defaultLoadImage;
  const images = new Map<string, PDFImage>();
  const wanted = new Set<string>([
    "pordosol-1200.jpg",
    "mesa-cheia-vista-mar-sir-fisher-660.jpg",
    "clientes-fim-de-tarde-sir-fisher-660.jpg",
    "logo-horizontal.png",
  ]);
  for (const key of Object.keys(portions)) {
    if (PHOTOS[key]) wanted.add(PHOTOS[key]);
  }
  await Promise.all([...wanted].map(async (file) => {
    const bytes = await load(file);
    if (!bytes) return;
    try {
      images.set(
        file,
        file.endsWith(".png")
          ? await pdf.embedPng(bytes)
          : await pdf.embedJpg(bytes),
      );
    } catch {
      // imagem inválida: segue sem ela
    }
  }));

  // Primitivas de desenho
  const tracked = (
    page: PDFPage,
    text: string,
    x: number,
    y: number,
    size: number,
    font: PDFFont,
    color: Color,
    spacing: number,
  ) => {
    page.pushOperators(setCharacterSpacing(spacing));
    page.drawText(safe(text), { x, y, size, font, color });
    page.pushOperators(setCharacterSpacing(0));
  };
  const trackedWidth = (
    text: string,
    size: number,
    font: PDFFont,
    spacing: number,
  ) =>
    font.widthOfTextAtSize(safe(text), size) +
    spacing * Math.max(0, safe(text).length - 1);
  const centered = (
    page: PDFPage,
    text: string,
    y: number,
    size: number,
    font: PDFFont,
    color: Color,
    spacing = 0,
  ) =>
    tracked(
      page,
      text,
      (W - trackedWidth(text, size, font, spacing)) / 2,
      y,
      size,
      font,
      color,
      spacing,
    );
  const photo = (
    page: PDFPage,
    file: string,
    x: number,
    y: number,
    w: number,
    h: number,
    fallback: Color = C.sand,
  ) => {
    const image = images.get(file);
    if (!image) {
      page.drawRectangle({ x, y, width: w, height: h, color: fallback });
      return;
    }
    const scale = Math.max(w / image.width, h / image.height);
    const iw = image.width * scale;
    const ih = image.height * scale;
    page.pushOperators(
      pushGraphicsState(),
      rectangle(x, y, w, h),
      clip(),
      endPath(),
    );
    page.drawImage(image, {
      x: x + (w - iw) / 2,
      y: y + (h - ih) / 2,
      width: iw,
      height: ih,
    });
    page.pushOperators(popGraphicsState());
  };
  const logo = (page: PDFPage, cx: number, y: number, width: number) => {
    const image = images.get("logo-horizontal.png");
    if (image) {
      const height = width * image.height / image.width;
      page.drawImage(image, { x: cx - width / 2, y, width, height });
      return height;
    }
    centered(page, "SIR FISHER", y + 8, 22, serifBold, C.navy, 4);
    return 30;
  };

  // ---------- Capa ----------
  const cover = pdf.addPage([W, H]);
  cover.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.cream });
  const photoBottom = 360;
  photo(cover, "pordosol-1200.jpg", 0, photoBottom, W, H - photoBottom, C.navy);
  for (let i = 0; i < 12; i++) {
    cover.drawRectangle({
      x: 0,
      y: photoBottom + i * 9,
      width: W,
      height: 9,
      color: C.deep,
      opacity: 0.5 * (1 - i / 12),
    });
  }
  cover.drawRectangle({
    x: 0,
    y: H - 70,
    width: W,
    height: 70,
    color: C.deep,
    opacity: 0.35,
  });
  tracked(
    cover,
    "SIR FISHER · BEIRA-MAR · FORTALEZA",
    M,
    H - 42,
    8,
    sansBold,
    C.goldSoft,
    2.4,
  );
  const tag = `PROPOSTA ${code}`;
  tracked(
    cover,
    tag,
    W - M - trackedWidth(tag, 8, sansBold, 1.6),
    H - 42,
    8,
    sansBold,
    C.goldSoft,
    1.6,
  );
  tracked(
    cover,
    "Um encontro à beira-mar,",
    M,
    photoBottom + 64,
    30,
    serifItalic,
    C.white,
    0,
  );
  tracked(
    cover,
    "preparado para o seu grupo.",
    M,
    photoBottom + 30,
    30,
    serifItalic,
    C.white,
    0,
  );
  cover.drawRectangle({
    x: 0,
    y: photoBottom - 3,
    width: W,
    height: 3,
    color: C.gold,
  });

  logo(cover, W / 2, 262, 190);
  centered(cover, "PROPOSTA DE EVENTO", 228, 9, sansBold, C.coral, 3.2);
  const clientName = safe(request.customer_name);
  const nameSize = serif.widthOfTextAtSize(clientName, 30) > CW ? 22 : 30;
  centered(cover, clientName, 190, nameSize, serif, C.navy);
  centered(cover, safe(pub.name), 166, 11, serifItalic, C.muted);
  cover.drawLine({
    start: { x: W / 2 - 40, y: 150 },
    end: { x: W / 2 + 40, y: 150 },
    thickness: 0.8,
    color: C.gold,
  });
  const facts = [
    ["DATA", eventDate ? dateShort(eventDate) : "-"],
    ["HORÁRIO", `${clock(startMinutes)} às ${clock(endMinutes)}`],
    ["CONVIDADOS", String(guests)],
    ["INVESTIMENTO", money(total)],
  ];
  const colW = CW / facts.length;
  facts.forEach(([label, value], index) => {
    const cx = M + colW * index + colW / 2;
    tracked(
      cover,
      label,
      cx - trackedWidth(label, 7, sansBold, 1.6) / 2,
      118,
      7,
      sansBold,
      C.gold,
      1.6,
    );
    const size = 15;
    cover.drawText(safe(value), {
      x: cx - serif.widthOfTextAtSize(safe(value), size) / 2,
      y: 98,
      size,
      font: serif,
      color: C.navy,
    });
    if (index > 0) {
      cover.drawLine({
        start: { x: M + colW * index, y: 92 },
        end: { x: M + colW * index, y: 128 },
        thickness: 0.5,
        color: C.line,
      });
    }
  });
  centered(
    cover,
    `Emitida em ${dateShort(issued)} · válida até ${
      dateShort(validUntil)
    } · versão ${version}`,
    56,
    7.5,
    sans,
    C.muted,
  );
  centered(cover, COMPANY.address, 42, 7.5, sans, C.muted);

  // ---------- Páginas internas ----------
  let page: PDFPage = cover;
  let y = 0;
  const top = H - 92;
  const bottom = 70;

  const newPage = () => {
    page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.cream });
    tracked(page, "SIR FISHER", M, H - 44, 10, serifBold, C.navy, 3);
    const right = "PROPOSTA DE EVENTO";
    tracked(
      page,
      right,
      W - M - trackedWidth(right, 7, sansBold, 1.8),
      H - 43,
      7,
      sansBold,
      C.muted,
      1.8,
    );
    page.drawLine({
      start: { x: M, y: H - 56 },
      end: { x: W - M, y: H - 56 },
      thickness: 0.6,
      color: C.gold,
    });
    y = top;
  };
  const ensure = (height: number) => {
    if (y - height < bottom) newPage();
  };
  const text = (
    value: string,
    o: {
      size?: number;
      font?: PDFFont;
      color?: Color;
      x?: number;
      width?: number;
      leading?: number;
      gap?: number;
    } = {},
  ) => {
    const size = o.size ?? 9.5;
    const font = o.font ?? sans;
    const leading = o.leading ?? size * 1.45;
    const lines = wrap(value, font, size, o.width ?? CW - ((o.x ?? M) - M));
    ensure(Math.min(lines.length, 3) * leading);
    for (const line of lines) {
      ensure(leading);
      page.drawText(line, {
        x: o.x ?? M,
        y: y - size,
        size,
        font,
        color: o.color ?? C.ink,
      });
      y -= leading;
    }
    y -= o.gap ?? 0;
  };
  const measure = (
    value: string,
    size: number,
    font: PDFFont,
    width: number,
    leading = size * 1.45,
  ) => wrap(value, font, size, width).length * leading;
  const section = (eyebrow: string, title: string) => {
    ensure(90);
    y -= 6;
    tracked(page, eyebrow.toUpperCase(), M, y - 8, 7.5, sansBold, C.coral, 2.2);
    y -= 20;
    page.drawText(safe(title), {
      x: M,
      y: y - 24,
      size: 25,
      font: serif,
      color: C.navy,
    });
    y -= 40;
  };
  const subhead = (title: string) => {
    ensure(40);
    y -= 4;
    page.drawText(safe(title), {
      x: M,
      y: y - 14,
      size: 14,
      font: serifBold,
      color: C.navy,
    });
    y -= 22;
  };
  const bullet = (
    value: string,
    o: { x?: number; width?: number; size?: number } = {},
  ) => {
    const x = o.x ?? M;
    const size = o.size ?? 9.3;
    const width = (o.width ?? CW) - 12;
    const lines = wrap(value, sans, size, width);
    const leading = size * 1.45;
    ensure(Math.min(lines.length, 2) * leading);
    page.drawRectangle({
      x: x + 1,
      y: y - size * 0.72,
      width: 3,
      height: 3,
      color: C.gold,
    });
    for (const line of lines) {
      ensure(leading);
      page.drawText(line, {
        x: x + 12,
        y: y - size,
        size,
        font: sans,
        color: C.ink,
      });
      y -= leading;
    }
    y -= 2.5;
  };

  // Página 2 — o evento e o cardápio
  newPage();
  section("O seu evento", "Sua experiência no Sir Fisher");
  text(
    `Olá, ${
      safe(request.customer_name).split(" ")[0]
    }! Preparamos esta proposta para receber o seu grupo com o clima do Sir Fisher: pé na areia da Beira-Mar, pôr do sol e uma cozinha que vai do fish & chips aos petiscos da casa. Nossa equipe cuida do serviço do começo ao fim, para você aproveitar com os seus convidados.`,
    { size: 10.5, font: serif, color: C.ink, leading: 15.5, gap: 12 },
  );

  const cards = [
    ["DATA", eventDateText],
    ["HORÁRIO", scheduleText],
    [
      "CONVIDADOS",
      `${guests} pessoas${children ? ` (${children} crianças)` : ""}`,
    ],
    ["LOCAL", "Sir Fisher Praia · Av. Beira-Mar, 3421"],
  ];
  const cardW = (CW - 10) / 2;
  const cardH = 48;
  ensure(cardH * 2 + 20);
  cards.forEach(([label, value], index) => {
    const cx = M + (index % 2) * (cardW + 10);
    const cy = y - Math.floor(index / 2) * (cardH + 8) - cardH;
    page.drawRectangle({
      x: cx,
      y: cy,
      width: cardW,
      height: cardH,
      color: C.white,
      borderColor: C.line,
      borderWidth: 0.6,
    });
    page.drawRectangle({
      x: cx,
      y: cy,
      width: 2.5,
      height: cardH,
      color: C.gold,
    });
    tracked(page, label, cx + 14, cy + cardH - 17, 6.8, sansBold, C.gold, 1.6);
    const lines = wrap(value, serif, 12, cardW - 24);
    page.drawText(lines[0] ?? "", {
      x: cx + 14,
      y: cy + 12,
      size: 12,
      font: serif,
      color: C.navy,
    });
  });
  y -= cardH * 2 + 8 + 22;

  subhead(safe(pub.name) || "Cardápio");
  if (pub.description) text(safe(pub.description), { color: C.muted, gap: 2 });
  if (pub.summary) {
    text(safe(pub.summary), {
      font: serifItalic,
      size: 10.5,
      color: C.navy,
      gap: 8,
    });
  }

  // Grade de pratos com foto
  const foodKeys = Object.keys(portions);
  if (foodKeys.length) {
    const cols = 4;
    const gap = 10;
    const tileW = (CW - gap * (cols - 1)) / cols;
    const imgH = 70;
    for (let start = 0; start < foodKeys.length; start += cols) {
      const row = foodKeys.slice(start, start + cols).map((key) => {
        const item = ITEMS[key] ?? LEGACY_ITEMS[key] ??
          { name: key.replaceAll("_", " "), detail: "", unit: "porções" };
        const qty = Number(portions[key]) || 0;
        const unitsPer =
          (ITEMS[key] as { unitsPerPortion?: number } | undefined)
            ?.unitsPerPortion;
        const quantity = unitsPer
          ? `${qty} porções · ${qty * unitsPer} ${item.unit}`
          : `${qty} ${item.unit}`;
        return { key, item, quantity };
      });
      const rowH = imgH + 16 + Math.max(...row.map(({ item }) =>
        measure(item.name, 10.5, serifBold, tileW - 4, 13) +
        measure(item.detail, 7.6, sans, tileW - 4, 10.2)
      )) + 26;
      ensure(rowH);
      row.forEach(({ key, item, quantity }, index) => {
        const x = M + index * (tileW + gap);
        let ty = y;
        photo(page, PHOTOS[key] ?? "", x, ty - imgH, tileW, imgH);
        ty -= imgH + 12;
        for (const line of wrap(item.name, serifBold, 10.5, tileW - 4)) {
          page.drawText(line, {
            x,
            y: ty - 9,
            size: 10.5,
            font: serifBold,
            color: C.navy,
          });
          ty -= 13;
        }
        for (const line of wrap(item.detail, sans, 7.6, tileW - 4)) {
          page.drawText(line, {
            x,
            y: ty - 7,
            size: 7.6,
            font: sans,
            color: C.muted,
          });
          ty -= 10.2;
        }
        page.drawText(safe(quantity), {
          x,
          y: ty - 10,
          size: 7.8,
          font: sansBold,
          color: C.coral,
        });
      });
      y -= rowH + 4;
    }
  } else if (Array.isArray(pub.mainFoods)) {
    for (const food of pub.mainFoods as unknown[]) bullet(safe(food));
  }
  text(
    "Quantidades totais dimensionadas para o número de convidados desta proposta. Serviço volante: os garçons circulam oferecendo os itens à medida que saem da cozinha.",
    { size: 8, color: C.muted, gap: 6 },
  );
  if (foodStyle === "petiscos_principal") {
    text(
      `Lanches: informe até ${
        confirmDate ? dateShort(confirmDate) : "7 dias antes"
      } quantos convidados preferem Edimburger, Fisher Burger ou Fish & Chips.`,
      { size: 8.5, font: sansBold, color: C.navy, gap: 6 },
    );
  }
  if (foodStyle === "refeicao") {
    text(
      `Pratos principais: informe até ${
        confirmDate ? dateShort(confirmDate) : "7 dias antes"
      } as duas proteínas escolhidas.`,
      { size: 8.5, font: sansBold, color: C.navy, gap: 6 },
    );
  }

  // Bebidas
  y -= 8;
  const drinkLines = Object.entries(drinks).filter(() => drinksIncluded);
  const drinkPhotoW = drinksIncluded ? 150 : 0;
  const drinkWidth = CW - (drinkPhotoW ? drinkPhotoW + 20 : 0);
  const beverageText = safe(pub.beverageDetail) || safe(pub.beverageLabel);
  const blockH = drinksIncluded
    ? Math.max(
      110,
      20 + measure(beverageText, 9.5, sans, drinkWidth) +
        drinkLines.length * 15 + 30,
    )
    : 20 + measure(beverageText, 9.5, sans, drinkWidth);
  ensure(blockH + 34);
  subhead("Bebidas");
  const blockTop = y;
  if (drinkPhotoW) {
    photo(
      page,
      "mesa-cheia-vista-mar-sir-fisher-660.jpg",
      W - M - drinkPhotoW,
      blockTop - blockH,
      drinkPhotoW,
      blockH,
    );
  }
  page.drawText(safe(pub.beverageLabel), {
    x: M,
    y: y - 12,
    size: 11.5,
    font: serifBold,
    color: C.navy,
  });
  y -= 20;
  text(beverageText, { width: drinkWidth, color: C.ink, gap: 6 });
  for (const [key, qty] of drinkLines) {
    page.drawText(safe(DRINKS[key] ?? key.replaceAll("_", " ")), {
      x: M,
      y: y - 9,
      size: 9,
      font: sans,
      color: C.ink,
    });
    const qtyText = `${Number(qty)} un.`;
    page.drawText(qtyText, {
      x: M + drinkWidth - sansBold.widthOfTextAtSize(qtyText, 9),
      y: y - 9,
      size: 9,
      font: sansBold,
      color: C.navy,
    });
    page.drawLine({
      start: { x: M, y: y - 13 },
      end: { x: M + drinkWidth, y: y - 13 },
      thickness: 0.4,
      color: C.line,
    });
    y -= 15;
  }
  if (drinksIncluded) {
    text(
      "Servidas durante o horário do evento. Bebidas alcoólicas somente para maiores de 18 anos.",
      { size: 7.8, width: drinkWidth, color: C.muted },
    );
  }
  y = Math.min(y, blockTop - blockH) - 18;

  // Foto de ambiente para fechar a página, quando houver espaço
  const room = y - bottom - 10;
  if (room > 170 && images.has("clientes-fim-de-tarde-sir-fisher-660.jpg")) {
    const bandH = Math.min(room, 300);
    photo(
      page,
      "clientes-fim-de-tarde-sir-fisher-660.jpg",
      M,
      y - bandH,
      CW,
      bandH,
    );
    page.drawRectangle({
      x: M,
      y: y - bandH,
      width: CW,
      height: 64,
      color: C.deep,
      opacity: 0.55,
    });
    page.drawText("Pé na areia, brisa do mar e o pôr do sol da Beira-Mar.", {
      x: M + 22,
      y: y - bandH + 36,
      size: 15,
      font: serifItalic,
      color: C.white,
    });
    tracked(
      page,
      "O CENÁRIO DO SEU EVENTO",
      M + 22,
      y - bandH + 18,
      7,
      sansBold,
      C.goldSoft,
      2,
    );
    y -= bandH + 10;
  }

  // Investimento
  newPage();
  section("Investimento", "Valores e forma de pagamento");
  const menuValue = Number(pub.menuValueTotal) || 0;
  const saving = menuValue > total ? menuValue - total : 0;
  const savingPct = saving ? Math.round((saving / menuValue) * 100) : 0;
  const panelH = saving ? 150 : 128;
  ensure(panelH + 10);
  const py = y - panelH;
  page.drawRectangle({ x: M, y: py, width: CW, height: panelH, color: C.navy });
  page.drawRectangle({
    x: M + 8,
    y: py + 8,
    width: CW - 16,
    height: panelH - 16,
    borderColor: C.gold,
    borderWidth: 0.6,
    opacity: 0,
  });
  tracked(
    page,
    "VALOR POR PESSOA",
    M + 30,
    py + panelH - 38,
    7.5,
    sansBold,
    C.goldSoft,
    2,
  );
  page.drawText(money(perPerson), {
    x: M + 30,
    y: py + panelH - 74,
    size: 32,
    font: serif,
    color: C.white,
  });
  tracked(
    page,
    "TOTAL DO EVENTO",
    M + CW / 2 + 10,
    py + panelH - 38,
    7.5,
    sansBold,
    C.goldSoft,
    2,
  );
  page.drawText(money(total), {
    x: M + CW / 2 + 10,
    y: py + panelH - 74,
    size: 32,
    font: serif,
    color: C.white,
  });
  page.drawLine({
    start: { x: M + CW / 2, y: py + (saving ? 70 : 44) },
    end: { x: M + CW / 2, y: py + panelH - 24 },
    thickness: 0.5,
    color: C.gold,
  });
  page.drawText(
    safe(
      `${guests} convidados · ${
        plural(duration, "hora", "horas")
      } · atendimento e taxa de serviço incluídos`,
    ),
    {
      x: M + 30,
      y: py + 24,
      size: 9,
      font: sans,
      color: C.goldSoft,
    },
  );
  if (saving) {
    const savingText = `Você economiza ${
      money(saving)
    } (${savingPct}%) em relação ao cardápio`;
    page.drawRectangle({
      x: M + 30,
      y: py + 40,
      width: sansBold.widthOfTextAtSize(savingText, 9.5) + 20,
      height: 20,
      color: C.gold,
    });
    page.drawText(savingText, {
      x: M + 40,
      y: py + 46.5,
      size: 9.5,
      font: sansBold,
      color: C.deep,
    });
  }
  y = py - 18;

  const rows: Array<[string, string, string]> = [];
  if (saving) {
    rows.push([
      "Condição de evento",
      `Pedindo os mesmos itens${
        duration > BASE_HOURS ? " e horas" : ""
      } no cardápio: ${money(menuValue)}`,
      `- ${money(saving)} (${savingPct}%)`,
    ]);
  }
  rows.push(
    [
      `Sinal (${depositPercent}%)`,
      "Na assinatura do contrato, para reservar a data",
      money(deposit),
    ],
    [
      "Saldo",
      balanceDate
        ? `Até ${dateShort(balanceDate)} (${balanceDays} dias antes do evento)`
        : `Até ${balanceDays} dias antes do evento`,
      money(balance),
    ],
    [
      "Cartão de crédito",
      `Acréscimo de ${cardPercent}% sobre o valor pago no cartão`,
      `${money(total * (1 + cardPercent / 100))} se tudo no cartão`,
    ],
  );
  if (duration > BASE_HOURS) {
    rows.push([
      "Duração",
      `Inclui ${
        plural(duration - BASE_HOURS, "hora", "horas")
      } além das ${BASE_HOURS} horas-base`,
      "já incluído",
    ]);
  }
  for (const [label, detail, value] of rows) {
    ensure(34);
    page.drawText(safe(label), {
      x: M,
      y: y - 12,
      size: 11,
      font: serifBold,
      color: C.navy,
    });
    page.drawText(safe(detail), {
      x: M,
      y: y - 25,
      size: 8.3,
      font: sans,
      color: C.muted,
    });
    page.drawText(safe(value), {
      x: W - M - sansBold.widthOfTextAtSize(safe(value), 10),
      y: y - 14,
      size: 10,
      font: sansBold,
      color: C.navy,
    });
    page.drawLine({
      start: { x: M, y: y - 33 },
      end: { x: W - M, y: y - 33 },
      thickness: 0.5,
      color: C.line,
    });
    y -= 37;
  }

  y -= 4;
  const payH = 86;
  ensure(payH + 8);
  page.drawRectangle({
    x: M,
    y: y - payH,
    width: CW,
    height: payH,
    color: C.sand,
  });
  tracked(
    page,
    "DADOS PARA PAGAMENTO",
    M + 18,
    y - 22,
    7.5,
    sansBold,
    C.coral,
    2,
  );
  page.drawText(safe(COMPANY.name), {
    x: M + 18,
    y: y - 40,
    size: 9.5,
    font: sansBold,
    color: C.navy,
  });
  page.drawText(safe(`PIX (CNPJ): ${COMPANY.cnpj}`), {
    x: M + 18,
    y: y - 54,
    size: 9.5,
    font: sans,
    color: C.ink,
  });
  page.drawText(safe(COMPANY.bank), {
    x: M + 18,
    y: y - 67,
    size: 9.5,
    font: sans,
    color: C.ink,
  });
  page.drawText(
    "Pagamentos só são válidos na conta acima. Mudança de dados bancários é sempre confirmada por escrito.",
    { x: M + 18, y: y - 79, size: 7.3, font: sans, color: C.muted },
  );
  y -= payH + 16;

  const half = (CW - 20) / 2;
  const incl = [
    "Equipe de garçons dimensionada para o grupo",
    "Preparo e reposição de todo o cardápio",
    drinksIncluded
      ? "Bebidas nas quantidades desta proposta"
      : "Comandas individuais para as bebidas",
    "Mesas, louças e estrutura do restaurante",
    "Taxa de serviço (10%)",
  ];
  const notIncl =
    (Array.isArray(pub.notIncluded) ? pub.notIncluded as unknown[] : []).map(
      safe,
    );
  const listH = Math.max(incl.length, notIncl.length) * 15 + 30;
  ensure(listH);
  const startY = y;
  page.drawText("Está incluído", {
    x: M,
    y: y - 12,
    size: 12,
    font: serifBold,
    color: C.navy,
  });
  y -= 22;
  for (const item of incl) bullet(item, { width: half });
  const leftEnd = y;
  y = startY;
  page.drawText("Não está incluído", {
    x: M + half + 20,
    y: y - 12,
    size: 12,
    font: serifBold,
    color: C.navy,
  });
  y -= 22;
  for (const item of notIncl) bullet(item, { x: M + half + 20, width: half });
  y = Math.min(y, leftEnd) - 10;
  const additions =
    (Array.isArray(pub.additions) ? pub.additions as unknown[] : []).map(safe);
  if (additions.length) {
    subhead("Sob consulta");
    for (const item of additions) bullet(item);
  }
  if (safe(terms.additionalNotes)) {
    subhead("Observações");
    text(safe(terms.additionalNotes));
  }

  // Condições
  newPage();
  section("Regras do evento", "Condições para um evento tranquilo");
  const rules: Array<[string, string[]]> = [
    ["Horário e duração", [
      `O evento acontece ${
        eventDate ? `em ${dateShort(eventDate)}` : "na data combinada"
      }, das ${clock(startMinutes)} às ${
        clock(endMinutes)
      }. Depois desse horário, quem permanecer é atendido como cliente regular, sem vínculo com o contratante.`,
      `Hora adicional depende de disponibilidade e custa ${
        Math.round(EXTRA_HOUR_RATE * 100)
      }% do valor total por hora ou fração. A hora adicional não amplia as bebidas incluídas.`,
    ]],
    [
      "Bebidas",
      drinksIncluded
        ? [
          "As bebidas incluídas são servidas durante o horário do evento, nas quantidades desta proposta.",
          "O que for pedido além disso é cobrado de cada convidado em comanda individual, e nunca lançado ao contratante sem autorização por escrito.",
          "Bebida alcoólica somente para maiores de 18 anos. A equipe pode recusar o serviço a quem apresentar sinais de embriaguez ou colocar pessoas em risco.",
        ]
        : [
          "Cada convidado pede e paga as próprias bebidas em comanda individual.",
          "Bebida alcoólica somente para maiores de 18 anos. A equipe pode recusar o serviço a quem apresentar sinais de embriaguez ou colocar pessoas em risco.",
        ],
    ],
    ["Convidados", [
      `O valor considera ${guests} convidados. A lista final deve ser confirmada até ${
        confirmDate ? dateShort(confirmDate) : "7 dias antes do evento"
      }.`,
      `Convidados além do contratado dependem de estrutura e equipe e são cobrados a ${
        money(perPerson)
      } por pessoa (mais ${cardPercent}% no cartão).`,
      "Se comparecerem menos convidados, o valor contratado se mantém: insumos e equipe são preparados com antecedência para o número informado.",
    ]],
    ["Pagamento", [
      `A data fica reservada com o pagamento do sinal de ${depositPercent}%. O saldo vence ${
        balanceDate
          ? `em ${dateShort(balanceDate)}`
          : `${balanceDays} dias antes do evento`
      }.`,
      "O pagamento vale a partir da compensação na conta do Sir Fisher. Consumos extras, hora adicional e convidados excedentes são acertados ao final do evento.",
      "Valores em atraso têm multa de 2%, juros de 1% ao mês e correção pelo IGP-M. Sem o saldo no prazo, o serviço pode ser suspenso após aviso.",
    ]],
    ["Serviço e cardápio", [
      "O serviço é volante: os garçons circulam oferecendo os itens à medida que ficam prontos. Não é serviço à la carte nem atendimento individual por mesa.",
      "Produtos fora da proposta são cobrados pelo cardápio vigente. Os alimentos e bebidas do evento são para consumo no local.",
      "Avise com antecedência sobre alergias e restrições. Nossos pratos podem conter ou ter contato com glúten, lactose, crustáceos e outros alergênicos.",
    ]],
    ["Alterações, decoração e fornecedores", [
      "Mudanças de cardápio, layout, decoração, equipamentos ou fornecedores externos devem ser pedidas com 7 dias de antecedência e dependem de aprovação.",
      "A entrada de alimentos, bebidas, caixas de som, músicos, estruturas ou fornecedores externos depende de autorização prévia e das normas municipais de horário, ruído e uso da área externa.",
      "Fogos de artifício, artefatos pirotécnicos e materiais inflamáveis são proibidos.",
    ]],
    ["Espaço e clima", [
      "O Sir Fisher é um espaço ao ar livre, com ombrelones e sem área interna ou cobertura completa. Chuva que não impeça o evento com segurança não dá direito a cancelamento ou abatimento.",
      "Se o clima impedir o evento com segurança, a prioridade é reagendar. Não fornecemos tendas ou coberturas extras.",
      "Durante o evento, a equipe atende com exclusividade a área reservada. Áreas públicas e de circulação continuam de livre acesso.",
    ]],
    ["Cancelamento e reagendamento", [
      `Se o contratante cancelar, o sinal não é devolvido. Nos 30 dias anteriores ao evento, a multa é de 50% do valor total, descontados os valores já pagos.`,
      "O Sir Fisher não cancela sem justa causa nos 30 dias anteriores. Se isso acontecer, devolve integralmente os valores recebidos.",
      "Em caso fortuito ou força maior, a prioridade é reagendar, conforme disponibilidade. Sem acordo, são apurados os valores pagos e os custos já assumidos e comprovados.",
    ]],
    ["Responsabilidades", [
      "O contratante responde por danos causados por convidados e fornecedores contratados por ele, e deve avisar os convidados sobre estas regras.",
      "Bolos, decoração e objetos próprios devem ser retirados ao final. Itens deixados no local podem ser descartados após aviso.",
      "O Sir Fisher não se responsabiliza por objetos pessoais esquecidos ou por veículos estacionados em vias públicas ou estacionamentos de terceiros.",
    ]],
  ];
  rules.forEach(([title, items], index) => {
    ensure(30 + measure(items[0], 9.3, sans, CW - 42));
    const number = String(index + 1).padStart(2, "0");
    page.drawText(number, {
      x: M,
      y: y - 15,
      size: 16,
      font: serifItalic,
      color: C.gold,
    });
    page.drawText(safe(title), {
      x: M + 30,
      y: y - 14,
      size: 12.5,
      font: serifBold,
      color: C.navy,
    });
    y -= 22;
    for (const item of items) bullet(item, { x: M + 30, width: CW - 30 });
    y -= 8;
  });

  // Próximos passos e aceite
  ensure(330);
  if (y < top - 10) {
    y -= 6;
  }
  section("Próximos passos", "Como confirmar o seu evento");
  const steps = [
    [
      "Aceite",
      `Confirme esta proposta até ${
        dateShort(validUntil)
      }. Depois disso, os valores podem mudar.`,
    ],
    [
      "Contrato e sinal",
      `Enviamos o contrato. A data fica garantida com a assinatura e o sinal de ${
        money(deposit)
      }.`,
    ],
    [
      "Detalhes finais",
      `Até ${
        confirmDate ? dateShort(confirmDate) : "7 dias antes"
      }: lista de convidados, escolhas do cardápio, restrições e fornecedores.`,
    ],
    [
      "Saldo",
      `${money(balance)} até ${
        balanceDate ? dateShort(balanceDate) : `${balanceDays} dias antes`
      }.`,
    ],
    ["O grande dia", "É só chegar e aproveitar. Nossa equipe cuida do resto."],
  ];
  const stepW = CW / steps.length;
  const stepTop = y;
  let stepsBottom = y;
  steps.forEach(([title, detail], index) => {
    const x = M + index * stepW;
    page.drawCircle({
      x: x + 11,
      y: stepTop - 11,
      size: 11,
      color: index === steps.length - 1 ? C.coral : C.navy,
    });
    const n = String(index + 1);
    page.drawText(n, {
      x: x + 11 - serifBold.widthOfTextAtSize(n, 11) / 2,
      y: stepTop - 15,
      size: 11,
      font: serifBold,
      color: C.white,
    });
    if (index < steps.length - 1) {
      page.drawLine({
        start: { x: x + 26, y: stepTop - 11 },
        end: { x: x + stepW - 4, y: stepTop - 11 },
        thickness: 0.6,
        color: C.gold,
      });
    }
    let ty = stepTop - 34;
    page.drawText(safe(title), {
      x,
      y: ty - 10,
      size: 10.5,
      font: serifBold,
      color: C.navy,
    });
    ty -= 16;
    for (const line of wrap(detail, sans, 7.8, stepW - 10)) {
      page.drawText(line, {
        x,
        y: ty - 8,
        size: 7.8,
        font: sans,
        color: C.muted,
      });
      ty -= 10.5;
    }
    stepsBottom = Math.min(stepsBottom, ty);
  });
  y = stepsBottom - 26;

  ensure(150);
  page.drawRectangle({
    x: M,
    y: y - 140,
    width: CW,
    height: 140,
    color: C.white,
    borderColor: C.line,
    borderWidth: 0.6,
  });
  tracked(
    page,
    "ACEITE DA PROPOSTA",
    M + 20,
    y - 24,
    7.5,
    sansBold,
    C.coral,
    2,
  );
  const acceptTop = y;
  y -= 34;
  text(
    `Declaro que li e aceito esta proposta (${code}, versão ${version}) e as condições acima. A data só é garantida após a assinatura do contrato e o pagamento do sinal.`,
    { x: M + 20, width: CW - 40, size: 8.8, color: C.ink },
  );
  y = acceptTop;
  const signY = y - 140 + 34;
  page.drawLine({
    start: { x: M + 20, y: signY },
    end: { x: M + 20 + 220, y: signY },
    thickness: 0.6,
    color: C.muted,
  });
  page.drawLine({
    start: { x: W - M - 20 - 150, y: signY },
    end: { x: W - M - 20, y: signY },
    thickness: 0.6,
    color: C.muted,
  });
  page.drawText(safe(request.customer_name), {
    x: M + 20,
    y: signY - 13,
    size: 8.3,
    font: sans,
    color: C.muted,
  });
  page.drawText("Data", {
    x: W - M - 20 - 150,
    y: signY - 13,
    size: 8.3,
    font: sans,
    color: C.muted,
  });
  y -= 140 + 20;
  text(
    "Esta proposta resume as condições comerciais e não substitui o contrato de prestação de serviços, que será enviado para assinatura.",
    { size: 7.5, color: C.muted },
  );

  // Rodapés
  const pages = pdf.getPages();
  pages.forEach((p, index) => {
    if (index === 0) return;
    p.drawLine({
      start: { x: M, y: 46 },
      end: { x: W - M, y: 46 },
      thickness: 0.5,
      color: C.line,
    });
    p.drawText(safe(`Sir Fisher Praia · ${COMPANY.address}`), {
      x: M,
      y: 32,
      size: 7,
      font: sans,
      color: C.muted,
    });
    const label = `${code} · v${version} · ${index + 1}/${pages.length}`;
    p.drawText(label, {
      x: W - M - sans.widthOfTextAtSize(label, 7),
      y: 32,
      size: 7,
      font: sans,
      color: C.muted,
    });
  });

  pdf.setTitle(`Proposta de evento ${code}`);
  pdf.setAuthor("Sir Fisher");
  pdf.setSubject("Proposta comercial de evento");
  return await pdf.save();
}
