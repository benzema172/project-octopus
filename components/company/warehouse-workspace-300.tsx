"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowRightLeft, Boxes, ChartNoAxesCombined, Check, ClipboardCheck,
  FileClock, FileSearch, History, LayoutDashboard, MapPin, Package, PackageCheck,
  Pencil, Search, Sparkles, ToolCase, X
} from "lucide-react";
import { ModuleDropzoneLink } from "@/components/documents/module-dropzone-link";
import type { Data, Row } from "@/components/company/operations/module-shell";
import type { WarehouseAiLine300, WarehouseDocumentPreview300, WarehouseReview300 } from "@/lib/data/warehouse-ai-300";
import styles from "./warehouse-workspace-300.module.css";

type Tab = "dashboard" | "stock" | "waiting" | "movements" | "needs" | "assets" | "counts" | "prices" | "locations";
type Props = { workspaceId: string; data: Data; canWrite: boolean; canApprove: boolean; query?: string };

const text = (value: unknown, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
const num = (value: unknown, digits = 2) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: digits }).format(Number(value ?? 0) || 0);
const money = (value: unknown, currency = "PLN") => new Intl.NumberFormat("pl-PL", { style: "currency", currency: currency || "PLN", maximumFractionDigits: 2 }).format(Number(value ?? 0) || 0);
const pct = (value: number) => `${value > 0 ? "+" : ""}${new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value)}%`;
const normalize = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("pl");
const dateLabel = (value: unknown) => {
  const raw = String(value ?? "");
  if (!raw) return "—";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("pl-PL").format(date);
};

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

