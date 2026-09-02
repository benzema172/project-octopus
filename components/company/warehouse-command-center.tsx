"use client";

import type { FormEvent, ReactNode } from "react";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowDownToLine, ArrowRight, ArrowRightLeft, BadgeCheck, Boxes,
  ChartNoAxesCombined, CheckCircle2, ChevronDown, ClipboardCheck, FileSearch,
  History, LayoutDashboard, LoaderCircle, MapPin, Package, PackageCheck, Plus,
  ScanLine, SearchCheck, ShieldCheck, Tags, ToolCase, TrendingDown, UserRoundCheck,
  Warehouse
} from "lucide-react";
import { WarehouseFlowIntegrityPanel } from "@/components/company/warehouse-flow-integrity-panel";
import type { Data, Row } from "@/components/company/operations/module-shell";
import { isPhysicalWarehouseLine, priceChangePercent } from "@/lib/warehouse/domain";
import styles from "./warehouse-command-center.module.css";

type Tab = "dashboard" | "stock" | "ai" | "movements" | "needs" | "assets" | "counts" | "prices" | "locations";
type Props = { workspaceId: string; data: Data; canWrite: boolean; canApprove: boolean; query: string };
type Submit = (entity: string, success: string) => (event: FormEvent<HTMLFormElement>) => void;

const EMPTY_ROWS: Row[] = [];
const text = (value: unknown, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
const number = (value: unknown, digits = 2) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number(value ?? 0));
const money = (value: unknown) => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(Number(value ?? 0));
const today = () => new Date().toISOString().slice(0, 10);
const business = (row: Row) => row.businessDocument && typeof row.businessDocument === "object" ? row.businessDocument as Row : {};
const physicalLine = (row: Row) => isPhysicalWarehouseLine(row.lineType);
const statusLabel = (status: unknown) => ({
  draft: "Szkic", pending: "Do akceptacji", review: "Do weryfikacji", approved: "Zatwierdzony",
  open: "Otwarta", in_progress: "W trakcie", available: "Dostępny", assigned: "Wydany",
  service: "Serwis", lost: "Zagubiony", damaged: "Uszkodzony", retired: "Wycofany",
  registered: "Zarejestrowany", issued: "Wydany", returned: "Zwrócony", transferred: "Przeniesiony"
}[String(status)] ?? text(status));

function Select({ name, label, rows, required = false, empty = "Wybierz", render }: {
  name: string; label: string; rows: Row[]; required?: boolean; empty?: string; render?: (row: Row) => string;
}) {
  return <label><span>{label}</span><select name={name} required={required} defaultValue=""><option value="">{empty}</option>{rows.map((row) => <option key={String(row.id)} value={String(row.id)}>{render ? render(row) : text(row.name ?? row.id)}</option>)}</select></label>;
}

function Field({ name, label, type = "text", required = false, defaultValue, placeholder }: {
  name: string; label: string; type?: string; required?: boolean; defaultValue?: string; placeholder?: string;
}) {
  return <label><span>{label}</span><input name={name} type={type === "number" ? "text" : type} inputMode={type === "number" ? "decimal" : undefined} required={required} defaultValue={defaultValue} placeholder={placeholder} /></label>;
}

function Empty({ children, compact = false }: { children: ReactNode; compact?: boolean }) {
  return <p className={compact ? styles.emptyCompact : styles.empty}><PackageCheck size={16} aria-hidden="true" />{children}</p>;
}

