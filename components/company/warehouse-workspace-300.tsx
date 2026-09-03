"use client";

import { useEffect, useMemo, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, ArrowRight, ArrowRightLeft, Boxes, ChartNoAxesCombined, Check,
  ClipboardCheck, FileClock, FileSearch, History, LayoutDashboard, MapPin, Package, PackageCheck,
  Pencil, Plus, QrCode, Save, Search, Sparkles, ToolCase, Undo2, Wrench, X
} from "lucide-react";
import { ModuleDropzoneLink } from "@/components/documents/module-dropzone-link";
import type { Data, PageMeta, Row } from "@/components/company/operations/module-shell";
import type { WarehouseAiLine300, WarehouseDocumentPreview300, WarehouseReview300 } from "@/lib/data/warehouse-ai-300";
import styles from "./warehouse-workspace-310.module.css";

type Tab = "dashboard" | "stock" | "waiting" | "movements" | "needs" | "assets" | "counts" | "prices" | "locations";
type Props = { workspaceId: string; data: Data; canWrite: boolean; canApprove: boolean; query?: string };
type Act = (action: string, payload: Record<string, unknown>, success: string) => void;
type Quality = { totalLines?: number; autoLines?: number; correctedLines?: number; learnedAliases?: number; automationRate?: number; correctionRate?: number; waitingDocuments?: number };
type UndoState = { eventId: string; label: string } | null;

const text = (value: unknown, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
const num = (value: unknown, digits = 2) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number(value ?? 0) || 0);
const money = (value: unknown, currency = "PLN") => new Intl.NumberFormat("pl-PL", { style: "currency", currency: currency || "PLN", maximumFractionDigits: 2 }).format(Number(value ?? 0) || 0);
const pct = (value: number) => `${value > 0 ? "+" : ""}${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value)}%`;
const normalize = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("pl");
const today = () => new Date().toISOString().slice(0, 10);
const dateLabel = (value: unknown) => {
  const raw = String(value ?? "");
  if (!raw) return "—";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("pl-PL").format(date);
};
const openStatuses = new Set(["open", "pending", "reserved"]);
const pendingMovementStatuses = new Set(["draft", "pending", "review"]);

const decisionLabel: Record<string, string> = {
  auto_matched: "Dopasowano automatycznie", matched: "Połączono", new_item_proposed: "Nowa kartoteka?",
  new_item_created: "Utworzono kartotekę", needs_review: "Wymaga decyzji", non_stock: "Poza magazynem", rejected: "Pominięto"
};
const classLabel: Record<string, string> = {
  material: "Materiał", device: "Urządzenie", tool: "Narzędzie", spare_part: "Część zamienna", consumable: "Eksploatacyjne",
  service: "Usługa", transport: "Transport", labor: "Robocizna", fee: "Opłata", informational: "Informacyjne", unknown: "Nierozpoznane"
};
const tabDefs: Array<{ id: Tab; label: string; icon: ReactNode }> = [
  { id: "dashboard", label: "Pulpit", icon: <LayoutDashboard size={15} /> },
  { id: "stock", label: "Magazyn", icon: <Package size={15} /> },
  { id: "waiting", label: "Poczekalnia", icon: <FileClock size={15} /> },
  { id: "movements", label: "Ruchy", icon: <ArrowRightLeft size={15} /> },
  { id: "needs", label: "Braki i rezerwacje", icon: <Boxes size={15} /> },
  { id: "assets", label: "Sprzęt", icon: <ToolCase size={15} /> },
  { id: "counts", label: "Inwentaryzacje", icon: <ClipboardCheck size={15} /> },
  { id: "prices", label: "Ceny i dostawcy", icon: <ChartNoAxesCombined size={15} /> },
  { id: "locations", label: "Lokalizacje", icon: <MapPin size={15} /> }
];