export function WarehouseWorkspace300({ workspaceId, data, canWrite, query = "" }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [search, setSearch] = useState(query);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedReviewId, setSelectedReviewId] = useState<string | null>(null);
  const [matchChoice, setMatchChoice] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const items = (data.items ?? []) as Row[];
  const warehouses = (data.warehouses ?? []) as Row[];
  const movements = (data.movements ?? []) as Row[];
  const reservations = (data.reservations ?? []) as Row[];
  const balances = (data.balances ?? []) as Row[];
  const projects = (data.projects ?? []) as Row[];
  const counterparties = (data.counterparties ?? []) as Row[];
  const prices = (data.priceObservations ?? []) as Row[];
  const aliases = (data.aliases ?? []) as Row[];
  const instances = (data.stockInstances ?? []) as Row[];
  const counts = (data.inventoryCounts ?? []) as Row[];
  const reviews = (data.warehouseReviews ?? []) as WarehouseReview300[];
  const aiLines = (data.warehouseAiLines ?? []) as WarehouseAiLine300[];
  const previews = (data.warehouseDocumentPreviews ?? []) as WarehouseDocumentPreview300[];

  const itemById = useMemo(() => new Map(items.map((row) => [String(row.id), row])), [items]);
  const warehouseById = useMemo(() => new Map(warehouses.map((row) => [String(row.id), row])), [warehouses]);
  const projectById = useMemo(() => new Map(projects.map((row) => [String(row.id), row])), [projects]);
  const counterpartyById = useMemo(() => new Map(counterparties.map((row) => [String(row.id), row])), [counterparties]);
  const previewByVersion = useMemo(() => new Map(previews.map((row) => [row.document_version_id, row])), [previews]);
  const linesByReview = useMemo(() => {
    const map = new Map<string, WarehouseAiLine300[]>();
    aiLines.forEach((line) => map.set(line.review_id, [...(map.get(line.review_id) ?? []), line]));
    return map;
  }, [aiLines]);

  const balanceByItem = useMemo(() => {
    const map = new Map<string, number>();
    balances.forEach((row) => {
      const id = String(row.stock_item_id ?? row.stockItemId ?? "");
      map.set(id, (map.get(id) ?? 0) + Number(row.quantity ?? 0));
    });
    return map;
  }, [balances]);
  const reservedByItem = useMemo(() => {
    const map = new Map<string, number>();
    reservations.filter((row) => ["open", "pending", "reserved"].includes(String(row.status))).forEach((row) => {
      const id = String(row.stock_item_id ?? row.stockItemId ?? "");
      map.set(id, (map.get(id) ?? 0) + Number(row.quantity ?? 0));
    });
    return map;
  }, [reservations]);
  const pricesByItem = useMemo(() => {
    const map = new Map<string, Row[]>();
    prices.forEach((row) => {
      const id = String(row.stock_item_id ?? row.stockItemId ?? "");
      map.set(id, [...(map.get(id) ?? []), row]);
    });
    map.forEach((rows) => rows.sort((a, b) => String(b.observed_at ?? b.created_at).localeCompare(String(a.observed_at ?? a.created_at))));
    return map;
  }, [prices]);

  const waitingReviews = reviews.filter((row) => row.status === "waiting");
  const currentReview = waitingReviews.find((row) => row.id === selectedReviewId) ?? waitingReviews[0] ?? null;
  const currentLines = currentReview ? linesByReview.get(currentReview.id) ?? [] : [];
  const currentPreview = currentReview ? previewByVersion.get(currentReview.document_version_id) ?? null : null;
  const pendingMovements = movements.filter((row) => ["draft", "pending", "review"].includes(String(row.status)));
  const lowStock = items.filter((row) => Number(row.minimum_stock ?? 0) > 0 && (balanceByItem.get(String(row.id)) ?? 0) < Number(row.minimum_stock ?? 0));
  const openReservations = reservations.filter((row) => ["open", "pending", "reserved"].includes(String(row.status)));
  const issuedInstances = instances.filter((row) => String(row.status) === "assigned");
  const openCounts = counts.filter((row) => ["draft", "open", "in_progress"].includes(String(row.status)));

  const stockRows = useMemo(() => items
    .filter((row) => !search || [row.name, row.sku, row.manufacturer, row.model, row.barcode].some((value) => normalize(value).includes(normalize(search))))
    .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), "pl", { sensitivity: "base" })), [items, search]);

  const act = (action: string, payload: Record<string, unknown>, success: string) => {
    setMessage(null); setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/warehouse-ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, action, payload }) });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Operacja AI nie powiodła się.");
        setMessage(success);
        router.refresh();
      } catch (err) { setError(err instanceof Error ? err.message : "Operacja AI nie powiodła się."); }
    });
  };

  return <section className={styles.workspace} data-warehouse-experience="3.0">
    <div className={styles.searchbar}>
      <label><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj po nazwie, SKU, producencie, modelu lub EAN…" /></label>
      {canWrite ? <ModuleDropzoneLink workspaceId={workspaceId} sourceModule="warehouse" variant="primary" /> : null}
    </div>

    <div className={styles.kpis}>
      <Kpi label="Kartoteki" value={items.length} caption="alfabetycznie A–Z" />
      <Kpi label="Poczekalnia" value={waitingReviews.length} caption="wyjątki wymagające decyzji" attention={waitingReviews.length > 0} />
      <Kpi label="Poniżej minimum" value={lowStock.length} caption="pozycje wymagające uzupełnienia" attention={lowStock.length > 0} />
      <Kpi label="Ruchy do akceptacji" value={pendingMovements.length} caption="stan jeszcze się nie zmienił" />
      <Kpi label="Rezerwacje" value={openReservations.length} caption="potrzeby inwestycji" />
      <Kpi label="Sprzęt wydany" value={issuedInstances.length} caption="pracownicy, budowy i pojazdy" />
    </div>

    <div className={styles.toolbar}>
      <nav className={styles.tabs} aria-label="Sekcje Magazynu 3.0">
        {tabDefs.map((item) => <button type="button" key={item.id} className={`${styles.tab} ${tab === item.id ? styles.tabActive : ""}`} onClick={() => setTab(item.id)}>{item.icon}{item.label}{item.id === "waiting" && waitingReviews.length ? <b>{waitingReviews.length}</b> : null}</button>)}
      </nav>
    </div>

    {message ? <div className={styles.success}><Check size={15} />{message}</div> : null}
    {error ? <div className={styles.error}><AlertTriangle size={15} />{error}</div> : null}

    {tab === "dashboard" ? <Dashboard waiting={waitingReviews} lowStock={lowStock} pendingMovements={pendingMovements} items={items} movements={movements} itemById={itemById} balanceByItem={balanceByItem} onOpen={setTab} /> : null}
    {tab === "stock" ? <StockRegistry rows={stockRows} balanceByItem={balanceByItem} reservedByItem={reservedByItem} pricesByItem={pricesByItem} counterpartyById={counterpartyById} onOpen={(id) => setSelectedItemId(id)} /> : null}
    {tab === "waiting" ? <WaitingRoom workspaceId={workspaceId} reviews={waitingReviews} currentReview={currentReview} currentLines={currentLines} currentPreview={currentPreview} itemById={itemById} items={items} selectedId={currentReview?.id ?? null} onSelect={setSelectedReviewId} matchChoice={matchChoice} setMatchChoice={setMatchChoice} pending={pending} canWrite={canWrite} act={act} /> : null}
    {tab === "movements" ? <MovementsPanel rows={movements} warehouseById={warehouseById} projectById={projectById} /> : null}
    {tab === "needs" ? <NeedsPanel lowStock={lowStock} reservations={openReservations} balanceByItem={balanceByItem} itemById={itemById} projectById={projectById} warehouseById={warehouseById} /> : null}
    {tab === "assets" ? <AssetsPanel rows={instances} itemById={itemById} projectById={projectById} /> : null}
    {tab === "counts" ? <CountsPanel rows={counts} warehouseById={warehouseById} /> : null}
    {tab === "prices" ? <PricesPanel pricesByItem={pricesByItem} items={items} counterpartyById={counterpartyById} /> : null}
    {tab === "locations" ? <LocationsPanel warehouses={warehouses} balances={balances} aliases={aliases} itemById={itemById} /> : null}

    {selectedItemId ? <ItemDrawer item={itemById.get(selectedItemId)} itemId={selectedItemId} balances={balances} reservations={reservations} aliases={aliases} prices={pricesByItem.get(selectedItemId) ?? []} warehouses={warehouseById} counterparties={counterpartyById} canWrite={canWrite} pending={pending} onClose={() => setSelectedItemId(null)} onRename={(name) => act("rename_item", { stockItemId: selectedItemId, name }, "Nazwa kartoteki została zapisana.")} /> : null}
  </section>;
}

