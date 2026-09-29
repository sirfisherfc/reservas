export type FoodStyle =
  | "petiscos"
  | "petiscos_principal"
  | "refeicao"
  | "recomendacao";
export type BeverageMode =
  | "individual"
  | "sem_alcool"
  | "chope"
  | "chope_coquetel";
export type Profile = "essencial" | "equilibrada" | "completa" | "comparar";
export type RiskLevel = "verde" | "amarelo" | "vermelho";

export interface QuoteInput {
  date: string;
  startTime: string;
  durationHours: number;
  guests: number;
  children?: number;
  foodStyle: FoodStyle;
  beverageMode: BeverageMode;
  profile: Profile;
  budgetPerPerson?: number | null;
  dietaryRestriction?: boolean;
  exclusive?: boolean;
}

export interface LiveSignals {
  blocked?: boolean;
  reservationConflict?: boolean;
  capacityExceeded?: boolean;
  nearCapacity?: boolean;
  opportunityCostTotal?: number | null;
  comparableRevenueMedian?: number | null;
  comparableRevenueLow?: number | null;
  comparableRevenueHigh?: number | null;
  demandDataAvailable?: boolean;
  availabilityUnverified?: boolean;
  /** Faturamento esperado do salão na janela do evento (histórico dia da semana × hora, ajustado pelo mês). */
  expectedWindowRevenue?: number | null;
  /** Movimento da janela ÷ hora mais movimentada da semana (0 a 1), já ajustado pelo mês. */
  demandIndex?: number | null;
  /** Faturamento médio do mês do evento ÷ média dos meses. */
  monthFactor?: number | null;
  /** Capacidade de pessoas do salão. */
  capacity?: number | null;
  /** CMV real médio dos últimos meses (0 a 1). */
  realCmvRate?: number | null;
  /** Por que o histórico por hora não foi usado, quando não foi. */
  demandNote?: string | null;
}

export interface PricingOverrides {
  versionCode: string;
  cmvRate: number;
  serviceRate: number;
  targetContributionMargin: number;
  freelancerDay: number;
  packages?: Array<{
    foodStyle: FoodKey;
    profile: ProfileKey;
    foodUnitsPerPerson: number;
    retailPerPerson: number;
    kitchenLaborPerPerson: number;
    composition: Record<string, number>;
  }>;
  beverages?: Array<{
    mode: BeverageKey;
    retailPerAdult: number;
    retailPerGuest?: number;
    unitsPerAdult: number;
    wasteRisk: number;
    needsValidation: boolean;
    composition: Record<string, unknown>;
  }>;
}

export interface MenuItem {
  name: string;
  detail: string;
}

export interface PublicOption {
  id: string;
  name: string;
  description: string;
  summary: string;
  mainFoods: string[];
  menuItems: MenuItem[];
  beverageLabel: string;
  beverageDetail: string;
  durationHours: number;
  pricePerPerson: number;
  total: number;
  /** Quanto os mesmos itens custariam no cardápio, com os 10%. */
  menuValueTotal: number;
  serviceIncluded: true;
  additions: string[];
  notIncluded: string[];
  exact: boolean;
  validationMessage: string;
  riskLevel: RiskLevel;
}

export interface InternalOption extends PublicOption {
  foodStyle: FoodKey;
  beverageMode: BeverageKey;
  profile: ProfileKey;
  adults: number;
  foodUnitsPerPerson: number;
  drinkUnitsPerAdult: number;
  portions: Record<string, number>;
  drinks: Record<string, number>;
  freelancerCount: number;
  extraHours: number;
  estimatedCmvTotal: number;
  estimatedContributionMargin: number;
  menuEquivalentTotal: number;
  durationSurchargeTotal: number;
  /** Piso de custo: nunca cobrar abaixo disso. */
  technicalMinimumTotal: number;
  opportunityFloorTotal: number | null;
  listPriceTotal: number;
  discountTarget: number;
  discountApplied: number;
  discountBreakdown: Record<DiscountKey, number>;
  demandIndex: number;
  demandSource: "historico" | "estimativa";
  monthFactor: number;
  expectedWindowRevenue: number | null;
  cmvRateUsed: number;
  priceDriver: "desconto" | "custo" | "oportunidade";
  alerts: string[];
  pricingVersion: string;
  menuVersion: string;
}

export interface QuoteResult {
  options: PublicOption[];
  internal: InternalOption[];
  requestRiskLevel: RiskLevel;
}