export function WarehouseWorkspace300({ workspaceId, data, canWrite, canApprove, query = "" }: Props) {
  const router = useRouter();
  const page = (data.page ?? { page: 1, pageSize: 40, total: 0 }) as PageMeta;
  const [tab, setTab] = useState<Tab>(query || page.page > 1 ? "stock" : "dashboard");
  const [search, setSearch] = useState(query);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [matchChoice, setMatchChoice] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState>(null);
  const [pending, startTransition] = useTransition();

  const pageItems = (data.items ?? []) as Row[];
  const catalogItems = ((data.catalogItems ?? data.items) ?? []) as Row[];
  const warehouses = (data.warehouses ?? []) as Row[];
  const movements = (data.movements ?? []) as Row[];
  const movementLines = (data.lines ?? []) as Row[];
  const projects = (data.projects ?? []) as Row[];
  const employees = (data.employees ?? []) as Row[];
  const vehicles = (data.vehicles ?? []) as Row[];
  const counterparties = (data.counterparties ?? []) as Row[];
  const reservations = ((data.globalReservations ?? data.reservations) ?? []) as Row[];
  const balances = ((data.globalBalances ?? data.balances) ?? []) as Row[];
  const prices = ((data.globalPriceObservations ?? data.priceObservations) ?? []) as Row[];
  const aliases = (data.aliases ?? []) as Row[];
  const instances = ((data.globalStockInstances ?? data.stockInstances) ?? []) as Row[];
  const counts = (data.inventoryCounts ?? []) as Row[];
  const countLines = (data.inventoryCountLines ?? []) as Row[];
  const reviews = (data.warehouseReviews ?? []) as WarehouseReview300[];
  const aiLines = (data.warehouseAiLines ?? []) as WarehouseAiLine300[];
  const previews = (data.warehouseDocumentPreviews ?? []) as WarehouseDocumentPreview300[];
  const locations = (data.warehouseLocations ?? []) as Row[];
  const locationAssignments = (data.stockItemLocationAssignments ?? []) as Row[];
  const costLayers = (data.inventoryCostLayers ?? []) as Row[];
  const purchaseOrders = (data.warehousePurchaseOrders ?? []) as Row[];
  const quality = (data.warehouseAiQuality ?? {}) as Quality;

  const itemById = useMemo(() => new Map(catalogItems.map((row) => [String(row.id), row])), [catalogItems]);
  const warehouseById = useMemo(() => new Map(warehouses.map((row) => [String(row.id), row])), [warehouses]);
  const projectById = useMemo(() => new Map(projects.map((row) => [String(row.id), row])), [projects]);
  const employeeById = useMemo(() => new Map(employees.map((row) => [String(row.id), row])), [employees]);
  const vehicleById = useMemo(() => new Map(vehicles.map((row) => [String(row.id), row])), [vehicles]);
  const counterpartyById = useMemo(() => new Map(counterparties.map((row) => [String(row.id), row])), [counterparties]);
  const locationById = useMemo(() => new Map(locations.map((row) => [String(row.id), row])), [locations]);
  const previewByVersion = useMemo(() => new Map(previews.map((row) => [row.document_version_id, row])), [previews]);
  const linesByReview = useMemo(() => {
    const map = new Map<string, WarehouseAiLine300[]>();
    aiLines.forEach((line) => map.set(line.review_id, [...(map.get(line.review_id) ?? []), line]));
    return map;
  }, [aiLines]);
  const balanceByItem = useMemo(() => {
    const map = new Map<string, number>();
    balances.forEach((row) => { const id = String(row.stock_item_id ?? row.stockItemId ?? ""); map.set(id, (map.get(id) ?? 0) + Number(row.quantity ?? 0)); });
    return map;
  }, [balances]);
  const reservedByItem = useMemo(() => {
    const map = new Map<string, number>();
    reservations.filter((row) => openStatuses.has(String(row.status))).forEach((row) => { const id = String(row.stock_item_id ?? row.stockItemId ?? ""); map.set(id, (map.get(id) ?? 0) + Number(row.quantity ?? 0)); });
    return map;
  }, [reservations]);
  const pricesByItem = useMemo(() => {
    const map = new Map<string, Row[]>();
    prices.forEach((row) => { const id = String(row.stock_item_id ?? row.stockItemId ?? ""); map.set(id, [...(map.get(id) ?? []), row]); });
    map.forEach((rows) => rows.sort((a, b) => String(b.observed_at ?? b.created_at).localeCompare(String(a.observed_at ?? a.created_at))));
    return map;
  }, [prices]);
  const fifoByItem = useMemo(() => {
    const map = new Map<string, { quantity: number; value: number }>();
    costLayers.forEach((row) => {
      const id = String(row.stock_item_id ?? "");
      const quantity = Number(row.remaining_quantity ?? 0);
      const value = quantity * Number(row.unit_cost ?? 0);
      const current = map.get(id) ?? { quantity: 0, value: 0 };
      map.set(id, { quantity: current.quantity + quantity, value: current.value + value });
    });
    return map;
  }, [costLayers]);

  const waitingReviews = reviews.filter((row) => row.status === "waiting");
  const currentReview = waitingReviews.find((row) => row.id === selectedReviewId) ?? waitingReviews[0] ?? null;
  const currentLines = currentReview ? linesByReview.get(currentReview.id) ?? [] : [];
  const currentPreview = currentReview ? previewByVersion.get(currentReview.document_version_id) ?? null : null;
  const pendingMovements = movements.filter((row) => pendingMovementStatuses.has(String(row.status)));
  const lowStock = catalogItems.filter((row) => Number(row.minimum_stock ?? 0) > 0 && (balanceByItem.get(String(row.id)) ?? 0) - (reservedByItem.get(String(row.id)) ?? 0) < Number(row.minimum_stock ?? 0));
  const openReservations = reservations.filter((row) => openStatuses.has(String(row.status)));
  const issuedInstances = instances.filter((row) => String(row.status) === "assigned");
  const totalStockValue = [...fifoByItem.values()].reduce((sum, row) => sum + row.value, 0);

  const stockRows = useMemo(() => pageItems
    .filter((row) => !search || [row.name, row.sku, row.manufacturer, row.model, row.barcode].some((value) => normalize(value).includes(normalize(search))))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "pl", { sensitivity: "base" })), [pageItems, search]);

  const run = (endpoint: "ai" | "atomic", action: string, payload: Record<string, unknown>, success: string) => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(endpoint === "ai" ? "/api/company/warehouse-ai" : "/api/company/warehouse-atomic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(endpoint === "ai" ? { workspaceId, action, payload } : { workspaceId, entity: action, payload })
        });
        const result = await response.json().catch(() => ({})) as { error?: string; eventId?: string; movementId?: string };
        if (!response.ok) throw new Error(result.error ?? "Operacja Magazynu nie powiodła się.");
        if (result.eventId) setUndo({ eventId: result.eventId, label: success });
        setMessage(result.movementId ? `${success} Szkic ruchu jest gotowy do zatwierdzenia.` : success);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Operacja Magazynu nie powiodła się.");
      }
    });
  };
  const aiAct: Act = (action, payload, success) => run("ai", action, payload, success);
  const atomicAct: Act = (action, payload, success) => run("atomic", action, payload, success);
  const doUndo = () => {
    if (!undo) return;
    const eventId = undo.eventId;
    setUndo(null);
    aiAct("undo", { eventId }, "Cofnięto ostatnią decyzję.");
  };
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTab("stock");
    router.push(`?page=1${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}`);
  };

  return <section className={styles.workspace} data-warehouse-experience="3.1">
    <form className={styles.searchbar} onSubmit={submitSearch}>
      <label><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj po nazwie, SKU, producencie, modelu, EAN lub zeskanuj kod…" /></label>
      {canWrite ? <ModuleDropzoneLink workspaceId={workspaceId} sourceModule="warehouse" variant="primary" /> : null}
    </form>

    <div className={styles.kpis}>
      <Kpi label="Kartoteki" value={page.total || catalogItems.length} caption="globalny katalog A–Z" />
      <Kpi label="Poczekalnia" value={waitingReviews.length} caption="wyjątki wymagające decyzji" attention={waitingReviews.length > 0} />
      <Kpi label="Automatyzacja AI" value={`${num(quality.automationRate ?? 0, 1)}%`} caption={`${num(quality.autoLines ?? 0, 0)} pozycji bez ręcznej pracy`} />
      <Kpi label="Poniżej minimum" value={lowStock.length} caption="po uwzględnieniu rezerwacji" attention={lowStock.length > 0} />
      <Kpi label="Wartość FIFO" value={money(totalStockValue)} caption="aktywne warstwy kosztowe" />
      <Kpi label="Sprzęt wydany" value={issuedInstances.length} caption="pracownicy, budowy i pojazdy" />
    </div>

    <div className={styles.toolbar}><nav className={styles.tabs} aria-label="Sekcje Magazynu 3.1">
      {tabDefs.map((item) => <button type="button" key={item.id} className={`${styles.tab} ${tab === item.id ? styles.tabActive : ""}`} onClick={() => setTab(item.id)}>{item.icon}{item.label}{item.id === "waiting" && waitingReviews.length ? <b>{waitingReviews.length}</b> : null}</button>)}
    </nav></div>

    {message ? <div className={styles.success}><Check size={15} />{message}{undo ? <button type="button" onClick={doUndo}><Undo2 size={13} /> Cofnij</button> : null}</div> : null}
    {error ? <div className={styles.error}><AlertTriangle size={15} />{error}</div> : null}

    {tab === "dashboard" ? <Dashboard waiting={waitingReviews} lowStock={lowStock} pendingMovements={pendingMovements} catalogItems={catalogItems} movements={movements} quality={quality} fifoByItem={fifoByItem} onOpen={setTab} /> : null}
    {tab === "stock" ? <StockRegistry rows={stockRows} page={page} query={search} balanceByItem={balanceByItem} reservedByItem={reservedByItem} pricesByItem={pricesByItem} fifoByItem={fifoByItem} counterpartyById={counterpartyById} onOpen={setSelectedItemId} onPage={(next) => router.push(`?page=${next}${search.trim() ? `&q=${encodeURIComponent(search.trim())}` : ""}`)} /> : null}
    {tab === "waiting" ? <WaitingRoom workspaceId={workspaceId} reviews={waitingReviews} currentReview={currentReview} currentLines={currentLines} currentPreview={currentPreview} itemById={itemById} items={catalogItems} selectedId={currentReview?.id ?? null} onSelect={setSelectedReviewId} matchChoice={matchChoice} setMatchChoice={setMatchChoice} pending={pending} canWrite={canWrite} act={aiAct} /> : null}
    {tab === "movements" ? <MovementsPanel rows={movements} lines={movementLines} warehouses={warehouses} items={catalogItems} projects={projects} warehouseById={warehouseById} projectById={projectById} canWrite={canWrite} canApprove={canApprove} pending={pending} act={atomicAct} /> : null}
    {tab === "needs" ? <NeedsPanel lowStock={lowStock} reservations={openReservations} balanceByItem={balanceByItem} reservedByItem={reservedByItem} pricesByItem={pricesByItem} itemById={itemById} projectById={projectById} warehouseById={warehouseById} counterpartyById={counterpartyById} canWrite={canWrite} pending={pending} act={atomicAct} /> : null}
    {tab === "assets" ? <AssetsPanel rows={instances} items={catalogItems} warehouses={warehouses} employees={employees} projects={projects} vehicles={vehicles} itemById={itemById} projectById={projectById} employeeById={employeeById} vehicleById={vehicleById} canWrite={canWrite} pending={pending} act={atomicAct} /> : null}
    {tab === "counts" ? <CountsPanel rows={counts} lines={countLines} warehouses={warehouses} itemById={itemById} warehouseById={warehouseById} canWrite={canWrite} canApprove={canApprove} pending={pending} act={atomicAct} /> : null}
    {tab === "prices" ? <PricesPanel pricesByItem={pricesByItem} items={catalogItems} counterpartyById={counterpartyById} purchaseOrders={purchaseOrders} /> : null}
    {tab === "locations" ? <LocationsPanel warehouses={warehouses} locations={locations} balances={balances} aliases={aliases} itemById={itemById} canWrite={canWrite} pending={pending} act={atomicAct} /> : null}

    {selectedItemId ? <ItemDrawer key={selectedItemId} item={itemById.get(selectedItemId)} itemId={selectedItemId} catalogItems={catalogItems} balances={balances} reservations={reservations} aliases={aliases} prices={pricesByItem.get(selectedItemId) ?? []} fifo={fifoByItem.get(selectedItemId)} warehouses={warehouseById} counterparties={counterpartyById} locations={locations} locationAssignments={locationAssignments} locationById={locationById} canWrite={canWrite} pending={pending} onClose={() => setSelectedItemId(null)} act={atomicAct} /> : null}
  </section>;
}

