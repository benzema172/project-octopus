export type OfflineWarehouseScan = {
  eventId: string;
  code: string;
  occurredAt: string;
  warehouseId?: string;
  locationId?: string;
  stockItemId?: string;
  logisticUnitId?: string;
  quantity?: number;
  note?: string;
};

const KEY = "octopus:warehouse:offline-scans:v1";
const MAX = 200;

function storage() { return typeof window === "undefined" ? null : window.localStorage; }
function parse(raw: string | null): OfflineWarehouseScan[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((row): row is OfflineWarehouseScan => !!row && typeof row === "object" && typeof (row as OfflineWarehouseScan).eventId === "string" && typeof (row as OfflineWarehouseScan).code === "string").slice(-MAX) : [];
  } catch { return []; }
}
function write(rows: OfflineWarehouseScan[]) { storage()?.setItem(KEY, JSON.stringify(rows.slice(-MAX))); }

export function pendingWarehouseScans() { return parse(storage()?.getItem(KEY) ?? null); }

export function enqueueWarehouseScan(input: Omit<OfflineWarehouseScan, "eventId" | "occurredAt"> & Partial<Pick<OfflineWarehouseScan, "eventId" | "occurredAt">>) {
  const eventId = input.eventId || (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `scan-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const row: OfflineWarehouseScan = { ...input, eventId, occurredAt: input.occurredAt || new Date().toISOString() };
  const rows = pendingWarehouseScans();
  if (!rows.some(item => item.eventId === eventId)) rows.push(row);
  write(rows);
  return row;
}

export async function flushWarehouseScans(workspaceId: string) {
  const queue = pendingWarehouseScans();
  if (!queue.length) return { sent: 0, pending: 0 };
  let sent = 0;
  const pending: OfflineWarehouseScan[] = [];
  for (const row of queue) {
    try {
      const response = await fetch("/api/company/warehouse-market", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action: "mobile_scan_event", payload: row })
      });
      if (!response.ok) pending.push(row); else sent += 1;
    } catch { pending.push(row); }
  }
  write(pending);
  return { sent, pending: pending.length };
}

export function clearWarehouseScanQueue() { storage()?.removeItem(KEY); }