export function WarehouseCommandCenter({ workspaceId, data, canWrite, canApprove, query }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab | null>(null);

  const items = (data.items as Row[] | undefined) ?? EMPTY_ROWS;
  const warehouses = (data.warehouses as Row[] | undefined) ?? EMPTY_ROWS;
  const movements = (data.movements as Row[] | undefined) ?? EMPTY_ROWS;
  const lines = (data.lines as Row[] | undefined) ?? EMPTY_ROWS;
  const projects = (data.projects as Row[] | undefined) ?? EMPTY_ROWS;
  const employees = (data.employees as Row[] | undefined) ?? EMPTY_ROWS;
  const vehicles = (data.vehicles as Row[] | undefined) ?? EMPTY_ROWS;
  const counterparties = (data.counterparties as Row[] | undefined) ?? EMPTY_ROWS;
  const reservations = (data.reservations as Row[] | undefined) ?? EMPTY_ROWS;
  const balances = (data.balances as Row[] | undefined) ?? EMPTY_ROWS;
  const imports = (data.aiImports as Row[] | undefined) ?? EMPTY_ROWS;
  const prices = (data.priceObservations as Row[] | undefined) ?? EMPTY_ROWS;
  const aliases = (data.aliases as Row[] | undefined) ?? EMPTY_ROWS;
  const instances = (data.stockInstances as Row[] | undefined) ?? EMPTY_ROWS;
  const instanceEvents = (data.stockInstanceEvents as Row[] | undefined) ?? EMPTY_ROWS;
  const counts = (data.inventoryCounts as Row[] | undefined) ?? EMPTY_ROWS;
  const countLines = (data.inventoryCountLines as Row[] | undefined) ?? EMPTY_ROWS;
  const summary = (data.summary as Row | undefined) ?? {};

  const itemById = useMemo(() => new Map(items.map((row) => [String(row.id), row])), [items]);
  const warehouseById = useMemo(() => new Map(warehouses.map((row) => [String(row.id), row])), [warehouses]);
  const projectById = useMemo(() => new Map(projects.map((row) => [String(row.id), row])), [projects]);
  const employeeById = useMemo(() => new Map(employees.map((row) => [String(row.id), row])), [employees]);
  const vehicleById = useMemo(() => new Map(vehicles.map((row) => [String(row.id), row])), [vehicles]);
  const counterpartyById = useMemo(() => new Map(counterparties.map((row) => [String(row.id), row])), [counterparties]);

  const linesByMovement = useMemo(() => {
    const result = new Map<string, Row[]>();
    for (const line of lines) result.set(String(line.movement_id), [...(result.get(String(line.movement_id)) ?? []), line]);
    return result;
  }, [lines]);

  const balanceByItem = useMemo(() => {
    const result = new Map<string, number>();
    for (const row of balances) {
      const id = String(row.stockItemId ?? row.stock_item_id);
      result.set(id, (result.get(id) ?? 0) + Number(row.quantity ?? 0));
    }
    return result;
  }, [balances]);

  const latestPriceByItem = useMemo(() => {
    const result = new Map<string, Row>();
    for (const row of prices) {
      const id = String(row.stock_item_id);
      const current = result.get(id);
      if (!current || String(row.observed_at) > String(current.observed_at)) result.set(id, row);
    }
    return result;
  }, [prices]);

  const unimported = imports.filter((row) => !row.importedId);
  const pendingMovements = movements.filter((row) => ["draft", "pending", "review"].includes(String(row.status)));
  const openReservations = reservations.filter((row) => ["open", "pending", "reserved"].includes(String(row.status)));
  const lowStock = items.filter((row) => Number(row.minimum_stock ?? 0) > 0 && (balanceByItem.get(String(row.id)) ?? 0) < Number(row.minimum_stock ?? 0));
  const issuedInstances = instances.filter((row) => row.status === "assigned");
  const openCounts = counts.filter((row) => ["draft", "open", "in_progress"].includes(String(row.status)));
  const isEmptyWarehouse = items.length === 0 && movements.length === 0 && unimported.length === 0;

  const run = (entity: string, payload: Record<string, unknown>, success: string, form?: HTMLFormElement) => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/warehouse-atomic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, entity, payload })
        });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) {
          setError(result.error ?? "Operacja magazynowa nie powiodła się.");
          return;
        }
        form?.reset();
        setMessage(success);
        router.refresh();
      } catch {
        setError("Nie udało się połączyć z modułem Magazynu.");
      }
    });
  };

  const submit: Submit = (entity, success) => (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    run(entity, Object.fromEntries(new FormData(form).entries()), success, form);
  };

  const modules: Array<{ id: Tab; label: string; caption: string; icon: ReactNode; count?: number; tone?: "warn" | "danger" }> = [
    { id: "dashboard", label: "Pulpit Magazynu", caption: "Stan, alerty i ostatnie zdarzenia", icon: <LayoutDashboard size={19} /> },
    { id: "stock", label: "Kartoteki i stany", caption: "Materiały, urządzenia i realny stan", icon: <Package size={19} />, count: items.length },
    { id: "ai", label: "Dostawy AI", caption: "Faktury, WZ i PZ do rozpoznania", icon: <FileSearch size={19} />, count: unimported.length, tone: unimported.length ? "warn" : undefined },
    { id: "movements", label: "Ruchy magazynowe", caption: "PZ, WZ, RW, ZW i MM", icon: <ArrowRightLeft size={19} />, count: pendingMovements.length, tone: pendingMovements.length ? "warn" : undefined },
    { id: "needs", label: "Braki i rezerwacje", caption: "Potrzeby inwestycji i minima", icon: <Boxes size={19} />, count: lowStock.length + openReservations.length, tone: lowStock.length ? "danger" : undefined },
    { id: "assets", label: "Sprzęt i urządzenia", caption: "Numery seryjne, wydania i serwis", icon: <ToolCase size={19} />, count: issuedInstances.length },
    { id: "counts", label: "Inwentaryzacje", caption: "Spisy, różnice i korekty", icon: <ClipboardCheck size={19} />, count: openCounts.length },
    { id: "prices", label: "Ceny i dostawcy", caption: "Historia cen i zmiany zakupu", icon: <ChartNoAxesCombined size={19} />, count: prices.length },
    { id: "locations", label: "Lokalizacje i aliasy", caption: "Magazyny, budowy, auta i nazwy dostawców", icon: <MapPin size={19} />, count: warehouses.length }
  ];

  return <section className={styles.center} aria-label="Magazyn — centrum operacyjne" data-warehouse-experience="2.0">
    <header className={styles.hero}>
      <div className={styles.heroText}>
        <span className={styles.eyebrow}><ShieldCheck size={15} /> Magazyn operacyjny 2.0</span>
        <h2>Od dokumentu do rzeczywistego stanu</h2>
        <p>AI odczytuje dokument i ceny, ale stan zmienia dopiero zatwierdzony ruch PZ, WZ, RW, ZW albo MM. Dzięki temu kartoteka, koszt i historia pozostają spójne.</p>
      </div>
      <div className={styles.heroActions}>
        <Link className={styles.primaryLink} href={`/workspace/companies/${workspaceId}/documents`}><ScanLine size={16} /> Wrzutnia dokumentów</Link>
        <button type="button" className={styles.secondaryAction} onClick={() => setTab("stock")}><Package size={16} /> Kartoteki i stany</button>
      </div>
    </header>

    <nav className={styles.moduleGrid} aria-label="Obszary Magazynu" data-equal-height-row="warehouse-modules">
      {modules.map((item) => <button key={item.id} type="button" className={`${styles.moduleCard} ${tab === item.id ? styles.moduleCardActive : ""} ${item.tone === "warn" ? styles.moduleCardWarn : ""} ${item.tone === "danger" ? styles.moduleCardDanger : ""}`} aria-pressed={tab === item.id} aria-expanded={tab === item.id} onClick={() => setTab((current) => current === item.id ? null : item.id)} data-equal-height-card>
        <span className={styles.moduleIcon}>{item.icon}</span>
        <span><strong>{item.label}</strong><small>{item.caption}</small></span>
        {item.count !== undefined ? <b>{item.count}</b> : <ArrowRight size={15} />}
      </button>)}
    </nav>

    <div className={styles.feedback} aria-live="polite">
      {message ? <p className={styles.success}><CheckCircle2 size={15} />{message}</p> : null}
      {error ? <p className={styles.error}><AlertTriangle size={15} />{error}</p> : null}
    </div>

    {tab === "dashboard" ? <DashboardPanel workspaceId={workspaceId} isEmpty={isEmptyWarehouse} items={items} movements={movements} unimported={unimported} pendingMovements={pendingMovements} lowStock={lowStock} openReservations={openReservations} issuedInstances={issuedInstances} openCounts={openCounts} prices={prices} summary={summary} warehouseById={warehouseById} projectById={projectById} balanceByItem={balanceByItem} latestPriceByItem={latestPriceByItem} onOpen={setTab} /> : null}
    {tab === "stock" ? <InventoryPanel items={items} balances={balances} reservations={reservations} query={query} warehouseById={warehouseById} projectById={projectById} balanceByItem={balanceByItem} latestPriceByItem={latestPriceByItem} /> : null}
    {tab === "ai" ? <AiImports imports={imports} warehouses={warehouses} projects={projects} canWrite={canWrite} pending={pending} query={query} submit={submit} workspaceId={workspaceId} /> : null}
    {tab === "movements" ? <MovementRegister workspaceId={workspaceId} movements={movements} linesByMovement={linesByMovement} itemById={itemById} warehouseById={warehouseById} projectById={projectById} projects={projects} canWrite={canWrite} canApprove={canApprove} /> : null}
    {tab === "needs" ? <NeedsPanel reservations={reservations} lowStock={lowStock} itemById={itemById} warehouseById={warehouseById} projectById={projectById} balanceByItem={balanceByItem} /> : null}
    {tab === "assets" ? <AssetsPanel items={items} warehouses={warehouses} projects={projects} employees={employees} vehicles={vehicles} instances={instances} events={instanceEvents} itemById={itemById} warehouseById={warehouseById} projectById={projectById} employeeById={employeeById} vehicleById={vehicleById} canWrite={canWrite} pending={pending} submit={submit} /> : null}
    {tab === "counts" ? <CountsPanel counts={counts} countLines={countLines} warehouses={warehouses} itemById={itemById} warehouseById={warehouseById} canWrite={canWrite} canApprove={canApprove} pending={pending} submit={submit} run={run} /> : null}
    {tab === "prices" ? <PricesPanel prices={prices} itemById={itemById} counterpartyById={counterpartyById} /> : null}
    {tab === "locations" ? <LocationsPanel items={items} counterparties={counterparties} balances={balances} aliases={aliases} itemById={itemById} warehouseById={warehouseById} counterpartyById={counterpartyById} canWrite={canWrite} pending={pending} submit={submit} /> : null}
  </section>;
}

