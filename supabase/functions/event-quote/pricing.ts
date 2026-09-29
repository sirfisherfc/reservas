export type FoodStyle =
  | "petiscos"
  | "petiscos_principal"
  | "refeicao"
  | "recomendacao";
export type BeverageMode =
  | "individual"
  | "sem_alcool"
  | "credito"
  | "fichas"
  | "chope"
  | "selecionado"
  | "open_bar"
  | "recomendacao";
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
    unitsPerAdult: number;
    wasteRisk: number;
    needsValidation: boolean;
    composition: Record<string, number>;
  }>;
}

export interface PublicOption {
  id: string;
  name: string;
  description: string;
  mainFoods: string[];
  beverageLabel: string;
  durationHours: number;
  pricePerPerson: number;
  total: number;
  serviceIncluded: true;
  additions: string[];
  notIncluded: string[];
  exact: boolean;
  validationMessage: string;
  riskLevel: RiskLevel;
}

export interface InternalOption extends PublicOption {
  foodStyle: Exclude<FoodStyle, "recomendacao">;
  beverageMode: Exclude<BeverageMode, "recomendacao">;
  profile: Exclude<Profile, "comparar">;
  adults: number;
  foodUnitsPerPerson: number;
  drinkUnitsPerAdult: number;
  portions: Record<string, number>;
  drinks: Record<string, number>;
  freelancerCount: number;
  estimatedCmvTotal: number;
  estimatedContributionMargin: number;
  menuEquivalentTotal: number;
  technicalMinimumTotal: number;
  opportunityFloorTotal: number | null;
  alerts: string[];
  pricingVersion: string;
  menuVersion: string;
}

export interface QuoteResult {
  options: PublicOption[];
  internal: InternalOption[];
  requestRiskLevel: RiskLevel;
}

const PRICING_VERSION = "eventos-2026-09-mvp-1";
const MENU_VERSION = "cardapio-1-2026-09-22";
const CMV_RATE = 0.35;
const SERVICE_RATE = 0.10;
const TARGET_CONTRIBUTION_MARGIN = 0.52;
const FREELANCER_DAY = 100;

type ProfileKey = Exclude<Profile, "comparar">;
type FoodKey = Exclude<FoodStyle, "recomendacao">;
type BeverageKey = Exclude<BeverageMode, "recomendacao">;

const FOOD: Record<
  FoodKey,
  Record<ProfileKey, {
    label: string;
    description: string;
    foods: string[];
    units: number;
    retailPerPerson: number;
    portionsPerPerson: Record<string, number>;
    kitchenLaborPerPerson: number;
  }>
