import {
  buildDemoBlueprint,
  demoId,
  validateDemoBlueprint,
  type DemoBlueprint,
  type DemoRow
} from "./blueprint";
import { extendDemoDataset } from "./extended-blueprint";

export { demoId, type DemoRow };

export function buildDemoDataset(userId: string, referenceDate = new Date()): DemoBlueprint {
  const dataset = buildDemoBlueprint(userId, referenceDate);
  extendDemoDataset(dataset, userId, referenceDate);

  const boqById = new Map(dataset.boqItems.map((row) => [String(row.id), row]));
  dataset.boqItems = dataset.boqItems.map((row) => {
    const quantity = Math.max(0, Number(row.quantity ?? 0));
    const executed = Math.min(quantity, Math.max(0, Number(row.quantity_executed ?? 0)));
    const accepted = Math.min(executed, Math.max(0, Number(row.quantity_accepted ?? 0)));
    return { ...row, quantity_executed: executed, quantity_accepted: accepted };
  });

  const normalizedBoq = new Map(dataset.boqItems.map((row) => [String(row.id), row]));
  dataset.progressEntries = dataset.progressEntries.map((row) => {
    const item = normalizedBoq.get(String(row.boq_item_id));
    if (!item) return row;
    const executed = Math.min(Number(row.quantity_executed ?? 0), Number(item.quantity_executed ?? 0));
    const accepted = Math.min(Number(row.quantity_accepted ?? 0), executed, Number(item.quantity_accepted ?? 0));
    const unitPrice = Number(item.unit_price ?? 0);
    return {
      ...row,
      quantity_executed: executed,
      quantity_accepted: accepted,
      value_executed: Math.round(executed * unitPrice * 100) / 100,
      value_accepted: Math.round(accepted * unitPrice * 100) / 100
    };
  });

  dataset.vehicleAllocations = dataset.vehicleAllocations.map((row) => ({
    ...row,
    date_from: row.date_from ?? row.allocated_from,
    date_to: row.date_to ?? row.allocated_to,
    allocation_method: row.allocation_method ?? row.allocation_type ?? "time"
  }));

  // A change-impact record requires a real document version. The demo account
  // intentionally does not invent R2-backed versions that could look
  // downloadable but do not exist, so these rows stay empty until a user
  // uploads a real revision.
  dataset.documentChangeImpacts = [];

  // Guard against accidental mutation of the raw BOQ lookup above being lost.
  for (const [id, raw] of boqById) {
    const normalized = normalizedBoq.get(id);
    if (!normalized) continue;
    if (Number(raw.quantity_accepted ?? 0) > Number(raw.quantity_executed ?? 0)) {
      normalized.quantity_accepted = Math.min(Number(normalized.quantity_accepted ?? 0), Number(normalized.quantity_executed ?? 0));
    }
  }

  return dataset;
}

export function validateDemoDataset(dataset: DemoBlueprint) {
  return validateDemoBlueprint(dataset);
}