function Kpi({ label, value, caption, attention = false }: { label: string; value: number; caption: string; attention?: boolean }) {
  return <div className={`${styles.kpi} ${attention ? styles.kpiAttention : ""}`}><span>{label}</span><strong>{value}</strong><small>{caption}</small></div>;
}

function Dashboard({ waiting, lowStock, pendingMovements, items, movements, itemById, balanceByItem, onOpen }: {
  waiting: WarehouseReview300[]; lowStock: Row[]; pendingMovements: Row[]; items: Row[]; movements: Row[]; itemById: Map<string, Row>; balanceByItem: Map<string, number>; onOpen: (tab: Tab) => void;
}) {
  const biggest = [...items].sort((a, b) => (balanceByItem.get(String(b.id)) ?? 0) - (balanceByItem.get(String(a.id)) ?? 0)).slice(0, 6);
  return <div className={styles.dashboard}>
    <section className={styles.aiBrief}>
      <div><Sparkles size={21} /><span><small>OCTOPUS AI · MAGAZYN</small><h2>{waiting.length ? `${waiting.length} ${waiting.length === 1 ? "dokument czeka" : "dokumentów czeka"} na krótką decyzję` : "Poczekalnia jest czysta"}</h2><p>{waiting.length ? "AI wykonało analizę pozycji. Zajmij się tylko wyjątkami, których nie dało się bezpiecznie rozstrzygnąć automatycznie." : "Nowe dokumenty z Wrzutni będą analizowane per pozycja i automatycznie dopasowywane do wyuczonych kartotek."}</p></span></div>
      <button type="button" onClick={() => onOpen(waiting.length ? "waiting" : "stock")}>{waiting.length ? "Przejdź do Poczekalni" : "Otwórz Magazyn"}</button>
    </section>
    <div className={styles.dashboardGrid}>
      <Panel title="Do uwagi" icon={<AlertTriangle size={16} />}>
        <ActionRow label="Poczekalnia AI" value={waiting.length} onClick={() => onOpen("waiting")} />
        <ActionRow label="Poniżej minimum" value={lowStock.length} onClick={() => onOpen("needs")} />
        <ActionRow label="Ruchy do akceptacji" value={pendingMovements.length} onClick={() => onOpen("movements")} />
      </Panel>
      <Panel title="Największe stany" icon={<Package size={16} />}>
        {biggest.length ? biggest.map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.name)}</strong><small>{text(row.sku, "bez SKU")}</small></span><b>{num(balanceByItem.get(String(row.id)))} {text(row.unit, "")}</b></div>) : <Empty />}
      </Panel>
      <Panel title="Ostatnie ruchy" icon={<History size={16} />}>
        {movements.slice(0, 6).map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.movement_type)} · {text(row.document_number, "bez numeru")}</strong><small>{dateLabel(row.movement_date)} · {text(row.status)}</small></span></div>)}
        {!movements.length ? <Empty /> : null}
      </Panel>
    </div>
  </div>;
}