export const PRICING_VERSION = "eventos-2026-09-v2";
const MENU_VERSION = "cardapio-1-2026-09-22";
const CMV_RATE = 0.35;
const SERVICE_RATE = 0.10;
/** Margem mínima de contribuição: o piso de custo garante pelo menos isso. */
const MIN_CONTRIBUTION_MARGIN = 0.35;
/** Abaixo desta margem o pedido fica amarelo. */
const MARGIN_ALERT = 0.45;
const FREELANCER_DAY = 100;
/** Duração incluída em todos os pacotes. */
export const BASE_HOURS = 3;
/** Cada hora além da base acrescenta este percentual ao valor do evento (mesma regra da hora extra do contrato). */
export const EXTRA_HOUR_RATE = 0.10;

export type DiscountKey = "antecipado" | "volume" | "horario" | "cardapio";
/** Descontos sobre o valor de cardápio. Provisórios: recalibrar com eventos reais. */
export const DISCOUNT = {
  /** Pagamento antecipado e quantidade fechada, com risco de sobra do cliente. */
  antecipado: 0.05,
  /** Por número de convidados: [mínimo, desconto]. */
  volume: [[30, 0.03], [41, 0.06], [61, 0.08], [81, 0.10]] as Array<
    [number, number]
  >,
  /** Máximo por horário vazio; cai até zero no horário mais movimentado. */
  horarioMax: 0.10,
  /** Formatos produzidos em lote custam menos para a cozinha. */
  cardapio: { petiscos: 0.03, petiscos_principal: 0.02, refeicao: 0 } as Record<
    string,
    number
  >,
  teto: 0.25,
};

/**
 * Movimento esperado (0 a 1) quando ainda não há histórico: sexta e sábado à
 * noite e domingo de dia são os horários fortes da casa.
 */
export function estimatedDemandIndex(
  isoWeekday: number,
  startHour: number,
  durationHours: number,
): number {
  const hours = Array.from(
    { length: Math.max(1, Math.ceil(durationHours)) },
    (_, i) => (startHour + i) % 24,
  );
  const hourIndex = (h: number) => {
    const night = h >= 17 && h <= 22;
    const lunch = h >= 11 && h <= 15;
    if ((isoWeekday === 5 || isoWeekday === 6) && night) return 0.9;
    if (isoWeekday === 7 && (lunch || h === 16)) return 0.8;
    if (isoWeekday === 6 && lunch) return 0.65;
    if (isoWeekday === 7 && night) return 0.5;
    if (isoWeekday === 4 && night) return 0.55;
    if (night) return 0.4;
    if (lunch) return 0.35;
    return 0.2;
  };
  return hours.reduce((sum, h) => sum + hourIndex(h), 0) / hours.length;
}

type ProfileKey = Exclude<Profile, "comparar">;
type FoodKey = Exclude<FoodStyle, "recomendacao">;
type BeverageKey = BeverageMode;

/**
 * Preço de cardápio (R$) de uma porção de cada componente, versão `MENU_VERSION`.
 * "lanche" é a média entre Edimburger (37), Fisher Burger (37) e Fish & Chips (45).
 * "travessa_*" é o prato para compartilhar mais caro liberado naquele perfil.
 */
export const MENU_PRICES: Record<string, number> = {
  pasteizinhos: 37,
  bolinha_peixe: 44,
  crocante_carne_sol: 38,
  crocantes: 38,
  dadinho_tapioca: 29,
  crispy_chicken: 37,
  newcastle: 60,
  isca_peixe: 42,
  lanche: 39.67,
  travessa_essencial: 80,
  travessa_equilibrada: 88,
  travessa_completa: 99,
  brownie: 10,
  brownie_sorvete: 18,
  agua: 5,
  refrigerante: 8,
  suco: 11,
  chope: 10.9,
  coquetel: 20,
};

/** Descrição pública e equivalência em unidades de cada componente. */
export const ITEMS: Record<
  string,
  { name: string; detail: string; unitsPerPortion?: number; unit: string }