function Kpi({ label, value, caption, attention = false }: { label: string; value: ReactNode; caption: string; attention?: boolean }) {
  return <div className={`${styles.kpi} ${attention ? styles.kpiAttention : ""}`}><span>{label}</span><strong>{value}</strong><small>{caption}</small></div>;
}

function Dashboard({ waiting, lowStock, pendingMovements, catalogItems, movements, quality, fifoByItem, onOpen }: {
  waiting: WarehouseReview300[];
  lowStock: Row[];
  pendingMovements: Row[];
  catalogItems: Row[];
  movements: Row[];
  quality: Quality;
  fifoByItem: Map<string, { quantity: number; value: number }>;
  onOpen: (tab: Tab) => void;
}) {
  const biggest = [...catalogItems].sort((a, b) => (fifoByItem.get(String(b.id))?.value ?? 0) - (fifoByItem.get(String(a.id))?.value ?? 0)).slice(0, 6);
  return <div className={styles.dashboard}>
    <section className={styles.aiBrief}><div><Sparkles size={21} /><span><small>OCTOPUS AI · WAREHOUSE 3.1</small><h2>{waiting.length ? `${waiting.length} ${waiting.length === 1 ? "dokument czeka" : "dokumentów czeka"} na krótką decyzję` : "Poczekalnia jest czysta"}</h2><p>{waiting.length ? "AI wykonało analizę pozycji. Zajmij się tylko wyjątkami; po rozstrzygnięciu całego dokumentu powstanie bezpieczny szkic PZ/WZ." : `Automatyzacja: ${num(quality.automationRate ?? 0, 1)}%. Potwierdzone decyzje i odrzucenia uczą kolejne dokumenty.`}</p></span></div><button type="button" onClick={() => onOpen(waiting.length ? "waiting" : "stock")}>{waiting.length ? "Przejdź do Poczekalni" : "Otwórz Magazyn"}</button></section>
    <div className={styles.qualityGrid}>
      <QualityCard label="Automatycznie" value={`${num(quality.automationRate ?? 0, 1)}%`} note={`${num(quality.autoLines ?? 0, 0)} linii`} />
      <QualityCard label="Korekty człowieka" value={`${num(quality.correctionRate ?? 0, 1)}%`} note="AI uczy się z każdej korekty" />
      <QualityCard label="Wyuczone aliasy" value={num(quality.learnedAliases ?? 0, 0)} note="nazwy i indeksy dostawców" />
      <QualityCard label="Łącznie przeanalizowano" value={num(quality.totalLines ?? 0, 0)} note="pozycji dokumentów" />
    </div>
    <div className={styles.dashboardGrid}>
      <Panel title="Do uwagi" icon={<AlertTriangle size={16} />}><ActionRow label="Poczekalnia AI" value={waiting.length} onClick={() => onOpen("waiting")} /><ActionRow label="Poniżej minimum" value={lowStock.length} onClick={() => onOpen("needs")} /><ActionRow label="Ruchy do akceptacji" value={pendingMovements.length} onClick={() => onOpen("movements")} /></Panel>
      <Panel title="Największa wartość zapasu" icon={<Package size={16} />}>{biggest.length ? biggest.map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.name)}</strong><small>{text(row.sku, "bez SKU")}</small></span><b>{money(fifoByItem.get(String(row.id))?.value ?? 0)}</b></div>) : <Empty />}</Panel>
      <Panel title="Ostatnie ruchy" icon={<History size={16} />}>{movements.slice(0, 6).map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.movement_type)} · {text(row.document_number, "bez numeru")}</strong><small>{dateLabel(row.movement_date)} · {text(row.status)}</small></span></div>)}{!movements.length ? <Empty /> : null}</Panel>
    </div>
  </div>;
}

function QualityCard({ label, value, note }: { label: string; value: ReactNode; note: string }) {
  return <div className={styles.qualityCard}><small>{label}</small><strong>{value}</strong><span>{note}</span></div>;
}

function StockRegistry({ rows, page, query, balanceByItem, reservedByItem, pricesByItem, fifoByItem, counterpartyById, onOpen, onPage }: {
  rows: Row[];
  page: PageMeta;
  query: string;
  balanceByItem: Map<string, number>;
  reservedByItem: Map<string, number>;
  pricesByItem: Map<string, Row[]>;
  fifoByItem: Map<string, { quantity: number; value: number }>;
  counterpartyById: Map<string, Row>;
  onOpen: (id: string) => void;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));
  return <section className={styles.section}>
    <header className={styles.sectionHeader}><div><small>MAGAZYN</small><h2>Kartoteki A–Z</h2><p>Globalne wyszukiwanie, stany, FIFO, ceny i historia zakupów. Jedna pozycja = jedna kanoniczna kartoteka.</p></div><b>{page.total}</b></header>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Pozycja</th><th>Stan</th><th>Dostępne</th><th>Rezerwacje</th><th>FIFO</th><th>Ostatnia cena</th><th>Zmiana</th><th>Dostawca</th><th>Zakup</th></tr></thead><tbody>{rows.map((row) => {
      const id = String(row.id);
      const history = pricesByItem.get(id) ?? [];
      const latest = history[0];
      const previous = history[1];
      const change = latest && previous && Number(previous.unit_price_net) ? ((Number(latest.unit_price_net) - Number(previous.unit_price_net)) / Number(previous.unit_price_net)) * 100 : null;
      const reserved = reservedByItem.get(id) ?? 0;
      const balance = balanceByItem.get(id) ?? 0;
      const counterparty = latest ? counterpartyById.get(String(latest.counterparty_id)) : null;
      return <tr key={id} onClick={() => onOpen(id)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onOpen(id); }}><td><strong>{text(row.name)}</strong><small>{[row.manufacturer, row.model, row.sku, row.barcode].filter(Boolean).join(" · ") || "bez dodatkowych oznaczeń"}</small></td><td><b>{num(balance)} {text(row.unit, "")}</b></td><td>{num(balance - reserved)} {text(row.unit, "")}</td><td>{num(reserved)}</td><td>{money(fifoByItem.get(id)?.value ?? 0)}</td><td>{latest ? money(latest.unit_price_net, text(latest.currency, "PLN")) : "—"}</td><td className={change !== null ? (change > 0 ? styles.priceUp : styles.priceDown) : ""}>{change === null ? "—" : pct(change)}</td><td>{text(counterparty?.name)}</td><td>{latest ? dateLabel(latest.observed_at) : "—"}</td></tr>;
    })}</tbody></table>{!rows.length ? <Empty label={query ? "Brak kartotek dla tego wyszukiwania." : "Brak kartotek."} /> : null}</div>
    {pages > 1 ? <div className={styles.pagination}><button type="button" disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}><ArrowLeft size={14} /> Poprzednia</button><span>Strona <b>{page.page}</b> z {pages}</span><button type="button" disabled={page.page >= pages} onClick={() => onPage(page.page + 1)}>Następna <ArrowRight size={14} /></button></div> : null}
  </section>;
}

