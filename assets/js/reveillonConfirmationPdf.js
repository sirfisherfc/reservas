// PDF para o cliente, gerado localmente após o sinal. Nenhum envio automático.
import {
  PDFDocument, StandardFonts, rgb, pushGraphicsState, popGraphicsState,
  rectangle, clip, endPath,
} from '../vendor/pdf-lib-1.17.1/pdf-lib.esm.min.js';
import { dateBR, dateTimeBR, money, pct, fillTemplate, formatPixKey } from './reveillonCommon.js';
import { canDownloadConfirmation } from './reveillonConfirmation.js';

const W = 595.28;
const H = 841.89;
const M = 44;
const CW = W - M * 2;
const C = {
  navy: rgb(.071, .161, .239), ink: rgb(.114, .169, .212),
  muted: rgb(.373, .420, .455), coral: rgb(.875, .357, .231),
  cream: rgb(.984, .969, .937), line: rgb(.890, .863, .812),
  green: rgb(.157, .451, .337), white: rgb(1, 1, 1),
};
const METHODS = { pix: 'Pix', debito: 'Débito', credito: 'Crédito' };

// Helvetica suporta WinAnsi. Preserva acentos; substitui apenas glifos ausentes.
function safe(value) {
  return String(value ?? '').normalize('NFC')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, ' ').replace(/\u00a0/g, ' ')
    .trim();
}

const amount = (value) => {
  if (value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) || Number(value) < 0) {
    throw new Error('Valores da reserva indisponíveis. Atualize a ficha antes de gerar o PDF.');
  }
  return Number(value);
};

// Projeção explícita: não copia observações internas, histórico, contatos do
// cliente, pagadores, motivos de desconto, notas de pagamentos ou usuários.
export function confirmationData(booking, event, terms) {
  if (!canDownloadConfirmation(booking)) {
    throw new Error('O PDF fica disponível depois que o sinal é registrado na reserva.');
  }
  if (!event || event.id !== booking.event_id || terms?.event_id !== booking.event_id
      || (booking.terms_id && terms.id !== booking.terms_id) || !terms?.body?.trim()) {
    throw new Error('Não foi possível conferir os dados e as regras desta reserva.');
  }
  if (!booking.public_code || !booking.customer_name || !booking.table_label
      || !event.name || !event.starts_at || !event.ends_at || !event.address) {
    throw new Error('Dados do evento incompletos. Confira a configuração antes de gerar o PDF.');
  }
  const p = booking.price || {};
  const payments = booking.payments.filter((pay) => !pay.voided_at).map((pay) => ({
    amount: amount(pay.amount), method: METHODS[pay.method] || 'Pagamento',
  }));
  const received = payments.reduce((sum, pay) => sum + pay.amount, 0);
  if (Math.abs(received - amount(p.paid_net)) > .011) {
    throw new Error('Os pagamentos mudaram. Atualize a ficha antes de gerar o PDF.');
  }
  const vars = {
    pix_discount_pct: pct(amount(booking.snap_pix_discount_pct)),
    deposit_pct: pct(amount(booking.snap_deposit_pct)),
    child_discount: money(amount(booking.snap_child_discount)),
    child_max_age: String(event.child_max_age ?? ''),
    hold_hours: String(event.hold_hours ?? ''), balance_due_date: dateBR(event.balance_due_date),
  };
  const text = (value) => safe(fillTemplate(value, vars));
  return {
    code: safe(booking.public_code), name: safe(booking.customer_name),
    table: safe(booking.table_label), tableType: safe(booking.table_type),
    adults: Number(booking.adults), children: Number(booking.children), infants: Number(booking.infants),
    total: amount(p.total), totalPix: amount(p.total_pix), received,
    balance: amount(p.balance), balancePix: amount(p.balance_pix),
    consumption: amount(p.consumption_total), childDiscount: amount(p.children_discount ?? 0),
    manualDiscount: amount(p.manual_discount ?? 0), payments,
    pixDiscount: amount(booking.snap_pix_discount_pct),
    eventName: safe(event.name), venue: safe(event.venue_name || 'Sir Fisher'),
    address: safe(event.address), timezone: event.timezone || 'America/Fortaleza',
    startsAt: event.starts_at, endsAt: event.ends_at, balanceDue: event.balance_due_date,
    pixKey: safe(formatPixKey(event.pix_key, event.pix_key_type)), pixHolder: safe(event.pix_holder),
    whatsapp: safe(event.whatsapp_number),
    included: (Array.isArray(event.included_items) ? event.included_items : []).map(text),
    menuNote: text(event.texts?.menu_note || ''),
    cardNote: text(event.texts?.card_note || ''),
    program: (Array.isArray(event.texts?.faq) ? event.texts.faq : []).map(text),
    childrenRules: (Array.isArray(event.texts?.children_rules) ? event.texts.children_rules : []).map(text),
    terms: safe(terms.body), termsVersion: terms.version,
    acceptedAt: booking.terms_accepted_at || null,
    paidInFull: booking.status === 'quitada' && amount(p.balance) === 0,
  };
}

