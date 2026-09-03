"use client";

import { useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CarFront, ChartNoAxesCombined, Check, ClipboardCheck, FileClock, FileText,
  Fuel, Gauge, LayoutDashboard, PackageCheck, Plus, Save, Search, ShieldCheck, Sparkles,
  TriangleAlert, Undo2, Wrench
} from "lucide-react";
import { ModuleDropzoneLink } from "@/components/documents/module-dropzone-link";
import { ServerPagination } from "@/components/system/server-pagination";
import type { Data, PageMeta, Row } from "@/components/company/operations/module-shell";
import styles from "./fleet-workspace-300.module.css";

type Tab = "dashboard" | "vehicles" | "waiting" | "operations" | "service" | "documents" | "equipment" | "damages" | "costs";
type Props = { workspaceId: string; data: Data; canWrite: boolean; canApprove: boolean; query?: string };
type Option = [string, string];
type MiniField = {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "select" | "textarea";
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  options?: Option[];
  rows?: Row[];
  rowLabel?: (row: Row) => string;
  full?: boolean;
};
type UndoState = { eventId: string; label: string } | null;

type ReviewPreview = { review_id?: unknown; document_version_id?: unknown; file_name?: unknown; mime_type?: unknown; excerpt?: unknown };

const text = (value: unknown, fallback = "—") => value === undefined || value === null || value === "" ? fallback : String(value);
const raw = (value: unknown) => value === undefined || value === null ? "" : String(value);
const number = (value: unknown) => Number(value ?? 0) || 0;
const num = (value: unknown, digits = 1) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(number(value));
const money = (value: unknown, currency = "PLN") => new Intl.NumberFormat("pl-PL", { style: "currency", currency: currency || "PLN", maximumFractionDigits: 2 }).format(number(value));
const dateLabel = (value: unknown) => {
  if (!value) return "—";
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat("pl-PL").format(parsed);
};
const statusLabel: Record<string, string> = {
  active: "Aktywny", inactive: "Nieaktywny", service: "W serwisie", sold: "Sprzedany",
  open: "Otwarte", closed: "Zamknięte", cancelled: "Anulowane", reported: "Zgłoszona",
  ready: "Gotowe", waiting: "Do decyzji", applied: "Zastosowano", ignored: "Pominięto",
  valid: "Ważny", expired: "Wygasły", ok: "OK", attention: "Uwagi", blocked: "Blokada",
  resolved: "Rozwiązany", acknowledged: "Przyjęty"
};
const labelStatus = (value: unknown) => statusLabel[String(value ?? "")] ?? text(value);
const normalize = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("pl");
const vehicleLabel = (row: Row) => `${text(row.registration_number)} · ${`${raw(row.make)} ${raw(row.model)}`.trim() || text(row.vehicle_type)}`;
const employeeLabel = (row: Row) => `${raw(row.first_name)} ${raw(row.last_name)}`.trim() || text(row.employee_number);
const projectLabel = (row: Row) => text(row.name);
const counterpartyLabel = (row: Row) => text(row.name);

const tabs: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: "dashboard", label: "Pulpit", icon: <LayoutDashboard size={15} /> },
  { id: "vehicles", label: "Pojazdy", icon: <CarFront size={15} /> },
  { id: "waiting", label: "Poczekalnia AI", icon: <FileClock size={15} /> },
  { id: "operations", label: "Eksploatacja", icon: <Gauge size={15} /> },
  { id: "service", label: "Serwis", icon: <Wrench size={15} /> },
  { id: "documents", label: "Dokumenty i terminy", icon: <FileText size={15} /> },
  { id: "equipment", label: "Wyposażenie i opony", icon: <PackageCheck size={15} /> },
  { id: "damages", label: "Szkody i bezpieczeństwo", icon: <ShieldCheck size={15} /> },
  { id: "costs", label: "Koszty i wykorzystanie", icon: <ChartNoAxesCombined size={15} /> }
];

function Badge({ value, tone = "neutral" }: { value: ReactNode; tone?: "neutral" | "good" | "warn" | "bad" }) {
  const className = tone === "good" ? styles.badgeGood : tone === "warn" ? styles.badgeWarn : tone === "bad" ? styles.badgeBad : styles.badge;
  return <span className={className}>{value}</span>;
}

function Kpi({ label, value, caption, attention = false }: { label: string; value: ReactNode; caption: string; attention?: boolean }) {
  return <article className={`${styles.kpi} ${attention ? styles.kpiAttention : ""}`}><small>{label}</small><strong>{value}</strong><p>{caption}</p></article>;
}

function Panel({ title, kicker, children, wide = false, aside }: { title: string; kicker?: string; children: ReactNode; wide?: boolean; aside?: ReactNode }) {
  return <article className={`${styles.panel} ${wide ? styles.panelWide : ""}`}>
    <div className={styles.heading}><div>{kicker ? <small>{kicker}</small> : null}<h2>{title}</h2></div>{aside}</div>
    {children}
  </article>;
}

