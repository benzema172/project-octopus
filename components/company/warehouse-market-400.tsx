"use client";

import {
  useEffect, useMemo, useState, useTransition,
  type ComponentProps, type FormEvent, type ReactNode
} from "react";
import { useRouter } from "next/navigation";
import {
  Boxes, BrainCircuit, PackageCheck, PlugZap, RotateCcw,
  ScanLine, Send, Truck, Undo2
} from "lucide-react";
import { WarehouseWorkspace300 } from "@/components/company/warehouse-workspace-300";
import {
  enqueueWarehouseScan, flushWarehouseScans, pendingWarehouseScans
} from "@/lib/warehouse/offline-scan-queue";
import styles from "./warehouse-market-400.module.css";

type Props = ComponentProps<typeof WarehouseWorkspace300>;
type Row = Record<string, unknown>;
type Mode = "operations" | "wms" | "planning" | "suppliers" | "shipping" | "integrations";
type Field = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "textarea" | "select";
  required?: boolean;
  options?: Array<[string, string]>;
  rows?: Row[];
  rowLabel?: (row: Row) => string;
  full?: boolean;
  placeholder?: string;
};

const text = (value: unknown, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
const number = (value: unknown, digits = 1) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number(value ?? 0) || 0);
const money = (value: unknown) => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(Number(value ?? 0) || 0);
const dateLabel = (value: unknown) => {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("pl-PL").format(date);
};
const itemLabel = (row: Row) => `${text(row.name)}${row.sku ? ` · ${text(row.sku)}` : ""}`;
const projectLabel = (row: Row) => text(row.name);
const employeeLabel = (row: Row) => `${text(row.first_name, "")} ${text(row.last_name, "")}`.trim() || text(row.employee_number);
const statusTone = (value: unknown) => {
  const status = String(value);
  if (["available", "active", "done", "delivered", "approved", "ready", "executed"].includes(status)) return styles.good;
  if (["blocked", "critical", "error", "expired", "rejected", "exception"].includes(status)) return styles.bad;
  return styles.warn;
};

