"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Save, Search, X } from "lucide-react";
import styles from "./warehouse-workspace-310.module.css";
import uxStyles from "./warehouse-ux-460.module.css";

type Row = Record<string, unknown>;

type Props = {
  workspaceId: string;
  canWrite: boolean;
  warehouses: Row[];
  items: Row[];
  prices: Row[];
  counterparties: Row[];
  purchaseOrders: Row[];
  initialTab: "dashboard" | "stock";
};

type EquipmentResult = {
  error?: string;
  createdCatalog?: boolean;
};

const tabFromLabel = (label: string) => {
  const value = label.replace(/\s+/g, " ").trim();
  if (value.startsWith("Pulpit")) return "dashboard";
  if (value.startsWith("Magazyn")) return "stock";
  if (value.startsWith("Poczekalnia")) return "waiting";
  if (value.startsWith("Ruchy")) return "movements";
  if (value.startsWith("Braki i rezerwacje")) return "needs";
  if (value.startsWith("Sprzęt")) return "assets";
  if (value.startsWith("Inwentaryzacje")) return "counts";
  if (value.startsWith("Ceny i dostawcy")) return "prices";
  if (value.startsWith("Lokalizacje")) return "locations";
  if (value.startsWith("Planowanie AI")) return "planning";
  return "other";
};

const legacySearchInput = () =>
  document.querySelector<HTMLInputElement>('section[data-warehouse-experience="3.1"] input[aria-label="Globalne wyszukiwanie Magazynu"]');