> = {
  petiscos: {
    essencial: {
      label: "Petiscos Essencial",
      description:
        "Petiscos clássicos em serviço volante para uma confraternização leve.",
      foods: [
        "Pasteizinhos",
        "Bolinha de peixe",
        "Crocante de carne de sol",
        "Dadinho de tapioca",
      ],
      units: 5,
      retailPerPerson: 23.0,
      kitchenLaborPerPerson: 7,
      portionsPerPerson: {
        pasteizinhos: 0.15,
        bolinha_peixe: 1 / 6,
        crocante_carne_sol: 1 / 6,
        dadinho_tapioca: 0.125,
      },
    },
    equilibrada: {
      label: "Petiscos Equilibrada",
      description:
        "Mais variedade e reposição para manter o serviço confortável durante o encontro.",
      foods: [
        "Pasteizinhos",
        "Bolinha de peixe",
        "Crocantes",
        "Dadinho de tapioca",
        "Crispy Spicy Chicken",
      ],
      units: 6.5,
      retailPerPerson: 34.0,
      kitchenLaborPerPerson: 8,
      portionsPerPerson: {
        pasteizinhos: 0.18,
        bolinha_peixe: 0.2,
        crocantes: 0.2,
        dadinho_tapioca: 0.15,
        crispy_chicken: 0.12,
      },
    },
    completa: {
      label: "Petiscos Completa",
      description:
        "Seleção mais farta, com itens do mar e da terra para uma experiência prolongada.",
      foods: [
        "Pasteizinhos",
        "Bolinha de peixe",
        "NewCastle",
        "Crocantes",
        "Dadinho de tapioca",
        "Isca de peixe",
      ],
      units: 8,
      retailPerPerson: 46.0,
      kitchenLaborPerPerson: 10,
      portionsPerPerson: {
        pasteizinhos: 0.2,
        bolinha_peixe: 0.22,
        newcastle: 0.16,
        crocantes: 0.2,
        dadinho_tapioca: 0.17,
        isca_peixe: 0.12,
      },
    },
  },
  petiscos_principal: {
    essencial: {
      label: "Petiscos + Principal Essencial",
      description:
        "Entradas volantes seguidas de um principal individual da casa.",
      foods: [
        "Pasteizinhos",
        "Crocante de carne de sol",
        "Dadinho de tapioca",
        "Fish & Chips ou sanduíche",
      ],
      units: 4.5,
      retailPerPerson: 56.0,
      kitchenLaborPerPerson: 9,
      portionsPerPerson: {
        pasteizinhos: 0.14,
        crocante_carne_sol: 0.17,
        dadinho_tapioca: 0.12,
        principal: 0.75,
      },
    },
    equilibrada: {
      label: "Petiscos + Principal Equilibrada",
      description:
        "Boa variedade de entradas e principal para servir como refeição completa.",
      foods: [
        "Pasteizinhos",
        "Bolinha de peixe",
        "Crocantes",
        "Dadinho de tapioca",
        "Fish & Chips ou sanduíche",
      ],
      units: 6,
      retailPerPerson: 66.0,
      kitchenLaborPerPerson: 10,
      portionsPerPerson: {
        pasteizinhos: 0.16,
        bolinha_peixe: 0.17,
        crocantes: 0.17,
        dadinho_tapioca: 0.14,
        principal: 0.85,
      },
    },
    completa: {
      label: "Petiscos + Principal Completa",
      description:
        "Entradas fartas, principal individual e sobremesa para uma celebração completa.",
      foods: [
        "Pasteizinhos",
        "Bolinha de peixe",
        "NewCastle",
        "Crocantes",
        "Dadinho de tapioca",
        "Principal",
        "Brownie",
      ],
      units: 7.5,
      retailPerPerson: 81.0,
      kitchenLaborPerPerson: 12,
      portionsPerPerson: {
        pasteizinhos: 0.18,
        bolinha_peixe: 0.18,
        newcastle: 0.14,
        crocantes: 0.18,
        dadinho_tapioca: 0.15,
        principal: 1,
        brownie: 1,
      },
    },
  },
  refeicao: {
    essencial: {
      label: "Almoço ou Jantar Essencial",
      description:
        "Refeição objetiva com entrada compartilhada e principal selecionado.",
      foods: [
        "Dadinho de tapioca",
        "Batata ou macaxeira",
        "Principal grelhado",
      ],
      units: 3,
      retailPerPerson: 52.0,
      kitchenLaborPerPerson: 9,
      portionsPerPerson: {
        dadinho_tapioca: 0.1,
        acompanhamento: 0.12,
        principal: 0.8,
      },
    },
    equilibrada: {
      label: "Almoço ou Jantar Equilibrada",
      description:
        "Entrada, principal e sobremesa com escolhas pensadas para grupos.",
      foods: [
        "Pasteizinhos",
        "Dadinho de tapioca",
        "Principal grelhado",
        "Brownie",
      ],
      units: 4,
      retailPerPerson: 66.0,
      kitchenLaborPerPerson: 10,
      portionsPerPerson: {
        pasteizinhos: 0.12,
        dadinho_tapioca: 0.12,
        principal: 1,
        brownie: 1,
      },
    },
    completa: {
      label: "Almoço ou Jantar Completa",
      description:
        "Recepção com petiscos, principal completo e sobremesa individual.",
      foods: [
        "Pasteizinhos",
        "Bolinha de peixe",
        "Dadinho de tapioca",
        "Principal premium",
        "Brownie com sorvete",
      ],
      units: 5,
      retailPerPerson: 86.0,
      kitchenLaborPerPerson: 13,
      portionsPerPerson: {
        pasteizinhos: 0.14,
        bolinha_peixe: 0.14,
        dadinho_tapioca: 0.12,
        principal_premium: 1,
        sobremesa: 1,
      },
    },
  },
};