function DashboardPanel({ workspaceId, isEmpty, items, movements, unimported, pendingMovements, lowStock, openReservations, issuedInstances, openCounts, prices, summary, warehouseById, projectById, balanceByItem, latestPriceByItem, onOpen }: {
  workspaceId: string; isEmpty: boolean; items: Row[]; movements: Row[]; unimported: Row[]; pendingMovements: Row[]; lowStock: Row[]; openReservations: Row[]; issuedInstances: Row[]; openCounts: Row[]; prices: Row[]; summary: Row; warehouseById: Map<string, Row>; projectById: Map<string, Row>; balanceByItem: Map<string, number>; latestPriceByItem: Map<string, Row>; onOpen: (tab: Tab) => void;
}) {
  if (isEmpty) return <div className={styles.onboarding}>
    <div className={styles.onboardingTitle}><Warehouse size={30} /><span><small>Start Magazynu</small><h3>Magazyn jest gotowy, ale nie ma jeszcze danych operacyjnych</h3><p>Najlepiej zacząć od faktur, WZ lub PZ. AI odczyta pozycje, utworzy lub dopasuje kartoteki i przygotuje szkic ruchu do zatwierdzenia.</p></span></div>
    <div className={styles.onboardingSteps} data-equal-height-row="warehouse-onboarding">
      <article data-equal-height-card><b>1</b><span><strong>Wrzuć dokument</strong><small>Faktura, WZ, PZ albo inny dokument zakupowy trafia do Wrzutni.</small></span></article>
      <article data-equal-height-card><b>2</b><span><strong>AI odczyta pozycje</strong><small>Materiały, urządzenia, ilości, jednostki, ceny, dostawcy i możliwa inwestycja.</small></span></article>
      <article data-equal-height-card><b>3</b><span><strong>Potwierdź ruch</strong><small>Szkic PZ/WZ nie zmienia stanu, dopóki nie zostanie zatwierdzony.</small></span></article>
      <article data-equal-height-card><b>4</b><span><strong>Magazyn zacznie żyć</strong><small>Powstanie stan, historia cen, lokalizacje, rezerwacje i pełna ścieżka audytu.</small></span></article>
    </div>
    <div className={styles.onboardingActions}><Link className={styles.primaryLink} href={`/workspace/companies/${workspaceId}/documents`}><ScanLine size={16} /> Otwórz Wrzutnię</Link><button type="button" className={styles.secondaryAction} onClick={() => onOpen("stock")}><Package size={16} /> Zobacz kartoteki</button><small>Ręczne dodanie magazynu, kartoteki lub ruchu jest nadal dostępne przez przycisk „+ Dodaj” u góry strony.</small></div>
  </div>;

  const attention = [
    { label: "Dokumenty AI", value: unimported.length, caption: unimported.length ? "czekają na decyzję" : "brak zaległości", tab: "ai" as Tab, icon: <FileSearch size={18} /> },
    { label: "Ruchy do akceptacji", value: pendingMovements.length, caption: pendingMovements.length ? "stan jeszcze się nie zmienił" : "brak szkiców", tab: "movements" as Tab, icon: <ArrowRightLeft size={18} /> },
    { label: "Braki + rezerwacje", value: lowStock.length + openReservations.length, caption: lowStock.length ? `${lowStock.length} poniżej minimum` : "bez braków krytycznych", tab: "needs" as Tab, icon: <Boxes size={18} /> },
    { label: "Sprzęt wydany", value: issuedInstances.length, caption: "pracownicy / inwestycje / pojazdy", tab: "assets" as Tab, icon: <ToolCase size={18} /> }
  ];
  const recentMovements = movements.slice(0, 6);
  const stockLeaders = [...items].sort((a, b) => (balanceByItem.get(String(b.id)) ?? 0) - (balanceByItem.get(String(a.id)) ?? 0)).slice(0, 6);

  return <div className={styles.dashboard}>
    <section className={styles.attentionGrid} data-equal-height-row="warehouse-attention">{attention.map((card) => <button key={card.label} type="button" onClick={() => onOpen(card.tab)} data-equal-height-card><span className={styles.attentionIcon}>{card.icon}</span><span><small>{card.label}</small><strong>{card.value}</strong><em>{card.caption}</em></span><ArrowRight size={15} /></button>)}</section>
    <section className={styles.dashboardGrid} data-equal-height-row="warehouse-dashboard">
      <article className={styles.dashboardPanel} data-equal-height-card><header><span><History size={18} /><strong>Ostatnie ruchy magazynowe</strong></span><button type="button" onClick={() => onOpen("movements")}>Pełny rejestr <ArrowRight size={14} /></button></header><div className={styles.activityList}>{recentMovements.map((row) => <div key={String(row.id)}><span className={styles.typeBadge}>{text(row.movement_type)}</span><span><strong>{text(row.document_number, "Bez numeru")}</strong><small>{text(row.movement_date)} · {text(warehouseById.get(String(row.warehouse_id))?.name)}{row.project_id ? ` → ${text(projectById.get(String(row.project_id))?.name)}` : ""}</small></span><em className={row.status === "approved" ? styles.statusGood : styles.statusWarn}>{statusLabel(row.status)}</em></div>)}{!recentMovements.length ? <Empty compact>Brak ruchów magazynowych.</Empty> : null}</div></article>
      <article className={styles.dashboardPanel} data-equal-height-card><header><span><AlertTriangle size={18} /><strong>Na dziś</strong></span><span className={styles.headerCount}>{lowStock.length + openCounts.length + unimported.length}</span></header><div className={styles.alertList}>{unimported.length ? <button type="button" onClick={() => onOpen("ai")}><FileSearch size={17} /><span><strong>{unimported.length} dokumentów AI</strong><small>Sprawdź pozycje i utwórz szkice PZ/WZ.</small></span><ArrowRight size={14} /></button> : null}{lowStock.length ? <button type="button" onClick={() => onOpen("needs")}><TrendingDown size={17} /><span><strong>{lowStock.length} pozycji poniżej minimum</strong><small>Wymagają zakupu, przesunięcia lub zmiany minimum.</small></span><ArrowRight size={14} /></button> : null}{openCounts.length ? <button type="button" onClick={() => onOpen("counts")}><ClipboardCheck size={17} /><span><strong>{openCounts.length} otwartych inwentaryzacji</strong><small>Dokończ liczenie i zatwierdź różnice.</small></span><ArrowRight size={14} /></button> : null}{!unimported.length && !lowStock.length && !openCounts.length ? <div className={styles.allGood}><CheckCircle2 size={18} /><span><strong>Brak krytycznych spraw magazynowych</strong><small>Nie ma dokumentów AI, braków ani otwartych spisów wymagających uwagi.</small></span></div> : null}</div></article>
    </section>
    <section className={styles.dashboardGrid} data-equal-height-row="warehouse-stock-price">
      <article className={styles.dashboardPanel} data-equal-height-card><header><span><Package size={18} /><strong>Największe stany</strong></span><button type="button" onClick={() => onOpen("stock")}>Kartoteki <ArrowRight size={14} /></button></header><div className={styles.stockSnapshot}>{stockLeaders.map((row) => { const balance = balanceByItem.get(String(row.id)) ?? 0; const latest = latestPriceByItem.get(String(row.id)); return <div key={String(row.id)}><span><strong>{text(row.name)}</strong><small>{text(row.sku, "bez SKU")} · {text(row.category, text(row.item_type, "materiał"))}</small></span><b>{number(balance)} {text(row.unit, "")}</b><em>{latest ? money(latest.unit_price_net) : "brak ceny"}</em></div>; })}{!stockLeaders.length ? <Empty compact>Brak kartotek.</Empty> : null}</div></article>
      <article className={styles.dashboardPanel} data-equal-height-card><header><span><ChartNoAxesCombined size={18} /><strong>Obraz wartości i cen</strong></span><button type="button" onClick={() => onOpen("prices")}>Historia cen <ArrowRight size={14} /></button></header><div className={styles.valueSummary}><div><small>Wartość zapasu</small><strong>{money(summary.stockValue ?? 0)}</strong><span>{text(summary.fifoLayers, "0")} aktywnych warstw FIFO</span></div><div><small>Obserwacje cen</small><strong>{prices.length}</strong><span>historia zakupów i przyjęć</span></div><div><small>Kartoteki</small><strong>{items.length}</strong><span>{text(summary.activeItems, String(items.length))} aktywnych</span></div><div><small>Magazyny / lokalizacje</small><strong>{text(summary.warehouses, "0")}</strong><span>centralne, budowy i mobilne</span></div></div></article>
    </section>
  </div>;
}

