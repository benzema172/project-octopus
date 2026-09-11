"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CarFront, Eye, PackageCheck, Plus, Search, X } from "lucide-react";
import type { Data, Row } from "@/components/company/operations/module-shell";
import styles from "./fleet-equipment-registry.module.css";

type Props = { workspaceId: string; data: Data; canWrite: boolean };
type Filter = "all" | "equipment" | "tires" | "empty";
type AddMode = "component" | "asset" | null;

const raw = (value: unknown) => value === undefined || value === null ? "" : String(value);
const text = (value: unknown, fallback = "—") => raw(value).trim() || fallback;
const normalize = (value: unknown) => raw(value).trim().toLocaleLowerCase("pl");
const dateLabel = (value: unknown) => {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("pl-PL").format(date);
};
const vehicleName = (row: Row) => `${raw(row.make)} ${raw(row.model)}`.trim() || text(row.vehicle_type, "Pojazd");
const vehicleLabel = (row: Row) => `${text(row.registration_number)} · ${vehicleName(row)}`;

export function FleetEquipmentRegistry({ workspaceId, data, canWrite }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const vehicles = ((data.allVehicles ?? data.vehicles) ?? []) as Row[];
  const components = ((data.components ?? []) as Row[]).filter((row) => row.active !== false);
  const vehicleStock = (data.vehicleStock ?? []) as Row[];
  const stockItems = (data.vehicleStockItems ?? []) as Row[];
  const availableAssets = (data.availableVehicleAssets ?? []) as Row[];

  const stockItemById = useMemo(() => new Map(stockItems.map((row) => [String(row.id), row])), [stockItems]);
  const componentsByVehicle = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of components) {
      const id = String(row.vehicle_id ?? "");
      map.set(id, [...(map.get(id) ?? []), row]);
    }
    return map;
  }, [components]);
  const assetsByVehicle = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of vehicleStock) {
      const id = String(row.vehicle_id ?? "");
      map.set(id, [...(map.get(id) ?? []), row]);
    }
    return map;
  }, [vehicleStock]);

  const filteredVehicles = useMemo(() => vehicles.filter((vehicle) => {
    const id = String(vehicle.id);
    const haystack = normalize(`${raw(vehicle.registration_number)} ${raw(vehicle.vin)} ${raw(vehicle.make)} ${raw(vehicle.model)} ${raw(vehicle.vehicle_type)}`);
    if (query.trim() && !haystack.includes(normalize(query))) return false;
    const vehicleComponents = componentsByVehicle.get(id) ?? [];
    const assets = assetsByVehicle.get(id) ?? [];
    const tires = vehicleComponents.filter((row) => String(row.component_type) === "tires");
    if (filter === "equipment") return assets.length > 0;
    if (filter === "tires") return tires.length > 0;
    if (filter === "empty") return assets.length === 0 && vehicleComponents.length === 0;
    return true;
  }), [vehicles, query, filter, componentsByVehicle, assetsByVehicle]);

  const selectedVehicle = selectedVehicleId ? vehicles.find((row) => String(row.id) === selectedVehicleId) ?? null : null;
  const selectedComponents = selectedVehicle ? componentsByVehicle.get(String(selectedVehicle.id)) ?? [] : [];
  const selectedAssets = selectedVehicle ? assetsByVehicle.get(String(selectedVehicle.id)) ?? [] : [];
  const selectedTires = selectedComponents.filter((row) => String(row.component_type) === "tires");

  const run = (action: string, payload: Record<string, unknown>, success: string, after?: () => void) => {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/fleet-core", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, action, payload })
        });
        const result = await response.json().catch(() => ({})) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Operacja Floty nie powiodła się.");
        setMessage(success);
        after?.();
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Operacja Floty nie powiodła się.");
      }
    });
  };

  const submit = (action: string, success: string, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    run(action, payload, success, () => setAddMode(null));
  };

  return <section className={styles.registry} data-fleet-equipment-registry="true">
    <div className={styles.header}>
      <div>
        <small>WYPOSAŻENIE I OPONY</small>
        <h2>Rejestr wyposażenia floty</h2>
        <p>Jedna tabela pojazdów, a szczegóły wyposażenia, opon i komponentów dopiero po otwarciu wybranego auta.</p>
      </div>
      {canWrite ? <div className={styles.actions}>
        <button className={styles.primaryAction} type="button" onClick={() => setAddMode(addMode === "component" ? null : "component")}><Plus size={16} /> Dodaj wyposażenie / opony</button>
        <button className={styles.secondaryAction} type="button" disabled={!availableAssets.length} onClick={() => setAddMode(addMode === "asset" ? null : "asset")}><PackageCheck size={16} /> Przypisz z magazynu</button>
      </div> : null}
    </div>

    {addMode ? <div className={styles.formPanel}>
      <div className={styles.formTitle}><strong>{addMode === "component" ? "Dodaj wyposażenie / opony" : "Przypisz sprzęt z magazynu"}</strong><button type="button" onClick={() => setAddMode(null)} aria-label="Zamknij"><X size={16} /></button></div>
      {addMode === "component" ? <form className={styles.form} onSubmit={(event) => submit("component_create", "Wyposażenie zostało dodane do pojazdu.", event)}>
        <label><span>Pojazd</span><select name="vehicleId" required defaultValue={selectedVehicleId ?? ""}><option value="">Wybierz pojazd</option>{vehicles.map((row) => <option key={String(row.id)} value={String(row.id)}>{vehicleLabel(row)}</option>)}</select></label>
        <label><span>Typ</span><select name="componentType" required defaultValue="tires"><option value="tires">Opony</option><option value="battery">Akumulator</option><option value="attachment">Wyposażenie / osprzęt</option><option value="other">Inny</option></select></label>
        <label><span>Nazwa</span><input name="name" required placeholder="np. Komplet zimowy" /></label>
        <label><span>Producent</span><input name="manufacturer" /></label>
        <label><span>Model</span><input name="model" /></label>
        <label><span>Numer seryjny</span><input name="serialNumber" /></label>
        <label><span>DOT</span><input name="dotCode" /></label>
        <label><span>Data montażu</span><input name="installedAt" type="date" /></label>
        <label><span>Bieżnik mm</span><input name="treadDepthMm" type="number" step="any" /></label>
        <label><span>Stan</span><input name="condition" placeholder="np. dobry" /></label>
        <label><span>Miejsce przechowywania</span><input name="storageLocation" /></label>
        <label className={styles.full}><span>Uwagi</span><textarea name="notes" rows={2} /></label>
        <div className={styles.formActions}><button className={styles.saveButton} type="submit" disabled={pending}>{pending ? "Zapisywanie…" : "Zapisz"}</button></div>
      </form> : <form className={styles.form} onSubmit={(event) => submit("asset_assign", "Sprzęt został przypisany do pojazdu.", event)}>
        <label className={styles.full}><span>Sprzęt z magazynu</span><select name="instanceId" required defaultValue=""><option value="">Wybierz sprzęt</option>{availableAssets.map((row) => <option key={String(row.id)} value={String(row.id)}>{text(stockItemById.get(String(row.stock_item_id))?.name, "Sprzęt")} · {text(row.asset_tag ?? row.serial_number, "bez oznaczenia")}</option>)}</select></label>
        <label className={styles.full}><span>Pojazd</span><select name="vehicleId" required defaultValue={selectedVehicleId ?? ""}><option value="">Wybierz pojazd</option>{vehicles.map((row) => <option key={String(row.id)} value={String(row.id)}>{vehicleLabel(row)}</option>)}</select></label>
        <div className={styles.formActions}><button className={styles.saveButton} type="submit" disabled={pending}>{pending ? "Zapisywanie…" : "Przypisz"}</button></div>
      </form>}
    </div> : null}

    {message ? <div className={styles.success}>{message}</div> : null}
    {error ? <div className={styles.error}>{error}</div> : null}

    <div className={styles.filters}>
      <label className={styles.search}><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj po rejestracji, VIN, marce lub modelu…" /></label>
      <select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}>
        <option value="all">Wszystkie pojazdy</option>
        <option value="equipment">Z wyposażeniem</option>
        <option value="tires">Z oponami</option>
        <option value="empty">Bez wyposażenia i komponentów</option>
      </select>
      <span className={styles.count}>{filteredVehicles.length} pojazdów</span>
    </div>

    <div className={styles.tableWrap}>
      <div className={styles.table}>
        <div className={styles.tableHead}><span>Rejestracja</span><span>Pojazd</span><span>Wyposażenie</span><span>Opony / komponenty</span><span>Stan</span><span>Akcja</span></div>
        {filteredVehicles.map((vehicle) => {
          const id = String(vehicle.id);
          const vehicleComponents = componentsByVehicle.get(id) ?? [];
          const assets = assetsByVehicle.get(id) ?? [];
          const tires = vehicleComponents.filter((row) => String(row.component_type) === "tires");
          const otherComponents = vehicleComponents.length - tires.length;
          return <div className={`${styles.tableRow} ${selectedVehicleId === id ? styles.selectedRow : ""}`} key={id}>
            <span><strong>{text(vehicle.registration_number)}</strong><small>{text(vehicle.vin, "bez VIN")}</small></span>
            <span>{vehicleName(vehicle)}</span>
            <span><b>{assets.length}</b> elementów</span>
            <span><b>{tires.length}</b> opon/kompletów{otherComponents ? ` · ${otherComponents} innych` : ""}</span>
            <span><span className={String(vehicle.status) === "active" ? styles.statusGood : styles.statusNeutral}>{String(vehicle.status) === "active" ? "Aktywny" : text(vehicle.status)}</span></span>
            <span><button className={styles.viewButton} type="button" onClick={() => setSelectedVehicleId(selectedVehicleId === id ? null : id)}><Eye size={14} /> {selectedVehicleId === id ? "Zwiń" : "Podgląd"}</button></span>
          </div>;
        })}
        {!filteredVehicles.length ? <div className={styles.empty}>Brak pojazdów dla bieżącego filtra.</div> : null}
      </div>
    </div>

    {selectedVehicle ? <div className={styles.detail}>
      <div className={styles.detailHeader}>
        <div><small>PODGLĄD POJAZDU</small><h3><CarFront size={18} /> {vehicleLabel(selectedVehicle)}</h3></div>
        <button type="button" onClick={() => setSelectedVehicleId(null)} aria-label="Zamknij"><X size={16} /></button>
      </div>
      <div className={styles.summaryGrid}>
        <div><small>Wyposażenie</small><strong>{selectedAssets.length}</strong></div>
        <div><small>Opony / komponenty</small><strong>{selectedComponents.length}</strong></div>
        <div><small>Komplety opon</small><strong>{selectedTires.length}</strong></div>
        <div><small>Status</small><strong>{String(selectedVehicle.status) === "active" ? "Aktywny" : text(selectedVehicle.status)}</strong></div>
      </div>
      <div className={styles.detailGrid}>
        <section>
          <h4>Wyposażenie z Magazynu</h4>
          <div className={styles.itemList}>{selectedAssets.map((row) => <div className={styles.item} key={String(row.id)}><div><strong>{text(stockItemById.get(String(row.stock_item_id))?.name, "Sprzęt")}</strong><small>{text(row.asset_tag ?? row.serial_number, "bez oznaczenia")}</small></div>{canWrite ? <button type="button" onClick={() => run("asset_unassign", { instanceId: row.id }, "Sprzęt został odpięty od pojazdu.")}>Odepnij</button> : null}</div>)}{!selectedAssets.length ? <p className={styles.muted}>Brak wyposażenia przypisanego z Magazynu.</p> : null}</div>
        </section>
        <section>
          <h4>Opony i komponenty</h4>
          <div className={styles.itemList}>{selectedComponents.map((row) => <div className={styles.itemStack} key={String(row.id)}><div className={styles.item}><div><strong>{text(row.name)}</strong><small>{text(row.component_type)} · {`${raw(row.manufacturer)} ${raw(row.model)}`.trim() || "bez producenta/modelu"}</small></div><span className={styles.componentMeta}>{row.dot_code ? `DOT ${text(row.dot_code)}` : text(row.condition, "—")}</span></div><div className={styles.componentDetails}><span>Montaż: {dateLabel(row.installed_at)}</span><span>Bieżnik: {row.tread_depth_mm ? `${text(row.tread_depth_mm)} mm` : "—"}</span><span>Magazyn: {text(row.storage_location)}</span></div>{canWrite ? <details className={styles.removeDetails}><summary>Zdemontuj / odłóż</summary><form onSubmit={(event) => { event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget).entries()); run("component_remove", { ...payload, componentId: row.id }, "Komponent został zdjęty i zapisany w historii."); }}><label><span>Data</span><input name="removedAt" type="date" /></label><label><span>Stan po demontażu</span><input name="condition" defaultValue={raw(row.condition)} /></label><label><span>Miejsce przechowywania</span><input name="storageLocation" defaultValue={raw(row.storage_location)} /></label><button type="submit" disabled={pending}>Zapisz demontaż</button></form></details> : null}</div>)}{!selectedComponents.length ? <p className={styles.muted}>Brak opon i komponentów w paszporcie pojazdu.</p> : null}</div>
        </section>
      </div>
    </div> : null}
  </section>;
}
