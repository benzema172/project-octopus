"use client";

import { WarehouseCommandCenter } from "@/components/company/warehouse-command-center";
import { CompanyModuleShell, type Data, type FormSpec, type Row } from "@/components/company/operations/module-shell";

function num(value: unknown) { const n = Number(value ?? 0); return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(Number.isFinite(n) ? n : 0); }
function money(value: unknown) { const n = Number(value ?? 0); return new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0); }
function str(value: unknown, fallback = "—") { return value == null || value === "" ? fallback : String(value); }
const typeLabel = (value: unknown) => ({ material: "Materiał", device: "Urządzenie", tool: "Narzędzie", equipment: "Sprzęt" }[String(value)] ?? str(value));

export default function WarehouseOperations({ workspaceId, data, canWrite, canApprove, pathname, query }: { workspaceId: string; data: Data; canWrite: boolean; canApprove: boolean; pathname: string; query: string }) {
  const items = (data.items ?? []) as Row[];
  const warehouses = (data.warehouses ?? []) as Row[];
  const movements = (data.movements ?? []) as Row[];
  const lines = (data.lines ?? []) as Row[];
  const reservations = (data.reservations ?? []) as Row[];
  const balances = (data.balances ?? []) as Row[];
  const projects = (data.projects ?? []) as Row[];
  const prices = (data.priceObservations ?? []) as Row[];
  const aliases = (data.aliases ?? []) as Row[];
  const instances = (data.stockInstances ?? []) as Row[];
  const aiImports = (data.aiImports ?? []) as Row[];
  const summary = (data.summary ?? {}) as Row;
  const balanceByItem = new Map<string, number>();
  const balanceByItemWarehouse = new Map<string, number>();
  balances.forEach((row) => {
    const itemId = String(row.stockItemId ?? row.stock_item_id);
    const warehouseId = String(row.warehouseId ?? row.warehouse_id);
    balanceByItem.set(itemId, (balanceByItem.get(itemId) ?? 0) + Number(row.quantity ?? 0));
    balanceByItemWarehouse.set(`${itemId}:${warehouseId}`, Number(row.quantity ?? 0));
  });
  const movementById = new Map(movements.map((row) => [String(row.id), row]));
  const projectById = new Map(projects.map((row) => [String(row.id), row]));
  const pendingMovements = movements.filter((row) => ["draft", "pending", "review"].includes(String(row.status))).map((row) => ({ ...row, name: `${str(row.movement_type)} · ${str(row.document_number, "bez numeru")} · ${str(row.movement_date)}` }));
  const belowMinimum = items.filter((row) => Number(row.minimum_stock ?? 0) > 0 && (balanceByItem.get(String(row.id)) ?? 0) < Number(row.minimum_stock ?? 0));
  const openReservations = reservations.filter((row) => ["open", "pending", "reserved"].includes(String(row.status)));
  const awaitingAi = aiImports.filter((row) => !row.importedId);
  const issuedInstances = instances.filter((row) => row.status === "assigned");
  const latestPrice = new Map<string, Row>();
  prices.forEach((row) => { const id = String(row.stock_item_id); const current = latestPrice.get(id); if (!current || String(row.observed_at) > String(current.observed_at)) latestPrice.set(id, row); });

  const itemOptions = items.map((row) => ({ ...row, name: `${str(row.sku, "—")} · ${str(row.name)}` }));
  const forms: FormSpec[] = [
    { title: "Dodaj magazyn", entity: "warehouse", success: "Magazyn został utworzony.", fields: [{ name: "name", label: "Nazwa", required: true }, { name: "location", label: "Lokalizacja" }, { name: "warehouseType", label: "Typ", type: "select", options: [["central", "Centralny"], ["project", "Budowa"], ["vehicle", "Mobilny / pojazd"]] }] },
    { title: "Dodaj pełną kartotekę", entity: "stock_item", success: "Kartoteka została dodana.", wide: true, fields: [
      { name: "name", label: "Nazwa systemowa", required: true }, { name: "sku", label: "SKU / indeks" },
      { name: "itemType", label: "Typ", type: "select", options: [["material", "Materiał"], ["device", "Urządzenie"], ["tool", "Narzędzie"], ["equipment", "Sprzęt"]] },
      { name: "unit", label: "Jednostka podstawowa", required: true }, { name: "category", label: "Kategoria" }, { name: "subcategory", label: "Podkategoria" },
      { name: "manufacturer", label: "Producent" }, { name: "model", label: "Model / wariant" }, { name: "barcode", label: "EAN / kod kreskowy" },
      { name: "minimumStock", label: "Stan minimalny", type: "number" }, { name: "optimalStock", label: "Stan optymalny", type: "number" },
      { name: "serialTracking", label: "Numery seryjne", type: "select", options: [["false", "Nie"], ["true", "Tak"]] }, { name: "warrantyMonths", label: "Gwarancja (miesiące)", type: "number" }
    ] },
    { title: "Aktualizuj kartotekę", entity: "stock_item_update", success: "Kartoteka została zaktualizowana.", wide: true, fields: [
      { name: "stockItemId", label: "Kartoteka", rows: itemOptions, required: true }, { name: "name", label: "Nowa nazwa" }, { name: "sku", label: "Nowe SKU" },
      { name: "itemType", label: "Typ", type: "select", options: [["material", "Materiał"], ["device", "Urządzenie"], ["tool", "Narzędzie"], ["equipment", "Sprzęt"]] },
      { name: "unit", label: "Jednostka" }, { name: "category", label: "Kategoria" }, { name: "subcategory", label: "Podkategoria" }, { name: "manufacturer", label: "Producent" }, { name: "model", label: "Model" },
      { name: "barcode", label: "EAN / kod kreskowy" }, { name: "minimumStock", label: "Stan minimalny", type: "number" }, { name: "optimalStock", label: "Stan optymalny", type: "number" },
      { name: "serialTracking", label: "Numery seryjne", type: "select", options: [["false", "Nie"], ["true", "Tak"]] }, { name: "warrantyMonths", label: "Gwarancja (miesiące)", type: "number" }
    ] },
    { title: "Szybki ruch jednej pozycji", entity: "stock_movement", success: "Ruch magazynowy został zatwierdzony i zapisany.", wide: true, fields: [
      { name: "movementType", label: "Typ", type: "select", required: true, options: [["PZ", "PZ – przyjęcie"], ["WZ", "WZ – wydanie"], ["RW", "RW – rozchód na inwestycję"], ["ZW", "ZW – zwrot"], ["MM", "MM – przesunięcie"]] },
      { name: "warehouseId", label: "Magazyn źródłowy", rows: warehouses, required: true }, { name: "targetWarehouseId", label: "Magazyn docelowy", rows: warehouses, placeholder: "Tylko dla MM" },
      { name: "stockItemId", label: "Kartoteka", rows: itemOptions, required: true }, { name: "projectId", label: "Inwestycja", rows: projects, placeholder: "Ruch firmowy" },
      { name: "quantity", label: "Ilość", type: "number", required: true }, { name: "unitCost", label: "Koszt jednostkowy", type: "number" }, { name: "documentNumber", label: "Numer dokumentu" }, { name: "movementDate", label: "Data ruchu", type: "date" }
    ] },
    { title: "Zarezerwuj materiał", entity: "reservation", success: "Materiał został zarezerwowany.", fields: [{ name: "projectId", label: "Inwestycja", rows: projects, required: true }, { name: "warehouseId", label: "Magazyn", rows: warehouses, required: true }, { name: "stockItemId", label: "Kartoteka", rows: itemOptions, required: true }, { name: "quantity", label: "Ilość", type: "number", required: true }, { name: "requiredAt", label: "Potrzebne na", type: "date", required: true }] },
    ...(canApprove && pendingMovements.length ? [{ title: "Zatwierdź ruch magazynowy", entity: "stock_movement_approve", success: "Ruch został zatwierdzony i przeliczono stan magazynu.", fields: [{ name: "movementId", label: "Ruch do zatwierdzenia", rows: pendingMovements, required: true }] } satisfies FormSpec] : [])
  ];
  const metrics = [
    { label: "Wartość zapasu", value: money(summary.stockValue), caption: `${str(summary.fifoLayers, "0")} aktywnych warstw FIFO` },
    { label: "Poniżej minimum", value: String(belowMinimum.length), caption: `${str(summary.zeroStock, "0")} pozycji bez stanu` },
    { label: "Dostawy AI", value: String(awaitingAi.length), caption: "Dokumenty wymagające decyzji" },
    { label: "Ruchy do akceptacji", value: String(pendingMovements.length), caption: "Stan nie został jeszcze zmieniony" },
    { label: "Rezerwacje", value: String(openReservations.length), caption: "Potrzeby inwestycji" },
    { label: "Sprzęt wydany", value: String(issuedInstances.length), caption: "Pracownicy, inwestycje i pojazdy" },
    { label: "Magazyny", value: str(summary.warehouses, "0"), caption: "Aktywne lokalizacje" },
    { label: "Kartoteki", value: str(summary.records, "0"), caption: `${str(summary.activeItems, "0")} aktywnych` },
    { label: "Ruchy 30 dni", value: str(summary.movements30d, "0"), caption: "PZ / WZ / RW / ZW / MM" },
    { label: "Inwentaryzacje", value: str(summary.openCounts, "0"), caption: "Otwarte spisy" },
    { label: "Wolnorotujące", value: str(summary.slowMoving, "0"), caption: "Bez ruchu przez 90 dni" }
  ];

  return <CompanyModuleShell
    workspaceId={workspaceId}
    data={data}
    canWrite={canWrite}
    pathname={pathname}
    query={query}
    metrics={metrics}
    primaryMetricCount={6}
    forms={forms}
    rows={items}
    tableTitle="Kartoteki i rzeczywiste stany"
    emptyLabel="Brak kartotek dla bieżącego filtra. Dokumenty i ruchy nadal możesz przeszukiwać w centrum operacyjnym."
    beforeTable={<WarehouseCommandCenter workspaceId={workspaceId} data={data} canWrite={canWrite} canApprove={canApprove} query={query} />}
    detailTitle={(row) => str(row.name)}
    detailContent={(row) => {
      const itemId = String(row.id);
      const itemLines = lines.filter((line) => String(line.stock_item_id ?? line.stockItemId) === itemId);
      const itemMovements = itemLines.map((line) => ({ line, movement: movementById.get(String(line.movement_id)) })).filter((entry) => entry.movement).sort((a, b) => String(b.movement?.movement_date).localeCompare(String(a.movement?.movement_date))).slice(0, 10);
      const itemReservations = reservations.filter((entry) => String(entry.stock_item_id ?? entry.stockItemId) === itemId).slice(0, 8);
      const itemAliases = aliases.filter((entry) => String(entry.stock_item_id) === itemId).slice(0, 8);
      const itemInstances = instances.filter((entry) => String(entry.stock_item_id) === itemId);
      const price = latestPrice.get(itemId);
      const balance = balanceByItem.get(itemId) ?? 0;
      return <>
        <section><h3>Stan kartoteki i identyfikacja</h3><p><strong>{num(balance)} {str(row.unit, "")}</strong> na stanie · minimum {num(row.minimum_stock)} · optimum {num(row.optimal_stock)} {str(row.unit, "")}</p><p>SKU: <strong>{str(row.sku)}</strong> · EAN: <strong>{str(row.barcode)}</strong> · {typeLabel(row.item_type)}</p><p>{str(row.manufacturer, "Producent nieuzupełniony")} · {str(row.model, "model nieuzupełniony")} · {str(row.category, "bez kategorii")}</p></section>
        <section><h3>Lokalizacje</h3>{warehouses.map((warehouse) => { const value = balanceByItemWarehouse.get(`${itemId}:${String(warehouse.id)}`) ?? 0; return value !== 0 ? <p key={String(warehouse.id)}><strong>{str(warehouse.name)}</strong> · {num(value)} {str(row.unit, "")}</p> : null; })}<p>Zarejestrowane egzemplarze: <strong>{itemInstances.length}</strong></p></section>
        <section><h3>Cena i dostawcy</h3><p>Ostatnia cena: <strong>{price ? `${money(price.unit_price_net)} / ${str(price.unit, str(row.unit, "j.m."))}` : "brak historii"}</strong>{price ? ` · ${str(price.observed_at)}` : ""}</p>{itemAliases.map((alias) => <p key={String(alias.id)}><strong>{str(alias.supplier_name)}</strong> · {str(alias.supplier_sku, "bez indeksu dostawcy")}</p>)}</section>
        <section><h3>Ostatnie ruchy</h3>{itemMovements.map((entry) => <p key={String(entry.line.id)}><strong>{str(entry.movement?.movement_type)} · {str(entry.movement?.document_number, "bez numeru")}</strong><br />{str(entry.movement?.movement_date)} · {num(entry.line.quantity)} {str(row.unit, "")} · {str(entry.movement?.status)}</p>)}{!itemMovements.length ? <p>Brak ruchów dla tej kartoteki.</p> : null}</section>
        <section><h3>Rezerwacje</h3>{itemReservations.map((entry) => <p key={String(entry.id)}><strong>{num(entry.quantity)} {str(row.unit, "")}</strong> · {str(projectById.get(String(entry.project_id))?.name)} · potrzebne {str(entry.required_at, "bez terminu")} · {str(entry.status)}</p>)}{!itemReservations.length ? <p>Brak rezerwacji dla tej kartoteki.</p> : null}</section>
      </>;
    }}
    columns={[
      { label: "Kartoteka", value: (row) => <span><strong>{str(row.name)}</strong><br /><small>{str(row.manufacturer, "")} {str(row.model, "")}</small></span> },
      { label: "SKU / EAN", value: (row) => <span>{str(row.sku)}<br /><small>{str(row.barcode, "")}</small></span> },
      { label: "Typ", value: (row) => typeLabel(row.item_type) },
      { label: "Stan", value: (row) => <strong>{num(balanceByItem.get(String(row.id)) ?? 0)} {str(row.unit, "")}</strong> },
      { label: "Minimum / optimum", value: (row) => `${num(row.minimum_stock)} / ${num(row.optimal_stock)}` },
      { label: "Ostatnia cena", value: (row) => latestPrice.get(String(row.id)) ? money(latestPrice.get(String(row.id))?.unit_price_net) : "—" }
    ]}
  />;
}