function Kpi({ label, value }: { label: string; value: ReactNode }) {
  return <div className={styles.kpi}><small>{label}</small><strong>{value}</strong></div>;
}
function Badge({ children, tone = styles.badge }: { children: ReactNode; tone?: string }) {
  return <span className={tone}>{children}</span>;
}
function Panel({ title, kicker, children, wide = false }: { title: string; kicker?: string; children: ReactNode; wide?: boolean }) {
  return <section className={`${styles.panel} ${wide ? styles.wide : ""}`}>
    <div className={styles.head}>{kicker ? <small>{kicker}</small> : null}<h2>{title}</h2></div>
    {children}
  </section>;
}
function MiniForm({ title, action, fields, pending, disabled, onSubmit }: {
  title: string; action: string; fields: Field[]; pending: boolean; disabled?: boolean;
  onSubmit: (action: string, event: FormEvent<HTMLFormElement>) => void;
}) {
  return <details className={styles.form}>
    <summary>{title}</summary>
    <form onSubmit={(event) => onSubmit(action, event)}>
      <div className={styles.fields}>{fields.map((field) => <label key={field.name} className={field.full ? styles.full : undefined}>
        <span>{field.label}</span>
        {field.type === "textarea" ? <textarea name={field.name} required={field.required} placeholder={field.placeholder} />
          : field.options || field.rows || field.type === "select" ? <select name={field.name} required={field.required}>
            <option value="">Wybierz</option>
            {field.options?.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            {field.rows?.map((row) => <option key={String(row.id)} value={String(row.id)}>{field.rowLabel ? field.rowLabel(row) : text(row.name ?? row.id)}</option>)}
          </select>
          : <input name={field.name} type={field.type ?? "text"} required={field.required} placeholder={field.placeholder} step={field.type === "number" ? "any" : undefined} />}
      </label>)}</div>
      <button className={styles.primary} disabled={disabled || pending}>{pending ? "Zapisywanie…" : "Zapisz"}</button>
    </form>
  </details>;
}

export function WarehouseMarket400(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("operations");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [scanCode, setScanCode] = useState("");
  const [queued, setQueued] = useState(0);
  const data = props.data as Record<string, unknown>;

  const items = ((data.warehousePlanningItems ?? data.catalogItems ?? data.items) ?? []) as Row[];
  const warehouses = (data.warehouses ?? []) as Row[];
  const projects = (data.projects ?? []) as Row[];
  const employees = (data.employees ?? []) as Row[];
  const counterparties = (data.counterparties ?? []) as Row[];
  const movementLines = (data.lines ?? []) as Row[];
  const locations = ((data.warehouseLocations400 ?? data.warehouseLocations) ?? []) as Row[];
  const lots = (data.stockLots ?? []) as Row[];
  const units = (data.logisticUnits ?? []) as Row[];
  const tasks = (data.warehouseTasks400 ?? []) as Row[];
  const crossdock = (data.crossdockLinks ?? []) as Row[];
  const scores = (data.supplierScores400 ?? []) as Row[];
  const returns = (data.warehouseReturns400 ?? []) as Row[];
  const forecasts = (data.warehouseForecasts400 ?? []) as Row[];
  const readiness = (data.materialReadiness400 ?? []) as Row[];
  const recommendations = (data.warehouseAiRecommendations400 ?? []) as Row[];
  const integrations = (data.warehouseIntegrations400 ?? []) as Row[];
  const events = (data.warehouseDeviceEvents400 ?? []) as Row[];
  const shipments = (data.warehouseShipments400 ?? []) as Row[];
  const summary = (data.warehouse400Summary ?? {}) as Row;

  const itemById = useMemo(() => new Map(items.map((row) => [String(row.id), row])), [items]);
  const projectById = useMemo(() => new Map(projects.map((row) => [String(row.id), row])), [projects]);
  const counterpartyById = useMemo(() => new Map(counterparties.map((row) => [String(row.id), row])), [counterparties]);
  const latestReadiness = useMemo(() => {
    const byProject = new Map<string, Row>();
    readiness.forEach((row) => { const id = String(row.project_id); if (!byProject.has(id)) byProject.set(id, row); });
    return [...byProject.values()];
  }, [readiness]);
  const modes: Array<[Mode, string, ReactNode]> = [
    ["operations", "Operacje", <Boxes size={14} key="operations" />],
    ["wms", "WMS i partie", <PackageCheck size={14} key="wms" />],
    ["planning", "Planowanie AI", <BrainCircuit size={14} key="planning" />],
    ["suppliers", "Dostawcy i zwroty", <Undo2 size={14} key="returns" />],
    ["shipping", "Wysyłki", <Truck size={14} key="shipping" />],
    ["integrations", "Skanery i integracje", <PlugZap size={14} key="integrations" />]
  ];

  useEffect(() => {
    setQueued(pendingWarehouseScans().length);
    const onOnline = () => {
      void flushWarehouseScans(props.workspaceId).then((result) => {
        setQueued(result.pending);
        if (result.sent) { setMessage(`Wysłano ${result.sent} skanów zapisanych offline.`); router.refresh(); }
      });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [props.workspaceId, router]);

  const run = (action: string, payload: Record<string, unknown>, success = "Operacja została wykonana.") => {
    setMessage(null); setError(null); setIssuedSecret(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/warehouse-market", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId: props.workspaceId, action, payload })
        });
        const output = await response.json().catch(() => ({})) as { error?: string; issuedSecret?: string; result?: { requiresHumanApproval?: boolean } };
        if (!response.ok) throw new Error(output.error ?? "Operacja nie powiodła się.");
        if (output.issuedSecret) setIssuedSecret(output.issuedSecret);
        setMessage(output.result?.requiresHumanApproval ? "Utworzono wyłącznie szkic zamówienia. Oczekuje na zatwierdzenie człowieka." : success);
        router.refresh();
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Operacja nie powiodła się."); }
    });
  };
  const submit = (action: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(action, Object.fromEntries(new FormData(event.currentTarget).entries()));
  };
  const queueScan = async () => {
    const code = scanCode.trim(); if (!code) return;
    const row = enqueueWarehouseScan({ code });
    setScanCode(""); setQueued(pendingWarehouseScans().length);
    if (typeof navigator !== "undefined" && navigator.onLine) {
      const result = await flushWarehouseScans(props.workspaceId);
      setQueued(result.pending);
      if (result.sent) { setMessage(`Skan ${code} zapisano w kolejce zdarzeń Magazynu.`); router.refresh(); }
    } else setMessage(`Skan ${row.code} zapisano offline. Zostanie wysłany po odzyskaniu połączenia.`);
  };

  return <div className={styles.shell} data-warehouse-market="4.0">
    <nav className={styles.modes} aria-label="Magazyn 4.0">{modes.map(([id, label, icon]) => <button type="button" key={id} className={`${styles.mode} ${mode === id ? styles.active : ""}`} onClick={() => setMode(id)}>{icon}{label}</button>)}</nav>
    {mode !== "operations" ? <div className={styles.kpis}>
      <Kpi label="Otwarte zadania WMS" value={text(summary.openTasks, String(tasks.filter((row) => !["done", "cancelled"].includes(String(row.status))).length))} />
      <Kpi label="Partie ≤30 dni" value={text(summary.expiringLots30, String(lots.filter((row) => row.expiry_date).length))} />
      <Kpi label="Zwroty / RMA" value={text(summary.openReturns, String(returns.length))} />
      <Kpi label="Aktywne wysyłki" value={text(summary.activeShipments, String(shipments.length))} />
      <Kpi label="Ryzyko materiałowe" value={text(summary.projectsMaterialRisk, String(latestReadiness.filter((row) => Number(row.score) < 80).length))} />
      <Kpi label="AI Material Planner" value={text(summary.aiRecommendations, String(recommendations.filter((row) => row.status === "new").length))} />
    </div> : null}
    {message ? <div className={`${styles.feedback} ${styles.success}`}>{message}</div> : null}
    {error ? <div className={`${styles.feedback} ${styles.error}`}>{error}</div> : null}
    {issuedSecret ? <div className={styles.guard}><strong>Sekret webhooka — wyświetlany tylko teraz.</strong><code>{issuedSecret}</code><span>/api/integrations/warehouse/ingest?integrationId=ID</span></div> : null}

    {mode === "operations" ? <WarehouseWorkspace300 {...props} /> : null}

    {mode === "wms" ? <div className={styles.grid}>
      <Panel title="Zadania WMS" kicker="Put-away · picking · count · move · pack · cross-dock">
        {props.canWrite ? <MiniForm title="Nowe zadanie" action="task_create" pending={pending} onSubmit={submit} fields={[
          { name: "warehouseId", label: "Magazyn", rows: warehouses, required: true },
          { name: "taskType", label: "Typ", type: "select", options: [["putaway","Put-away"],["pick","Picking"],["replenish_pickface","Uzupełnij pick-face"],["crossdock","Cross-dock"],["count","Inwentaryzacja"],["move","Przesunięcie"],["pack","Pakowanie"],["dispatch","Wydanie"],["return_inspection","Kontrola zwrotu"]], required: true },
          { name: "priority", label: "Priorytet", type: "number" }, { name: "stockItemId", label: "Kartoteka", rows: items, rowLabel: itemLabel },
          { name: "quantity", label: "Ilość", type: "number" }, { name: "sourceLocationId", label: "Z lokalizacji", rows: locations, rowLabel: (row) => `${text(row.code)} · ${text(row.name)}` },
          { name: "targetLocationId", label: "Do lokalizacji", rows: locations, rowLabel: (row) => `${text(row.code)} · ${text(row.name)}` },
          { name: "projectId", label: "Inwestycja", rows: projects, rowLabel: projectLabel }, { name: "assignedEmployeeId", label: "Pracownik", rows: employees, rowLabel: employeeLabel },
          { name: "instructions", label: "Instrukcja", type: "textarea", full: true }
        ]} /> : null}
        <div className={styles.table}><table><thead><tr><th>Typ</th><th>Materiał</th><th>Osoba</th><th>Status</th><th>Akcja</th></tr></thead><tbody>{tasks.slice(0, 40).map((row) => <tr key={String(row.id)}><td>{text(row.task_type)}</td><td>{itemLabel(itemById.get(String(row.stock_item_id)) ?? {})}</td><td>{employeeLabel(employees.find((employee) => String(employee.id) === String(row.assigned_employee_id)) ?? {})}</td><td><Badge tone={statusTone(row.status)}>{text(row.status)}</Badge></td><td>{props.canWrite && !["done","cancelled"].includes(String(row.status)) ? <button className={styles.secondary} onClick={() => run("task_status", { taskId: row.id, status: "done" })}>Zakończ</button> : "—"}</td></tr>)}</tbody></table></div>
      </Panel>
      <Panel title="Partie LOT / FEFO" kicker="Ważność · kwarantanna · koszt · pochodzenie">
        <div className={styles.cards}>{lots.slice(0, 30).map((row) => <div className={styles.card} key={String(row.id)}><h3>{itemLabel(itemById.get(String(row.stock_item_id)) ?? {})}</h3><p>LOT {text(row.lot_number)} · {number(row.remaining_quantity)} · ważność {dateLabel(row.expiry_date)}</p><p><Badge tone={statusTone(row.status)}>{text(row.status)}</Badge>{row.unit_cost ? ` · ${money(row.unit_cost)}` : ""}</p>{props.canWrite && String(row.status) === "available" ? <button className={styles.secondary} onClick={() => run("lot_status", { lotId: row.id, status: "quarantine" })}>Kwarantanna</button> : null}</div>)}</div>
      </Panel>
      <Panel title="Palety / SSCC / jednostki logistyczne" kicker="Kontener → paleta → karton">
        {props.canWrite ? <MiniForm title="Nowa jednostka logistyczna" action="logistic_unit_create" pending={pending} onSubmit={submit} fields={[
          { name: "warehouseId", label: "Magazyn", rows: warehouses, required: true }, { name: "locationId", label: "Lokalizacja", rows: locations, rowLabel: (row) => `${text(row.code)} · ${text(row.name)}` },
          { name: "unitType", label: "Typ", type: "select", options: [["pallet","Paleta"],["carton","Karton"],["container","Kontener"],["bundle","Paczka"],["other","Inne"]] },
          { name: "sscc", label: "SSCC" }, { name: "labelCode", label: "Kod etykiety" }, { name: "grossWeightKg", label: "Masa kg", type: "number" }, { name: "volumeM3", label: "Objętość m³", type: "number" }
        ]} /> : null}
        {props.canWrite ? <MiniForm title="Dodaj pozycję do jednostki" action="logistic_unit_item_add" pending={pending} onSubmit={submit} fields={[
          { name: "logisticUnitId", label: "Jednostka", rows: units, rowLabel: (row) => `${text(row.unit_type)} · ${text(row.sscc ?? row.label_code)}`, required: true },
          { name: "stockItemId", label: "Kartoteka", rows: items, rowLabel: itemLabel, required: true }, { name: "lotId", label: "Partia", rows: lots, rowLabel: (row) => `${text(row.lot_number)} · ${dateLabel(row.expiry_date)}` },
          { name: "quantity", label: "Ilość", type: "number", required: true }, { name: "unit", label: "JM" }
        ]} /> : null}
        <div className={styles.cards}>{units.slice(0, 24).map((row) => <div className={styles.card} key={String(row.id)}><h3>{text(row.unit_type)} · {text(row.sscc ?? row.label_code)}</h3><p>{text(row.location_id)} · <Badge tone={statusTone(row.status)}>{text(row.status)}</Badge></p></div>)}</div>
      </Panel>
      <Panel title="Cross-docking" kicker="Przyjęcie → bezpośrednie wydanie / inwestycja">
        {props.canWrite ? <MiniForm title="Powiąż cross-dock" action="crossdock_create" pending={pending} onSubmit={submit} fields={[
          { name: "inboundMovementLineId", label: "Pozycja przyjęcia", rows: movementLines, rowLabel: (row) => `${text(row.id)} · ${itemLabel(itemById.get(String(row.stock_item_id)) ?? {})}`, required: true },
          { name: "projectId", label: "Inwestycja", rows: projects, rowLabel: projectLabel }, { name: "quantity", label: "Ilość", type: "number", required: true }
        ]} /> : null}
        <p>Aktywne powiązania: <strong>{crossdock.filter((row) => String(row.status) !== "closed").length}</strong></p>
      </Panel>
    </div> : null}

    {mode === "planning" ? <div className={styles.grid}>
      <Panel title="AI Material Planner" kicker="ABC/XYZ · forecast · min/max · Project Material Readiness" wide>
        <div className={styles.guard}><strong>Guardrail zakupowy.</strong><span>Autonomous Replenishment nie wysyła zamówienia do dostawcy. Może utworzyć wyłącznie szkic PO, który wymaga osobnego zatwierdzenia człowieka.</span></div>
        {props.canWrite ? <button className={styles.primary} onClick={() => run("refresh_intelligence", {}, "Przeliczono Digital Worker Magazynu.")}><RotateCcw size={14}/> Przelicz Digital Worker</button> : null}
        <div className={styles.readiness}>{latestReadiness.slice(0, 20).map((row) => <div className={styles.card} key={String(row.id)}><h3>{projectLabel(projectById.get(String(row.project_id)) ?? {})}</h3><strong>{number(row.score)}%</strong><p>{text(row.ready_lines,"0")}/{text(row.required_lines,"0")} pozycji gotowych · braki {text(row.shortage_lines,"0")}</p></div>)}</div>
      </Panel>
      <Panel title="Rekomendacje AI" kicker="Sygnał ≠ automatyczna decyzja">
        <div className={styles.cards}>{recommendations.slice(0, 30).map((row) => {
          const payload = (row.action_payload && typeof row.action_payload === "object" ? row.action_payload : {}) as Row;
          const stockItemId = text(payload.stockItemId ?? row.stock_item_id, "");
          return <div className={styles.card} key={String(row.id)}><h3>{text(row.title)}</h3><p>{text(row.description)}</p><p><Badge tone={statusTone(row.severity)}>{text(row.severity)}</Badge> · {text(row.recommendation_type)}</p><div className={styles.actions}>
            {props.canApprove && String(row.status) === "new" ? <><button className={styles.secondary} onClick={() => run("recommendation_status", { recommendationId: row.id, status: "accepted" })}>Akceptuj sygnał</button><button className={styles.secondary} onClick={() => run("recommendation_status", { recommendationId: row.id, status: "dismissed" })}>Odrzuć</button></> : null}
            {props.canApprove && stockItemId && String(row.recommendation_type) === "shortage" ? <button className={styles.primary} onClick={() => run("autonomous_replenishment", { stockItemId })}>Utwórz szkic PO</button> : null}
          </div></div>;
        })}</div>
      </Panel>
      <Panel title="Strategia kartotek" kicker="FIFO / FEFO / LIFO + polityka zamawiania">
        {props.canWrite ? <MiniForm title="Zmień planowanie kartoteki" action="item_planning_update" pending={pending} onSubmit={submit} fields={[
          { name: "stockItemId", label: "Kartoteka", rows: items, rowLabel: itemLabel, required: true }, { name: "stockStrategy", label: "Rotacja", type: "select", options: [["fifo","FIFO"],["fefo","FEFO"],["lifo","LIFO"]] },
          { name: "reorderPolicy", label: "Polityka", type: "select", options: [["manual","Ręczna"],["minmax","Min/Max"],["forecast","Prognoza"],["project_demand","Popyt inwestycji"]] },
          { name: "leadTimeDays", label: "Lead time [dni]", type: "number" }, { name: "serviceLevelPct", label: "Service level %", type: "number" }, { name: "dynamicMinStock", label: "Min dynamiczny", type: "number" },
          { name: "dynamicMaxStock", label: "Max dynamiczny", type: "number" }, { name: "shelfLifeDays", label: "Shelf-life [dni]", type: "number" }, { name: "gtin", label: "GTIN" },
          { name: "lotTracking", label: "Śledź LOT", type: "select", options: [["true","Tak"],["false","Nie"]] }, { name: "expiryTracking", label: "Śledź ważność", type: "select", options: [["true","Tak"],["false","Nie"]] },
          { name: "gs1Enabled", label: "GS1", type: "select", options: [["true","Tak"],["false","Nie"]] }
        ]} /> : null}
        <div className={styles.table}><table><thead><tr><th>Kartoteka</th><th>ABC/XYZ</th><th>Strategia</th><th>Min/Max</th><th>Prognoza</th></tr></thead><tbody>{items.slice(0, 50).map((row) => { const forecast = forecasts.find((entry) => String(entry.stock_item_id) === String(row.id)); return <tr key={String(row.id)}><td>{itemLabel(row)}</td><td>{text(row.abc_class)}/{text(row.xyz_class)}</td><td>{text(row.stock_strategy)} · {text(row.reorder_policy)}</td><td>{number(row.dynamic_min_stock)} / {number(row.dynamic_max_stock)}</td><td>{forecast ? number(forecast.forecast_quantity) : "—"}</td></tr>; })}</tbody></table></div>
      </Panel>
    </div> : null}

    {mode === "suppliers" ? <div className={styles.grid}>
      <Panel title="AI Supplier Score" kicker="Cena · terminowość · jakość · zwroty">
        <div className={styles.table}><table><thead><tr><th>Dostawca</th><th>Ocena</th><th>Cena</th><th>Dostawy</th><th>Jakość</th><th>Próba</th></tr></thead><tbody>{scores.slice(0, 40).map((row) => <tr key={String(row.id)}><td>{text(counterpartyById.get(String(row.counterparty_id))?.name)}</td><td><strong>{number(row.overall_score)}</strong></td><td>{number(row.price_score)}</td><td>{number(row.delivery_score)}</td><td>{number(row.quality_score)}</td><td>{text(row.sample_count)}</td></tr>)}</tbody></table></div>
      </Panel>
      <Panel title="Zwroty / RMA / reklamacje" kicker="Dostawca · klient · wewnętrzne · gwarancja">
        {props.canWrite ? <MiniForm title="Nowy zwrot / RMA" action="return_create" pending={pending} onSubmit={submit} fields={[
          { name: "returnNumber", label: "Numer" }, { name: "returnType", label: "Typ", type: "select", options: [["supplier","Do dostawcy"],["customer","Od klienta"],["internal","Wewnętrzny"],["warranty","Gwarancja"]] },
          { name: "counterpartyId", label: "Kontrahent", rows: counterparties, rowLabel: (row) => text(row.name) }, { name: "projectId", label: "Inwestycja", rows: projects, rowLabel: projectLabel },
          { name: "rmaNumber", label: "RMA" }, { name: "requestedAt", label: "Data", type: "date" }, { name: "reason", label: "Powód", type: "textarea", full: true }
        ]} /> : null}
        {props.canWrite ? <MiniForm title="Dodaj pozycję zwrotu" action="return_line_add" pending={pending} onSubmit={submit} fields={[
          { name: "returnId", label: "Zwrot", rows: returns, rowLabel: (row) => text(row.return_number), required: true }, { name: "stockItemId", label: "Kartoteka", rows: items, rowLabel: itemLabel, required: true },
          { name: "lotId", label: "Partia", rows: lots, rowLabel: (row) => text(row.lot_number) }, { name: "quantity", label: "Ilość", type: "number", required: true }, { name: "unit", label: "JM" }, { name: "reason", label: "Powód", type: "textarea", full: true }
        ]} /> : null}
        <div className={styles.cards}>{returns.slice(0, 30).map((row) => <div className={styles.card} key={String(row.id)}><h3>{text(row.return_number)} · {text(row.return_type)}</h3><p>{text(counterpartyById.get(String(row.counterparty_id))?.name)} · {dateLabel(row.requested_at)}</p><p><Badge tone={statusTone(row.status)}>{text(row.status)}</Badge>{row.rma_number ? ` · RMA ${text(row.rma_number)}` : ""}</p>{props.canApprove && String(row.status) === "submitted" ? <button className={styles.secondary} onClick={() => run("return_status", { returnId: row.id, status: "approved" })}>Zatwierdź</button> : null}</div>)}</div>
      </Panel>
    </div> : null}

    {mode === "shipping" ? <div className={styles.grid}>
      <Panel title="Wysyłki i kurierzy" kicker="Inbound / outbound · tracking · status" wide>
        {props.canWrite ? <MiniForm title="Nowa przesyłka" action="shipment_create" pending={pending} onSubmit={submit} fields={[
          { name: "warehouseId", label: "Magazyn", rows: warehouses, required: true }, { name: "shipmentNumber", label: "Numer przesyłki" }, { name: "direction", label: "Kierunek", type: "select", options: [["outbound","Wychodząca"],["inbound","Przychodząca"]] },
          { name: "projectId", label: "Inwestycja", rows: projects, rowLabel: projectLabel }, { name: "counterpartyId", label: "Kontrahent", rows: counterparties, rowLabel: (row) => text(row.name) },
          { name: "carrier", label: "Przewoźnik" }, { name: "serviceLevel", label: "Usługa" }, { name: "trackingNumber", label: "Tracking" }, { name: "plannedAt", label: "Planowany termin", type: "datetime-local" }, { name: "note", label: "Notatka", type: "textarea", full: true }
        ]} /> : null}
        <div className={styles.table}><table><thead><tr><th>Numer</th><th>Kierunek</th><th>Przewoźnik</th><th>Tracking</th><th>Inwestycja</th><th>Status</th><th>Akcja</th></tr></thead><tbody>{shipments.slice(0, 50).map((row) => <tr key={String(row.id)}><td>{text(row.shipment_number)}</td><td>{text(row.direction)}</td><td>{text(row.carrier)}</td><td>{text(row.tracking_number)}</td><td>{projectLabel(projectById.get(String(row.project_id)) ?? {})}</td><td><Badge tone={statusTone(row.status)}>{text(row.status)}</Badge></td><td>{props.canApprove && String(row.status) === "ready" ? <button className={styles.secondary} onClick={() => run("shipment_status", { shipmentId: row.id, status: "dispatched" })}>Wydaj</button> : "—"}</td></tr>)}</tbody></table></div>
      </Panel>
    </div> : null}

    {mode === "integrations" ? <div className={styles.grid}>
      <Panel title="Skaner mobilny offline" kicker="Kolejka lokalna → synchronizacja po odzyskaniu sieci">
        <div className={styles.scan}><ScanLine size={22}/><input value={scanCode} onChange={(event) => setScanCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void queueScan(); } }} placeholder="Zeskanuj / wpisz GTIN, SKU, SSCC lub kod lokalizacji"/><button className={styles.primary} onClick={() => void queueScan()} disabled={!scanCode.trim()}>Dodaj skan</button></div>
        <p>Oczekuje offline: <strong>{queued}</strong>. Skan nie zmienia stanu magazynowego — tworzy zdarzenie wymagające potwierdzonego procesu/ruchu.</p>
        {queued > 0 ? <button className={styles.secondary} onClick={() => void flushWarehouseScans(props.workspaceId).then((result) => { setQueued(result.pending); setMessage(`Wysłano ${result.sent}; pozostało ${result.pending}.`); router.refresh(); })}><Send size={14}/> Synchronizuj teraz</button> : null}
      </Panel>
      <Panel title="RFID / wagi / automatyka / WMS" kicker="Uniwersalny webhook urządzeń">
        {props.canWrite ? <MiniForm title="Nowa integracja" action="integration_create" pending={pending} onSubmit={submit} fields={[
          { name: "provider", label: "Provider", placeholder: "generic / RFID / waga / automat" }, { name: "name", label: "Nazwa", required: true }, { name: "mode", label: "Tryb", type: "select", options: [["webhook","Webhook"],["poll","Polling"],["file","Plik"],["manual","Ręczny"]] },
          { name: "capabilities", label: "Możliwości", placeholder: "scan,rfid,weight,automation,shipment_status" }, { name: "notes", label: "Notatki", type: "textarea", full: true }
        ]} /> : null}
        <div className={styles.cards}>{integrations.map((row) => <div className={styles.card} key={String(row.id)}><h3>{text(row.name)} · {text(row.provider)}</h3><p><Badge tone={statusTone(row.status)}>{text(row.status)}</Badge> · ostatnio {dateLabel(row.last_sync_at)}</p><div className={styles.actions}>{props.canWrite ? <button className={styles.secondary} onClick={() => run("integration_rotate_secret", { integrationId: row.id })}>Obróć sekret</button> : null}{props.canApprove && String(row.status) !== "disabled" ? <button className={styles.secondary} onClick={() => run("integration_disable", { integrationId: row.id })}>Wyłącz</button> : null}</div></div>)}</div>
      </Panel>
      <Panel title="Ostatnie zdarzenia urządzeń" kicker="Brak ślepych ruchów magazynowych" wide>
        <div className={styles.table}><table><thead><tr><th>Czas</th><th>Typ</th><th>Kod/źródło</th><th>Kartoteka</th><th>Lokalizacja</th><th>Przetworzone</th></tr></thead><tbody>{events.slice(0, 50).map((row) => <tr key={String(row.id)}><td>{dateLabel(row.occurred_at)}</td><td>{text(row.event_type)}</td><td>{text(row.external_event_id)}</td><td>{itemLabel(itemById.get(String(row.stock_item_id)) ?? {})}</td><td>{text(row.location_id)}</td><td>{row.processed ? "Tak" : "Nie — wymaga procesu"}</td></tr>)}</tbody></table></div>
      </Panel>
    </div> : null}
  </div>;
}