function StockRegistry({ rows, balanceByItem, reservedByItem, pricesByItem, counterpartyById, onOpen }: {
  rows: Row[]; balanceByItem: Map<string, number>; reservedByItem: Map<string, number>; pricesByItem: Map<string, Row[]>; counterpartyById: Map<string, Row>; onOpen: (id: string) => void;
}) {
  return <section className={styles.section}>
    <header className={styles.sectionHeader}><div><small>MAGAZYN</small><h2>Kartoteki A–Z</h2><p>Jedna pozycja = jedna kanoniczna nazwa. Aliasów dostawców uczy się AI w Poczekalni.</p></div><b>{rows.length}</b></header>
    <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Pozycja</th><th>Stan</th><th>Dostępne</th><th>Rezerwacje</th><th>Ostatnia cena</th><th>Zmiana</th><th>Dostawca</th><th>Ostatni zakup</th></tr></thead><tbody>
      {rows.map((row) => {
        const id = String(row.id); const history = pricesByItem.get(id) ?? []; const latest = history[0]; const previous = history[1];
        const change = latest && previous && Number(previous.unit_price_net) ? ((Number(latest.unit_price_net) - Number(previous.unit_price_net)) / Number(previous.unit_price_net)) * 100 : null;
        const reserved = reservedByItem.get(id) ?? 0; const balance = balanceByItem.get(id) ?? 0; const counterparty = latest ? counterpartyById.get(String(latest.counterparty_id)) : null;
        return <tr key={id} onClick={() => onOpen(id)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onOpen(id); }}><td><strong>{text(row.name)}</strong><small>{[row.manufacturer, row.model, row.sku].filter(Boolean).join(" · ") || "bez dodatkowych oznaczeń"}</small></td><td><b>{num(balance)} {text(row.unit, "")}</b></td><td>{num(balance - reserved)} {text(row.unit, "")}</td><td>{num(reserved)}</td><td>{latest ? money(latest.unit_price_net, text(latest.currency, "PLN")) : "—"}</td><td className={change !== null ? (change > 0 ? styles.priceUp : styles.priceDown) : ""}>{change === null ? "—" : pct(change)}</td><td>{text(counterparty?.name)}</td><td>{latest ? dateLabel(latest.observed_at) : "—"}</td></tr>;
      })}
    </tbody></table>{!rows.length ? <Empty label="Brak kartotek dla tego wyszukiwania." /> : null}</div>
  </section>;
}