> = {
  pasteizinhos: {
    name: "Pasteizinhos",
    detail:
      "Pastéis crocantes com molho especial (2 queijos, carne ou camarão).",
    unitsPerPortion: 10,
    unit: "pastéis",
  },
  bolinha_peixe: {
    name: "Bolinha de peixe cremosa",
    detail: "Bolinhas de pescada amarela com recheio de cream cheese.",
    unitsPerPortion: 6,
    unit: "bolinhas",
  },
  crocante_carne_sol: {
    name: "Crocante de carne de sol",
    detail: "Bolinhos em massa de abóbora com recheio cremoso de carne de sol.",
    unitsPerPortion: 6,
    unit: "bolinhos",
  },
  crocantes: {
    name: "Crocantes da casa",
    detail:
      "Bolinhos de carne de sol com abóbora e de calabresa com alho-poró.",
    unitsPerPortion: 6,
    unit: "bolinhos",
  },
  dadinho_tapioca: {
    name: "Dadinho de tapioca",
    detail: "Crocante por fora, macio por dentro, com molho especial.",
    unitsPerPortion: 12,
    unit: "dadinhos",
  },
  crispy_chicken: {
    name: "Crispy Spicy Chicken",
    detail: "Rolinhos de frango empanados recheados com queijo.",
    unit: "porções de 200 g",
  },
  newcastle: {
    name: "NewCastle",
    detail: "Camarões empanados no panko, com batatas.",
    unit: "porções de 250 g",
  },
  isca_peixe: {
    name: "Isca de peixe",
    detail: "Tiras de pescada amarela empanadas no panko, com molho especial.",
    unit: "porções de 250 g",
  },
  lanche: {
    name: "Lanche individual",
    detail:
      "1 por convidado, à escolha: Edimburger (blend bovino de 120 g, bacon e cheddar), Fisher Burger (pescada amarela empanada) ou Fish & Chips (pescada no panko com batatas).",
    unit: "lanches",
  },
  travessa_essencial: {
    name: "Prato principal para compartilhar",
    detail:
      "Até 2 proteínas entre peito de frango com ervas, picanha suína e filé de peixe grelhado. Travessas com arroz, batata ou macaxeira, salada, farota e molho, 1 para cada 2 convidados.",
    unit: "travessas",
  },
  travessa_equilibrada: {
    name: "Prato principal para compartilhar",
    detail:
      "Até 2 proteínas entre peito de frango com ervas, picanha suína, filé de peixe grelhado e carne de sol acebolada. Travessas com arroz, batata ou macaxeira, salada, farota e molho, 1 para cada 2 convidados.",
    unit: "travessas",
  },
  travessa_completa: {
    name: "Prato principal para compartilhar",
    detail:
      "Até 2 proteínas entre filé de peixe grelhado, carne de sol acebolada, filé mignon e picanha importada. Travessas com arroz, batata ou macaxeira, salada, farota e molho, 1 para cada 2 convidados.",
    unit: "travessas",
  },
  brownie: {
    name: "Brownie de chocolate",
    detail: "Sobremesa individual.",
    unit: "unidades",
  },
  brownie_sorvete: {
    name: "Brownie com sorvete",
    detail: "Brownie com sorvete de creme e calda de chocolate, individual.",
    unit: "unidades",
  },
};

const FOOD_STYLE_INFO: Record<FoodKey, { label: string; description: string }> =
  {
    petiscos: {
      label: "Só petiscos",
      description:
        "Petiscos servidos por garçons circulando entre os convidados, durante todo o evento.",
    },
    petiscos_principal: {
      label: "Petiscos + lanche",
      description:
        "Petiscos circulando na recepção e, depois, um lanche individual por convidado.",
    },
    refeicao: {
      label: "Petiscos + almoço ou jantar",
      description:
        "Petiscos na recepção e pratos principais servidos em travessas para compartilhar.",
    },
  };

const PROFILE_LABEL: Record<ProfileKey, string> = {
  essencial: "Essencial",
  equilibrada: "Equilibrada",
  completa: "Completa",
};

interface FoodRule {
  profileNote: string;
  kitchenLaborPerPerson: number;
  portionsPerPerson: Record<string, number>;
}