const BEVERAGE: Record<BeverageKey, {
  label: string;
  retailPerAdult: number;
  unitsPerAdult: number;
  wasteRisk: number;
  needsValidation: boolean;
  drinks: Record<string, number>;
}> = {
  individual: {
    label: "Cada convidado paga seu consumo",
    retailPerAdult: 0,
    unitsPerAdult: 0,
    wasteRisk: 0,
    needsValidation: false,
    drinks: {},
  },
  sem_alcool: {
    label: "Bebidas sem álcool incluídas",
    retailPerAdult: 13,
    unitsPerAdult: 1.7,
    wasteRisk: 0.04,
    needsValidation: false,
    drinks: { agua: 0.7, refrigerante: 0.7, suco: 0.3 },
  },
  credito: {
    label: "Crédito financeiro de consumo",
    retailPerAdult: 22,
    unitsPerAdult: 0,
    wasteRisk: 0,
    needsValidation: false,
    drinks: { credito_reais: 22 },
  },
  fichas: {
    label: "Duas fichas por convidado",
    retailPerAdult: 20,
    unitsPerAdult: 2,
    wasteRisk: 0.03,
    needsValidation: false,
    drinks: { fichas: 2 },
  },
  chope: {
    label: "Chope controlado",
    retailPerAdult: 26,
    unitsPerAdult: 2.4,
    wasteRisk: 0.10,
    needsValidation: true,
    drinks: { chope: 2.4 },
  },
  selecionado: {
    label: "Pacote selecionado de bebidas",
    retailPerAdult: 31,
    unitsPerAdult: 2.5,
    wasteRisk: 0.10,
    needsValidation: true,
    drinks: { agua_refrigerante: 1, cerveja_ou_chope: 1.5 },
  },
  open_bar: {
    label: "Open bar especial por até 3 horas",
    retailPerAdult: 55,
    unitsPerAdult: 4.2,
    wasteRisk: 0.18,
    needsValidation: true,
    drinks: { agua_refrigerante: 1.2, alcoolicas_selecionadas: 3 },
  },
};

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;
const roundUpReal = (value: number) => Math.ceil(value);
const portions = (perPerson: Record<string, number>, guests: number) =>
  Object.fromEntries(
    Object.entries(perPerson).map(([k, v]) => [k, Math.ceil(v * guests)]),
  );

function resolveFood(style: FoodStyle): FoodKey {
  return style === "recomendacao" ? "petiscos_principal" : style;
}

function resolveBeverage(mode: BeverageMode): BeverageKey {
  return mode === "recomendacao" ? "sem_alcool" : mode;
}

function profilesFor(profile: Profile): ProfileKey[] {
  if (profile === "comparar") return ["essencial", "equilibrada", "completa"];
  if (profile === "essencial") return ["essencial", "equilibrada"];
  if (profile === "completa") return ["equilibrada", "completa"];
  return ["essencial", "equilibrada", "completa"];
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
  return errors;
}

