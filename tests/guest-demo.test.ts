import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDemoBlueprint, validateDemoBlueprint } from "@/lib/demo/blueprint";
import {
  GUEST_AUTH_EMAIL,
  GUEST_AUTH_PASSWORD,
  GUEST_PUBLIC_LOGIN,
  GUEST_PUBLIC_PASSWORD
} from "@/lib/demo/guest-constants";

const reference = new Date("2026-08-17T12:00:00.000Z");
const userId = "11111111-1111-4111-8111-111111111111";

function makeRandom(seed = 0x0c70_2026) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function randomRow<T>(rows: T[], random: () => number) {
  return rows[Math.floor(random() * rows.length) % rows.length];
}

describe("guest demo account contract", () => {
  it("keeps the requested public credentials while using an isolated Supabase identity", () => {
    expect(GUEST_PUBLIC_LOGIN).toBe("gosc");
    expect(GUEST_PUBLIC_PASSWORD).toBe("gosc");
    expect(GUEST_AUTH_EMAIL).not.toBe(GUEST_PUBLIC_LOGIN);
    expect(GUEST_AUTH_EMAIL).toContain("@");
    expect(GUEST_AUTH_PASSWORD.length).toBeGreaterThanOrEqual(12);
    expect(GUEST_AUTH_PASSWORD).not.toBe(GUEST_PUBLIC_PASSWORD);
  });

  it("wires the existing login flow to the guest bootstrap endpoint", () => {
    const clientSource = readFileSync(resolve(process.cwd(), "lib/supabase/client.ts"), "utf8");
    const routeSource = readFileSync(resolve(process.cwd(), "app/api/auth/guest/route.ts"), "utf8");
    expect(clientSource).toContain("/api/auth/guest");
    expect(clientSource).toContain("GUEST_PUBLIC_LOGIN");
    expect(routeSource).toContain("ensureGuestDemoAccount");
    expect(routeSource).toContain("GUEST_PUBLIC_PASSWORD");
  });
});