/** Porções por convidado. 1 porção = 1 prato do cardápio. */
export const FOOD: Record<FoodKey, Record<ProfileKey, FoodRule>> = {
  petiscos: {
    essencial: {
      profileNote: "4 petiscos clássicos, cerca de 7 unidades por pessoa.",
      kitchenLaborPerPerson: 7,
      portionsPerPerson: {
        pasteizinhos: 0.2,
        bolinha_peixe: 1 / 6,
        crocante_carne_sol: 1 / 6,
        dadinho_tapioca: 0.25,
      },
    },
    equilibrada: {
      profileNote: "5 petiscos, cerca de 8 unidades por pessoa.",
      kitchenLaborPerPerson: 8,
      portionsPerPerson: {
        pasteizinhos: 0.2,
        bolinha_peixe: 1 / 6,
        crocantes: 1 / 3,
        dadinho_tapioca: 1 / 6,
        crispy_chicken: 0.125,
      },
    },
    completa: {
      profileNote: "6 petiscos com camarão, cerca de 10 unidades por pessoa.",
      kitchenLaborPerPerson: 10,
      portionsPerPerson: {
        pasteizinhos: 0.2,
        bolinha_peixe: 1 / 6,
        crocantes: 1 / 3,
        dadinho_tapioca: 1 / 6,
        newcastle: 0.1,
        isca_peixe: 0.1,
      },
    },
  },
  petiscos_principal: {
    essencial: {
      profileNote: "3 petiscos (cerca de 4 unidades por pessoa) + 1 lanche.",
      kitchenLaborPerPerson: 9,
      portionsPerPerson: {
        pasteizinhos: 0.15,
        crocante_carne_sol: 1 / 6,
        dadinho_tapioca: 0.125,
        lanche: 1,
      },
    },
    equilibrada: {
      profileNote: "4 petiscos (cerca de 5 unidades por pessoa) + 1 lanche.",
      kitchenLaborPerPerson: 10,
      portionsPerPerson: {
        pasteizinhos: 0.16,
        bolinha_peixe: 1 / 6,
        crocantes: 1 / 6,
        dadinho_tapioca: 0.125,
        lanche: 1,
      },
    },
    completa: {
      profileNote:
        "5 petiscos com camarão (cerca de 7 unidades por pessoa) + 1 lanche + sobremesa.",
      kitchenLaborPerPerson: 12,
      portionsPerPerson: {
        pasteizinhos: 0.18,
        bolinha_peixe: 1 / 6,
        crocantes: 1 / 6,
        dadinho_tapioca: 0.125,
        newcastle: 0.1,
        lanche: 1,
        brownie: 1,
      },
    },
  },
  refeicao: {
    essencial: {
      profileNote:
        "2 petiscos na recepção (cerca de 3 unidades por pessoa) + prato principal.",
      kitchenLaborPerPerson: 9,
      portionsPerPerson: {
        pasteizinhos: 0.1,
        dadinho_tapioca: 0.125,
        travessa_essencial: 0.5,
      },
    },
    equilibrada: {
      profileNote:
        "3 petiscos na recepção (cerca de 4 unidades por pessoa) + prato principal + sobremesa.",
      kitchenLaborPerPerson: 10,
      portionsPerPerson: {
        pasteizinhos: 0.15,
        bolinha_peixe: 1 / 6,
        dadinho_tapioca: 0.125,
        travessa_equilibrada: 0.5,
        brownie: 1,
      },
    },
    completa: {
      profileNote:
        "4 petiscos com camarão (cerca de 5 unidades por pessoa) + prato principal premium + sobremesa.",
      kitchenLaborPerPerson: 13,
      portionsPerPerson: {
        pasteizinhos: 0.15,
        bolinha_peixe: 1 / 6,
        crocantes: 1 / 6,
        newcastle: 0.1,
        travessa_completa: 0.5,
        brownie_sorvete: 1,
      },
    },
  },
};

interface BeverageRule {
  label: string;
  detail: string;
  /** Bebidas por convidado (inclui crianças). */
  perGuest: Record<string, number>;
  /** Bebidas por adulto (álcool). */
  perAdult: Record<string, number>;
  wasteRisk: number;
  needsValidation: boolean;
}