function InventoryPanel({ items, balances, reservations, query, warehouseById, projectById, balanceByItem, latestPriceByItem }: { items: Row[]; balances: Row[]; reservations: Row[]; query: string; warehouseById: Map<string, Row>; projectById: Map<string, Row>; balanceByItem: Map<string, number>; latestPriceByItem: Map<string, Row>; }) {
  const needle = query.trim().toLowerCase();
  const visible = items.filter((row) => !needle || `${text(row.name, "")} ${text(row.sku, "")} ${text(row.manufacturer, "")} ${text(row.model, "")} ${text(row.category, "")}`.toLowerCase().includes(needle));
  return <div className={styles.stack}><div className={styles.sectionIntro}><div><Package size={19} /><span><strong>Kartoteki i rzeczywiste stany</strong><small>Jedna kartoteka łączy stan, lokalizacje, cenę, rezerwacje, producenta i historię dokumentów.</small></span></div><em>{visible.length} widocznych</em></div><div className={styles.inventoryList}>{visible.map((row) => {
    const itemId = String(row.id); const balance = balanceByItem.get(itemId) ?? 0; const minimum = Number(row.minimum_stock ?? 0); const latestPrice = latestPriceByItem.get(itemId); const itemBalances = balances.filter((entry) => String(entry.stockItemId ?? entry.stock_item_id) === itemId && Number(entry.quantity ?? 0) !== 0); const itemReservations = reservations.filter((entry) => String(entry.stock_item_id ?? entry.stockItemId) === itemId && ["open", "pending", "reserved"].includes(String(entry.status))); const below = minimum > 0 && balance < minimum;
    return <details key={itemId} className={below ? styles.inventoryDanger : undefined}><summary><span className={styles.inventoryIcon}><Package size={17} /></span><span><strong>{text(row.name)}</strong><small>{text(row.sku, "bez SKU")} · {text(row.manufacturer, "")} {text(row.model, "")}</small></span><span className={styles.inventoryQty}><strong>{number(balance)} {text(row.unit, "")}</strong><small>{minimum > 0 ? `minimum ${number(minimum)}` : "bez minimum"}</small></span><span className={styles.inventoryPrice}><strong>{latestPrice ? money(latestPrice.unit_price_net) : "—"}</strong><small>ostatnia cena</small></span><span className={below ? styles.badgeDanger : styles.goodBadge}>{below ? "Poniżej minimum" : "OK"}</span><ChevronDown size={15} /></summary><div className={styles.inventoryBody}><dl><div><dt>Typ</dt><dd>{text(row.item_type)}</dd></div><div><dt>Kategoria</dt><dd>{text(row.category)}</dd></div><div><dt>EAN</dt><dd>{text(row.barcode)}</dd></div><div><dt>Stan optymalny</dt><dd>{number(row.optimal_stock)} {text(row.unit, "")}</dd></div><div><dt>Numery seryjne</dt><dd>{row.serial_tracking ? "Tak" : "Nie"}</dd></div><div><dt>Gwarancja</dt><dd>{row.warranty_months ? `${number(row.warranty_months, 0)} mies.` : "—"}</dd></div></dl><div className={styles.inventoryColumns}><section><h4>Lokalizacje</h4>{itemBalances.map((entry, index) => <p key={`${itemId}-${index}`}><span>{text(warehouseById.get(String(entry.warehouseId ?? entry.warehouse_id))?.name)}</span><strong>{number(entry.quantity)} {text(row.unit, "")}</strong></p>)}{!itemBalances.length ? <small>Brak dodatniego stanu w lokalizacjach.</small> : null}</section><section><h4>Otwarte rezerwacje</h4>{itemReservations.map((entry) => <p key={String(entry.id)}><span>{text(projectById.get(String(entry.project_id))?.name)}</span><strong>{number(entry.quantity)} {text(row.unit, "")}</strong></p>)}{!itemReservations.length ? <small>Brak otwartych rezerwacji.</small> : null}</section></div></div></details>;
  })}{!visible.length ? <Empty>{items.length ? "Brak kartotek pasujących do wyszukiwania." : "Brak kartotek. Wrzuć fakturę/WZ albo użyj „+ Dodaj”, aby utworzyć pierwszą kartotekę ręcznie."}</Empty> : null}</div></div>;
}