function WaitingRoom({ workspaceId, reviews, currentReview, currentLines, currentPreview, itemById, items, selectedId, onSelect, matchChoice, setMatchChoice, pending, canWrite, act }: {
  workspaceId: string;
  reviews: WarehouseReview300[];
  currentReview: WarehouseReview300 | null;
  currentLines: WarehouseAiLine300[];
  currentPreview: WarehouseDocumentPreview300 | null;
  itemById: Map<string, Row>;
  items: Row[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  matchChoice: Record<string, string>;
  setMatchChoice: (value: Record<string, string>) => void;
  pending: boolean;
  canWrite: boolean;
  act: Act;
}) {
  const firstPending = currentLines.find((line) => ["needs_review", "new_item_proposed"].includes(line.decision));
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!canWrite || pending || !firstPending) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(target.tagName)) return;
      if (event.key === "Enter" && firstPending.candidate_stock_item_id) { event.preventDefault(); act("match", { lineId: firstPending.id, stockItemId: firstPending.candidate_stock_item_id }, "Zaakceptowano sugestię AI."); }
      if (event.key.toLowerCase() === "n") { event.preventDefault(); act("create", { lineId: firstPending.id }, "Utworzono nową kartotekę."); }
      if (event.key.toLowerCase() === "p") { event.preventDefault(); act("non_stock", { lineId: firstPending.id }, "Pozycję oznaczono jako poza magazynem."); }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [act, canWrite, firstPending, pending]);

  if (!currentReview) return <section className={styles.cleanWaiting}><PackageCheck size={28} /><h2>Poczekalnia jest pusta</h2><p>AI nie ma teraz wyjątków wymagających decyzji. Dokumenty rozpoznane jednoznacznie automatycznie przygotowują szkic PZ/WZ, ale nigdy nie zmieniają stanu bez zatwierdzenia ruchu.</p></section>;
  const unresolved = currentLines.filter((line) => ["needs_review", "new_item_proposed"].includes(line.decision)).length;
  return <section className={styles.waitingRoom}>
    <aside className={styles.queue}><header><span><small>POCZEKALNIA</small><strong>{reviews.length} dokumentów</strong></span></header>{reviews.map((review) => <button type="button" key={review.id} className={selectedId === review.id ? styles.queueActive : ""} onClick={() => onSelect(review.id)}><span><strong>{review.supplier_name || review.document_name || "Dokument"}</strong><small>{review.document_type || "Dokument"} · {review.document_number || "bez numeru"} · {dateLabel(review.document_date)}</small></span><b>{review.review_lines}</b><em>{Math.round(Number(review.confidence ?? 0) * 100)}%</em></button>)}</aside>
    <div className={styles.preview}><header><span><FileSearch size={16} /><strong>{currentReview.document_name || "Podgląd dokumentu"}</strong></span><small>{currentReview.supplier_name || "Dostawca nierozpoznany"}</small></header><DocumentPreview workspaceId={workspaceId} review={currentReview} preview={currentPreview} /></div>
    <aside className={styles.decisions}><header><span><Sparkles size={17} /><div><small>SUGESTIA OCTOPUS AI</small><strong>{unresolved ? `${unresolved} ${unresolved === 1 ? "decyzja" : "decyzji"} do potwierdzenia` : "Dokument rozstrzygnięty"}</strong></div></span><p>{currentReview.ai_summary || "AI przeanalizowało dokument i każdą pozycję osobno."}</p><div className={styles.shortcutHint}>Enter = zaakceptuj AI · N = nowa kartoteka · P = poza magazynem</div></header>
      <div className={styles.lineDecisions}>{currentLines.map((line) => {
        const candidate = line.candidate_stock_item_id ? itemById.get(line.candidate_stock_item_id) : null;
        const resolved = !["needs_review", "new_item_proposed"].includes(line.decision);
        return <article key={line.id} className={resolved ? styles.lineResolved : styles.linePending}><div className={styles.lineTop}><span className={styles.lineClass}>{classLabel[line.line_class] ?? line.line_class}</span><span className={styles.confidence}>{Math.round(Number(line.match_confidence ?? 0) * 100)}%</span></div><strong>{line.raw_description}</strong><small>{line.quantity ? `${num(line.quantity)} ${text(line.unit, "")}` : ""}{line.normalized_unit_price || line.unit_price ? ` · ${money(line.normalized_unit_price ?? line.unit_price, line.currency || "PLN")}/${text(line.unit, "j.m.")}` : ""}</small><p>{line.decision_reason}</p>{[line.manufacturer, line.model, line.ean, line.supplier_sku].some(Boolean) ? <small className={styles.identity}>{[line.manufacturer, line.model, line.ean ? `EAN ${line.ean}` : null, line.supplier_sku ? `SKU ${line.supplier_sku}` : null].filter(Boolean).join(" · ")}</small> : null}
          {candidate ? <div className={styles.suggestion}><span>AI sugeruje</span><strong>{text(candidate.name)}</strong></div> : null}
          {resolved ? <div className={styles.resolvedBadge}><Check size={13} />{decisionLabel[line.decision] ?? line.decision}</div> : canWrite ? <div className={styles.lineActions}>{candidate ? <button type="button" disabled={pending} onClick={() => act("match", { lineId: line.id, stockItemId: candidate.id }, `Połączono „${line.raw_description}” z kartoteką.`)}><Check size={13} /> Akceptuj AI</button> : null}<div className={styles.matchPicker}><select value={matchChoice[line.id] ?? ""} onChange={(event) => setMatchChoice({ ...matchChoice, [line.id]: event.target.value })}><option value="">Dopasuj do istniejącej…</option>{items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "pl")).map((item) => <option key={String(item.id)} value={String(item.id)}>{text(item.name)}{item.sku ? ` · ${item.sku}` : ""}</option>)}</select><button type="button" disabled={pending || !matchChoice[line.id]} onClick={() => act("match", { lineId: line.id, stockItemId: matchChoice[line.id] }, "Dopasowanie zapisano. Octopus zapamięta wybór i odrzuci wcześniejszą błędną sugestię.")}>Połącz</button></div><button type="button" className={styles.secondaryButton} disabled={pending} onClick={() => act("create", { lineId: line.id }, `Utworzono nową kartotekę „${line.raw_description}”.`)}>+ Nowa kartoteka</button><button type="button" className={styles.ghostButton} disabled={pending} onClick={() => act("non_stock", { lineId: line.id }, "Pozycję oznaczono jako poza magazynem.")}>Poza magazynem</button></div> : null}
        </article>;
      })}</div>
      {unresolved === 0 && canWrite ? <button type="button" className={styles.finalizeButton} disabled={pending} onClick={() => act("finalize_review", { reviewId: currentReview.id }, "Przygotowano szkic ruchu na podstawie rozstrzygniętego dokumentu.")}>{currentReview.draft_movement_id ? "Odśwież szkic PZ/WZ" : "Przygotuj szkic PZ/WZ"}</button> : null}
      {canWrite ? <button type="button" className={styles.ignoreDocument} disabled={pending} onClick={() => act("ignore_document", { reviewId: currentReview.id }, "Dokument usunięto z Poczekalni jako niezwiązany z magazynem.")}>Ten dokument nie dotyczy Magazynu</button> : null}
    </aside>
  </section>;
}

function DocumentPreview({ workspaceId, review, preview }: { workspaceId: string; review: WarehouseReview300; preview: WarehouseDocumentPreview300 | null }) {
  const url = `/api/company/warehouse-ai/preview?workspaceId=${encodeURIComponent(workspaceId)}&versionId=${encodeURIComponent(review.document_version_id)}`;
  if (preview?.mime_type === "application/pdf") return <iframe className={styles.previewFrame} src={url} title={`Podgląd ${preview.file_name}`} />;
  if (preview?.mime_type.startsWith("image/")) return <img className={styles.previewImage} src={url} alt={`Podgląd ${preview.file_name}`} />;
  return <div className={styles.textPreview}><FileSearch size={28} /><h3>{preview?.file_name || review.document_name || "Dokument"}</h3><p>{preview?.excerpt || "Dla tego formatu dostępny jest podgląd danych odczytanych przez AI. Oryginał pozostaje zapisany w repozytorium dokumentów."}</p></div>;
}