function WaitingRoom({ workspaceId, reviews, currentReview, currentLines, currentPreview, itemById, items, selectedId, onSelect, matchChoice, setMatchChoice, pending, canWrite, act }: {
  workspaceId: string; reviews: WarehouseReview300[]; currentReview: WarehouseReview300 | null; currentLines: WarehouseAiLine300[]; currentPreview: WarehouseDocumentPreview300 | null; itemById: Map<string, Row>; items: Row[]; selectedId: string | null; onSelect: (id: string) => void; matchChoice: Record<string, string>; setMatchChoice: (value: Record<string, string>) => void; pending: boolean; canWrite: boolean; act: (action: string, payload: Record<string, unknown>, success: string) => void;
}) {
  if (!currentReview) return <section className={styles.cleanWaiting}><PackageCheck size={28} /><h2>Poczekalnia jest pusta</h2><p>AI nie ma teraz żadnych wyjątków wymagających Twojej decyzji. Nowe dokumenty z Wrzutni będą pojawiać się tutaj tylko wtedy, gdy automatyczne rozstrzygnięcie nie będzie bezpieczne.</p></section>;
  const unresolved = currentLines.filter((line) => ["needs_review", "new_item_proposed"].includes(line.decision)).length;
  return <section className={styles.waitingRoom}>
    <aside className={styles.queue}><header><span><small>POCZEKALNIA</small><strong>{reviews.length} dokumentów</strong></span></header>{reviews.map((review) => <button type="button" key={review.id} className={selectedId === review.id ? styles.queueActive : ""} onClick={() => onSelect(review.id)}><span><strong>{review.supplier_name || review.document_name || "Dokument"}</strong><small>{review.document_type || "Dokument"} · {review.document_number || "bez numeru"}</small></span><b>{review.review_lines}</b><em>{Math.round(Number(review.confidence ?? 0) * 100)}%</em></button>)}</aside>
    <div className={styles.preview}><header><span><FileSearch size={16} /><strong>{currentReview.document_name || "Podgląd dokumentu"}</strong></span><small>{currentReview.supplier_name || "Dostawca nierozpoznany"}</small></header><DocumentPreview workspaceId={workspaceId} review={currentReview} preview={currentPreview} /></div>
    <aside className={styles.decisions}><header><span><Sparkles size={17} /><div><small>SUGESTIA OCTOPUS AI</small><strong>{unresolved ? `${unresolved} ${unresolved === 1 ? "decyzja" : "decyzji"} do potwierdzenia` : "Dokument rozstrzygnięty"}</strong></div></span><p>{currentReview.ai_summary || "AI przeanalizowało dokument i każdą pozycję osobno."}</p></header>
      <div className={styles.lineDecisions}>{currentLines.map((line) => {
        const candidate = line.candidate_stock_item_id ? itemById.get(line.candidate_stock_item_id) : null;
        const resolved = !["needs_review", "new_item_proposed"].includes(line.decision);
        return <article key={line.id} className={resolved ? styles.lineResolved : styles.linePending}><div className={styles.lineTop}><span className={styles.lineClass}>{classLabel[line.line_class] ?? line.line_class}</span><span className={styles.confidence}>{Math.round(Number(line.match_confidence ?? 0) * 100)}%</span></div><strong>{line.raw_description}</strong><small>{line.quantity ? `${num(line.quantity)} ${text(line.unit, "")}` : ""}{line.unit_price ? ` · ${money(line.unit_price, line.currency || "PLN")}` : ""}</small><p>{line.decision_reason}</p>
          {candidate ? <div className={styles.suggestion}><span>AI sugeruje</span><strong>{text(candidate.name)}</strong></div> : null}
          {resolved ? <div className={styles.resolvedBadge}><Check size={13} />{decisionLabel[line.decision] ?? line.decision}</div> : canWrite ? <div className={styles.lineActions}>
            {candidate ? <button type="button" disabled={pending} onClick={() => act("match", { lineId: line.id, stockItemId: candidate.id }, `Połączono „${line.raw_description}” z kartoteką.`)}><Check size={13} /> Akceptuj AI</button> : null}
            <div className={styles.matchPicker}><select value={matchChoice[line.id] ?? ""} onChange={(event) => setMatchChoice({ ...matchChoice, [line.id]: event.target.value })}><option value="">Dopasuj do istniejącej…</option>{items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "pl")).map((item) => <option key={String(item.id)} value={String(item.id)}>{text(item.name)}</option>)}</select><button type="button" disabled={pending || !matchChoice[line.id]} onClick={() => act("match", { lineId: line.id, stockItemId: matchChoice[line.id] }, "Dopasowanie zapisano i AI nauczyło się aliasu dostawcy.")}>Połącz</button></div>
            <button type="button" className={styles.secondaryButton} disabled={pending} onClick={() => act("create", { lineId: line.id }, `Utworzono nową kartotekę „${line.raw_description}”.`)}>+ Nowa kartoteka</button>
            <button type="button" className={styles.ghostButton} disabled={pending} onClick={() => act("non_stock", { lineId: line.id }, "Pozycję oznaczono jako poza magazynem.")}>Poza magazynem</button>
          </div> : null}
        </article>;
      })}</div>
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