function AiImports({ imports, warehouses, projects, canWrite, pending, query, submit, workspaceId }: { imports: Row[]; warehouses: Row[]; projects: Row[]; canWrite: boolean; pending: boolean; query: string; submit: Submit; workspaceId: string; }) {
  const needle = query.toLowerCase();
  const visible = imports.filter((row) => !needle || `${text(row.name, "")} ${text(business(row).documentNumber, "")} ${text(business(row).supplierName, "")}`.toLowerCase().includes(needle));
  return <div className={styles.stack}><div className={styles.sectionIntro}><div><FileSearch size={19} /><span><strong>Dostawy i dokumenty rozpoznane przez AI</strong><small>Sprawdź pozycje, wybierz kierunek fizycznego ruchu i utwórz szkic. Usługi nie trafią do stanu.</small></span></div><em>{visible.filter((row) => !row.importedId).length} do obsłużenia</em></div>{!visible.length ? <div className={styles.aiEmpty}><Empty>Brak dokumentów magazynowych dla bieżącego filtra.</Empty><Link className={styles.primaryLink} href={`/workspace/companies/${workspaceId}/documents`}><ScanLine size={16} /> Wrzuć fakturę / WZ / PZ</Link></div> : visible.map((row) => {
    const doc = business(row); const docLines = Array.isArray(doc.lines) ? doc.lines.filter((line): line is Row => Boolean(line) && typeof line === "object") : []; const materialLines = docLines.filter(physicalLine); const imported = Boolean(row.importedId); const defaultType = String(doc.direction).toLowerCase() === "sale" ? "WZ" : "PZ";
    return <details className={styles.document} key={String(row.id)} open={!imported && visible.length === 1}><summary><span className={styles.docIcon}><ScanLine size={17} /></span><span><strong>{text(doc.documentNumber, text(row.name, "Dokument"))}</strong><small>{text(doc.supplierName ?? doc.buyerName, "Kontrahent nierozpoznany")} · {text(doc.issueDate, "bez daty")}</small></span><span className={imported ? styles.goodBadge : styles.warnBadge}>{imported ? "Zaimportowany" : `${Math.round(Number(row.confidence ?? 0) * 100)}% AI`}</span><ChevronDown size={16} /></summary><div className={styles.documentBody}><div className={styles.docFacts}><span><small>Typ</small><strong>{text(row.documentType)}</strong></span><span><small>Kierunek</small><strong>{text(doc.direction, "zakup")}</strong></span><span><small>Pozycje fizyczne</small><strong>{materialLines.length}/{docLines.length}</strong></span><span><small>Wartość netto</small><strong>{money(doc.netAmount)}</strong></span></div><div className={styles.lineList}>{docLines.map((line, index) => <div key={`${String(row.id)}-${index}`}><span><strong>{text(line.description, `Pozycja ${index + 1}`)}</strong><small>{text(line.sku, "bez SKU")} · {text(line.lineType, "materiał")}</small></span><span>{number(line.quantity)} {text(line.unit, "")}</span><b>{money(line.unitPrice)}</b><em className={physicalLine(line) ? styles.physical : styles.service}>{physicalLine(line) ? "stan" : "poza stanem"}</em></div>)}</div>{!imported && canWrite ? <form className={styles.actionForm} onSubmit={submit("ai_warehouse_import", "Dokument został zamieniony na wielopozycyjny szkic ruchu. Stan zmieni się dopiero po zatwierdzeniu.")}><input type="hidden" name="documentId" value={String(row.documentId)} /><label><span>Ruch fizyczny</span><select name="movementType" defaultValue={defaultType}><option value="PZ">PZ – przyjęcie</option><option value="WZ">WZ – wydanie</option></select></label><Select name="warehouseId" label="Magazyn" rows={warehouses} required /><Select name="projectId" label="Inwestycja" rows={projects} empty="Ruch firmowy / przypisz później" /><button disabled={pending || materialLines.length === 0}>{pending ? <LoaderCircle className={styles.spin} size={15} /> : <ArrowDownToLine size={15} />}Utwórz szkic</button></form> : null}</div></details>;
  })}</div>;
}