function MovementsPanel({ rows, lines, warehouses, items, projects, warehouseById, projectById, canWrite, canApprove, pending, act }: {
  rows: Row[];
  lines: Row[];
  warehouses: Row[];
  items: Row[];
  projects: Row[];
  warehouseById: Map<string, Row>;
  projectById: Map<string, Row>;
  canWrite: boolean;
  canApprove: boolean;
  pending: boolean;
  act: Act;
}) {
  return <section className={styles.section}><header className={styles.sectionHeader}><div><small>OPERACJE</small><h2>Ruchy magazynowe</h2><p>PZ, WZ, RW, ZW i MM. Rzeczywisty stan zmienia się wyłącznie po zatwierdzeniu.</p></div></header>{canWrite ? <ManualMovementForm warehouses={warehouses} items={items} projects={projects} pending={pending} act={act} /> : null}<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Typ</th><th>Dokument</th><th>Data</th><th>Magazyn</th><th>Inwestycja</th><th>Pozycje</th><th>Status</th><th>Akcja</th></tr></thead><tbody>{rows.map((row) => { const count = lines.filter((line) => String(line.movement_id) === String(row.id)).length; return <tr key={String(row.id)}><td><b>{text(row.movement_type)}</b></td><td>{text(row.document_number)}</td><td>{dateLabel(row.movement_date)}</td><td>{text(warehouseById.get(String(row.warehouse_id))?.name)}</td><td>{text(projectById.get(String(row.project_id))?.name)}</td><td>{count}</td><td>{text(row.status)}</td><td>{canApprove && String(row.status) === "draft" ? <button className={styles.tableButton} type="button" disabled={pending} onClick={() => act("stock_movement_approve", { movementId: row.id, projectId: row.project_id }, "Ruch zatwierdzono i stan magazynowy został zaktualizowany.")}>Zatwierdź</button> : "—"}</td></tr>; })}</tbody></table>{!rows.length ? <Empty /> : null}</div></section>;
}

function ManualMovementForm({ warehouses, items, projects, pending, act }: { warehouses: Row[]; items: Row[]; projects: Row[]; pending: boolean; act: Act }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("PZ");
  const [lines, setLines] = useState([{ stockItemId: "", quantity: "", unitCost: "" }]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    act("manual_stock_movement", { movementType: type, warehouseId: form.get("warehouseId"), targetWarehouseId: form.get("targetWarehouseId"), projectId: form.get("projectId"), documentNumber: form.get("documentNumber"), movementDate: form.get("movementDate"), lines }, "Utworzono bezpieczny szkic ruchu. Stan nie zmieni się przed zatwierdzeniem.");
  };
  if (!open) return <button type="button" className={styles.addAction} onClick={() => setOpen(true)}><Plus size={14} /> Nowy ruch</button>;
  return <form className={styles.operationForm} onSubmit={submit}><div className={styles.formHeader}><strong>Nowy szkic ruchu</strong><button type="button" onClick={() => setOpen(false)}><X size={15} /></button></div><div className={styles.formGrid}><label>Typ<select value={type} onChange={(e) => setType(e.target.value)}>{["PZ","WZ","RW","ZW","MM"].map((v) => <option key={v}>{v}</option>)}</select></label><label>Magazyn<select name="warehouseId" required><option value="">Wybierz</option>{warehouses.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select></label>{type === "MM" ? <label>Magazyn docelowy<select name="targetWarehouseId" required><option value="">Wybierz</option>{warehouses.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select></label> : null}<label>Inwestycja<select name="projectId"><option value="">Ruch ogólnofirmowy</option>{projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select></label><label>Data<input type="date" name="movementDate" defaultValue={today()} /></label><label>Numer dokumentu<input name="documentNumber" placeholder="automatyczny / opcjonalny" /></label></div><div className={styles.movementLines}>{lines.map((line, index) => <div className={styles.movementLine} key={index}><select value={line.stockItemId} onChange={(e) => setLines(lines.map((v, i) => i === index ? { ...v, stockItemId: e.target.value } : v))} required><option value="">Materiał / sprzęt</option>{items.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}</option>)}</select><input value={line.quantity} onChange={(e) => setLines(lines.map((v, i) => i === index ? { ...v, quantity: e.target.value } : v))} inputMode="decimal" placeholder="Ilość" required /><input value={line.unitCost} onChange={(e) => setLines(lines.map((v, i) => i === index ? { ...v, unitCost: e.target.value } : v))} inputMode="decimal" placeholder="Koszt j. (opc.)" />{lines.length > 1 ? <button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))}><X size={13} /></button> : null}</div>)}</div><div className={styles.formActions}><button type="button" className={styles.secondaryButton} onClick={() => setLines([...lines, { stockItemId: "", quantity: "", unitCost: "" }])}><Plus size={13} /> Pozycja</button><button type="submit" disabled={pending}><Save size={13} /> Zapisz szkic</button></div></form>;
}

function NeedsPanel({ lowStock, reservations, balanceByItem, reservedByItem, pricesByItem, itemById, projectById, warehouseById, counterpartyById, canWrite, pending, act }: {
  lowStock: Row[];
  reservations: Row[];
  balanceByItem: Map<string, number>;
  reservedByItem: Map<string, number>;
  pricesByItem: Map<string, Row[]>;
  itemById: Map<string, Row>;
  projectById: Map<string, Row>;
  warehouseById: Map<string, Row>;
  counterpartyById: Map<string, Row>;
  canWrite: boolean;
  pending: boolean;
  act: Act;
}) {
  return <div className={styles.twoPanels}><Panel title="Braki i sugestie zakupu" icon={<AlertTriangle size={16} />}>{lowStock.map((row) => { const id = String(row.id); const balance = balanceByItem.get(id) ?? 0; const reserved = reservedByItem.get(id) ?? 0; const available = balance - reserved; const target = Number(row.optimal_stock ?? 0) > 0 ? Number(row.optimal_stock) : Number(row.minimum_stock ?? 0); const suggested = Math.max(0, target - available); const latest = (pricesByItem.get(id) ?? [])[0]; const supplier = latest ? counterpartyById.get(String(latest.counterparty_id)) : null; return <div className={styles.needRow} key={id}><span><strong>{text(row.name)}</strong><small>Dostępne {num(available)} · minimum {num(row.minimum_stock)} · cel {num(target)} {text(row.unit, "")}</small><small>{latest ? `Ostatnio: ${money(latest.unit_price_net, text(latest.currency,"PLN"))} · ${text(supplier?.name)}` : "Brak historii ceny"}</small></span><div><b>kup {num(suggested)} {text(row.unit, "")}</b>{canWrite && suggested > 0 ? <button type="button" disabled={pending} onClick={() => act("replenishment_order", { stockItemId: id, quantity: suggested, counterpartyId: latest?.counterparty_id }, "Utworzono szkic zamówienia uzupełniającego.")}>Szkic zamówienia</button> : null}</div></div>; })}{!lowStock.length ? <Empty label="Wszystkie minima i rezerwacje są zabezpieczone." /> : null}</Panel><Panel title="Rezerwacje inwestycji" icon={<Boxes size={16} />}>{reservations.map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(itemById.get(String(row.stock_item_id))?.name)}</strong><small>{text(projectById.get(String(row.project_id))?.name)} · {text(warehouseById.get(String(row.warehouse_id))?.name)} · termin {dateLabel(row.required_at)}</small></span><b>{num(row.quantity)}</b></div>)}{!reservations.length ? <Empty label="Brak otwartych rezerwacji." /> : null}</Panel></div>;
}

