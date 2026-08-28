export type CompensationInput = {
  netMonthlyPay?: number | null;
  grossMonthlyPay?: number | null;
  employerContributions?: number | null;
  otherMonthlyCosts?: number | null;
  nominalMonthlyHours?: number | null;
  legacyMonthlyCost?: number | null;
  legacyHourlyCost?: number | null;
};

export type CompensationBreakdown = {
  netMonthlyPay: number | null;
  grossMonthlyPay: number | null;
  employerContributions: number;
  otherMonthlyCosts: number;
  nominalMonthlyHours: number | null;
  totalEmployerCost: number;
  effectiveHourlyCost: number;
  hasDetailedBreakdown: boolean;
};

function optionalAmount(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, value);
}

function rounded(value: number, digits = 2) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

export function calculateCompensation(input: CompensationInput): CompensationBreakdown {
  const netMonthlyPay = optionalAmount(input.netMonthlyPay);
  const grossMonthlyPay = optionalAmount(input.grossMonthlyPay);
  const employerContributions = optionalAmount(input.employerContributions) ?? 0;
  const otherMonthlyCosts = optionalAmount(input.otherMonthlyCosts) ?? 0;
  const nominalMonthlyHours = optionalAmount(input.nominalMonthlyHours);
  const legacyMonthlyCost = optionalAmount(input.legacyMonthlyCost) ?? 0;
  const legacyHourlyCost = optionalAmount(input.legacyHourlyCost) ?? 0;
  const hasDetailedBreakdown = netMonthlyPay !== null || grossMonthlyPay !== null || employerContributions > 0 || otherMonthlyCosts > 0;

  const totalEmployerCost = hasDetailedBreakdown
    ? rounded((grossMonthlyPay ?? 0) + employerContributions + otherMonthlyCosts)
    : rounded(legacyMonthlyCost);
  const effectiveHourlyCost = nominalMonthlyHours && nominalMonthlyHours > 0
    ? rounded(totalEmployerCost / nominalMonthlyHours, 4)
    : rounded(legacyHourlyCost, 4);

  return {
    netMonthlyPay,
    grossMonthlyPay,
    employerContributions,
    otherMonthlyCosts,
    nominalMonthlyHours,
    totalEmployerCost,
    effectiveHourlyCost,
    hasDetailedBreakdown
  };
}

export function compensationBurden(input: CompensationInput) {
  const result = calculateCompensation(input);
  return rounded(Math.max(0, result.totalEmployerCost - (result.netMonthlyPay ?? 0)));
}
