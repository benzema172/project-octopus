export type OperationalStockValueInput = {
  balance: unknown;
  fifoQuantity: unknown;
  fifoValue: unknown;
  latestUnitPrice: unknown;
};

const positiveNumber = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * Operational warehouse value keeps approved FIFO truth where it exists,
 * then values any projected/document-derived remainder with the latest
 * known PLN purchase price. It never invents a FIFO layer for a draft PZ/WZ.
 */
export function operationalStockValue(input: OperationalStockValueInput) {
  const balance = positiveNumber(input.balance);
  if (!balance) return 0;

  const fifoQuantity = positiveNumber(input.fifoQuantity);
  const fifoValue = positiveNumber(input.fifoValue);
  const latestUnitPrice = positiveNumber(input.latestUnitPrice);
  const fifoUnitCost = fifoQuantity > 0 && fifoValue > 0 ? fifoValue / fifoQuantity : 0;

  if (!fifoUnitCost) return balance * latestUnitPrice;

  const fifoCoveredQuantity = Math.min(balance, fifoQuantity);
  const projectedRemainder = Math.max(0, balance - fifoCoveredQuantity);
  const remainderUnitCost = latestUnitPrice || fifoUnitCost;

  return fifoCoveredQuantity * fifoUnitCost + projectedRemainder * remainderUnitCost;
}