function AssetsPanel({ rows, items, warehouses, employees, projects, vehicles, itemById, projectById, employeeById, vehicleById, canWrite, pending, act }: {
  rows: Row[];
  items: Row[];
  warehouses: Row[];
  employees: Row[];
  projects: Row[];
  vehicles: Row[];
  itemById: Map<string, Row>;
  projectById: Map<string, Row>;
  employeeById: Map<string, Row>;
  vehicleById: Map<string, Row>;
  canWrite: boolean;
  pending: boolean;
  act: Act;
}) {
  const serialItems = items.filter((row) => Boolean(row.serial_tracking) || ["equipment","device","tool"].includes(String(row.item_type)));
  return <section className={styles.section}><header className={styles.sectionHeader}><div><small>SPRZĘT</small><h2>Urządzenia i odpowiedzialność</h2><p>Numery seryjne, użytkownik/budowa/pojazd, gwarancja i historia serwisu.</p></div><b>{rows.length}</b></header>{canWrite ? <div className={styles.threeForms}><CompactForm title="Zarejestruj egzemplarz" submit="Dodaj" pending={pending} onSubmit={(f) => act("stock_instance_create", { stockItemId: f.get("item"), warehouseId: f.get("warehouse"), serialNumber: f.get("serial"), assetTag: f.get("tag"), purchaseDate: f.get("purchaseDate"), purchasePrice: f.get("price"), warrantyUntil: f.get("warranty"), condition: f.get("condition") }, "Sprzęt zarejestrowano.")}><SelectField name="item" label="Kartoteka" rows={serialItems} required /><SelectField name="warehouse" label="Magazyn" rows={warehouses} /><TextField name="serial" label="Numer seryjny" required /><TextField name="tag" label="Tag/QR" /><TextField name="purchaseDate" label="Data zakupu" type="date" /><TextField name="price" label="Cena zakupu" /></CompactForm><CompactForm title="Wydaj / przypisz" submit="Przypisz" pending={pending} onSubmit={(f) => act("stock_instance_assign", { instanceId: f.get("instance"), employeeId: f.get("employee"), projectId: f.get("project"), vehicleId: f.get("vehicle"), eventDate: f.get("date"), condition: f.get("condition") }, "Sprzęt przypisano.")}><SelectField name="instance" label="Egzemplarz" rows={rows.filter((r) => !["lost","retired","service"].includes(String(r.status)))} optionLabel={(r) => `${text(itemById.get(String(r.stock_item_id))?.name)} · ${text(r.serial_number)}`} required /><SelectField name="employee" label="Pracownik" rows={employees} /><SelectField name="project" label="Inwestycja" rows={projects} /><SelectField name="vehicle" label="Pojazd" rows={vehicles} optionLabel={(r) => text(r.registration_number, r.name as string)} /><TextField name="date" label="Data" type="date" defaultValue={today()} /></CompactForm><CompactForm title="Zwrot / serwis" submit="Zwróć" pending={pending} onSubmit={(f) => act("stock_instance_return", { instanceId: f.get("instance"), warehouseId: f.get("warehouse"), eventDate: f.get("date"), condition: f.get("condition") }, "Sprzęt wrócił do magazynu.")}><SelectField name="instance" label="Wydany egzemplarz" rows={rows.filter((r) => String(r.status) === "assigned")} optionLabel={(r) => `${text(itemById.get(String(r.stock_item_id))?.name)} · ${text(r.serial_number)}`} required /><SelectField name="warehouse" label="Magazyn zwrotu" rows={warehouses} required /><TextField name="date" label="Data" type="date" defaultValue={today()} /><TextField name="condition" label="Stan" /></CompactForm></div> : null}<div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Sprzęt</th><th>Nr seryjny / tag</th><th>Status</th><th>Przypisanie</th><th>Zakup</th><th>Serwis</th><th>Akcja</th></tr></thead><tbody>{rows.map((row) => { const assignment = row.employee_id ? text(employeeById.get(String(row.employee_id))?.full_name ?? employeeById.get(String(row.employee_id))?.name) : row.project_id ? text(projectById.get(String(row.project_id))?.name) : row.vehicle_id ? text(vehicleById.get(String(row.vehicle_id))?.registration_number) : "Magazyn"; return <tr key={String(row.id)}><td><strong>{text(itemById.get(String(row.stock_item_id))?.name)}</strong></td><td>{text(row.serial_number)}<small>{text(row.asset_tag, "bez tagu")}</small></td><td>{text(row.status)}</td><td>{assignment}</td><td>{dateLabel(row.purchase_date)}<small>{row.purchase_price ? money(row.purchase_price) : "—"}</small></td><td>{dateLabel(row.next_service_date)}</td><td>{canWrite ? <button type="button" className={styles.tableButton} disabled={pending} onClick={() => act("stock_instance_service", { instanceId: row.id, eventDate: today(), nextServiceDate: row.next_service_date, cost: 0, condition: row.condition, notes: "Aktualizacja serwisowa z Warehouse 3.1" }, "Zapisano zdarzenie serwisowe.")}><Wrench size={12} /> Serwis</button> : "—"}</td></tr>; })}</tbody></table>{!rows.length ? <Empty label="Brak zarejestrowanego sprzętu seryjnego." /> : null}</div></section>;
}

function CountsPanel({ rows, lines, warehouses, itemById, warehouseById, canWrite, canApprove, pending, act }: {
  rows: Row[];
  lines: Row[];
  warehouses: Row[];
  itemById: Map<string, Row>;
  warehouseById: Map<string, Row>;
  canWrite: boolean;
  canApprove: boolean;
  pending: boolean;
  act: Act;
}) {
  const openRows = rows.filter((row) => ["draft","open","in_progress"].includes(String(row.status)));
  const [selected, setSelected] = useState(String(openRows[0]?.id ?? rows[0]?.id ?? ""));
  const selectedRow = rows.find((row) => String(row.id) === selected);
  const selectedLines = lines.filter((line) => String(line.inventory_count_id) === selected);
  return <section className={styles.section}><header className={styles.sectionHeader}><div><small>INWENTARYZACJA</small><h2>Spisy i korekty</h2><p>Blind count: użytkownik wpisuje stan policzony, a system wylicza różnicę. Dopiero zatwierdzenie generuje PZ/RW korekcyjne.</p></div><b>{rows.length}</b></header>{canWrite ? <CompactForm title="Nowa inwentaryzacja" submit="Rozpocznij spis" pending={pending} inline onSubmit={(f) => act("inventory_count_create", { warehouseId: f.get("warehouse"), countDate: f.get("date"), notes: f.get("notes") }, "Rozpoczęto inwentaryzację.")}><SelectField name="warehouse" label="Magazyn" rows={warehouses} required /><TextField name="date" label="Data" type="date" defaultValue={today()} /><TextField name="notes" label="Notatka" /></CompactForm> : null}<div className={styles.countLayout}><aside className={styles.countList}>{rows.map((row) => <button type="button" key={String(row.id)} className={selected === String(row.id) ? styles.countActive : ""} onClick={() => setSelected(String(row.id))}><span><strong>{text(warehouseById.get(String(row.warehouse_id))?.name)}</strong><small>{dateLabel(row.count_date)} · {text(row.status)}</small></span><b>{lines.filter((line) => String(line.inventory_count_id) === String(row.id)).length}</b></button>)}</aside><div className={styles.countSheet}>{selectedRow ? <><header><div><strong>{text(warehouseById.get(String(selectedRow.warehouse_id))?.name)}</strong><small>{dateLabel(selectedRow.count_date)} · {text(selectedRow.status)}</small></div>{canApprove && ["draft","open","in_progress"].includes(String(selectedRow.status)) ? <button type="button" disabled={pending} onClick={() => act("inventory_count_approve", { countId: selectedRow.id }, "Inwentaryzację zatwierdzono. Różnice zapisano jako kontrolowane ruchy korekcyjne.")}>Zatwierdź korekty</button> : null}</header>{selectedLines.map((line) => <CountLineEditor key={String(line.id)} line={line} item={itemById.get(String(line.stock_item_id))} canWrite={canWrite} pending={pending} act={act} />)}{!selectedLines.length ? <Empty label="Brak pozycji w spisie." /> : null}</> : <Empty label="Rozpocznij pierwszą inwentaryzację." />}</div></div></section>;
}

function CountLineEditor({ line, item, canWrite, pending, act }: { line: Row; item?: Row; canWrite: boolean; pending: boolean; act: Act }) {
  const [value, setValue] = useState(line.counted_quantity === null || line.counted_quantity === undefined ? "" : String(line.counted_quantity));
  return <div className={styles.countLine}><span><strong>{text(item?.name)}</strong><small>{text(item?.unit, "j.m.")}{line.counted_quantity !== null && line.counted_quantity !== undefined ? ` · różnica ${num(line.difference)}` : " · stan systemowy ukryty podczas liczenia"}</small></span><input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="Policzono" disabled={!canWrite} />{canWrite ? <button type="button" disabled={pending || value === ""} onClick={() => act("inventory_count_line", { lineId: line.id, countedQuantity: value, note: line.note }, "Zapisano stan policzony.")}><Save size={12} /></button> : null}</div>;
}