export const BEVERAGE: Record<BeverageKey, BeverageRule> = {
  individual: {
    label: "Bebidas por conta de cada convidado",
    detail:
      "Nenhuma bebida incluída. Cada convidado pede e paga o que consumir, em comanda individual.",
    perGuest: {},
    perAdult: {},
    wasteRisk: 0,
    needsValidation: false,
  },
  sem_alcool: {
    label: "Bebidas sem álcool incluídas",
    detail:
      "2 bebidas por convidado entre água mineral, refrigerante lata e suco. O que passar disso vai para a comanda individual.",
    perGuest: { agua: 0.8, refrigerante: 0.8, suco: 0.4 },
    perAdult: {},
    wasteRisk: 0.03,
    needsValidation: false,
  },
  chope: {
    label: "Sem álcool + chope",
    detail:
      "3 chopes Brahma (300 ml) por adulto e 1 água ou refrigerante por convidado. O que passar disso vai para a comanda individual.",
    perGuest: { agua: 0.5, refrigerante: 0.5 },
    perAdult: { chope: 3 },
    wasteRisk: 0.05,
    needsValidation: true,
  },
  chope_coquetel: {
    label: "Sem álcool + chope + coquetel",
    detail:
      "2 chopes Brahma (300 ml) e 1 caipirinha ou caipiroska por adulto, mais 1 água ou refrigerante por convidado. O que passar disso vai para a comanda individual.",
    perGuest: { agua: 0.5, refrigerante: 0.5 },
    perAdult: { chope: 2, coquetel: 1 },
    wasteRisk: 0.05,
    needsValidation: true,
  },
};

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const roundUpReal = (value: number) => Math.ceil(value - 1e-9);
const scale = (perUnit: Record<string, number>, count: number) =>
  Object.fromEntries(
    Object.entries(perUnit).map(([k, v]) => [k, Math.ceil(v * count - 1e-3)]),
  );
const retailOf = (composition: Record<string, number>) =>
  Object.entries(composition).reduce(
    (sum, [key, qty]) => sum + (MENU_PRICES[key] ?? 0) * qty,
    0,
  );
const unitsOf = (composition: Record<string, number>) =>
  Object.entries(composition).reduce(
    (sum, [key, qty]) => sum + (ITEMS[key]?.unitsPerPortion ?? 0) * qty,
    0,
  );

export function foodRetailPerPerson(foodStyle: FoodKey, profile: ProfileKey) {
  return roundMoney(retailOf(FOOD[foodStyle][profile].portionsPerPerson));
}

export function foodUnitsPerPerson(foodStyle: FoodKey, profile: ProfileKey) {
  return roundMoney(unitsOf(FOOD[foodStyle][profile].portionsPerPerson));
}

function resolveFood(style: FoodStyle): FoodKey {
  return style === "recomendacao" ? "petiscos_principal" : style;
}

function profilesFor(profile: Profile): ProfileKey[] {
  return profile === "comparar" || !(profile in PROFILE_LABEL)
    ? ["essencial", "equilibrada", "completa"]
    : [profile];
}

export function validateInput(input: QuoteInput): string[] {
  const errors: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    errors.push("Data inválida.");
  } else {
    const [year, month, day] = input.date.split("-").map(Number);
    const parsedDate = new Date(Date.UTC(year, month - 1, day));
    const isRealDate = parsedDate.getUTCFullYear() === year &&
      parsedDate.getUTCMonth() === month - 1 && parsedDate.getUTCDate() === day;
    if (!isRealDate || input.date < new Date().toISOString().slice(0, 10)) {
      errors.push("Data inválida ou no passado.");
    }
  }
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) {
    errors.push("Horário inválido.");
  }
  if (
    !Number.isInteger(input.guests) || input.guests < 1 || input.guests > 300
  ) errors.push("Quantidade de convidados inválida.");
  if (
    !Number.isFinite(input.durationHours) || input.durationHours < 2 ||
    input.durationHours > 8
  ) errors.push("Duração deve ficar entre 2 e 8 horas.");
  const children = input.children ?? 0;
  if (!Number.isInteger(children) || children < 0 || children > input.guests) {
    errors.push("Quantidade de crianças inválida.");
  }
  if (!(resolveFood(input.foodStyle) in FOOD)) {
    errors.push("Opção de alimentação inválida.");
  }
  if (!(input.beverageMode in BEVERAGE)) {
    errors.push("Opção de bebidas inválida.");
  }
  return errors;
}

function beverageFrom(
  mode: BeverageKey,
  overrides?: PricingOverrides,
): BeverageRule {
  const base = BEVERAGE[mode];
  const row = overrides?.beverages?.find((rule) => rule.mode === mode);
  if (!row) return base;
  const composition = row.composition as {
    perGuest?: Record<string, number>;
    perAdult?: Record<string, number>;
  };
  return {
    ...base,
    perGuest: composition.perGuest ?? base.perGuest,
    perAdult: composition.perAdult ?? base.perAdult,
    wasteRisk: row.wasteRisk,
    needsValidation: row.needsValidation,
  };
}

