"use client";

import { createPortal } from "react-dom";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import styles from "./warehouse-workspace-310.module.css";

type Row = Record<string, unknown>;

type Props = {
  workspaceId: string;
  canWrite: boolean;
  warehouses: Row[];
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
  if (value.startsWith("Sprzęt")) return "assets";
  if (value.startsWith("Ceny i dostawcy")) return "prices";
  if (value.startsWith("Lokalizacje")) return "locations";
  if (value.startsWith("Planowanie AI")) return "planning";
  return "other";
};

export function WarehouseUx440({ workspaceId, canWrite, warehouses, initialTab }: Props) {
  const router = useRouter();
  const activeTab = useRef<string>(initialTab);
  const [equipmentHost, setEquipmentHost] = useState<HTMLElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let nav: HTMLElement | null = null;
    let observer: MutationObserver | null = null;

    const applyVisibility = () => {
      const section = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
      if (!section) return;

      const searchInput = section.querySelector<HTMLInputElement>('input[aria-label="Globalne wyszukiwanie Magazynu"]');
      const searchLabel = searchInput?.closest("label") as HTMLElement | null;
      const searchForm = searchInput?.closest("form") as HTMLElement | null;
      if (searchLabel && searchForm) {
        const showSearch = activeTab.current === "stock";
        searchLabel.style.display = showSearch ? "" : "none";
        searchForm.style.gridTemplateColumns = showSearch ? "minmax(0,1fr) auto" : "auto";
        searchForm.style.justifyContent = showSearch ? "" : "end";
      }

      const directDivs = Array.from(section.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node.tagName === "DIV");
      const kpis = directDivs.find((node) => node.textContent?.includes("Kartoteki") && node.textContent?.includes("Wartość FIFO"));
      if (kpis) kpis.style.display = activeTab.current === "dashboard" ? "" : "none";
    };

    const syncEquipmentHost = () => {
      const section = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
      if (!section) return;

      if (equipmentHost && !equipmentHost.isConnected) setEquipmentHost(null);
      const forms = Array.from(section.querySelectorAll<HTMLFormElement>("form"));
      const legacyForm = forms.find((form) => form.querySelector("strong")?.textContent?.trim() === "Zarejestruj egzemplarz");
      if (!legacyForm || legacyForm.dataset.octopusEquipmentReplaced === "1") return;

      legacyForm.dataset.octopusEquipmentReplaced = "1";
      legacyForm.style.display = "none";
      const host = document.createElement("div");
      host.dataset.octopusEquipmentQuickRegister = "1";
      host.style.display = "contents";
      legacyForm.before(host);
      setEquipmentHost(host);
    };

    const sync = () => {
      const section = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
      if (!section) return;
      const nextNav = section.querySelector<HTMLElement>('nav[aria-label="Sekcje Magazynu 3.1"]');
      if (nextNav && nextNav !== nav) {
        if (nav) nav.removeEventListener("click", onNavClick);
        nav = nextNav;
        nav.addEventListener("click", onNavClick);
      }
      applyVisibility();
      syncEquipmentHost();
    };

    const onNavClick = (event: Event) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!target) return;
      activeTab.current = tabFromLabel(target.textContent ?? "");
      window.requestAnimationFrame(() => {
        applyVisibility();
        syncEquipmentHost();
      });
    };

    observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, childList: true });
    sync();

    return () => {
      observer?.disconnect();
      if (nav) nav.removeEventListener("click", onNavClick);
      const legacy = document.querySelector<HTMLElement>('form[data-octopus-equipment-replaced="1"]');
      if (legacy) legacy.style.display = "";
      const host = document.querySelector<HTMLElement>('[data-octopus-equipment-quick-register="1"]');
      host?.remove();
    };
  }, [equipmentHost, initialTab]);

  const submitEquipment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
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
        event.currentTarget.reset();
        router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Nie udało się zarejestrować sprzętu.");
      }
    });
  };

  if (!canWrite || !equipmentHost || !equipmentHost.isConnected) return null;

  return createPortal(
    <form className={styles.compactForm} onSubmit={submitEquipment} data-equipment-quick-register="4.4">
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
    </form>,
    equipmentHost
  );
}