function MovementRegister({ workspaceId, movements, linesByMovement, itemById, warehouseById, projectById, projects, canWrite, canApprove }: { workspaceId: string; movements: Row[]; linesByMovement: Map<string, Row[]>; itemById: Map<string, Row>; warehouseById: Map<string, Row>; projectById: Map<string, Row>; projects: Row[]; canWrite: boolean; canApprove: boolean; }) {
  return <div className={styles.stack}><WarehouseFlowIntegrityPanel workspaceId={workspaceId} movements={movements} projects={projects} canWrite={canWrite} canApprove={canApprove} /><div className={styles.sectionIntro}><div><History size={19} /><span><strong>Rejestr dokumentów magazynowych</strong><small>Każdy dokument pokazuje wszystkie pozycje, lokalizację, inwestycję i stan zatwierdzenia.</small></span></div><em>{movements.length} ostatnich</em></div><div className={styles.movementList}>{movements.map((movement) => { const movementLines = linesByMovement.get(String(movement.id)) ?? []; return <details key={String(movement.id)}><summary><span className={styles.typeBadge}>{text(movement.movement_type)}</span><span><strong>{text(movement.document_number, "Bez numeru")}</strong><small>{text(movement.movement_date)} · {text(warehouseById.get(String(movement.warehouse_id))?.name)}{movement.project_id ? ` → ${text(projectById.get(String(movement.project_id))?.name)}` : ""}</small></span><span>{movementLines.length} poz.</span><span className={movement.status === "approved" ? styles.goodBadge : styles.warnBadge}>{statusLabel(movement.status)}</span><ChevronDown size={15} /></summary><div>{movementLines.map((line) => <p key={String(line.id)}><span><strong>{text(itemById.get(String(line.stock_item_id))?.name, "Kartoteka")}</strong><small>{text(itemById.get(String(line.stock_item_id))?.sku, "bez SKU")}</small></span><b>{number(line.quantity)} {text(itemById.get(String(line.stock_item_id))?.unit, "")}</b><em>{line.unit_cost ? money(line.unit_cost) : "bez kosztu"}</em></p>)}{!movementLines.length ? <Empty compact>Dokument nie zawiera pozycji na załadowanej liście.</Empty> : null}</div></details>; })}{!movements.length ? <Empty>Brak ruchów. Utwórz pierwszy PZ/WZ z dokumentu AI lub przez „+ Dodaj”.</Empty> : null}</div></div>;
}

function NeedsPanel({ reservations, lowStock, itemById, warehouseById, projectById, balanceByItem }: { reservations: Row[]; lowStock: Row[]; itemById: Map<string, Row>; warehouseById: Map<string, Row>; projectById: Map<string, Row>; balanceByItem: Map<string, number>; }) {
  const open = reservations.filter((row) => ["open", "pending", "reserved"].includes(String(row.status)));
  return <div className={styles.twoColumns} data-equal-height-row="warehouse-needs"><article className={styles.panel} data-equal-height-card><header><Boxes size={18} /><span><strong>Rezerwacje dla inwestycji</strong><small>Planowane potrzeby przed rzeczywistym RW.</small></span></header>{open.map((row) => <p key={String(row.id)}><span><strong>{text(itemById.get(String(row.stock_item_id))?.name)}</strong><small>{text(warehouseById.get(String(row.warehouse_id))?.name)} → {text(projectById.get(String(row.project_id))?.name)}</small></span><b>{number(row.quantity)} {text(itemById.get(String(row.stock_item_id))?.unit, "")}</b><em>{text(row.required_at, "bez terminu")}</em></p>)}{!open.length ? <Empty compact>Brak otwartych rezerwacji.</Empty> : null}</article><article className={styles.panel} data-equal-height-card><header><AlertTriangle size={18} /><span><strong>Braki i stany minimalne</strong><small>Pozycje wymagające zakupu lub przesunięcia.</small></span></header>{lowStock.map((row) => { const stock = balanceByItem.get(String(row.id)) ?? 0; return <p key={String(row.id)}><span><strong>{text(row.name)}</strong><small>{text(row.sku, "bez SKU")}</small></span><b>{number(stock)} / {number(row.minimum_stock)} {text(row.unit, "")}</b><em className={styles.negative}>brakuje {number(Math.max(0, Number(row.minimum_stock) - stock))}</em></p>; })}{!lowStock.length ? <Empty compact>Wszystkie widoczne kartoteki są powyżej minimum.</Empty> : null}</article></div>;
}