export function buildQuote(
  input: QuoteInput,
  signals: LiveSignals = {},
  overrides?: PricingOverrides,
): QuoteResult {
  const validationErrors = validateInput(input);
  if (validationErrors.length) throw new Error(validationErrors.join(" "));

  const foodStyle = resolveFood(input.foodStyle);
  const beverageMode = input.beverageMode;
  const adults = Math.max(0, input.guests - (input.children ?? 0));
  const date = new Date(`${input.date}T12:00:00Z`);
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  const strongMonth = [0, 6, 11].includes(date.getUTCMonth());
  const demandReview = weekend || strongMonth;
  const cmvRate = overrides?.cmvRate ?? CMV_RATE;
  const serviceRate = overrides?.serviceRate ?? SERVICE_RATE;
  const minMargin = overrides?.targetContributionMargin ??
    MIN_CONTRIBUTION_MARGIN;
  const realCmv = signals.realCmvRate;
  const cmvUsed = realCmv != null && realCmv >= 0.15 && realCmv <= 0.6
    ? realCmv
    : cmvRate;
  const isoWeekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  const startHour = Number(input.startTime.slice(0, 2));
  const demandSource: InternalOption["demandSource"] =
    signals.demandIndex != null ? "historico" : "estimativa";
  const monthFactor = signals.monthFactor ??
    (strongMonth ? 1.2 : 1);
  const demandIndex = Math.min(
    1,
    Math.max(
      0,
      signals.demandIndex ??
        estimatedDemandIndex(isoWeekday, startHour, input.durationHours) *
          monthFactor,
    ),
  );
  const volumeDiscount = DISCOUNT.volume.reduce(
    (value, [min, rate]) => input.guests >= min ? rate : value,
    0,
  );
  const discountBreakdown: Record<DiscountKey, number> = {
    antecipado: DISCOUNT.antecipado,
    volume: volumeDiscount,
    horario: input.exclusive
      ? 0
      : roundMoney(DISCOUNT.horarioMax * (1 - demandIndex) * 1000) / 1000,
    cardapio: DISCOUNT.cardapio[foodStyle] ?? 0,
  };
  const discountTarget = Math.min(
    DISCOUNT.teto,
    Object.values(discountBreakdown).reduce((a, b) => a + b, 0),
  );
  const capacity = signals.capacity && signals.capacity > 0
    ? signals.capacity
    : 100;
  const freelancerDay = overrides?.freelancerDay ?? FREELANCER_DAY;
  const extraHours = Math.max(0, input.durationHours - BASE_HOURS);
  const beverage = beverageFrom(beverageMode, overrides);
  const beverageRetailTotal = retailOf(beverage.perGuest) * input.guests +
    retailOf(beverage.perAdult) * adults;

  const options = profilesFor(input.profile).map((profile) => {
    const defaultFood = FOOD[foodStyle][profile];
    const foodOverride = overrides?.packages?.find((rule) =>
      rule.foodStyle === foodStyle && rule.profile === profile
    );
    const food: FoodRule = foodOverride
      ? {
        ...defaultFood,
        kitchenLaborPerPerson: foodOverride.kitchenLaborPerPerson,
        portionsPerPerson: foodOverride.composition,
      }
      : defaultFood;
    let freelancerCount = input.guests > 50 ? 1 : 0;
    if (beverageMode === "chope_coquetel" && adults > 50) freelancerCount += 1;
    else if (beverageMode === "chope" && adults > 70) freelancerCount += 1;
    if (input.durationHours > 4) freelancerCount += 1;

    const foodRetailTotal = retailOf(food.portionsPerPerson) * input.guests;
    const menuEquivalentTotal = (foodRetailTotal + beverageRetailTotal) *
      (1 + serviceRate);
    const durationSurchargeTotal = menuEquivalentTotal * EXTRA_HOUR_RATE *
      extraHours;
    const cmvTotal = (foodRetailTotal + beverageRetailTotal) * cmvUsed;
    const laborTotal = food.kitchenLaborPerPerson * input.guests +
      freelancerCount * freelancerDay;
    const durationCost = extraHours *
      (input.guests * 1.5 + freelancerCount * 20);
    const riskCost = beverageRetailTotal * beverage.wasteRisk;
    const technicalMinimumTotal =
      ((cmvTotal + laborTotal + durationCost + riskCost) / (1 - minMargin)) *
      (1 + serviceRate);
    const displacedShare = input.exclusive
      ? 1
      : Math.min(1, input.guests / capacity);
    const opportunityFloor = signals.expectedWindowRevenue != null
      ? signals.expectedWindowRevenue * displacedShare
      : signals.opportunityCostTotal == null
      ? null
      : signals.opportunityCostTotal * displacedShare;
    const listPriceTotal = menuEquivalentTotal + durationSurchargeTotal;
    const discountedTotal = listPriceTotal * (1 - discountTarget);
    const commercialMinimum = Math.max(
      discountedTotal,
      technicalMinimumTotal,
      opportunityFloor ?? 0,
    );
    const priceDriver: InternalOption["priceDriver"] =
      commercialMinimum === discountedTotal
        ? "desconto"
        : commercialMinimum === technicalMinimumTotal
        ? "custo"
        : "oportunidade";
    const pricePerPerson = roundUpReal(commercialMinimum / input.guests);
    const total = roundMoney(pricePerPerson * input.guests);
    const estimatedContributionMargin = total > 0
      ? (total - cmvTotal - laborTotal - durationCost - riskCost) / total
      : 0;
    const alerts: string[] = [];

    if (input.guests < 30 || input.guests > 100) {
      alerts.push(
        "Quantidade fora da faixa automática de 30 a 100 convidados.",
      );
    }
    if (input.guests > 60) {
      alerts.push("Avaliar exclusividade e impacto na operação.");
    }
    if (input.exclusive) alerts.push("Exclusividade solicitada.");
    if (beverage.needsValidation) {
      alerts.push(`${beverage.label}: conferir controle do álcool.`);
    }
    if (input.durationHours > 4) {
      alerts.push("Duração ampliada exige validação de equipe.");
    }
    if (input.dietaryRestriction) {
      alerts.push("Restrição alimentar relevante informada.");
    }
    if (freelancerCount > 0) {
      alerts.push(
        `${freelancerCount} profissional(is) adicional(is) recomendado(s).`,
      );
    }
    if (signals.blocked) alerts.push("Data bloqueada.");
    if (signals.reservationConflict) {
      alerts.push("Conflito com reservas existentes.");
    }
    if (signals.capacityExceeded) alerts.push("Capacidade excedida.");
    else if (signals.nearCapacity) {
      alerts.push("Operação próxima da capacidade.");
    }
    if (demandIndex >= 0.75) {
      alerts.push("Horário forte da casa; conferir impacto no salão.");
    }
    if (demandSource === "estimativa" && demandReview) {
      alerts.push("Movimento do horário estimado, sem histórico carregado.");
    }
    if (priceDriver !== "desconto") {
      alerts.push(
        priceDriver === "custo"
          ? "Desconto limitado pelo piso de custo."
          : "Desconto limitado pelo faturamento esperado do horário.",
      );
    }
    if (signals.availabilityUnverified) {
      alerts.push(
        "Disponibilidade e capacidade precisam de conferência interna.",
      );
    }
    if (opportunityFloor != null && total < opportunityFloor) {
      alerts.push("Valor abaixo do custo de oportunidade.");
    }
    if (estimatedContributionMargin < MARGIN_ALERT) {
      alerts.push("Margem estimada abaixo de 45%.");
    }
    if (
      input.budgetPerPerson != null && input.budgetPerPerson < pricePerPerson
    ) {
      alerts.push(
        "Faixa de investimento informada abaixo do mínimo calculado.",
      );
    }

    const red = Boolean(
      signals.blocked || signals.reservationConflict ||
        signals.capacityExceeded ||
        estimatedContributionMargin < minMargin - 0.005 ||
        (opportunityFloor != null && total < opportunityFloor),
    );
    const yellow = !red &&
      Boolean(
        alerts.length || input.guests > 60 || beverage.needsValidation ||
          input.durationHours > 4 || input.dietaryRestriction,
      );
    const riskLevel: RiskLevel = red
      ? "vermelho"
      : yellow
      ? "amarelo"
      : "verde";
    const exact = riskLevel === "verde";
    const menuItems = Object.keys(food.portionsPerPerson)
      .filter((key) => ITEMS[key])
      .map((key) => ({ name: ITEMS[key].name, detail: ITEMS[key].detail }));
    const styleInfo = FOOD_STYLE_INFO[foodStyle];

    const internal: InternalOption = {
      id: `${foodStyle}-${profile}-${beverageMode}`,
      name: `${styleInfo.label} · ${PROFILE_LABEL[profile]}`,
      description: styleInfo.description,
      summary: food.profileNote,
      mainFoods: menuItems.map((item) => item.name),
      menuItems,
      beverageLabel: beverage.label,
      beverageDetail: beverage.detail,
      durationHours: input.durationHours,
      pricePerPerson,
      total,
      menuValueTotal: roundMoney(menuEquivalentTotal),
      serviceIncluded: true,
      additions: [
        "Hora adicional durante o evento: 10% do valor por hora",
        "Bebidas além das incluídas, na comanda individual",
        "Exclusividade do espaço, sob avaliação",
      ],
      notIncluded: [
        "Decoração",
        "Música, som ou DJ",
        "Fotografia",
        "Cerimonial",
        "Bolo e doces de festa",
      ],
      exact,
      validationMessage: exact
        ? "Pré-proposta sujeita à confirmação de disponibilidade."
        : "Valor indicativo sujeito à validação da equipe.",
      riskLevel,
      foodStyle,
      beverageMode,
      profile,
      adults,
      foodUnitsPerPerson: roundMoney(unitsOf(food.portionsPerPerson)),
      drinkUnitsPerAdult: Object.values(beverage.perAdult).reduce(
        (a, b) => a + b,
        0,
      ),
      portions: scale(food.portionsPerPerson, input.guests),
      drinks: (() => {
        const guestDrinks = scale(beverage.perGuest, input.guests);
        const adultDrinks = scale(beverage.perAdult, adults);
        for (const [k, v] of Object.entries(adultDrinks)) {
          guestDrinks[k] = (guestDrinks[k] ?? 0) + v;
        }
        return guestDrinks;
      })(),
      freelancerCount,
      extraHours,
      estimatedCmvTotal: roundMoney(cmvTotal),
      estimatedContributionMargin: roundMoney(estimatedContributionMargin),
      menuEquivalentTotal: roundMoney(menuEquivalentTotal),
      durationSurchargeTotal: roundMoney(durationSurchargeTotal),
      technicalMinimumTotal: roundMoney(technicalMinimumTotal),
      opportunityFloorTotal: opportunityFloor == null
        ? null
        : roundMoney(opportunityFloor),
      listPriceTotal: roundMoney(listPriceTotal),
      discountTarget: roundMoney(discountTarget * 1000) / 1000,
      discountApplied: listPriceTotal > 0
        ? roundMoney((1 - total / listPriceTotal) * 1000) / 1000
        : 0,
      discountBreakdown,
      demandIndex: roundMoney(demandIndex),
      demandSource,
      monthFactor: roundMoney(monthFactor),
      expectedWindowRevenue: signals.expectedWindowRevenue == null
        ? null
        : roundMoney(signals.expectedWindowRevenue),
      cmvRateUsed: cmvUsed,
      priceDriver,
      alerts,
      pricingVersion: overrides?.versionCode ?? PRICING_VERSION,
      menuVersion: MENU_VERSION,
    };
    return internal;
  });

  const rank: Record<RiskLevel, number> = { verde: 0, amarelo: 1, vermelho: 2 };
  const requestRiskLevel = options.reduce<RiskLevel>(
    (level, option) =>
      rank[option.riskLevel] > rank[level] ? option.riskLevel : level,
    "verde",
  );
  const publicOptions = options.map(({
    adults: _a,
    foodUnitsPerPerson: _b,
    drinkUnitsPerAdult: _c,
    portions: _d,
    drinks: _e,
    freelancerCount: _f,
    estimatedCmvTotal: _g,
    estimatedContributionMargin: _h,
    menuEquivalentTotal: _i,
    technicalMinimumTotal: _j,
    opportunityFloorTotal: _k,
    alerts: _l,
    pricingVersion: _m,
    menuVersion: _n,
    foodStyle: _o,
    beverageMode: _p,
    profile: _q,
    extraHours: _r,
    durationSurchargeTotal: _s,
    priceDriver: _t,
    listPriceTotal: _u,
    discountTarget: _v,
    discountApplied: _w,
    discountBreakdown: _x,
    demandIndex: _y,
    demandSource: _z,
    monthFactor: _aa,
    expectedWindowRevenue: _ab,
    cmvRateUsed: _ac,
    ...safe
  }) => safe);
  return { options: publicOptions, internal: options, requestRiskLevel };
}