export function buildQuote(
  input: QuoteInput,
  signals: LiveSignals = {},
  overrides?: PricingOverrides,
): QuoteResult {
  const validationErrors = validateInput(input);
  if (validationErrors.length) throw new Error(validationErrors.join(" "));

  const foodStyle = resolveFood(input.foodStyle);
  const beverageMode = resolveBeverage(input.beverageMode);
  const adults = Math.max(0, input.guests - (input.children ?? 0));
  const date = new Date(`${input.date}T12:00:00Z`);
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  const strongMonth = [0, 6, 11].includes(date.getUTCMonth());
  const demandReview = weekend || strongMonth;
  const cmvRate = overrides?.cmvRate ?? CMV_RATE;
  const serviceRate = overrides?.serviceRate ?? SERVICE_RATE;
  const targetMargin = overrides?.targetContributionMargin ??
    TARGET_CONTRIBUTION_MARGIN;
  const freelancerDay = overrides?.freelancerDay ?? FREELANCER_DAY;
  const options = profilesFor(input.profile).map((profile) => {
    const defaultFood = FOOD[foodStyle][profile];
    const foodOverride = overrides?.packages?.find((rule) =>
      rule.foodStyle === foodStyle && rule.profile === profile
    );
    const food = foodOverride
      ? {
        ...defaultFood,
        units: foodOverride.foodUnitsPerPerson,
        retailPerPerson: foodOverride.retailPerPerson,
        kitchenLaborPerPerson: foodOverride.kitchenLaborPerPerson,
        portionsPerPerson: foodOverride.composition,
      }
      : defaultFood;
    const defaultBeverage = BEVERAGE[beverageMode];
    const beverageOverride = overrides?.beverages?.find((rule) =>
      rule.mode === beverageMode
    );
    const beverage = beverageOverride
      ? {
        ...defaultBeverage,
        retailPerAdult: beverageOverride.retailPerAdult,
        unitsPerAdult: beverageOverride.unitsPerAdult,
        wasteRisk: beverageOverride.wasteRisk,
        needsValidation: beverageOverride.needsValidation,
        drinks: beverageOverride.composition,
      }
      : defaultBeverage;
    let freelancerCount = input.guests > 50 ? 1 : 0;
    if (beverageMode === "open_bar") {
      freelancerCount += Math.max(1, Math.ceil(adults / 70));
    } else if (
      ["chope", "selecionado"].includes(beverageMode) && input.guests > 70
    ) freelancerCount += 1;
    if (input.durationHours > 4) freelancerCount += 1;

    const foodRetailTotal = food.retailPerPerson * input.guests;
    const beverageRetailTotal = beverage.retailPerAdult * adults;
    const menuEquivalentTotal = (foodRetailTotal + beverageRetailTotal) *
      (1 + serviceRate);
    const cmvTotal = (foodRetailTotal + beverageRetailTotal) * cmvRate;
    const laborTotal = food.kitchenLaborPerPerson * input.guests +
      freelancerCount * freelancerDay;
    const durationCost = Math.max(0, input.durationHours - 3) *
      (input.guests * 1.5 + freelancerCount * 20);
    const riskCost = beverageRetailTotal * beverage.wasteRisk;
    const technicalMinimumTotal =
      ((cmvTotal + laborTotal + durationCost + riskCost) / (1 - targetMargin)) *
      (1 + serviceRate);
    const opportunityFloor = signals.opportunityCostTotal == null
      ? null
      : input.exclusive
      ? signals.opportunityCostTotal
      : signals.opportunityCostTotal * Math.min(1, input.guests / 100);
    const commercialMinimum = Math.max(
      menuEquivalentTotal,
      technicalMinimumTotal,
      opportunityFloor ?? 0,
    );
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
      alerts.push(`${beverage.label} exige validação interna.`);
    }
    if (input.durationHours > 4) {
      alerts.push("Duração ampliada e hora adicional exigem validação.");
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
    if (demandReview) {
      alerts.push(
        "Período potencialmente forte; conferir dados históricos comparáveis.",
      );
    }
    if (!signals.demandDataAvailable && demandReview) {
      alerts.push("Custo de oportunidade ainda sem dados analíticos ao vivo.");
    }
    if (signals.availabilityUnverified) {
      alerts.push(
        "Disponibilidade e capacidade precisam de conferência interna.",
      );
    }
    if (opportunityFloor != null && total < opportunityFloor) {
      alerts.push("Valor abaixo do custo de oportunidade.");
    }
    if (estimatedContributionMargin < 0.45) {
      alerts.push("Margem estimada abaixo do piso provisório.");
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
        signals.capacityExceeded || estimatedContributionMargin < 0.45 ||
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

    const internal: InternalOption = {
      id: `${foodStyle}-${profile}-${beverageMode}`,
      name: food.label,
      description: food.description,
      mainFoods: food.foods,
      beverageLabel: beverage.label,
      durationHours: input.durationHours,
      pricePerPerson,
      total,
      serviceIncluded: true,
      additions: [
        "Hora adicional sob validação",
        "Exclusividade sob avaliação",
        "Crédito adicional de consumo",
      ],
      notIncluded: [
        "Decoração",
        "Música ou DJ",
        "Fotografia",
        "Cerimonial",
        "Equipamentos externos",
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
      foodUnitsPerPerson: food.units,
      drinkUnitsPerAdult: beverage.unitsPerAdult,
      portions: portions(food.portionsPerPerson, input.guests),
      drinks: portions(beverage.drinks, adults),
      freelancerCount,
      estimatedCmvTotal: roundMoney(cmvTotal),
      estimatedContributionMargin: roundMoney(estimatedContributionMargin),
      menuEquivalentTotal: roundMoney(menuEquivalentTotal),
      technicalMinimumTotal: roundMoney(technicalMinimumTotal),
      opportunityFloorTotal: opportunityFloor == null
        ? null
        : roundMoney(opportunityFloor),
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
    ...safe
  }) => safe);
  return { options: publicOptions, internal: options, requestRiskLevel };
}