function MovementsPanel({ rows, warehouseById, projectById }: { rows: Row[]; warehouseById: Map<string, Row>; projectById: Map<string, Row> }) {
  return <GenericTable title="Ruchy magazynowe" subtitle="PZ, WZ, RW, ZW i MM. Rzeczywisty stan zmienia się dopiero po zatwierdzeniu ruchu." headers={["Typ", "Dokument", "Data", "Magazyn", "Inwestycja", "Status"]} rows={rows.map((row) => [text(row.movement_type), text(row.document_number), dateLabel(row.movement_date), text(warehouseById.get(String(row.warehouse_id))?.name), text(projectById.get(String(row.project_id))?.name), text(row.status)])} />;
}
function NeedsPanel({ lowStock, reservations, balanceByItem, itemById, projectById, warehouseById }: { lowStock: Row[]; reservations: Row[]; balanceByItem: Map<string, number>; itemById: Map<string, Row>; projectById: Map<string, Row>; warehouseById: Map<string, Row> }) {
  return <div className={styles.twoPanels}><Panel title="Poniżej minimum" icon={<AlertTriangle size={16} />}>{lowStock.map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.name)}</strong><small>minimum {num(row.minimum_stock)} {text(row.unit, "")}</small></span><b>{num(balanceByItem.get(String(row.id)))} {text(row.unit, "")}</b></div>)}{!lowStock.length ? <Empty label="Wszystkie minima są zabezpieczone." /> : null}</Panel><Panel title="Rezerwacje inwestycji" icon={<Boxes size={16} />}>{reservations.map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(itemById.get(String(row.stock_item_id))?.name)}</strong><small>{text(projectById.get(String(row.project_id))?.name)} · {text(warehouseById.get(String(row.warehouse_id))?.name)}</small></span><b>{num(row.quantity)}</b></div>)}{!reservations.length ? <Empty label="Brak otwartych rezerwacji." /> : null}</Panel></div>;
}
function AssetsPanel({ rows, itemById, projectById }: { rows: Row[]; itemById: Map<string, Row>; projectById: Map<string, Row> }) { return <GenericTable title="Sprzęt i urządzenia" subtitle="Egzemplarze seryjne, wydania i serwis." headers={["Sprzęt", "Nr seryjny", "Status", "Inwestycja", "Przypisanie"]} rows={rows.map((row) => [text(itemById.get(String(row.stock_item_id))?.name), text(row.serial_number), text(row.status), text(projectById.get(String(row.project_id))?.name), text(row.assigned_to_name ?? row.assigned_to_type)])} />; }
function CountsPanel({ rows, warehouseById }: { rows: Row[]; warehouseById: Map<string, Row> }) { return <GenericTable title="Inwentaryzacje" subtitle="Spisy, różnice i zatwierdzone korekty." headers={["Spis", "Magazyn", "Data", "Status", "Pozycje"]} rows={rows.map((row) => [text(row.name ?? row.count_number, "Inwentaryzacja"), text(warehouseById.get(String(row.warehouse_id))?.name), dateLabel(row.count_date ?? row.created_at), text(row.status), text(row.line_count, "—")])} />; }
function PricesPanel({ pricesByItem, items, counterpartyById }: { pricesByItem: Map<string, Row[]>; items: Row[]; counterpartyById: Map<string, Row> }) {
  const rows = items.flatMap((item) => (pricesByItem.get(String(item.id)) ?? []).slice(0, 8).map((price) => ({ item, price }))).sort((a, b) => String(b.price.observed_at).localeCompare(String(a.price.observed_at))).slice(0, 200);
  return <GenericTable title="Ceny i dostawcy" subtitle="Historia cen z dokumentów, obserwacji i zatwierdzonych decyzji AI." headers={["Pozycja", "Cena netto", "Jednostka", "Dostawca", "Data", "Źródło"]} rows={rows.map(({ item, price }) => [text(item.name), money(price.unit_price_net, text(price.currency, "PLN")), text(price.unit, item.unit as string), text(counterpartyById.get(String(price.counterparty_id))?.name), dateLabel(price.observed_at), text(price.source_type)])} />;
}
function LocationsPanel({ warehouses, balances, aliases, itemById }: { warehouses: Row[]; balances: Row[]; aliases: Row[]; itemById: Map<string, Row> }) {
  const quantityByWarehouse = new Map<string, number>(); balances.forEach((row) => { const id = String(row.warehouse_id ?? row.warehouseId); quantityByWarehouse.set(id, (quantityByWarehouse.get(id) ?? 0) + Number(row.quantity ?? 0)); });
  return <div className={styles.twoPanels}><Panel title="Lokalizacje" icon={<MapPin size={16} />}>{warehouses.map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.name)}</strong><small>{text(row.code)} · {text(row.warehouse_type)}</small></span><b>{num(quantityByWarehouse.get(String(row.id)))} j.m.</b></div>)}{!warehouses.length ? <Empty /> : null}</Panel><Panel title="Wyuczone aliasy dostawców" icon={<Sparkles size={16} />}>{aliases.slice(0, 40).map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.supplier_name, "Dostawca")}: {text(row.supplier_sku, row.normalized_key as string)}</strong><small>→ {text(itemById.get(String(row.stock_item_id))?.name)}</small></span><b>{Math.round(Number(row.confidence ?? 0) * 100)}%</b></div>)}{!aliases.length ? <Empty label="Aliasów przybędzie po pierwszych decyzjach w Poczekalni." /> : null}</Panel></div>;
}