function PricesPanel({ pricesByItem, items, counterpartyById, purchaseOrders }: { pricesByItem: Map<string, Row[]>; items: Row[]; counterpartyById: Map<string, Row>; purchaseOrders: Row[] }) {
  const alerts = items.flatMap((item) => {
    const history = pricesByItem.get(String(item.id)) ?? [];
    if (history.length < 2) return [];
    const latest = Number(history[0].unit_price_net);
    const previous = Number(history[1].unit_price_net);
    const change = previous > 0 ? ((latest - previous) / previous) * 100 : 0;
    return Math.abs(change) >= 10 ? [{ item, latest: history[0], change }] : [];
  }).sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  const rows = items.flatMap((item) => (pricesByItem.get(String(item.id)) ?? []).slice(0, 6).map((price) => ({ item, price }))).sort((a, b) => String(b.price.observed_at).localeCompare(String(a.price.observed_at))).slice(0, 300);
  return <div className={styles.priceLayout}><Panel title="Alerty zmian cen" icon={<AlertTriangle size={16} />}>{alerts.slice(0, 12).map(({ item, latest, change }) => <div className={styles.simpleRow} key={String(item.id)}><span><strong>{text(item.name)}</strong><small>{money(latest.unit_price_net, text(latest.currency,"PLN"))} · {text(counterpartyById.get(String(latest.counterparty_id))?.name)}</small></span><b className={change > 0 ? styles.priceUp : styles.priceDown}>{pct(change)}</b></div>)}{!alerts.length ? <Empty label="Brak istotnych zmian cen (≥10%)." /> : null}</Panel><Panel title="Ostatnie szkice zamówień" icon={<Package size={16} />}>{purchaseOrders.slice(0, 12).map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.order_number)}</strong><small>{text(row.status)} · {dateLabel(row.created_at)}</small></span><b>{money(row.total_amount, text(row.currency,"PLN"))}</b></div>)}{!purchaseOrders.length ? <Empty label="Szkice pojawią się po rekomendacjach uzupełnień." /> : null}</Panel><section className={`${styles.section} ${styles.priceTable}`}><header className={styles.sectionHeader}><div><small>HISTORIA</small><h2>Ceny i dostawcy</h2><p>Znormalizowana cena jednostkowa i data dokumentu, nie data jego późniejszego uploadu.</p></div><b>{rows.length}</b></header><div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Pozycja</th><th>Cena netto</th><th>Jednostka</th><th>Dostawca</th><th>Data zakupu</th><th>Źródło</th></tr></thead><tbody>{rows.map(({ item, price }) => <tr key={String(price.id)}><td><strong>{text(item.name)}</strong></td><td>{money(price.unit_price_net, text(price.currency,"PLN"))}</td><td>{text(price.unit, item.unit as string)}</td><td>{text(counterpartyById.get(String(price.counterparty_id))?.name)}</td><td>{dateLabel(price.observed_at)}</td><td>{text(price.source_type)}</td></tr>)}</tbody></table>{!rows.length ? <Empty /> : null}</div></section></div>;
}

function LocationsPanel({ warehouses, locations, balances, aliases, itemById, canWrite, pending, act }: { warehouses: Row[]; locations: Row[]; balances: Row[]; aliases: Row[]; itemById: Map<string, Row>; canWrite: boolean; pending: boolean; act: Act }) {
  const quantityByWarehouse = new Map<string, number>();
  balances.forEach((row) => {
    const id = String(row.warehouse_id ?? row.warehouseId);
    quantityByWarehouse.set(id, (quantityByWarehouse.get(id) ?? 0) + Number(row.quantity ?? 0));
  });
  return <div className={styles.locationLayout}>{canWrite ? <CompactForm title="Dodaj lokalizację / regał" submit="Dodaj lokalizację" pending={pending} inline onSubmit={(f) => act("warehouse_location_create", { warehouseId: f.get("warehouse"), parentId: f.get("parent"), code: f.get("code"), name: f.get("name") }, "Lokalizacja została utworzona wraz z tokenem QR.")}><SelectField name="warehouse" label="Magazyn" rows={warehouses} required /><SelectField name="parent" label="Nadrzędna" rows={locations} optionLabel={(r) => `${text(r.code)} · ${text(r.name)}`} /><TextField name="code" label="Kod" required /><TextField name="name" label="Nazwa" required /></CompactForm> : null}<div className={styles.twoPanels}><Panel title="Magazyny i lokalizacje" icon={<MapPin size={16} />}>{warehouses.map((row) => <div key={String(row.id)} className={styles.locationGroup}><div className={styles.simpleRow}><span><strong>{text(row.name)}</strong><small>{text(row.location, row.warehouse_type as string)}</small></span><b>{num(quantityByWarehouse.get(String(row.id)))} j.m.</b></div>{locations.filter((loc) => String(loc.warehouse_id) === String(row.id)).map((loc) => <div className={styles.locationRow} key={String(loc.id)}><span><strong>{text(loc.code)} · {text(loc.name)}</strong><small>{loc.parent_id ? `pod: ${text(locations.find((p) => String(p.id) === String(loc.parent_id))?.name)}` : "poziom główny"}</small></span><code><QrCode size={13} /> {text(loc.qr_token)}</code></div>)}</div>)}{!warehouses.length ? <Empty /> : null}</Panel><Panel title="Wyuczone aliasy dostawców" icon={<Sparkles size={16} />}>{aliases.slice(0, 80).map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.supplier_name, "Dostawca")}: {text(row.supplier_sku, row.normalized_key as string)}</strong><small>→ {text(itemById.get(String(row.stock_item_id))?.name)}</small></span><b>{Math.round(Number(row.confidence ?? 0) * 100)}%</b></div>)}{!aliases.length ? <Empty label="Aliasów przybędzie po decyzjach w Poczekalni." /> : null}</Panel></div></div>;
}