async function loadLocalImage(file) {
  const response = await fetch(new URL(`../img/${file}`, import.meta.url), { signal: AbortSignal.timeout(8000) });
  if (!response.ok) return null;
  return new Uint8Array(await response.arrayBuffer());
}

export async function buildReveillonConfirmationPdf(booking, event, terms, options = {}) {
  const data = confirmationData(booking, event, terms);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${data.eventName} - reserva ${data.code}`);
  pdf.setAuthor('Sir Fisher');
  pdf.setSubject('Confirmação da reserva, pagamentos e regras do evento');
  const normal = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const issued = dateTimeBR(options.now || new Date().toISOString(), data.timezone, { withYear: true });
  const load = options.loadImage || loadLocalImage;
  let hero = null;
  try {
    const bytes = await load('festa-reveillon-sir-fisher-660.jpg');
    if (bytes) hero = await pdf.embedJpg(bytes);
  } catch { /* O conteúdo permanece completo se a foto não carregar. */ }

  let page;
  let y;
  const draw = (text, x, baseline, size = 10, font = normal, color = C.ink) => {
    page.drawText(safe(text), { x, y: baseline, size, font, color });
  };
  function newPage(title = 'Sua reserva') {
    page = pdf.addPage([W, H]);
    page.drawRectangle({ x: 0, y: H - 7, width: W, height: 7, color: C.coral });
    draw('SIR FISHER', M, H - 40, 16, serif, C.navy);
    draw(data.eventName, W - M - normal.widthOfTextAtSize(data.eventName, 10), H - 38, 10, normal, C.muted);
    draw(title, M, H - 76, 23, serif, C.navy);
    y = H - 103;
  }
  function ensure(height) {
    if (y - height < 58) newPage('Continuação');
  }
  function lines(text, size, font, width) {
    const result = [];
    for (const paragraph of safe(text).split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) { line = candidate; continue; }
        if (line) { result.push(line); line = ''; }
        // URLs, códigos e palavras longas nunca ultrapassam a margem.
        for (const char of word) {
          if (line && font.widthOfTextAtSize(line + char, size) > width) {
            result.push(line); line = '';
          }
          line += char;
        }
      }
      result.push(line);
    }
    return result;
  }
  function paragraph(text, { size = 10, font = normal, color = C.ink, gap = 7, indent = 0, width = CW - indent } = {}) {
    for (const line of lines(text, size, font, width)) {
      ensure(size * 1.38);
      if (line) draw(line, M + indent, y, size, font, color);
      y -= size * 1.38;
    }
    y -= gap;
  }
  function section(title) {
    ensure(52);
    y -= 6;
    draw(title, M, y, 12, bold, C.navy);
    y -= 18;
  }
  function pair(label, value) {
    paragraph(`${label}: ${value}`, { size: 10, gap: 5 });
  }

  newPage('Sua virada está confirmada');
  // Foto de festa já publicada no portal; não usa a imagem ilustrativa de fogos.
  const bannerY = y - 104;
  page.drawRectangle({ x: M, y: bannerY, width: CW, height: 104, color: C.navy });
  if (hero) {
    const x = M + CW - 210;
    const scale = Math.max(210 / hero.width, 104 / hero.height);
    page.pushOperators(pushGraphicsState(), rectangle(x, bannerY, 210, 104), clip(), endPath());
    page.drawImage(hero, { x: x + (210 - hero.width * scale) / 2, y: bannerY + (104 - hero.height * scale) / 2,
      width: hero.width * scale, height: hero.height * scale });
    page.pushOperators(popGraphicsState());
  }
  draw('RESERVA CONFIRMADA', M + 16, bannerY + 78, 9, bold, C.white);
  draw(`Mesa ${data.table}`, M + 16, bannerY + 41, 28, serif, C.white);
  const typeLines = lines(`${data.tableType} | ${data.code}`, 10, normal, 264);
  typeLines.forEach((line, i) => draw(line, M + 16, bannerY + 20 - i * 12, 10, normal, C.white));
  y = bannerY - 24;
  paragraph(data.name, { size: 16, font: serif, gap: 5 });
  paragraph(`${data.adults} adulto(s) | ${data.children} criança(s) | ${data.infants} de colo`, { color: C.muted, gap: 10 });
  pair('Evento', `${dateTimeBR(data.startsAt, data.timezone, { withYear: true })} até ${dateTimeBR(data.endsAt, data.timezone, { withYear: true })}`);
  paragraph(`${data.venue} - ${data.address}`, { size: 9.5, color: C.muted, gap: 10 });

  section('Pagamento e saldo');
  const cardHeight = 68;
  ensure(cardHeight + 15);
  page.drawRectangle({ x: M, y: y - cardHeight + 12, width: CW, height: cardHeight, color: C.cream });
  const cols = [
    ['Valor contratado', money(data.total)], ['Recebido', money(data.received)],
    [data.paidInFull ? 'Pagamento quitado' : 'Saldo no Pix', money(data.balancePix)],
  ];
  cols.forEach(([label, value], i) => {
    const x = M + 14 + i * (CW / 3);
    draw(label, x, y - 6, 9, normal, C.muted);
    draw(value, x, y - 31, 19, serif, i === 2 ? C.green : C.navy);
  });
  y -= cardHeight + 4;
  paragraph(`Total no Pix: ${money(data.totalPix)} (${pct(data.pixDiscount)}% de desconto). Saldo no débito/crédito: ${money(data.balance)}.`, { size: 9, gap: 5 });
  const byMethod = new Map();
  data.payments.forEach((p) => byMethod.set(p.method, (byMethod.get(p.method) || 0) + p.amount));
  paragraph(`Pagamento registrado: ${[...byMethod].map(([method, value]) => `${money(value)} em ${method}`).join(' + ')}.`, { size: 9, gap: 5 });
  if (data.childDiscount || data.manualDiscount) {
    paragraph(`Descontos já considerados: crianças ${money(data.childDiscount)}; outros descontos ${money(data.manualDiscount)}.`, { size: 9, gap: 5 });
  }
  if (data.balance > 0) {
    paragraph(data.balanceDue ? `Quite o saldo até ${dateBR(data.balanceDue)}.` : 'Combine o prazo do saldo com nossa equipe.', { font: bold, size: 10, color: C.coral, gap: 6 });
    if (data.pixKey) {
      paragraph(`Chave Pix: ${data.pixKey}${data.pixHolder ? ` | ${data.pixHolder}` : ''}`, { size: 8.5, gap: 4 });
    }
    paragraph('Envie o comprovante pelo WhatsApp para a equipe conferir e registrar o pagamento.', { size: 9, gap: 4 });
  }
  if (data.cardNote) paragraph(data.cardNote, { size: 8.5, color: C.muted, gap: 5 });

  section('Consumação da sua mesa');
  y -= 8;
  paragraph(money(data.consumption), { size: 21, font: serif, color: C.green, gap: 5 });
  if (data.menuNote) paragraph(data.menuNote, { size: 9.5, gap: 5 });

  section('Incluído no evento');
  data.included.forEach((item) => paragraph(`- ${item}`, { size: 9.5, gap: 3 }));
  if (data.program.length) {
    section('Para aproveitar a noite');
    data.program.forEach((item) => paragraph(item.includes(' | ') ? item.split(' | ').slice(1).join(' | ') : item,
      { size: 9, gap: 4 }));
  }

  newPage('Regras da sua reserva');
  if (data.whatsapp) pair('Atendimento pelo WhatsApp', `+${data.whatsapp.replace(/\D/g, '')}`);
  data.childrenRules.forEach((item) => paragraph(item, { size: 9, gap: 4 }));
  section(`Termos e condições - versão ${data.termsVersion}`);
  paragraph(data.acceptedAt
    ? `Aceite registrado em ${dateTimeBR(data.acceptedAt, data.timezone, { withYear: true })}.`
    : 'Condições cadastradas para o evento. Aceite não registrado no portal.',
  { size: 8, color: C.muted, gap: 8 });
  for (const block of data.terms.split(/\n\s*\n/)) {
    const firstBreak = block.indexOf('\n');
    const title = firstBreak >= 0 ? block.slice(0, firstBreak) : block;
    const isHeading = /^\d+\.\s+[A-ZÀ-Ü]/.test(title) || title.startsWith('TERMOS E CONDI');
    if (isHeading) {
      const body = firstBreak >= 0 ? block.slice(firstBreak + 1) : '';
      ensure(45);
      paragraph(title, { size: 9, font: bold, gap: 3 });
      if (body) paragraph(body, { size: 9, gap: 5 });
    } else {
      paragraph(block, { size: 9, gap: 5 });
    }
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    page = p;
    p.drawLine({ start: { x: M, y: 43 }, end: { x: W - M, y: 43 }, thickness: .5, color: C.line });
    draw(`${data.code} | Emitido em ${issued}`, M, 29, 7.5, normal, C.muted);
    const label = `${i + 1} / ${pages.length}`;
    draw(label, W - M - normal.widthOfTextAtSize(label, 8), 29, 8, normal, C.muted);
  });
  return pdf.save();
}