describe("coherent full-application demo dataset", () => {
  const demo = buildDemoBlueprint(userId, reference);

  it("fills every major operational area with meaningful records", () => {
    expect(validateDemoBlueprint(demo)).toEqual([]);
    expect(demo.projects.length).toBeGreaterThanOrEqual(8);
    expect(demo.projectFacts.length).toBe(demo.projects.length);
    expect(demo.documents.length).toBeGreaterThanOrEqual(30);
    expect(demo.boqItems.length).toBeGreaterThanOrEqual(40);
    expect(demo.wbsNodes.length).toBeGreaterThanOrEqual(40);
    expect(demo.scheduleActivities.length).toBeGreaterThanOrEqual(40);
    expect(demo.invoices.length).toBeGreaterThanOrEqual(20);
    expect(demo.employees.length).toBeGreaterThanOrEqual(12);
    expect(demo.stockItems.length).toBeGreaterThanOrEqual(16);
    expect(demo.vehicles.length).toBeGreaterThanOrEqual(6);
    expect(demo.knowledgeEntries.length).toBeGreaterThanOrEqual(8);
    expect(demo.notifications.length).toBeGreaterThanOrEqual(4);
  });

  it("contains distinct project scenarios instead of duplicated placeholders", () => {
    expect(new Set(demo.projects.map((row) => row.name)).size).toBe(demo.projects.length);
    expect(demo.projects.some((row) => row.status === "active")).toBe(true);
    expect(demo.projects.some((row) => row.status === "completed")).toBe(true);
    expect(demo.projects.some((row) => row.status === "planned")).toBe(true);
    expect(demo.projectFacts.some((row) => String((row.value_json as Record<string, unknown>).completionDate) < "2026-08-17")).toBe(true);
  });

  it("survives 10,000 deterministic cross-module integrity probes", () => {
    const random = makeRandom();
    const projectIds = new Set(demo.projects.map((row) => String(row.id)));
    const employeeIds = new Set(demo.employees.map((row) => String(row.id)));
    const vehicleIds = new Set(demo.vehicles.map((row) => String(row.id)));
    const warehouseIds = new Set(demo.warehouses.map((row) => String(row.id)));
    const stockIds = new Set(demo.stockItems.map((row) => String(row.id)));
    const invoiceIds = new Set(demo.invoices.map((row) => String(row.id)));
    const boqById = new Map(demo.boqItems.map((row) => [String(row.id), row]));

    for (let probe = 0; probe < 10_000; probe += 1) {
      switch (probe % 10) {
        case 0: {
          const row = randomRow(demo.projectFacts, random);
          expect(projectIds.has(String(row.project_id))).toBe(true);
          const profile = row.value_json as Record<string, unknown>;
          expect(String(profile.projectName).length).toBeGreaterThan(5);
          expect(String(profile.contractNumber).length).toBeGreaterThan(3);
          expect(Number(profile.contractValue)).toBeGreaterThan(0);
          break;
        }
        case 1: {
          const row = randomRow(demo.boqItems, random);
          expect(projectIds.has(String(row.project_id))).toBe(true);
          expect(Number(row.quantity)).toBeGreaterThan(0);
          expect(Number(row.quantity_executed)).toBeLessThanOrEqual(Number(row.quantity) + 0.001);
          expect(Number(row.quantity_accepted)).toBeLessThanOrEqual(Number(row.quantity_executed) + 0.001);
          break;
        }
        case 2: {
          const row = randomRow(demo.invoices, random);
          expect(Number(row.gross_amount)).toBeGreaterThanOrEqual(Number(row.paid_amount));
          expect(["purchase", "sale"]).toContain(row.direction);
          const allocation = demo.financialAllocations.find((item) => item.source_id === row.id);
          expect(allocation).toBeTruthy();
          expect(projectIds.has(String(allocation?.project_id))).toBe(true);
          break;
        }
        case 3: {
          const row = randomRow(demo.assignments, random);
          expect(projectIds.has(String(row.project_id))).toBe(true);
          expect(employeeIds.has(String(row.employee_id))).toBe(true);
          expect(Number(row.allocation_percent)).toBeGreaterThan(0);
          expect(Number(row.allocation_percent)).toBeLessThanOrEqual(100);
          break;
        }
        case 4: {
          const row = randomRow(demo.reservations, random);
          expect(projectIds.has(String(row.project_id))).toBe(true);
          expect(warehouseIds.has(String(row.warehouse_id))).toBe(true);
          expect(stockIds.has(String(row.stock_item_id))).toBe(true);
          expect(Number(row.quantity)).toBeGreaterThan(0);
          break;
        }
        case 5: {
          const row = randomRow(demo.vehicleAllocations, random);
          expect(vehicleIds.has(String(row.vehicle_id))).toBe(true);
          expect(projectIds.has(String(row.project_id))).toBe(true);
          expect(employeeIds.has(String(row.employee_id))).toBe(true);
          const from = String(row.date_from ?? row.allocated_from ?? "");
          const to = String(row.date_to ?? row.allocated_to ?? "");
          expect(from).not.toBe("");
          expect(!to || from <= to).toBe(true);
          break;
        }
        case 6: {
          const row = randomRow(demo.scheduleActivities, random);
          expect(projectIds.has(String(row.project_id))).toBe(true);
          expect(String(row.planned_start) <= String(row.planned_finish)).toBe(true);
          expect(Number(row.actual_progress)).toBeGreaterThanOrEqual(0);
          expect(Number(row.actual_progress)).toBeLessThanOrEqual(1);
          break;
        }
        case 7: {
          const row = randomRow(demo.progressEntries, random);
          const boq = boqById.get(String(row.boq_item_id));
          expect(boq).toBeTruthy();
          expect(Number(row.quantity_accepted)).toBeLessThanOrEqual(Number(row.quantity_executed));
          expect(Number(row.quantity_executed)).toBeLessThanOrEqual(Number(boq?.quantity ?? 0) + 0.001);
          break;
        }
        case 8: {
          const row = randomRow(demo.closeoutRequirements, random);
          expect(projectIds.has(String(row.project_id))).toBe(true);
          expect(["missing", "in_progress", "complete"]).toContain(row.status);
          expect(String(row.title).length).toBeGreaterThan(4);
          break;
        }
        default: {
          const row = randomRow(demo.notifications, random);
          expect(row.workspace_id).toBe(demo.workspace.id);
          expect(["info", "warning", "critical"]).toContain(row.severity);
          expect(String(row.title).length).toBeGreaterThan(5);
          const invoice = randomRow(demo.financialAllocations, random);
          expect(invoiceIds.has(String(invoice.source_id))).toBe(true);
        }
      }
    }
  });
});