function ItemDrawer({ item, itemId, catalogItems, balances, reservations, aliases, prices, fifo, warehouses, counterparties, locations, locationAssignments, locationById, canWrite, pending, onClose, act }: {
  item?: Row;
  itemId: string;
  catalogItems: Row[];
  balances: Row[];
  reservations: Row[];
  aliases: Row[];
  prices: Row[];
  fifo?: { quantity: number; value: number };
  warehouses: Map<string, Row>;
  counterparties: Map<string, Row>;
  locations: Row[];
  locationAssignments: Row[];
  locationById: Map<string, Row>;
  canWrite: boolean;
  pending: boolean;
  onClose: () => void;
  act: Act;
}) {
  if (!item) return null;
  const itemBalances = balances.filter((row) => String(row.stock_item_id ?? row.stockItemId) === itemId);
  const itemReservations = reservations.filter((row) => String(row.stock_item_id ?? row.stockItemId) === itemId && openStatuses.has(String(row.status)));
  const itemAliases = aliases.filter((row) => String(row.stock_item_id) === itemId);
  const itemLocations = locationAssignments.filter((row) => String(row.stock_item_id) === itemId);
  const values = prices.map((row) => Number(row.unit_price_net)).filter((value) => Number.isFinite(value) && value > 0);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  const similar = catalogItems.filter((row) => String(row.id) !== itemId && similarity(text(row.name,""), text(item.name,"")) >= .55).slice(0, 8);
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    act("stock_item_update", { stockItemId: itemId, name: f.get("name"), sku: f.get("sku"), barcode: f.get("barcode"), manufacturer: f.get("manufacturer"), model: f.get("model"), itemType: f.get("itemType"), category: f.get("category"), subcategory: f.get("subcategory"), unit: f.get("unit"), minimumStock: f.get("minimum"), optimalStock: f.get("optimal"), warrantyMonths: f.get("warranty"), serialTracking: f.get("serialTracking") === "on", active: f.get("active") === "on" }, "Kartoteka została zaktualizowana.");
  };
  return <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside className={styles.drawer}><header><span><small>KARTOTEKA MAGAZYNU 3.1</small><h2>{text(item.name)}</h2></span><button type="button" onClick={onClose}><X size={18} /></button></header><div className={styles.drawerStats}><div><small>Wartość FIFO</small><strong>{money(fifo?.value ?? 0)}</strong></div><div><small>Śr. koszt FIFO</small><strong>{fifo?.quantity ? money((fifo.value ?? 0) / fifo.quantity) : "—"}</strong></div><div><small>Ostatnia cena</small><strong>{prices[0] ? money(prices[0].unit_price_net, text(prices[0].currency,"PLN")) : "—"}</strong></div><div><small>Średnia zakupów</small><strong>{values.length ? money(avg, text(prices[0]?.currency,"PLN")) : "—"}</strong></div></div>
    <form className={styles.itemForm} onSubmit={save}><label className={styles.wide}>Nazwa kanoniczna<input name="name" defaultValue={text(item.name,"")} required /></label><label>SKU<input name="sku" defaultValue={text(item.sku,"")} /></label><label>EAN / kod<input name="barcode" defaultValue={text(item.barcode,"")} /></label><label>Producent<input name="manufacturer" defaultValue={text(item.manufacturer,"")} /></label><label>Model<input name="model" defaultValue={text(item.model,"")} /></label><label>Typ<select name="itemType" defaultValue={text(item.item_type,"material")}><option value="material">Materiał</option><option value="equipment">Sprzęt</option><option value="device">Urządzenie</option><option value="tool">Narzędzie</option></select></label><label>Jednostka<input name="unit" defaultValue={text(item.unit,"szt.")} required /></label><label>Kategoria<input name="category" defaultValue={text(item.category,"")} /></label><label>Podkategoria<input name="subcategory" defaultValue={text(item.subcategory,"")} /></label><label>Minimum<input name="minimum" defaultValue={text(item.minimum_stock,"0")} inputMode="decimal" /></label><label>Optimum<input name="optimal" defaultValue={text(item.optimal_stock,"0")} inputMode="decimal" /></label><label>Gwarancja (mies.)<input name="warranty" defaultValue={text(item.warranty_months,"")} inputMode="numeric" /></label><label className={styles.check}><input type="checkbox" name="serialTracking" defaultChecked={Boolean(item.serial_tracking)} /> Śledzenie numerów seryjnych</label><label className={styles.check}><input type="checkbox" name="active" defaultChecked={Boolean(item.active)} /> Aktywna kartoteka</label>{canWrite ? <button className={styles.saveItem} type="submit" disabled={pending}><Pencil size={14} /> Zapisz kartotekę</button> : null}</form>
    <Panel title="Stany wg magazynu" icon={<MapPin size={15} />}>{itemBalances.map((row) => <div className={styles.simpleRow} key={`${row.warehouse_id}-${row.stock_item_id}`}><span><strong>{text(warehouses.get(String(row.warehouse_id ?? row.warehouseId))?.name)}</strong></span><b>{num(row.quantity)} {text(item.unit,"")}</b></div>)}{!itemBalances.length ? <Empty /> : null}</Panel>
    <Panel title="Lokalizacje regałowe / QR" icon={<QrCode size={15} />}>{itemLocations.map((row) => { const loc = locationById.get(String(row.warehouse_location_id)); return <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(loc?.code)} · {text(loc?.name)}</strong><small>{text(loc?.qr_token)}</small></span>{row.preferred ? <b>domyślna</b> : null}</div>; })}{canWrite && locations.length ? <LocationAssignForm itemId={itemId} locations={locations} pending={pending} act={act} /> : null}{!itemLocations.length && !locations.length ? <Empty label="Dodaj lokalizacje w zakładce Lokalizacje." /> : null}</Panel>
    <Panel title="Ostatnie zakupy i ceny" icon={<History size={15} />}>{prices.slice(0, 16).map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{money(row.unit_price_net, text(row.currency,"PLN"))} / {text(row.unit,item.unit as string)}</strong><small>{text(counterparties.get(String(row.counterparty_id))?.name)} · {dateLabel(row.observed_at)}</small></span></div>)}{!prices.length ? <Empty label="Historia cen pojawi się po rozpoznanych zakupach." /> : null}</Panel>
    <Panel title="Wyuczone nazwy dostawców" icon={<Sparkles size={15} />}>{itemAliases.map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.supplier_name,"Dostawca")}</strong><small>{text(row.supplier_sku,row.normalized_key as string)}</small></span></div>)}{!itemAliases.length ? <Empty label="Brak wyuczonych aliasów." /> : null}</Panel>
    {itemReservations.length ? <Panel title="Rezerwacje" icon={<Boxes size={15} />}>{itemReservations.map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{num(row.quantity)} {text(item.unit,"")}</strong><small>{dateLabel(row.required_at)}</small></span></div>)}</Panel> : null}
    {canWrite ? <Panel title="Duplikaty i scalanie" icon={<AlertTriangle size={15} />}>{similar.length ? <MergeForm sourceId={itemId} rows={similar} pending={pending} act={act} onClose={onClose} /> : <Empty label="Nie wykryto podobnych aktywnych kartotek." />}</Panel> : null}
  </aside></div>;
}

function LocationAssignForm({ itemId, locations, pending, act }: { itemId: string; locations: Row[]; pending: boolean; act: Act }) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    act("warehouse_location_assign", { stockItemId: itemId, locationId: f.get("location"), preferred: f.get("preferred") === "on" }, "Przypisano lokalizację kartoteki.");
  };
  return <form className={styles.inlineAssign} onSubmit={submit}><select name="location" required><option value="">Przypisz do lokalizacji…</option>{locations.map((loc) => <option key={String(loc.id)} value={String(loc.id)}>{text(loc.code)} · {text(loc.name)}</option>)}</select><label><input type="checkbox" name="preferred" /> domyślna</label><button type="submit" disabled={pending}>Przypisz</button></form>;
}

function MergeForm({ sourceId, rows, pending, act, onClose }: { sourceId: string; rows: Row[]; pending: boolean; act: Act; onClose: () => void }) {
  const [target, setTarget] = useState("");
  const merge = () => {
    if (!target || !window.confirm("Scalić kartoteki? Historia ruchów, cen, rezerwacji, faktur i zakupów zostanie przeniesiona do kartoteki docelowej.")) return;
    act("stock_item_merge", { sourceId, targetId: target }, "Kartoteki scalono bez utraty historii.");
    onClose();
  };
  return <div className={styles.mergeForm}><select value={target} onChange={(e) => setTarget(e.target.value)}><option value="">Wybierz kartotekę docelową…</option>{rows.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(row.name)}{row.sku ? ` · ${row.sku}` : ""}</option>)}</select><button type="button" disabled={pending || !target} onClick={merge}>Scal do wybranej</button></div>;
}

function similarity(a: string, b: string) {
  const ta = new Set(normalize(a).split(/[^a-z0-9ąćęłńóśźż]+/).filter((v) => v.length > 1));
  const tb = new Set(normalize(b).split(/[^a-z0-9ąćęłńóśźż]+/).filter((v) => v.length > 1));
  if (!ta.size || !tb.size) return 0;
  const common = [...ta].filter((v) => tb.has(v)).length;
  return common / Math.max(ta.size, tb.size);
}

function CompactForm({ title, submit, pending, onSubmit, children, inline = false }: { title: string; submit: string; pending: boolean; onSubmit: (form: FormData) => void; children: ReactNode; inline?: boolean }) {
  const handle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(new FormData(event.currentTarget));
  };
  return <form className={`${styles.compactForm} ${inline ? styles.compactFormInline : ""}`} onSubmit={handle}><strong>{title}</strong><div>{children}</div><button type="submit" disabled={pending}><Save size={12} /> {submit}</button></form>;
}

function SelectField({ name, label, rows, required = false, optionLabel }: { name: string; label: string; rows: Row[]; required?: boolean; optionLabel?: (row: Row) => string }) {
  return <label>{label}<select name={name} required={required}><option value="">{required ? "Wybierz" : "—"}</option>{rows.map((row) => <option key={String(row.id)} value={String(row.id)}>{optionLabel ? optionLabel(row) : text(row.name, row.title as string)}</option>)}</select></label>;
}

function TextField({ name, label, type = "text", required = false, defaultValue }: { name: string; label: string; type?: string; required?: boolean; defaultValue?: string }) {
  return <label>{label}<input name={name} type={type} required={required} defaultValue={defaultValue} /></label>;
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return <section className={styles.panel}><header>{icon}<strong>{title}</strong></header><div>{children}</div></section>;
}

function ActionRow({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return <button type="button" className={styles.actionRow} onClick={onClick}><span>{label}</span><b>{value}</b></button>;
}

function Empty({ label = "Brak danych." }: { label?: string }) {
  return <div className={styles.empty}>{label}</div>;
}