function MiniForm({ title, action, success, fields, pending, disabled, onSubmit }: {
  title: string;
  action: string;
  success: string;
  fields: MiniField[];
  pending: boolean;
  disabled?: boolean;
  onSubmit: (action: string, success: string, event: FormEvent<HTMLFormElement>) => void;
}) {
  return <details className={`${styles.formCard} ${disabled ? styles.locked : ""}`}>
    <summary><span>{title}</span><Plus size={14} /></summary>
    <form className={styles.form} onSubmit={(event) => onSubmit(action, success, event)}>
      <div className={styles.fields}>
        {fields.map((field) => <label key={field.name} className={field.full ? styles.full : undefined}>
          <span>{field.label}</span>
          {field.type === "textarea" ? <textarea name={field.name} required={field.required} placeholder={field.placeholder} defaultValue={field.defaultValue} /> : field.rows || field.options || field.type === "select" ? (
            <select name={field.name} required={field.required} defaultValue={field.defaultValue ?? ""}>
              <option value="">{field.placeholder ?? (field.required ? "Wybierz" : "—")}</option>
              {field.options?.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              {field.rows?.map((row) => <option value={String(row.id)} key={String(row.id)}>{field.rowLabel ? field.rowLabel(row) : text(row.name ?? row.id)}</option>)}
            </select>
          ) : <input name={field.name} type={field.type ?? "text"} required={field.required} placeholder={field.placeholder} defaultValue={field.defaultValue} step={field.type === "number" ? "any" : undefined} />}
        </label>)}
      </div>
      <div className={styles.actionRow}><button className={styles.button} type="submit" disabled={disabled || pending}><Save size={14} />{pending ? "Zapisywanie…" : "Zapisz"}</button></div>
    </form>
  </details>;
}

function Empty({ children }: { children: ReactNode }) { return <div className={styles.empty}>{children}</div>; }

export function FleetWorkspace300({ workspaceId, data, canWrite, canApprove, query = "" }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<Tab>(query ? "vehicles" : "dashboard");
  const [search, setSearch] = useState(query);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState>(null);

  const vehicles = (data.vehicles ?? []) as Row[];
  const allVehicles = ((data.allVehicles ?? data.vehicles) ?? []) as Row[];
  const projects = (data.projects ?? []) as Row[];
  const employees = (data.employees ?? []) as Row[];
  const counterparties = (data.counterparties ?? []) as Row[];
  const summary = (data.summary ?? {}) as Row;
  const fuel = (data.fuel ?? []) as Row[];
  const trips = (data.trips ?? []) as Row[];
  const service = (data.service ?? []) as Row[];
  const serviceItems = (data.serviceItems ?? []) as Row[];
  const servicePlans = (data.servicePlans ?? []) as Row[];
  const documents = (data.documents ?? []) as Row[];
  const damages = (data.damages ?? []) as Row[];
  const allocations = (data.allocations ?? []) as Row[];
  const readings = (data.readings ?? []) as Row[];
  const costRates = (data.costRates ?? []) as Row[];
  const components = (data.components ?? []) as Row[];
  const vehicleStock = (data.vehicleStock ?? []) as Row[];
  const availableVehicleAssets = (data.availableVehicleAssets ?? []) as Row[];
  const stockItems = (data.vehicleStockItems ?? []) as Row[];
  const requiredQualifications = (data.requiredQualifications ?? []) as Row[];
  const checks = (data.checks ?? []) as Row[];
  const qualifications = (data.qualifications ?? []) as Row[];
  const reviews = (data.reviews ?? []) as Row[];
  const reviewPreviews = (data.reviewPreviews ?? []) as ReviewPreview[];
  const decisionEvents = (data.decisionEvents ?? []) as Row[];
  const anomalies = (data.anomalies ?? []) as Row[];
  const costLinks = (data.costLinks ?? []) as Row[];
  const referenceDate = String(data.referenceDate ?? new Date().toISOString().slice(0, 10));
  const page = (data.page ?? { page: 1, pageSize: Math.max(vehicles.length, 1), total: vehicles.length }) as PageMeta;

  const vehicleById = useMemo(() => new Map(allVehicles.map((row) => [String(row.id), row])), [allVehicles]);
  const employeeById = useMemo(() => new Map(employees.map((row) => [String(row.id), row])), [employees]);
  const projectById = useMemo(() => new Map(projects.map((row) => [String(row.id), row])), [projects]);
  const stockItemById = useMemo(() => new Map(stockItems.map((row) => [String(row.id), row])), [stockItems]);
  const previewByReview = useMemo(() => new Map(reviewPreviews.map((row) => [String(row.review_id ?? ""), row])), [reviewPreviews]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string>(() => String(allVehicles[0]?.id ?? ""));
  const selectedVehicle = vehicleById.get(selectedVehicleId) ?? allVehicles[0] ?? null;

  const openReviews = reviews.filter((row) => ["waiting", "ready"].includes(String(row.status)));
  const criticalAnomalies = anomalies.filter((row) => String(row.status) === "open" && String(row.severity) === "critical");
  const openAnomalies = anomalies.filter((row) => String(row.status) === "open");
  const expiredDocuments = documents.filter((row) => row.valid_until && String(row.valid_until) < referenceDate);
  const dueDocuments = documents.filter((row) => row.valid_until && String(row.valid_until) >= referenceDate && String(row.valid_until) <= new Date(new Date(referenceDate).getTime() + 30 * 86400000).toISOString().slice(0, 10));
  const openService = service.filter((row) => !["closed", "cancelled"].includes(String(row.status)));
  const dueServicePlans = servicePlans.filter((row) => row.active !== false && row.next_due_date && String(row.next_due_date) <= new Date(new Date(referenceDate).getTime() + 30 * 86400000).toISOString().slice(0, 10));

  const requiredByVehicle = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const row of requiredQualifications) {
      const id = String(row.vehicle_id ?? "");
      map.set(id, [...(map.get(id) ?? []), String(row.qualification_type ?? "")].filter(Boolean));
    }
    return map;
  }, [requiredQualifications]);
  const qualificationsByEmployee = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of qualifications) {
      const id = String(row.employee_id ?? "");
      map.set(id, [...(map.get(id) ?? []), row]);
    }
    return map;
  }, [qualifications]);
  const missingQualificationCount = (vehicle: Row) => {
    const required = requiredByVehicle.get(String(vehicle.id)) ?? [];
    if (!required.length) return 0;
    const employeeId = String(vehicle.responsible_employee_id ?? "");
    if (!employeeId) return required.length;
    const employeeQualifications = qualificationsByEmployee.get(employeeId) ?? [];
    return required.filter((requiredType) => !employeeQualifications.some((row) => normalize(row.qualification_type) === normalize(requiredType) && !["expired", "revoked"].includes(String(row.status)) && (!row.valid_until || String(row.valid_until) >= referenceDate))).length;
  };
  const notReadyVehicles = allVehicles.filter((vehicle) => String(vehicle.status) === "active" && missingQualificationCount(vehicle) > 0);

  const costByVehicle = useMemo(() => {
    const map = new Map<string, { total: number; fuel: number; service: number; damage: number; other: number }>();
    for (const row of costLinks) {
      const id = String(row.vehicle_id ?? "");
      const current = map.get(id) ?? { total: 0, fuel: 0, service: 0, damage: 0, other: 0 };
      const value = number(row.amount);
      current.total += value;
      const type = normalize(row.cost_type);
      if (type.includes("fuel") || type.includes("paliw")) current.fuel += value;
      else if (type.includes("service") || type.includes("serwis")) current.service += value;
      else if (type.includes("damage") || type.includes("szkod")) current.damage += value;
      else current.other += value;
      map.set(id, current);
    }
    return map;
  }, [costLinks]);
  const distanceByVehicle = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of trips) {
      const id = String(row.vehicle_id ?? "");
      map.set(id, (map.get(id) ?? 0) + number(row.distance_km));
    }
    return map;
  }, [trips]);

  const run = (action: string, payload: Record<string, unknown>, success: string) => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/fleet-core", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, action, payload })
        });
        const result = await response.json().catch(() => ({})) as { error?: string; eventId?: string; id?: string };
        if (!response.ok) throw new Error(result.error ?? "Operacja Floty nie powiodła się.");
        setMessage(success);
        if (result.eventId && action === "ai_review_accept") setUndo({ eventId: result.eventId, label: success });
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Operacja Floty nie powiodła się.");
      }
    });
  };
  const submit = (action: string, success: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const payload = Object.fromEntries(new FormData(form).entries());
    run(action, payload, success);
    if (!pending) form.reset();
  };
  const undoLast = () => {
    if (!undo) return;
    const eventId = undo.eventId;
    setUndo(null);
    run("ai_undo", { eventId }, "Cofnięto ostatnią decyzję AI.");
  };
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTab("vehicles");
    router.push(`/workspace/companies/${workspaceId}/fleet?page=1${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}`);
  };

  const vehicleRows = allVehicles;
  const activeVehicleRows = allVehicles.filter((row) => String(row.status) === "active");
  const serviceSelectRows = openService.map((row) => ({ ...row, name: `${text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · ${text(row.service_type)} · ${dateLabel(row.opened_at)}` }));
  const damageSelectRows = damages.filter((row) => String(row.status) !== "closed").map((row) => ({ ...row, name: `${text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · ${text(row.claim_number, "bez nr szkody")} · ${dateLabel(row.occurred_at)}` }));
  const componentSelectRows = components.filter((row) => row.active !== false).map((row) => ({ ...row, name: `${text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · ${text(row.name)}` }));
  const availableAssetOptions = availableVehicleAssets.map((row) => ({ ...row, name: `${text(stockItemById.get(String(row.stock_item_id))?.name, "Sprzęt")} · ${text(row.asset_tag ?? row.serial_number, "bez oznaczenia")}` }));

  return <section className={styles.workspace} data-fleet-experience="3.0">
    <form className={styles.searchbar} onSubmit={submitSearch}>
      <label><Search size={17} /><span className={styles.srOnly}>Szukaj pojazdu</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj po rejestracji, VIN, marce lub modelu…" /></label>
      {canWrite ? <ModuleDropzoneLink workspaceId={workspaceId} sourceModule="fleet" variant="primary" /> : null}
    </form>

    <div className={styles.kpis}>
      <Kpi label="Aktywne pojazdy" value={text(summary.activeVehicles, "0")} caption={`${text(summary.vehicles, "0")} wszystkich pojazdów i maszyn`} />
      <Kpi label="Dokumenty / 30 dni" value={text(summary.documentsDue30, String(dueDocuments.length))} caption={`${text(summary.expiredDocuments, String(expiredDocuments.length))} już wygasłych`} attention={expiredDocuments.length > 0} />
      <Kpi label="Serwis / 30 dni" value={text(summary.servicesDue30, String(dueServicePlans.length))} caption={`${text(summary.openServices, String(openService.length))} otwartych zleceń`} attention={openService.length > 0} />
      <Kpi label="Poczekalnia AI" value={openReviews.length} caption={`${text(summary.readyAi, "0")} jednoznacznych dopasowań`} attention={openReviews.length > 0} />
      <Kpi label="Alerty krytyczne" value={criticalAnomalies.length} caption={`${openAnomalies.length} otwartych alertów`} attention={criticalAnomalies.length > 0} />
      <Kpi label="Koszt miesiąca" value={money(summary.monthCost)} caption={`${notReadyVehicles.length} pojazdów z brakami uprawnień`} attention={notReadyVehicles.length > 0} />
    </div>

    <div className={styles.toolbar}><nav className={styles.tabs} aria-label="Sekcje Fleet Core 3.0">
      {tabs.map((item) => <button type="button" key={item.id} className={`${styles.tab} ${tab === item.id ? styles.tabActive : ""}`} onClick={() => setTab(item.id)}>{item.icon}{item.label}{item.id === "waiting" && openReviews.length ? <b>{openReviews.length}</b> : item.id === "damages" && criticalAnomalies.length ? <b>{criticalAnomalies.length}</b> : null}</button>)}
    </nav></div>

    {message ? <div className={`${styles.feedback} ${styles.feedbackSuccess}`}><span><Check size={14} /> {message}</span>{undo ? <button type="button" onClick={undoLast}><Undo2 size={13} /> Cofnij</button> : null}</div> : null}
    {error ? <div className={`${styles.feedback} ${styles.feedbackError}`}><span><AlertTriangle size={14} /> {error}</span><button type="button" onClick={() => setError(null)}>Zamknij</button></div> : null}
    {!canWrite ? <div className={styles.warning}><AlertTriangle size={15} /><span>Masz dostęp tylko do odczytu. Zapisy i decyzje są ukryte lub zablokowane.</span></div> : null}

    {tab === "dashboard" ? <div className={styles.grid}>
      <Panel title="Do decyzji" kicker="Dzisiaj">
        <div className={styles.list}>
          <div className={styles.listItem}><span>Poczekalnia AI</span><strong>{openReviews.length}</strong></div>
          <div className={styles.listItem}><span>Krytyczne alerty</span><strong>{criticalAnomalies.length}</strong></div>
          <div className={styles.listItem}><span>Wygasłe dokumenty</span><strong>{expiredDocuments.length}</strong></div>
          <div className={styles.listItem}><span>Otwarte serwisy</span><strong>{openService.length}</strong></div>
          <div className={styles.listItem}><span>Blokady po kontroli</span><strong>{text(summary.blockedChecks, "0")}</strong></div>
        </div>
        <div className={styles.actionRow}><button className={styles.buttonSecondary} type="button" onClick={() => setTab("waiting")}><Sparkles size={14} />Poczekalnia AI</button><button className={styles.buttonSecondary} type="button" onClick={() => setTab("damages")}><ShieldCheck size={14} />Ryzyka</button></div>
      </Panel>
      <Panel title="Gotowość floty" kicker="Kadry + pojazdy">
        {notReadyVehicles.length ? <div className={styles.cards}>{notReadyVehicles.slice(0, 6).map((vehicle) => <div className={styles.warning} key={String(vehicle.id)}><TriangleAlert size={14} /><span><strong>{vehicleLabel(vehicle)}</strong><br />Brakuje {missingQualificationCount(vehicle)} wymaganych uprawnień osobie odpowiedzialnej.</span></div>)}</div> : <div className={styles.success}><ShieldCheck size={14} /><span>Aktywne pojazdy z określonymi wymaganiami mają komplet ważnych uprawnień.</span></div>}
      </Panel>
      <Panel title="Najbliższe terminy" kicker="Dokumenty i serwis">
        <div className={styles.list}>
          {[...expiredDocuments, ...dueDocuments].slice(0, 5).map((row) => <div className={styles.listItem} key={String(row.id)}><span>{text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · {text(row.document_type)}</span><strong>{dateLabel(row.valid_until)}</strong></div>)}
          {dueServicePlans.slice(0, 5).map((row) => <div className={styles.listItem} key={String(row.id)}><span>{text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · {text(row.name)}</span><strong>{dateLabel(row.next_due_date)}</strong></div>)}
          {!expiredDocuments.length && !dueDocuments.length && !dueServicePlans.length ? <Empty>Brak pilnych terminów w ciągu 30 dni.</Empty> : null}
        </div>
      </Panel>
      <Panel title="TCO i wykorzystanie" kicker="Koszty + inwestycje">
        <div className={styles.list}>{allVehicles.slice(0, 7).map((vehicle) => {
          const cost = costByVehicle.get(String(vehicle.id))?.total ?? 0;
          const distance = distanceByVehicle.get(String(vehicle.id)) ?? 0;
          return <div className={styles.listItem} key={String(vehicle.id)}><span>{vehicleLabel(vehicle)} · {num(distance, 0)} km</span><strong>{money(cost)}{distance > 0 ? ` · ${money(cost / distance)}/km` : ""}</strong></div>;
        })}</div>
        <div className={styles.actionRow}><button className={styles.buttonSecondary} type="button" onClick={() => setTab("costs")}><ChartNoAxesCombined size={14} />Pełna analiza TCO</button></div>
      </Panel>
    </div> : null}

    {tab === "vehicles" ? <div className={styles.grid}>
      {canWrite ? <Panel title="Nowy pojazd lub maszyna" kicker="Cyfrowy paszport">
        <MiniForm title="Dodaj pojazd" action="vehicle_create" success="Pojazd został dodany do Floty." pending={pending} onSubmit={submit} fields={[
          { name: "registrationNumber", label: "Rejestracja / identyfikator", required: true },
          { name: "vin", label: "VIN" },
          { name: "vehicleType", label: "Typ", type: "select", required: true, options: [["car", "Samochód"], ["van", "Dostawczy"], ["truck", "Ciężarowy"], ["machine", "Maszyna"], ["trailer", "Przyczepa"], ["other", "Inny"]] },
          { name: "meterType", label: "Licznik", type: "select", options: [["km", "Kilometry"], ["hours", "Motogodziny"], ["both", "Km + motogodziny"], ["none", "Bez licznika"]], defaultValue: "km" },
          { name: "make", label: "Marka" }, { name: "model", label: "Model" },
          { name: "productionYear", label: "Rok produkcji", type: "number" },
          { name: "ownershipType", label: "Własność", type: "select", options: [["owned", "Własny"], ["lease", "Leasing"], ["rental", "Wynajem"]] },
          { name: "currentMileage", label: "Przebieg km", type: "number" }, { name: "currentEngineHours", label: "Motogodziny", type: "number" },
          { name: "fuelType", label: "Paliwo / energia" }, { name: "tankCapacityL", label: "Zbiornik l", type: "number" },
          { name: "purchaseDate", label: "Data zakupu", type: "date" }, { name: "purchasePrice", label: "Cena zakupu", type: "number" },
          { name: "leaseEndDate", label: "Koniec leasingu / najmu", type: "date" },
          { name: "responsibleEmployeeId", label: "Osoba odpowiedzialna", rows: employees.filter((row) => String(row.status) === "active"), rowLabel: employeeLabel },
          { name: "defaultProjectId", label: "Domyślna inwestycja", rows: projects, rowLabel: projectLabel }
        ]} />
      </Panel> : null}
      <Panel title="Rejestr pojazdów" kicker="A–Z" wide={!canWrite} aside={<span>{page.total} rekordów</span>}>
        <div className={styles.scroll}><div className={styles.table} style={{ "--cols": 6 } as React.CSSProperties}>
          <div className={styles.tableHead}><span>Rejestracja</span><span>Pojazd</span><span>Licznik</span><span>Odpowiedzialny</span><span>Gotowość</span><span>Status</span></div>
          {vehicles.map((vehicle) => <div className={styles.row} key={String(vehicle.id)}>
            <span><button className={styles.vehicleButton} type="button" onClick={() => setSelectedVehicleId(String(vehicle.id))}><strong>{text(vehicle.registration_number)}</strong><small>{text(vehicle.vin, "bez VIN")}</small></button></span>
            <span>{`${raw(vehicle.make)} ${raw(vehicle.model)}`.trim() || text(vehicle.vehicle_type)}</span>
            <span>{vehicle.meter_type === "hours" ? `${num(vehicle.current_engine_hours, 0)} mth` : vehicle.meter_type === "both" ? `${num(vehicle.current_mileage, 0)} km / ${num(vehicle.current_engine_hours, 0)} mth` : `${num(vehicle.current_mileage, 0)} km`}</span>
            <span>{vehicle.responsible_employee_id ? employeeLabel(employeeById.get(String(vehicle.responsible_employee_id)) ?? {}) : "—"}</span>
            <span>{missingQualificationCount(vehicle) ? <Badge tone="bad" value={`Braki: ${missingQualificationCount(vehicle)}`} /> : <Badge tone="good" value="Gotowy" />}</span>
            <span><Badge tone={String(vehicle.status) === "active" ? "good" : String(vehicle.status) === "service" ? "warn" : "neutral"} value={labelStatus(vehicle.status)} /></span>
          </div>)}
          {!vehicles.length ? <Empty>Brak pojazdów dla bieżącego filtra.</Empty> : null}
        </div></div>
        <ServerPagination page={page.page} pageSize={page.pageSize} total={page.total} pathname={`/workspace/companies/${workspaceId}/fleet`} query={{ q: query || undefined }} />
      </Panel>
      {selectedVehicle ? <Panel title={vehicleLabel(selectedVehicle)} kicker="Paszport pojazdu" wide>
        <div className={styles.statGrid}>
          <div className={styles.stat}><small>VIN</small><strong className={styles.code}>{text(selectedVehicle.vin)}</strong></div>
          <div className={styles.stat}><small>Przebieg</small><strong>{num(selectedVehicle.current_mileage, 0)} km</strong></div>
          <div className={styles.stat}><small>Motogodziny</small><strong>{num(selectedVehicle.current_engine_hours, 0)} mth</strong></div>
          <div className={styles.stat}><small>TCO</small><strong>{money(costByVehicle.get(String(selectedVehicle.id))?.total ?? 0)}</strong></div>
          <div className={styles.stat}><small>Zakup</small><strong>{dateLabel(selectedVehicle.purchase_date)}</strong></div>
          <div className={styles.stat}><small>Cena zakupu</small><strong>{money(selectedVehicle.purchase_price)}</strong></div>
          <div className={styles.stat}><small>Odpowiedzialny</small><strong>{selectedVehicle.responsible_employee_id ? employeeLabel(employeeById.get(String(selectedVehicle.responsible_employee_id)) ?? {}) : "—"}</strong></div>
          <div className={styles.stat}><small>Inwestycja</small><strong>{selectedVehicle.default_project_id ? projectLabel(projectById.get(String(selectedVehicle.default_project_id)) ?? {}) : "—"}</strong></div>
        </div>
        {missingQualificationCount(selectedVehicle) ? <div className={styles.warning}><TriangleAlert size={14} /><span>Osobie odpowiedzialnej brakuje {missingQualificationCount(selectedVehicle)} wymaganych uprawnień.</span></div> : null}
        {canWrite ? <div className={styles.grid}>
          <MiniForm title="Edytuj paszport / status" action="vehicle_update" success="Dane pojazdu zostały zaktualizowane." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd", rows: [selectedVehicle], rowLabel: vehicleLabel, required: true, defaultValue: String(selectedVehicle.id) },
            { name: "status", label: "Status", type: "select", options: [["active", "Aktywny"], ["service", "W serwisie"], ["inactive", "Nieaktywny"], ["sold", "Sprzedany"]], defaultValue: String(selectedVehicle.status ?? "active") },
            { name: "responsibleEmployeeId", label: "Osoba odpowiedzialna", rows: employees.filter((row) => String(row.status) === "active"), rowLabel: employeeLabel, defaultValue: raw(selectedVehicle.responsible_employee_id) },
            { name: "defaultProjectId", label: "Domyślna inwestycja", rows: projects, rowLabel: projectLabel, defaultValue: raw(selectedVehicle.default_project_id) },
            { name: "registrationNumber", label: "Rejestracja", defaultValue: raw(selectedVehicle.registration_number) },
            { name: "vin", label: "VIN", defaultValue: raw(selectedVehicle.vin) },
            { name: "fuelType", label: "Paliwo / energia", defaultValue: raw(selectedVehicle.fuel_type) },
            { name: "tankCapacityL", label: "Zbiornik l", type: "number", defaultValue: raw(selectedVehicle.tank_capacity_l) }
          ]} />
          <MiniForm title="Wymagane uprawnienie" action="qualification_requirement_create" success="Wymaganie uprawnienia zostało zapisane." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd", rows: [selectedVehicle], rowLabel: vehicleLabel, required: true, defaultValue: String(selectedVehicle.id) },
            { name: "qualificationType", label: "Rodzaj uprawnienia", required: true, placeholder: "np. Prawo jazdy C, UDT" },
            { name: "notes", label: "Uwagi", type: "textarea", full: true }
          ]} />
        </div> : null}
      </Panel> : null}
    </div> : null}

    {tab === "waiting" ? <div className={styles.split}>
      <Panel title="Poczekalnia AI" kicker="Wrzutnia → Gemini → decyzja" aside={<Badge tone={openReviews.length ? "warn" : "good"} value={`${openReviews.length} otwartych`} />}>
        <div className={styles.cards}>{openReviews.map((review) => {
          const preview = previewByReview.get(String(review.id));
          const candidate = review.candidate_vehicle_id ? vehicleById.get(String(review.candidate_vehicle_id)) : null;
          return <div className={styles.card} key={String(review.id)}>
            <div className={styles.cardHeader}><div><h3>{text(preview?.file_name, text(review.document_type, "Dokument Floty"))}</h3><p>{text(review.document_type)} · {text(review.document_number, "bez numeru")} · {dateLabel(review.document_date)}</p></div><Badge tone={String(review.status) === "ready" ? "good" : "warn"} value={`${labelStatus(review.status)} · ${Math.round(number(review.confidence) * 100)}%`} /></div>
            <dl><div><dt>Rejestracja</dt><dd>{text(review.registration_number)}</dd></div><div><dt>VIN</dt><dd className={styles.code}>{text(review.vin)}</dd></div><div><dt>Kwota</dt><dd>{money(review.amount, raw(review.currency) || "PLN")}</dd></div><div><dt>Przebieg</dt><dd>{review.mileage ? `${num(review.mileage, 0)} km` : "—"}</dd></div><div><dt>Motogodziny</dt><dd>{review.engine_hours ? `${num(review.engine_hours, 0)} mth` : "—"}</dd></div><div><dt>Ważne do</dt><dd>{dateLabel(review.valid_until)}</dd></div></dl>
            <p>{text(review.decision_reason)}</p>{preview?.excerpt ? <div className={styles.preview}>{text(preview.excerpt)}</div> : null}
            {canApprove ? <form className={styles.form} onSubmit={(event) => submit("ai_review_accept", "Dokument AI został zatwierdzony i bezpiecznie zastosowany.", event)}>
              <input type="hidden" name="reviewId" value={String(review.id)} />
              <div className={styles.fields}><label className={styles.full}><span>Pojazd docelowy</span><select name="vehicleId" required defaultValue={candidate ? String(candidate.id) : ""}><option value="">Wybierz pojazd</option>{allVehicles.map((vehicle) => <option key={String(vehicle.id)} value={String(vehicle.id)}>{vehicleLabel(vehicle)}</option>)}</select></label></div>
              <div className={styles.actionRow}><button className={styles.button} type="submit" disabled={pending}><Check size={14} />Zatwierdź i zastosuj</button><button className={styles.buttonDanger} type="button" disabled={pending} onClick={() => run("ai_review_ignore", { reviewId: review.id }, "Dokument został pominięty w Flocie.")}>Pomiń</button></div>
            </form> : <p className={styles.note}>Decyzje AI wymagają uprawnienia „zatwierdzanie”.</p>}
          </div>;
        })}{!openReviews.length ? <Empty>Brak dokumentów wymagających decyzji. Wrzutnia jest gotowa na kolejne pliki.</Empty> : null}</div>
      </Panel>
      <Panel title="Historia decyzji" kicker="AI uczy się z potwierdzeń">
        <div className={styles.list}>{decisionEvents.slice(0, 18).map((event) => <div className={styles.listItem} key={String(event.id)}><span>{dateLabel(event.created_at)} · {text(event.action)}</span><strong>{event.reverted_at ? "Cofnięto" : "Aktywna"}</strong></div>)}{!decisionEvents.length ? <Empty>Brak historii decyzji.</Empty> : null}</div>
        {canApprove ? decisionEvents.find((event) => !event.reverted_at && String(event.action) === "accept") ? <div className={styles.actionRow}><button className={styles.buttonSecondary} type="button" onClick={() => run("ai_undo", { eventId: decisionEvents.find((event) => !event.reverted_at && String(event.action) === "accept")!.id }, "Cofnięto wybraną decyzję AI.")}><Undo2 size={14} />Cofnij ostatnie zastosowanie</button></div> : null : null}
        <div className={styles.divider} /><p className={styles.muted}>AI nie zakłada samodzielnie pojazdu i nie rozstrzyga odpowiedzialności za szkodę. Powtarzające się potwierdzenia VIN/rejestracji poprawiają kolejne dopasowania.</p>
      </Panel>
    </div> : null}

    {tab === "operations" ? <div className={styles.grid}>
      {canWrite ? <Panel title="Rejestracja eksploatacji" kicker="Liczniki, paliwo, przejazdy, kontrola" wide>
        <div className={styles.three}>
          <MiniForm title="Odczyt licznika" action="meter_reading" success="Odczyt został zapisany. Cofający się licznik trafi do alertów zamiast nadpisać prawdę." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd", rows: vehicleRows, rowLabel: vehicleLabel, required: true }, { name: "readingDate", label: "Data", type: "date" },
            { name: "mileage", label: "Przebieg km", type: "number" }, { name: "engineHours", label: "Motogodziny", type: "number" }, { name: "source", label: "Źródło", defaultValue: "manual" }
          ]} />
          <MiniForm title="Tankowanie" action="fuel_entry" success="Tankowanie, koszt i odczyt przebiegu zostały zapisane atomowo." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd", rows: activeVehicleRows, rowLabel: vehicleLabel, required: true }, { name: "employeeId", label: "Kierowca", rows: employees, rowLabel: employeeLabel },
            { name: "projectId", label: "Inwestycja", rows: projects, rowLabel: projectLabel }, { name: "fueledAt", label: "Data i czas", type: "datetime-local" },
            { name: "liters", label: "Litry / kWh", type: "number", required: true }, { name: "grossAmount", label: "Kwota brutto", type: "number", required: true },
            { name: "mileage", label: "Przebieg", type: "number" }, { name: "fuelType", label: "Paliwo / energia" }, { name: "stationName", label: "Stacja / dostawca" }
          ]} />
          <MiniForm title="Przejazd" action="trip_create" success="Przejazd został zapisany do wykorzystania i inwestycji." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd", rows: activeVehicleRows, rowLabel: vehicleLabel, required: true }, { name: "employeeId", label: "Kierowca", rows: employees, rowLabel: employeeLabel },
            { name: "projectId", label: "Inwestycja", rows: projects, rowLabel: projectLabel }, { name: "startedAt", label: "Start", type: "datetime-local" }, { name: "finishedAt", label: "Koniec", type: "datetime-local" },
            { name: "startLocation", label: "Skąd" }, { name: "endLocation", label: "Dokąd" }, { name: "distanceKm", label: "Dystans km", type: "number", required: true }, { name: "purpose", label: "Cel", required: true, full: true }
          ]} />
          <MiniForm title="Kontrola przed pracą" action="vehicle_check_create" success="Kontrola pojazdu została zapisana." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd / maszyna", rows: activeVehicleRows, rowLabel: vehicleLabel, required: true }, { name: "employeeId", label: "Operator", rows: employees, rowLabel: employeeLabel },
            { name: "checkedAt", label: "Data i czas", type: "datetime-local" }, { name: "checkType", label: "Rodzaj", type: "select", options: [["daily", "Codzienna"], ["handover", "Przekazanie"], ["return", "Zwrot"], ["inspection", "Kontrola specjalna"]], defaultValue: "daily" },
            { name: "mileage", label: "Przebieg", type: "number" }, { name: "engineHours", label: "Motogodziny", type: "number" },
            { name: "status", label: "Wynik", type: "select", required: true, options: [["ok", "OK"], ["attention", "Uwagi"], ["blocked", "Blokada pojazdu"]], defaultValue: "ok" }, { name: "notes", label: "Uwagi / usterki", type: "textarea", full: true }
          ]} />
        </div>
      </Panel> : null}
      <Panel title="Ostatnie odczyty" kicker="Źródło prawdy">
        <div className={styles.list}>{readings.slice(0, 12).map((row) => <div className={styles.listItem} key={String(row.id)}><span>{dateLabel(row.reading_date)} · {text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · {text(row.source)}</span><strong>{row.mileage ? `${num(row.mileage, 0)} km` : ""}{row.engine_hours ? ` ${num(row.engine_hours, 0)} mth` : ""} {row.verified === false ? "⚠" : ""}</strong></div>)}{!readings.length ? <Empty>Brak odczytów liczników.</Empty> : null}</div>
      </Panel>
      <Panel title="Paliwo i przejazdy" kicker="Koszt + wykorzystanie">
        <div className={styles.metricLine}><span>Tankowania</span><strong>{fuel.length}</strong></div><div className={styles.metricLine}><span>Łączna kwota paliwa</span><strong>{money(fuel.reduce((sum, row) => sum + number(row.gross_amount), 0))}</strong></div><div className={styles.metricLine}><span>Przejazdy</span><strong>{trips.length}</strong></div><div className={styles.metricLine}><span>Dystans</span><strong>{num(trips.reduce((sum, row) => sum + number(row.distance_km), 0), 0)} km</strong></div>
        <div className={styles.divider} />
        {fuel.slice(0, 5).map((row) => <div className={styles.listItem} key={String(row.id)}><span>{dateLabel(row.fueled_at)} · {text(vehicleById.get(String(row.vehicle_id))?.registration_number)}</span><strong>{num(row.liters)} l · {money(row.gross_amount)}</strong></div>)}
      </Panel>
    </div> : null}

    {tab === "service" ? <div className={styles.grid}>
      {canWrite ? <Panel title="Serwis i prewencja" kicker="Plan → zlecenie → pozycje → zamknięcie" wide>
        <div className={styles.three}>
          <MiniForm title="Otwórz serwis" action="service_create" success="Zlecenie serwisowe zostało otwarte, a pojazd oznaczony jako w serwisie." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd", rows: vehicleRows, rowLabel: vehicleLabel, required: true }, { name: "serviceType", label: "Rodzaj serwisu", required: true },
            { name: "openedAt", label: "Otwarcie", type: "date" }, { name: "workshopCounterpartyId", label: "Warsztat", rows: counterparties, rowLabel: counterpartyLabel },
            { name: "currentMileage", label: "Przebieg", type: "number" }, { name: "currentEngineHours", label: "Motogodziny", type: "number" }, { name: "cost", label: "Koszt szacowany", type: "number" },
            { name: "nextDueDate", label: "Następny termin", type: "date" }, { name: "nextDueMileage", label: "Następny przebieg", type: "number" }, { name: "notes", label: "Zakres / uwagi", type: "textarea", full: true }
          ]} />
          <MiniForm title="Zamknij serwis" action="service_close" success="Serwis został zamknięty, TCO i licznik zaktualizowane." pending={pending} onSubmit={submit} disabled={!serviceSelectRows.length} fields={[
            { name: "serviceId", label: "Otwarte zlecenie", rows: serviceSelectRows, required: true }, { name: "closedAt", label: "Data zamknięcia", type: "date" }, { name: "cost", label: "Koszt końcowy", type: "number" },
            { name: "mileage", label: "Przebieg", type: "number" }, { name: "engineHours", label: "Motogodziny", type: "number" }, { name: "downtimeHours", label: "Przestój h", type: "number" }
          ]} />
          <MiniForm title="Plan serwisowy" action="service_plan_create" success="Plan serwisowy został utworzony." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd", rows: vehicleRows, rowLabel: vehicleLabel, required: true }, { name: "name", label: "Nazwa planu", required: true }, { name: "serviceType", label: "Rodzaj", required: true },
            { name: "intervalDays", label: "Co ile dni", type: "number" }, { name: "intervalKm", label: "Co ile km", type: "number" }, { name: "intervalEngineHours", label: "Co ile mth", type: "number" },
            { name: "nextDueDate", label: "Następna data", type: "date" }, { name: "nextDueMileage", label: "Następny przebieg", type: "number" }, { name: "nextDueEngineHours", label: "Następne mth", type: "number" }, { name: "notes", label: "Uwagi", type: "textarea", full: true }
          ]} />
          <MiniForm title="Pozycja serwisowa" action="service_item_create" success="Pozycja serwisowa została dodana do historii." pending={pending} onSubmit={submit} disabled={!service.length} fields={[
            { name: "serviceOrderId", label: "Zlecenie", rows: service.map((row) => ({ ...row, name: `${text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · ${text(row.service_type)}` })), required: true },
            { name: "itemType", label: "Typ", type: "select", options: [["part", "Część"], ["labor", "Robocizna"], ["fee", "Opłata"], ["other", "Inne"]], defaultValue: "labor" },
            { name: "description", label: "Opis", required: true, full: true }, { name: "quantity", label: "Ilość", type: "number", defaultValue: "1" }, { name: "unit", label: "Jednostka" }, { name: "unitCost", label: "Koszt jednostkowy", type: "number" }
          ]} />
        </div>
      </Panel> : null}
      <Panel title="Plany serwisowe" kicker="Prewencja">
        <div className={styles.cards}>{servicePlans.slice(0, 18).map((row) => <div className={styles.card} key={String(row.id)}><div className={styles.cardHeader}><h3>{text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · {text(row.name)}</h3><Badge tone={row.next_due_date && String(row.next_due_date) <= referenceDate ? "bad" : "neutral"} value={dateLabel(row.next_due_date)} /></div><p>{text(row.service_type)} · {row.interval_km ? `co ${num(row.interval_km, 0)} km` : ""} {row.interval_engine_hours ? `· co ${num(row.interval_engine_hours, 0)} mth` : ""}</p></div>)}{!servicePlans.length ? <Empty>Brak planów serwisowych.</Empty> : null}</div>
      </Panel>
      <Panel title="Historia serwisowa" kicker="Koszty i części">
        <div className={styles.list}>{service.slice(0, 18).map((row) => <div className={styles.listItem} key={String(row.id)}><span>{text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · {text(row.service_type)} · {dateLabel(row.opened_at)}</span><strong>{money(row.cost)} · {labelStatus(row.status)}</strong></div>)}</div>
        <div className={styles.note}>{serviceItems.length} zapisanych pozycji części/robocizny.</div>
      </Panel>
    </div> : null}

    {tab === "documents" ? <div className={styles.grid}>
      {canWrite ? <Panel title="Dokument i termin" kicker="OC/AC, badanie, UDT, leasing">
        <MiniForm title="Dodaj dokument" action="document_create" success="Dokument, termin i ewentualny koszt zostały zapisane." pending={pending} onSubmit={submit} fields={[
          { name: "vehicleId", label: "Pojazd", rows: vehicleRows, rowLabel: vehicleLabel, required: true },
          { name: "documentType", label: "Rodzaj", type: "select", required: true, options: [["inspection", "Badanie techniczne"], ["insurance_oc", "OC"], ["insurance_ac", "AC"], ["lease", "Leasing"], ["udt", "UDT / dozór"], ["permit", "Pozwolenie"], ["other", "Inny"]] },
          { name: "number", label: "Numer" }, { name: "providerName", label: "Wystawca / ubezpieczyciel" }, { name: "validFrom", label: "Ważny od", type: "date" }, { name: "validUntil", label: "Ważny do", type: "date" },
          { name: "amount", label: "Koszt", type: "number" }, { name: "currency", label: "Waluta", defaultValue: "PLN" }, { name: "reminderDays", label: "Przypomnij dni wcześniej", type: "number", defaultValue: "30" }
        ]} />
      </Panel> : null}
      <Panel title="Terminy dokumentów" kicker="Kontrola ważności" wide={!canWrite}>
        <div className={styles.scroll}><div className={styles.table} style={{ "--cols": 6 } as React.CSSProperties}><div className={styles.tableHead}><span>Pojazd</span><span>Dokument</span><span>Numer</span><span>Ważny do</span><span>Wystawca</span><span>Status</span></div>{documents.map((row) => {
          const expired = row.valid_until && String(row.valid_until) < referenceDate;
          const due = row.valid_until && String(row.valid_until) >= referenceDate && String(row.valid_until) <= new Date(new Date(referenceDate).getTime() + 30 * 86400000).toISOString().slice(0, 10);
          return <div className={styles.row} key={String(row.id)}><span><strong>{text(vehicleById.get(String(row.vehicle_id))?.registration_number)}</strong></span><span>{text(row.document_type)}</span><span>{text(row.number)}</span><span>{dateLabel(row.valid_until)}</span><span>{text(row.provider_name)}</span><span><Badge tone={expired ? "bad" : due ? "warn" : "good"} value={expired ? "Wygasły" : due ? "Do 30 dni" : "Ważny"} /></span></div>;
        })}{!documents.length ? <Empty>Brak dokumentów pojazdów.</Empty> : null}</div></div>
      </Panel>
    </div> : null}

    {tab === "equipment" ? <div className={styles.grid}>
      {canWrite ? <Panel title="Opony i komponenty" kicker="Historia montażu / magazynowania">
        <div className={styles.grid}>
          <MiniForm title="Dodaj komponent / komplet opon" action="component_create" success="Komponent został dodany do paszportu pojazdu." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd", rows: vehicleRows, rowLabel: vehicleLabel, required: true }, { name: "componentType", label: "Typ", type: "select", required: true, options: [["tires", "Opony"], ["battery", "Akumulator"], ["attachment", "Osprzęt"], ["other", "Inny"]] },
            { name: "name", label: "Nazwa", required: true }, { name: "manufacturer", label: "Producent" }, { name: "model", label: "Model" }, { name: "serialNumber", label: "Numer seryjny" }, { name: "dotCode", label: "DOT" },
            { name: "installedAt", label: "Data montażu", type: "date" }, { name: "installedMileage", label: "Przebieg montażu", type: "number" }, { name: "installedEngineHours", label: "Motogodziny montażu", type: "number" },
            { name: "condition", label: "Stan" }, { name: "treadDepthMm", label: "Bieżnik mm", type: "number" }, { name: "storageLocation", label: "Miejsce przechowywania" }, { name: "notes", label: "Uwagi", type: "textarea", full: true }
          ]} />
          <MiniForm title="Zdemontuj / odłóż" action="component_remove" success="Komponent został zdjęty i zapisany w historii." pending={pending} onSubmit={submit} disabled={!componentSelectRows.length} fields={[
            { name: "componentId", label: "Komponent", rows: componentSelectRows, required: true }, { name: "removedAt", label: "Data demontażu", type: "date" }, { name: "condition", label: "Stan po demontażu" }, { name: "storageLocation", label: "Magazyn / lokalizacja" }
          ]} />
        </div>
      </Panel> : null}
      {canWrite ? <Panel title="Sprzęt z Magazynu" kicker="Pojazd jako miejsce odpowiedzialności">
        {availableAssetOptions.length ? <MiniForm title="Przypisz sprzęt do pojazdu" action="asset_assign" success="Sprzęt został przypisany do pojazdu." pending={pending} onSubmit={submit} fields={[
          { name: "instanceId", label: "Sprzęt", rows: availableAssetOptions, required: true }, { name: "vehicleId", label: "Pojazd", rows: activeVehicleRows, rowLabel: vehicleLabel, required: true }
        ]} /> : <p className={styles.muted}>Brak wolnych, serializowanych aktywów magazynowych do przypisania.</p>}
      </Panel> : null}
      <Panel title="Aktywne komponenty" kicker="Opony / akumulatory / osprzęt">
        <div className={styles.cards}>{components.filter((row) => row.active !== false).slice(0, 20).map((row) => <div className={styles.card} key={String(row.id)}><div className={styles.cardHeader}><h3>{text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · {text(row.name)}</h3><Badge value={text(row.component_type)} /></div><p>{`${raw(row.manufacturer)} ${raw(row.model)}`.trim()} · DOT {text(row.dot_code)} · bieżnik {row.tread_depth_mm ? `${num(row.tread_depth_mm)} mm` : "—"}</p></div>)}{!components.length ? <Empty>Brak komponentów i opon w paszportach.</Empty> : null}</div>
      </Panel>
      <Panel title="Wyposażenie pojazdów" kicker="Integracja Magazyn">
        <div className={styles.list}>{vehicleStock.map((row) => <div className={styles.listItem} key={String(row.id)}><span>{text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · {text(stockItemById.get(String(row.stock_item_id))?.name, "Sprzęt")} · {text(row.asset_tag ?? row.serial_number)}</span>{canWrite ? <button className={styles.linkButton} type="button" onClick={() => run("asset_unassign", { instanceId: row.id }, "Sprzęt został odpięty od pojazdu.")}>Odepnij</button> : <strong>{text(row.status)}</strong>}</div>)}{!vehicleStock.length ? <Empty>Brak sprzętu magazynowego przypisanego do pojazdów.</Empty> : null}</div>
      </Panel>
    </div> : null}

    {tab === "damages" ? <div className={styles.grid}>
      {canWrite ? <Panel title="Szkoda" kicker="Zdarzenie → ubezpieczyciel → rozliczenie">
        <div className={styles.grid}>
          <MiniForm title="Zgłoś szkodę" action="damage_create" success="Szkoda została zarejestrowana bez automatycznego przypisywania winy." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd", rows: vehicleRows, rowLabel: vehicleLabel, required: true }, { name: "employeeId", label: "Kierowca / operator", rows: employees, rowLabel: employeeLabel }, { name: "projectId", label: "Inwestycja", rows: projects, rowLabel: projectLabel },
            { name: "occurredAt", label: "Data i czas", type: "datetime-local" }, { name: "location", label: "Miejsce" }, { name: "description", label: "Opis", type: "textarea", required: true, full: true },
            { name: "insurer", label: "Ubezpieczyciel" }, { name: "claimNumber", label: "Numer szkody" }, { name: "cost", label: "Szacowany koszt", type: "number" }, { name: "deductible", label: "Udział własny", type: "number" }
          ]} />
          <MiniForm title="Aktualizuj / zamknij szkodę" action="damage_update" success="Szkoda i jej realny koszt zostały zaktualizowane." pending={pending} onSubmit={submit} disabled={!damageSelectRows.length} fields={[
            { name: "damageId", label: "Sprawa", rows: damageSelectRows, required: true }, { name: "status", label: "Status", type: "select", options: [["reported", "Zgłoszona"], ["in_progress", "W toku"], ["closed", "Zamknięta"]] },
            { name: "claimNumber", label: "Numer szkody" }, { name: "insurer", label: "Ubezpieczyciel" }, { name: "cost", label: "Koszt", type: "number" }, { name: "insurerPayout", label: "Wypłata ubezpieczyciela", type: "number" }, { name: "deductible", label: "Udział własny", type: "number" },
            { name: "liabilityStatus", label: "Odpowiedzialność", type: "select", options: [["undetermined", "Nieustalona"], ["employee", "Pracownik"], ["third_party", "Osoba trzecia"], ["company", "Firma"], ["insurer", "Ubezpieczyciel"]] }, { name: "closedAt", label: "Zamknięto", type: "datetime-local" }
          ]} />
        </div>
      </Panel> : null}
      <Panel title="Alerty bezpieczeństwa" kicker="Guardraile i kontrole">
        <div className={styles.cards}>{openAnomalies.slice(0, 20).map((row) => <div className={styles.card} key={String(row.id)}><div className={styles.cardHeader}><h3>{text(row.title)}</h3><Badge tone={String(row.severity) === "critical" ? "bad" : "warn"} value={text(row.severity)} /></div><p>{text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · {text(row.description)}</p>{canApprove ? <div className={styles.actionRow}><button className={styles.buttonSecondary} type="button" onClick={() => run("anomaly_resolve", { anomalyId: row.id, status: "resolved" }, "Alert został oznaczony jako rozwiązany.")}>Rozwiąż</button><button className={styles.buttonDanger} type="button" onClick={() => run("anomaly_resolve", { anomalyId: row.id, status: "ignored" }, "Alert został świadomie pominięty.")}>Pomiń</button></div> : null}</div>)}{!openAnomalies.length ? <Empty>Brak otwartych alertów.</Empty> : null}</div>
      </Panel>
      <Panel title="Rejestr szkód" kicker="Koszt netto po ubezpieczeniu">
        <div className={styles.list}>{damages.slice(0, 18).map((row) => <div className={styles.listItem} key={String(row.id)}><span>{dateLabel(row.occurred_at)} · {text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · {text(row.claim_number, "bez numeru")}</span><strong>{labelStatus(row.status)} · {money(Math.max(0, number(row.cost) - number(row.insurer_payout)))}</strong></div>)}{!damages.length ? <Empty>Brak szkód.</Empty> : null}</div>
      </Panel>
      <Panel title="Kontrole eksploatacyjne" kicker="Codzienna odpowiedzialność">
        <div className={styles.list}>{checks.slice(0, 18).map((row) => <div className={styles.listItem} key={String(row.id)}><span>{dateLabel(row.checked_at)} · {text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · {row.employee_id ? employeeLabel(employeeById.get(String(row.employee_id)) ?? {}) : "bez operatora"}</span><strong><Badge tone={String(row.status) === "blocked" ? "bad" : String(row.status) === "attention" ? "warn" : "good"} value={labelStatus(row.status)} /></strong></div>)}{!checks.length ? <Empty>Brak kontroli.</Empty> : null}</div>
      </Panel>
    </div> : null}

    {tab === "costs" ? <div className={styles.grid}>
      {canWrite ? <Panel title="Rozliczanie wykorzystania" kicker="Koszt/km + inwestycje + odpowiedzialność">
        <div className={styles.grid}>
          <MiniForm title="Stawka kosztowa / km" action="cost_rate_create" success="Stawka kosztowa pojazdu została zapisana." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd", rows: vehicleRows, rowLabel: vehicleLabel, required: true }, { name: "validFrom", label: "Obowiązuje od", type: "date" }, { name: "validTo", label: "Do", type: "date" }, { name: "costPerKm", label: "Koszt / km", type: "number", required: true }, { name: "currency", label: "Waluta", defaultValue: "PLN" }
          ]} />
          <MiniForm title="Przypisz pojazd" action="allocation_create" success="Przypisanie pojazdu zostało zapisane." pending={pending} onSubmit={submit} fields={[
            { name: "vehicleId", label: "Pojazd", rows: vehicleRows, rowLabel: vehicleLabel, required: true }, { name: "employeeId", label: "Pracownik", rows: employees, rowLabel: employeeLabel }, { name: "projectId", label: "Inwestycja", rows: projects, rowLabel: projectLabel },
            { name: "dateFrom", label: "Od", type: "date" }, { name: "dateTo", label: "Do", type: "date" }, { name: "allocationPercent", label: "Udział %", type: "number", defaultValue: "100" }, { name: "allocationMethod", label: "Metoda", type: "select", options: [["manual", "Ręczne"], ["distance", "Dystans"], ["time", "Czas"]], defaultValue: "manual" }
          ]} />
        </div>
      </Panel> : null}
      <Panel title="TCO pojazdów" kicker="Pełny koszt posiadania" wide={!canWrite}>
        <div className={styles.scroll}><div className={styles.table} style={{ "--cols": 7 } as React.CSSProperties}><div className={styles.tableHead}><span>Pojazd</span><span>Paliwo</span><span>Serwis</span><span>Szkody</span><span>Inne</span><span>TCO</span><span>TCO/km</span></div>{allVehicles.map((vehicle) => {
          const c = costByVehicle.get(String(vehicle.id)) ?? { total: 0, fuel: 0, service: 0, damage: 0, other: 0 };
          const distance = distanceByVehicle.get(String(vehicle.id)) ?? 0;
          return <div className={styles.row} key={String(vehicle.id)}><span><strong>{text(vehicle.registration_number)}</strong></span><span>{money(c.fuel)}</span><span>{money(c.service)}</span><span>{money(c.damage)}</span><span>{money(c.other)}</span><span><strong>{money(c.total)}</strong></span><span>{distance > 0 ? `${money(c.total / distance)}/km` : "—"}</span></div>;
        })}{!allVehicles.length ? <Empty>Brak pojazdów do analizy TCO.</Empty> : null}</div></div>
      </Panel>
      <Panel title="Koszty na inwestycjach" kicker="Flota → Finanse">
        <div className={styles.list}>{projects.map((project) => {
          const amount = costLinks.filter((row) => String(row.project_id ?? "") === String(project.id)).reduce((sum, row) => sum + number(row.amount), 0);
          return amount > 0 ? <div className={styles.listItem} key={String(project.id)}><span>{projectLabel(project)}</span><strong>{money(amount)}</strong></div> : null;
        })}</div>
        {!costLinks.some((row) => row.project_id) ? <Empty>Brak kosztów Floty przypisanych do inwestycji.</Empty> : null}
      </Panel>
      <Panel title="Przypisania i stawki" kicker="Kontrola wykorzystania">
        <div className={styles.list}>{allocations.slice(0, 12).map((row) => <div className={styles.listItem} key={String(row.id)}><span>{text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · {row.project_id ? projectLabel(projectById.get(String(row.project_id)) ?? {}) : row.employee_id ? employeeLabel(employeeById.get(String(row.employee_id)) ?? {}) : "—"}</span><strong>{num(row.allocation_percent, 0)}% · {dateLabel(row.date_from)}</strong></div>)}{costRates.slice(0, 8).map((row) => <div className={styles.listItem} key={String(row.id)}><span>{text(vehicleById.get(String(row.vehicle_id))?.registration_number)} · stawka od {dateLabel(row.valid_from)}</span><strong>{money(row.cost_per_km, raw(row.currency) || "PLN")}/km</strong></div>)}</div>
      </Panel>
    </div> : null}
  </section>;
}
