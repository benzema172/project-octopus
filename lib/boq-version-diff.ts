export type BoqControlItem = {
  id: string;
  versionId: string | null;
  lineageId: string;
  sourceBoqItemId: string | null;
  itemNumber: string | null;
  description: string;
  unit: string | null;
  quantity: number | null;
  unitPrice: number | null;
  totalPrice: number;
  wbsNodeId: string | null;
  costCode: string | null;
  changeOrderId: string | null;
  changeType: "unchanged" | "added" | "modified" | "removed";
  revisionNote: string | null;
};

export type BoqVersionDiffRow = {
  lineageId: string;
  itemNumber: string | null;
  description: string;
  changeType: "added" | "modified" | "removed";
  beforeValue: number;
  afterValue: number;
  deltaValue: number;
};

export type BoqVersionDiff = {
  rows: BoqVersionDiffRow[];
  added: number;
  modified: number;
  removed: number;
  beforeValue: number;
  afterValue: number;
  deltaValue: number;
};

export function buildBoqVersionDiff(baseItems: BoqControlItem[], targetItems: BoqControlItem[]): BoqVersionDiff {
  const base = new Map(baseItems.filter((item) => item.changeType !== "removed").map((item) => [item.lineageId, item]));
  const target = new Map(targetItems.filter((item) => item.changeType !== "removed").map((item) => [item.lineageId, item]));
  const rows: BoqVersionDiffRow[] = [];

  for (const [lineageId, item] of target) {
    const previous = base.get(lineageId);
    if (!previous) {
      rows.push({ lineageId, itemNumber: item.itemNumber, description: item.description, changeType: "added", beforeValue: 0, afterValue: item.totalPrice, deltaValue: item.totalPrice });
      continue;
    }
    const changed = previous.itemNumber !== item.itemNumber
      || previous.description !== item.description
      || previous.unit !== item.unit
      || previous.quantity !== item.quantity
      || previous.unitPrice !== item.unitPrice
      || previous.wbsNodeId !== item.wbsNodeId
      || previous.costCode !== item.costCode;
    if (changed || item.changeType === "modified") {
      rows.push({ lineageId, itemNumber: item.itemNumber, description: item.description, changeType: "modified", beforeValue: previous.totalPrice, afterValue: item.totalPrice, deltaValue: item.totalPrice - previous.totalPrice });
    }
  }

  for (const [lineageId, item] of base) {
    if (!target.has(lineageId)) rows.push({ lineageId, itemNumber: item.itemNumber, description: item.description, changeType: "removed", beforeValue: item.totalPrice, afterValue: 0, deltaValue: -item.totalPrice });
  }

  rows.sort((a, b) => (a.itemNumber ?? "").localeCompare(b.itemNumber ?? "", "pl", { numeric: true }));
  const beforeValue = Array.from(base.values()).reduce((sum, item) => sum + item.totalPrice, 0);
  const afterValue = Array.from(target.values()).reduce((sum, item) => sum + item.totalPrice, 0);
  return {
    rows,
    added: rows.filter((row) => row.changeType === "added").length,
    modified: rows.filter((row) => row.changeType === "modified").length,
    removed: rows.filter((row) => row.changeType === "removed").length,
    beforeValue,
    afterValue,
    deltaValue: afterValue - beforeValue
  };
}