function AssetsPanel({ items, warehouses, projects, employees, vehicles, instances, events, itemById, warehouseById, projectById, employeeById, vehicleById, canWrite, pending, submit }: { items: Row[]; warehouses: Row[]; projects: Row[]; employees: Row[]; vehicles: Row[]; instances: Row[]; events: Row[]; itemById: Map<string, Row>; warehouseById: Map<string, Row>; projectById: Map<string, Row>; employeeById: Map<string, Row>; vehicleById: Map<string, Row>; canWrite: boolean; pending: boolean; submit: Submit; }) {
  const equipment = items.filter((row) => ["device", "tool", "equipment"].includes(String(row.item_type)) || row.serial_tracking); const labelEmployee = (row: Row) => `${text(row.first_name, "")} ${text(row.last_name, "")}`.trim() || text(row.employee_number); const labelVehicle = (row: Row) => `${text(row.registration_number, "")} ${text(row.make, "")} ${text(row.model, "")}`.trim();
  return <div className={styles.stack}>{canWrite ? <div className={styles.formGrid} data-equal-height-row="warehouse-assets-forms"><details className={styles.formCard} open={!instances.length} data-equal-height-card><summary><Plus size={15} />Zarejestruj egzemplarz<ChevronDown size={15} /></summary><form onSubmit={submit("stock_instance_create", "Egzemplarz sprzętu został zarejestrowany.")}><Select name="stockItemId" label="Kartoteka urządzenia / narzędzia" rows={equipment} required render={(row) => `${text(row.sku, "—")} · ${text(row.name)}`} /><Select name="warehouseId" label="Lokalizacja początkowa" rows={warehouses} empty="Bez lokalizacji" /><Field name="serialNumber" label="Numer seryjny" required /><Field name="assetTag" label="Numer majątkowy" /><Field name="purchaseDate" label="Data zakupu" type="date" /><Field name="purchasePrice" label="Cena zakupu" type="number" /><Field name="warrantyUntil" label="Gwarancja do" type="date" /><Field name="condition" label="Stan techniczny" placeholder="Nowy / dobry / zużyty" /><button disabled={pending}><Plus size={15} />Dodaj egzemplarz</button></form></details><details className={styles.formCard} data-equal-height-card><summary><UserRoundCheck size={15} />Wydaj egzemplarz<ChevronDown size={15} /></summary><form onSubmit={submit("stock_instance_assign", "Egzemplarz został wydany i przypisany.")}><Select name="instanceId" label="Dostępny egzemplarz" rows={instances.filter((row) => row.status === "available")} required render={(row) => `${text(row.serial_number)} · ${text(itemById.get(String(row.stock_item_id))?.name)}`} /><Select name="employeeId" label="Pracownik" rows={employees} empty="Bez pracownika" render={labelEmployee} /><Select name="projectId" label="Inwestycja" rows={projects} empty="Bez inwestycji" /><Select name="vehicleId" label="Pojazd" rows={vehicles} empty="Bez pojazdu" render={labelVehicle} /><Field name="eventDate" label="Data wydania" type="date" defaultValue={today()} /><Field name="condition" label="Stan przy wydaniu" /><button disabled={pending}><UserRoundCheck size={15} />Wydaj</button></form></details><details className={styles.formCard} data-equal-height-card><summary><ArrowDownToLine size={15} />Zwrot egzemplarza<ChevronDown size={15} /></summary><form onSubmit={submit("stock_instance_return", "Zwrot został zapisany wraz ze stanem technicznym.")}><Select name="instanceId" label="Wydany egzemplarz" rows={instances.filter((row) => row.status === "assigned")} required render={(row) => `${text(row.serial_number)} · ${text(itemById.get(String(row.stock_item_id))?.name)}`} /><Select name="warehouseId" label="Magazyn zwrotu" rows={warehouses} required /><Field name="eventDate" label="Data zwrotu" type="date" defaultValue={today()} /><Field name="condition" label="Stan przy zwrocie" required /><Field name="notes" label="Uwagi / uszkodzenia" /><button disabled={pending}><ArrowDownToLine size={15} />Przyjmij zwrot</button></form></details><details className={styles.formCard} data-equal-height-card><summary><ToolCase size={15} />Serwis i kalibracja<ChevronDown size={15} /></summary><form onSubmit={submit("stock_instance_service", "Zdarzenie serwisowe i kolejny termin zostały zapisane.")}><Select name="instanceId" label="Egzemplarz" rows={instances} required render={(row) => `${text(row.serial_number)} · ${text(itemById.get(String(row.stock_item_id))?.name)}`} /><Field name="eventDate" label="Data serwisu" type="date" defaultValue={today()} /><Field name="nextServiceDate" label="Następny termin" type="date" /><Field name="cost" label="Koszt" type="number" /><Field name="condition" label="Stan po serwisie" /><Field name="notes" label="Zakres / uwagi" /><button disabled={pending}><ToolCase size={15} />Zapisz serwis</button></form></details></div> : null}<div className={styles.assetList}>{instances.map((row) => { const employee = employeeById.get(String(row.employee_id)); const vehicle = vehicleById.get(String(row.vehicle_id)); const history = events.filter((event) => String(event.instance_id) === String(row.id)).slice(0, 6); return <details key={String(row.id)}><summary><span className={styles.assetIcon}><ToolCase size={17} /></span><span><strong>{text(itemById.get(String(row.stock_item_id))?.name)}</strong><small>S/N {text(row.serial_number)} · {text(row.asset_tag, "bez numeru majątkowego")}</small></span><span className={row.status === "available" ? styles.goodBadge : styles.warnBadge}>{statusLabel(row.status)}</span><ChevronDown size={15} /></summary><div className={styles.assetBody}><dl><div><dt>Lokalizacja</dt><dd>{text(warehouseById.get(String(row.current_warehouse_id))?.name, "poza magazynem")}</dd></div><div><dt>Pracownik</dt><dd>{employee ? labelEmployee(employee) : "—"}</dd></div><div><dt>Inwestycja</dt><dd>{text(projectById.get(String(row.project_id))?.name)}</dd></div><div><dt>Pojazd</dt><dd>{vehicle ? labelVehicle(vehicle) : "—"}</dd></div><div><dt>Gwarancja</dt><dd>{text(row.warranty_until)}</dd></div><div><dt>Następny serwis</dt><dd>{text(row.next_service_date)}</dd></div></dl><div className={styles.timeline}>{history.map((event) => <p key={String(event.id)}><BadgeCheck size={14} /><span><strong>{statusLabel(event.event_type)}</strong><small>{text(event.event_date)} · {text(event.condition, "bez oceny stanu")}</small></span>{event.cost ? <b>{money(event.cost)}</b> : null}</p>)}</div></div></details>; })}{!instances.length ? <Empty>Brak zarejestrowanych egzemplarzy sprzętu. Utwórz kartotekę urządzenia/narzędzia i zarejestruj numer seryjny.</Empty> : null}</div></div>;
}

function CountsPanel({ counts, countLines, warehouses, itemById, warehouseById, canWrite, canApprove, pending, submit, run }: { counts: Row[]; countLines: Row[]; warehouses: Row[]; itemById: Map<string, Row>; warehouseById: Map<string, Row>; canWrite: boolean; canApprove: boolean; pending: boolean; submit: Submit; run: (entity: string, payload: Record<string, unknown>, success: string, form?: HTMLFormElement) => void; }) {
  return <div className={styles.stack}>{canWrite ? <form className={styles.startCount} onSubmit={submit("inventory_count_create", "Inwentaryzacja została rozpoczęta na zamrożonym stanie systemowym.")}><span><ClipboardCheck size={18} /><strong>Rozpocznij spis</strong></span><Select name="warehouseId" label="Magazyn" rows={warehouses} required /><Field name="countDate" label="Data spisu" type="date" defaultValue={today()} required /><Field name="notes" label="Opis / osoba licząca" /><button disabled={pending}><Plus size={15} />Rozpocznij</button></form> : null}<div className={styles.countList}>{counts.map((count) => { const rows = countLines.filter((line) => String(line.inventory_count_id) === String(count.id)); const completed = rows.filter((line) => line.counted_quantity !== null).length; const differences = rows.filter((line) => Number(line.difference ?? 0) !== 0); const open = ["draft", "open", "in_progress"].includes(String(count.status)); return <details key={String(count.id)} open={open}><summary><span className={styles.countIcon}><ClipboardCheck size={17} /></span><span><strong>{text(warehouseById.get(String(count.warehouse_id))?.name)}</strong><small>{text(count.count_date)} · policzono {completed}/{rows.length} · różnice {differences.length}</small></span><span className={open ? styles.warnBadge : styles.goodBadge}>{statusLabel(count.status)}</span><ChevronDown size={15} /></summary><div className={styles.countBody}><div className={styles.countRows}>{rows.map((line) => <form key={String(line.id)} onSubmit={submit("inventory_count_line", "Stan policzony został zapisany.")}><input type="hidden" name="lineId" value={String(line.id)} /><span><strong>{text(itemById.get(String(line.stock_item_id))?.name)}</strong><small>{text(itemById.get(String(line.stock_item_id))?.sku, "bez SKU")} · system {number(line.system_quantity)} {text(itemById.get(String(line.stock_item_id))?.unit, "")}</small></span><input name="countedQuantity" aria-label={`Stan policzony ${text(itemById.get(String(line.stock_item_id))?.name)}`} inputMode="decimal" defaultValue={line.counted_quantity === null ? "" : String(line.counted_quantity)} placeholder="Policzono" disabled={!open || !canWrite} required /><input name="note" aria-label="Uwaga do różnicy" defaultValue={text(line.note, "")} placeholder="Uwaga" disabled={!open || !canWrite} />{open && canWrite ? <button disabled={pending} aria-label="Zapisz pozycję"><CheckCircle2 size={14} /></button> : <b className={Number(line.difference ?? 0) === 0 ? styles.goodText : styles.negative}>{Number(line.difference ?? 0) > 0 ? "+" : ""}{number(line.difference)}</b>}</form>)}</div>{open && canApprove ? <div className={styles.approveBar}><span><SearchCheck size={17} /><strong>Kontrola kompletności</strong><small>{completed === rows.length ? "Wszystkie pozycje policzone. Zatwierdzenie utworzy korekty PZ/RW." : `Brakuje ${rows.length - completed} pozycji.`}</small></span><button type="button" disabled={pending || !rows.length || completed !== rows.length} onClick={() => run("inventory_count_approve", { countId: count.id }, "Inwentaryzacja została zatwierdzona, a różnice zapisano dokumentami korekty PZ/RW.")}><ShieldCheck size={15} />Zatwierdź spis</button></div> : null}</div></details>; })}{!counts.length ? <Empty>Brak rozpoczętych lub historycznych inwentaryzacji.</Empty> : null}</div></div>;
}