function ItemDrawer({ item, itemId, balances, reservations, aliases, prices, warehouses, counterparties, canWrite, pending, onClose, onRename }: { item?: Row; itemId: string; balances: Row[]; reservations: Row[]; aliases: Row[]; prices: Row[]; warehouses: Map<string, Row>; counterparties: Map<string, Row>; canWrite: boolean; pending: boolean; onClose: () => void; onRename: (name: string) => void }) {
  const [name, setName] = useState(text(item?.name, ""));
  if (!item) return null;
  const itemBalances = balances.filter((row) => String(row.stock_item_id ?? row.stockItemId) === itemId);
  const itemReservations = reservations.filter((row) => String(row.stock_item_id ?? row.stockItemId) === itemId && ["open", "pending", "reserved"].includes(String(row.status)));
  const itemAliases = aliases.filter((row) => String(row.stock_item_id) === itemId);
  const values = prices.map((row) => Number(row.unit_price_net)).filter((value) => Number.isFinite(value) && value > 0);
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  return <div className={styles.drawerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><aside className={styles.drawer}><header><span><small>KARTOTEKA MAGAZYNU</small><h2>{text(item.name)}</h2></span><button type="button" onClick={onClose}><X size={18} /></button></header>
    <section className={styles.rename}><label>Nazwa kanoniczna<input value={name} onChange={(event) => setName(event.target.value)} /></label>{canWrite ? <button type="button" disabled={pending || !name.trim() || name.trim() === String(item.name)} onClick={() => onRename(name.trim())}><Pencil size={14} /> Zapisz nazwę</button> : null}</section>
    <div className={styles.drawerStats}><div><small>Ostatnia cena</small><strong>{prices[0] ? money(prices[0].unit_price_net, text(prices[0].currency, "PLN")) : "—"}</strong></div><div><small>Średnia</small><strong>{values.length ? money(avg, text(prices[0]?.currency, "PLN")) : "—"}</strong></div><div><small>Minimum</small><strong>{values.length ? money(Math.min(...values), text(prices[0]?.currency, "PLN")) : "—"}</strong></div><div><small>Maksimum</small><strong>{values.length ? money(Math.max(...values), text(prices[0]?.currency, "PLN")) : "—"}</strong></div></div>
    <Panel title="Stany wg lokalizacji" icon={<MapPin size={15} />}>{itemBalances.map((row) => <div className={styles.simpleRow} key={`${row.warehouse_id}-${row.stock_item_id}`}><span><strong>{text(warehouses.get(String(row.warehouse_id ?? row.warehouseId))?.name)}</strong></span><b>{num(row.quantity)} {text(item.unit, "")}</b></div>)}{!itemBalances.length ? <Empty /> : null}</Panel>
    <Panel title="Ostatnie zakupy i ceny" icon={<History size={15} />}>{prices.slice(0, 12).map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{money(row.unit_price_net, text(row.currency, "PLN"))} / {text(row.unit, item.unit as string)}</strong><small>{text(counterparties.get(String(row.counterparty_id))?.name)} · {dateLabel(row.observed_at)}</small></span></div>)}{!prices.length ? <Empty label="Historia cen pojawi się po rozpoznanych zakupach." /> : null}</Panel>
    <Panel title="Wyuczone nazwy dostawców" icon={<Sparkles size={15} />}>{itemAliases.map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{text(row.supplier_name, "Dostawca")}</strong><small>{text(row.supplier_sku, row.normalized_key as string)}</small></span></div>)}{!itemAliases.length ? <Empty label="Brak wyuczonych aliasów." /> : null}</Panel>
    {itemReservations.length ? <Panel title="Rezerwacje" icon={<Boxes size={15} />}>{itemReservations.map((row) => <div className={styles.simpleRow} key={String(row.id)}><span><strong>{num(row.quantity)} {text(item.unit, "")}</strong><small>{dateLabel(row.required_at)}</small></span></div>)}</Panel> : null}
  </aside></div>;
}

function Panel({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) { return <section className={styles.panel}><header>{icon}<strong>{title}</strong></header><div>{children}</div></section>; }
function ActionRow({ label, value, onClick }: { label: string; value: number; onClick: () => void }) { return <button type="button" className={styles.actionRow} onClick={onClick}><span>{label}</span><b>{value}</b></button>; }
function Empty({ label = "Brak danych." }: { label?: string }) { return <div className={styles.empty}>{label}</div>; }
function GenericTable({ title, subtitle, headers, rows }: { title: string; subtitle: string; headers: string[]; rows: ReactNode[][] }) { return <section className={styles.section}><header className={styles.sectionHeader}><div><small>REJESTR</small><h2>{title}</h2><p>{subtitle}</p></div><b>{rows.length}</b></header><div className={styles.tableWrap}><table className={styles.table}><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table>{!rows.length ? <Empty /> : null}</div></section>; }