export function WarehouseUx440({ workspaceId, canWrite, warehouses, initialTab }: Props) {
  const router = useRouter();
  const activeTab = useRef<string>(initialTab);
  const equipmentHostRef = useRef<HTMLElement | null>(null);
  const equipmentLayoutRef = useRef<HTMLElement | null>(null);
  const stockSearchHostRef = useRef<HTMLElement | null>(null);
  const stockSearchHeaderRef = useRef<HTMLElement | null>(null);
  const [equipmentHost, setEquipmentHost] = useState<HTMLElement | null>(null);
  const [stockSearchHost, setStockSearchHost] = useState<HTMLElement | null>(null);
  const [stockSearch, setStockSearch] = useState("");
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateStockSearch = (nextValue: string, submit = false) => {
    setStockSearch(nextValue);
    const input = legacySearchInput();
    if (!input) return;

    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (valueSetter) valueSetter.call(input, nextValue);
    else input.value = nextValue;
    input.dispatchEvent(new Event("input", { bubbles: true }));

    if (submit) input.form?.requestSubmit();
  };

  const onStockSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      updateStockSearch("");
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      updateStockSearch(stockSearch, true);
    }
  };

  useEffect(() => {
    let section: HTMLElement | null = null;
    let nav: HTMLElement | null = null;
    let observer: MutationObserver | null = null;
    let attachFrame = 0;
    let syncFrame = 0;
    let disposed = false;

    const currentSection = () => {
      if (section?.isConnected) return section;
      section = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
      return section;
    };

    const restoreLegacyEquipment = () => {
      const legacyEquipment = document.querySelector<HTMLElement>('form[data-octopus-equipment-replaced="1"]');
      if (legacyEquipment) {
        legacyEquipment.style.display = "";
        delete legacyEquipment.dataset.octopusEquipmentReplaced;
      }
      if (equipmentLayoutRef.current) {
        delete equipmentLayoutRef.current.dataset.octopusEquipmentLayout;
        equipmentLayoutRef.current = null;
      }
    };

    const restoreLegacySearch = () => {
      const searchInput = legacySearchInput();
      const searchLabel = searchInput?.closest("label") as HTMLElement | null;
      const searchForm = searchInput?.closest("form") as HTMLElement | null;
      if (searchLabel) searchLabel.style.display = "";
      if (searchForm) {
        searchForm.style.gridTemplateColumns = "";
        searchForm.style.justifyContent = "";
      }
    };

    const teardownEquipmentHost = (updateState = true) => {
      restoreLegacyEquipment();
      equipmentHostRef.current?.remove();
      equipmentHostRef.current = null;
      if (updateState) setEquipmentHost(null);
    };

    const teardownStockSearchHost = (updateState = true) => {
      stockSearchHostRef.current?.remove();
      stockSearchHostRef.current = null;
      if (stockSearchHeaderRef.current) {
        delete stockSearchHeaderRef.current.dataset.octopusStockSearchLayout;
        stockSearchHeaderRef.current = null;
      }
      if (updateState) setStockSearchHost(null);
    };

    const applyVisibility = () => {
      const scope = currentSection();
      if (!scope) return;

      const searchInput = scope.querySelector<HTMLInputElement>('input[aria-label="Globalne wyszukiwanie Magazynu"]');
      const searchLabel = searchInput?.closest("label") as HTMLElement | null;
      const searchForm = searchInput?.closest("form") as HTMLElement | null;
      if (searchLabel && searchForm) {
        searchLabel.style.display = "none";
        searchForm.style.gridTemplateColumns = "auto";
        searchForm.style.justifyContent = "end";
      }

      const directDivs = Array.from(scope.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === "DIV");
      const kpis = directDivs.find((node) => node.textContent?.includes("Kartoteki") && node.textContent?.includes("Wartość FIFO"));
      if (kpis) kpis.style.display = activeTab.current === "dashboard" ? "" : "none";
    };

    const syncStockSearchHost = () => {
      const scope = currentSection();
      if (!scope) return;

      if (activeTab.current !== "stock") {
        teardownStockSearchHost();
        return;
      }

      if (stockSearchHostRef.current && !stockSearchHostRef.current.isConnected) {
        stockSearchHostRef.current = null;
        stockSearchHeaderRef.current = null;
        setStockSearchHost(null);
      }

      const headers = Array.from(scope.querySelectorAll<HTMLElement>("header"));
      const stockHeader = headers.find((header) => header.querySelector("h2")?.textContent?.trim() === "Kartoteki A–Z");
      if (!stockHeader) return;
      if (stockSearchHostRef.current?.parentElement === stockHeader) return;

      teardownStockSearchHost();
      const host = document.createElement("div");
      host.dataset.octopusStockSearchHost = "4.7";
      stockHeader.dataset.octopusStockSearchLayout = "4.7";
      const countBadge = Array.from(stockHeader.children).find((node) => node.tagName === "B") ?? null;
      stockHeader.insertBefore(host, countBadge);
      stockSearchHostRef.current = host;
      stockSearchHeaderRef.current = stockHeader;
      setStockSearch(legacySearchInput()?.value ?? "");
      setStockSearchHost(host);
    };

    const syncEquipmentHost = () => {
      const scope = currentSection();
      if (!scope) return;

      if (activeTab.current !== "assets") {
        teardownEquipmentHost();
        return;
      }

      if (equipmentHostRef.current && !equipmentHostRef.current.isConnected) {
        equipmentHostRef.current = null;
        setEquipmentHost(null);
      }

      const forms = Array.from(scope.querySelectorAll<HTMLFormElement>("form"));
      const legacyForm = forms.find((form) => form.querySelector("strong")?.textContent?.trim() === "Zarejestruj egzemplarz");
      if (!legacyForm || legacyForm.dataset.octopusEquipmentReplaced === "1") return;

      legacyForm.dataset.octopusEquipmentReplaced = "1";
      legacyForm.style.display = "none";
      const layout = legacyForm.parentElement as HTMLElement | null;
      if (layout) {
        layout.dataset.octopusEquipmentLayout = "4.6";
        equipmentLayoutRef.current = layout;
      }
      const host = document.createElement("div");
      host.dataset.octopusEquipmentQuickRegister = "1";
      host.style.display = "contents";
      legacyForm.before(host);
      equipmentHostRef.current = host;
      setEquipmentHost(host);
    };

    const sync = () => {
      if (disposed) return;
      const scope = currentSection();
      if (!scope) return;
      const nextNav = scope.querySelector<HTMLElement>('nav[aria-label="Sekcje Magazynu 3.1"]');
      if (nextNav && nextNav !== nav) {
        if (nav) nav.removeEventListener("click", onNavClick);
        nav = nextNav;
        nav.addEventListener("click", onNavClick);
      }
      applyVisibility();
      syncStockSearchHost();
      syncEquipmentHost();
    };

    const scheduleSync = () => {
      if (disposed || syncFrame) return;
      syncFrame = window.requestAnimationFrame(() => {
        syncFrame = 0;
        sync();
      });
    };

    const onNavClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!target) return;
      const nextTab = tabFromLabel(target.textContent ?? "");
      activeTab.current = nextTab;
      if (nextTab !== "stock") teardownStockSearchHost();
      if (nextTab !== "assets") teardownEquipmentHost();
      scheduleSync();
    };

    const attach = () => {
      if (disposed) return;
      const scope = currentSection();
      if (!scope) {
        attachFrame = window.requestAnimationFrame(attach);
        return;
      }

      const observedRoot = scope.parentElement ?? scope;
      observer = new MutationObserver(scheduleSync);
      observer.observe(observedRoot, { subtree: true, childList: true });
      sync();
    };

    attach();

    return () => {
      disposed = true;
      observer?.disconnect();
      if (attachFrame) window.cancelAnimationFrame(attachFrame);
      if (syncFrame) window.cancelAnimationFrame(syncFrame);
      if (nav) nav.removeEventListener("click", onNavClick);
      teardownStockSearchHost(false);
      teardownEquipmentHost(false);
      restoreLegacySearch();
    };
  }, [initialTab]);

  const submitEquipment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setMessage(null);
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/company/warehouse-equipment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspaceId,
            name: form.get("name"),
            itemType: form.get("itemType"),
            warehouseId: form.get("warehouseId"),
            serialNumber: form.get("serialNumber"),
            assetTag: form.get("assetTag"),
            purchaseDate: form.get("purchaseDate"),
            purchasePrice: form.get("purchasePrice"),
            warrantyUntil: form.get("warrantyUntil"),
            condition: form.get("condition")
          })
        });
        const result = await response.json().catch(() => ({})) as EquipmentResult;
        if (!response.ok) throw new Error(result.error ?? "Nie udało się zarejestrować sprzętu.");
        setMessage(result.createdCatalog ? "Sprzęt dodano i automatycznie utworzono jego kartotekę." : "Sprzęt dodano do istniejącej kartoteki.");
        formElement.reset();
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Nie udało się zarejestrować sprzętu.");
      }
    });
  };

  return <>
    {stockSearchHost && stockSearchHost.isConnected ? createPortal(
      <div className={uxStyles.stockSearch} data-warehouse-stock-search="4.7">
        <Search size={14} aria-hidden="true" />
        <input
          value={stockSearch}
          onChange={(event) => updateStockSearch(event.target.value)}
          onKeyDown={onStockSearchKeyDown}
          aria-label="Szukaj w kartotekach magazynu"
          placeholder="Szukaj po wszystkim…"
          autoComplete="off"
          spellCheck={false}
        />
        {stockSearch ? (
          <button type="button" onClick={() => updateStockSearch("")} aria-label="Wyczyść wyszukiwanie" title="Wyczyść">
            <X size={13} />
          </button>
        ) : null}
      </div>, stockSearchHost) : null}

    {canWrite && equipmentHost && equipmentHost.isConnected ? createPortal(
      <form className={`${styles.compactForm} ${uxStyles.quickRegister}`} onSubmit={submitEquipment} data-equipment-quick-register="4.6">
        <strong>Zarejestruj sprzęt</strong>
        <div>
          <label>Nazwa sprzętu<input name="name" required placeholder="np. Wiertarka Bosch GBH 2-28" /></label>
          <label>Typ<select name="itemType" defaultValue="equipment"><option value="equipment">Sprzęt</option><option value="device">Urządzenie</option><option value="tool">Narzędzie</option></select></label>
          <label>Magazyn<select name="warehouseId" defaultValue=""><option value="">—</option>{warehouses.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row.name ?? "Magazyn")}</option>)}</select></label>
          <label>Numer seryjny<input name="serialNumber" required /></label>
          <label>Tag/QR<input name="assetTag" /></label>
          <label>Data zakupu<input name="purchaseDate" type="date" /></label>
          <label>Cena zakupu<input name="purchasePrice" inputMode="decimal" /></label>
          <label>Gwarancja do<input name="warrantyUntil" type="date" /></label>
          <label>Stan<input name="condition" placeholder="np. dobry" /></label>
        </div>
        {message ? <small style={{ color: "#17643f", fontWeight: 750 }}>{message}</small> : null}
        {error ? <small style={{ color: "#a52a36", fontWeight: 750 }}>{error}</small> : null}
        <button type="submit" disabled={pending}><Save size={12} /> {pending ? "Dodawanie…" : "Dodaj"}</button>
      </form>, equipmentHost) : null}
  </>;
}