function PricesPanel({ prices, itemById, counterpartyById }: { prices: Row[]; itemById: Map<string, Row>; counterpartyById: Map<string, Row> }) {
  const grouped = new Map<string, Row[]>(); for (const row of prices) grouped.set(String(row.stock_item_id), [...(grouped.get(String(row.stock_item_id)) ?? []), row]);
  return <div className={styles.priceList}>{Array.from(grouped.entries()).map(([itemId, rows]) => { const sorted = [...rows].sort((a, b) => String(b.observed_at).localeCompare(String(a.observed_at))); const latest = sorted[0]; const previous = sorted[1]; const change = previous ? priceChangePercent(latest.unit_price_net, previous.unit_price_net) : null; return <details key={itemId}><summary><span className={styles.priceIcon}><ChartNoAxesCombined size={17} /></span><span><strong>{text(itemById.get(itemId)?.name)}</strong><small>{rows.length} obserwacji · ostatnio {text(latest.observed_at)}</small></span><b>{money(latest.unit_price_net)} / {text(latest.unit, text(itemById.get(itemId)?.unit, "j.m."))}</b>{change === null ? <em>pierwsza cena</em> : <em className={change > 5 ? styles.negative : change < -5 ? styles.positive : undefined}>{change > 0 ? "+" : ""}{number(change, 1)}%</em>}<ChevronDown size={15} /></summary><div>{sorted.slice(0, 12).map((row) => <p key={String(row.id)}><span><strong>{text(row.observed_at)}</strong><small>{text(counterpartyById.get(String(row.counterparty_id))?.name, "Dostawca nierozpoznany")} · {text(row.source_type)}</small></span><b>{money(row.unit_price_net)}</b><em>{number(row.quantity)} {text(row.unit, "")}</em></p>)}</div></details>; })}{!prices.length ? <Empty>Historia cen pojawi się automatycznie po imporcie zamówień, faktur lub przyjęć z kosztem jednostkowym.</Empty> : null}</div>;
}

function LocationsPanel({ items, counterparties, balances, aliases, itemById, warehouseById, counterpartyById, canWrite, pending, submit }: { items: Row[]; counterparties: Row[]; balances: Row[]; aliases: Row[]; itemById: Map<string, Row>; warehouseById: Map<string, Row>; counterpartyById: Map<string, Row>; canWrite: boolean; pending: boolean; submit: Submit; }) {
  const nonZero = balances.filter((row) => Number(row.quantity ?? 0) !== 0);
  return <div className={styles.twoColumns} data-equal-height-row="warehouse-locations"><article className={styles.panel} data-equal-height-card><header><Warehouse size={18} /><span><strong>Stany według lokalizacji</strong><small>Magazyn centralny, budowy i magazyny mobilne.</small></span></header>{nonZero.map((row, index) => <p key={`${String(row.warehouseId ?? row.warehouse_id)}-${String(row.stockItemId ?? row.stock_item_id)}-${index}`}><span><strong>{text(itemById.get(String(row.stockItemId ?? row.stock_item_id))?.name)}</strong><small>{text(warehouseById.get(String(row.warehouseId ?? row.warehouse_id))?.name)}</small></span><b>{number(row.quantity)} {text(itemById.get(String(row.stockItemId ?? row.stock_item_id))?.unit, "")}</b></p>)}{!nonZero.length ? <Empty compact>Brak dodatnich stanów w lokalizacjach.</Empty> : null}</article><article className={styles.panel} data-equal-height-card><header><Tags size={18} /><span><strong>Nazwy i indeksy dostawców</strong><small>Aliasy zapobiegają duplikowaniu kartotek przez AI.</small></span></header>{canWrite ? <form className={styles.aliasForm} onSubmit={submit("material_alias", "Alias dostawcy został przypisany do kartoteki.")}><Select name="stockItemId" label="Kartoteka" rows={items} required /><Select name="counterpartyId" label="Dostawca" rows={counterparties} empty="Alias ogólny" /><Field name="supplierName" label="Nazwa na dokumencie" required /><Field name="supplierSku" label="Indeks dostawcy" /><button disabled={pending}><Plus size={15} />Dodaj alias</button></form> : null}<div className={styles.aliasList}>{aliases.map((row) => <p key={String(row.id)}><span><strong>{text(row.supplier_name)}</strong><small>{text(counterpartyById.get(String(row.counterparty_id))?.name, "alias ogólny")} · {text(row.supplier_sku, "bez indeksu")}</small></span><b>→ {text(itemById.get(String(row.stock_item_id))?.name)}</b></p>)}</div>{!aliases.length ? <Empty compact>Brak zatwierdzonych aliasów dla widocznych kartotek.</Empty> : null}</article></div>;
}
