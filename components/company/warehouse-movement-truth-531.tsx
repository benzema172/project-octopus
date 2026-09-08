"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Plus, Save, X } from "lucide-react";
import type { Data, Row } from "@/components/company/operations/module-shell";
import styles from "./warehouse-movement-truth-531.module.css";

type Props = { workspaceId: string; data: Data; canWrite: boolean; canApprove: boolean };
type Movement = Row & {
  id: string;
  movement_type?: string;
  document_number?: string | null;
  movement_date?: string | null;
  status?: string;
  destination_mode?: string;
  project_id?: string | null;
  counterparty_id?: string | null;
  warehouse_id?: string | null;
  target_warehouse_id?: string | null;
  line_count?: number;
  counterparty_name?: string | null;
  counterparty_role?: string | null;
  project_name?: string | null;
  warehouse_name?: string | null;
  target_warehouse_name?: string | null;
  source_label?: string | null;
  source_document_name?: string | null;
};
type FlowResponse = {
  movements?: Movement[];
  counterparties?: Row[];
  projects?: Row[];
  warehouses?: Row[];
  counterparty?: Row;
  error?: string;
};
type DraftLine = { stockItemId: string; quantity: string; unitCost: string };

const label = (value: unknown, fallback = "—") => value === null || value === undefined || value === "" ? fallback : String(value);
const today = () => new Date().toISOString().slice(0, 10);
const dateLabel = (value: unknown) => {
  const raw = String(value ?? "");
  if (!raw) return "—";
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat("pl-PL").format(date);
};
const statusLabel = (value: unknown) => ({ draft: "szkic", approved: "zatwierdzony", pending: "oczekuje", review: "weryfikacja" }[String(value)] ?? label(value));

function routeChoice(row: Movement) {
  const mode = String(row.destination_mode ?? "unassigned");
  if (mode === "central_stock") return "central_stock";
  if (mode === "direct_project" && row.project_id) return `project:${row.project_id}`;
  if (mode === "external_customer" && row.counterparty_id) return `customer:${row.counterparty_id}`;
  return "";
}

function routePayload(choice: string) {
  if (choice === "central_stock") return { destinationMode: "central_stock", projectId: null, counterpartyId: null };
  if (choice.startsWith("project:")) return { destinationMode: "direct_project", projectId: choice.slice(8), counterpartyId: null };
  if (choice.startsWith("customer:")) return { destinationMode: "external_customer", projectId: null, counterpartyId: choice.slice(9) };
  return { destinationMode: "unassigned", projectId: null, counterpartyId: null };
}

function routeText(row: Movement) {
  const type = String(row.movement_type ?? "").toUpperCase();
  const mode = String(row.destination_mode ?? "unassigned");
  if (type === "PZ" && mode === "central_stock") return `Zapas centralny · ${label(row.warehouse_name, "magazyn")}`;
  if (mode === "direct_project") return `Inwestycja · ${label(row.project_name)}`;
  if (mode === "external_customer") return `Klient · ${label(row.counterparty_name)}`;
  if (type === "MM") return `Magazyn · ${label(row.target_warehouse_name)}`;
  if (type === "ZW" && row.project_name) return `Zwrot z · ${label(row.project_name)}`;
  if (type === "RW" && row.project_name) return `Rozchód · ${label(row.project_name)}`;
  return "Nieprzypisane";
}

export function WarehouseMovementTruth531({ workspaceId, data, canWrite, canApprove }: Props) {
  const router = useRouter();
  const hostRef = useRef<HTMLElement | null>(null);
  const legacyRef = useRef<HTMLElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [counterparties, setCounterparties] = useState<Row[]>((data.counterparties ?? []) as Row[]);
  const [projects, setProjects] = useState<Row[]>((data.projects ?? []) as Row[]);
  const [warehouses, setWarehouses] = useState<Row[]>((data.warehouses ?? []) as Row[]);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [movementType, setMovementType] = useState("PZ");
  const [formRoute, setFormRoute] = useState("central_stock");
  const [lines, setLines] = useState<DraftLine[]>([{ stockItemId: "", quantity: "", unitCost: "" }]);
  const [customerForm, setCustomerForm] = useState(false);

  const items = ((data.catalogItems ?? data.items) ?? []) as Row[];
  const customerRows = useMemo(() => counterparties.filter((row) => String(row.role ?? "").toLowerCase() === "customer"), [counterparties]);
  const otherCounterparties = useMemo(() => counterparties.filter((row) => String(row.role ?? "").toLowerCase() !== "customer"), [counterparties]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/company/warehouse-movement-flow?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({})) as FlowResponse;
      if (!response.ok) throw new Error(result.error ?? "Nie udało się pobrać ruchów magazynowych.");
      setMovements(result.movements ?? []);
      if (result.counterparties) setCounterparties(result.counterparties);
      if (result.projects) setProjects(result.projects);
      if (result.warehouses) setWarehouses(result.warehouses);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać ruchów magazynowych.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const post = useCallback(async (action: string, payload: Record<string, unknown>, success: string) => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/company/warehouse-movement-flow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action, payload })
      });
      const result = await response.json().catch(() => ({})) as FlowResponse;
      if (!response.ok) throw new Error(result.error ?? "Operacja ruchu magazynowego nie powiodła się.");
      if (result.counterparty) {
        setCounterparties((current) => current.some((row) => String(row.id) === String(result.counterparty?.id)) ? current : [...current, result.counterparty as Row].sort((a, b) => label(a.name, "").localeCompare(label(b.name, ""), "pl")));
      }
      setMessage(success);
      await load();
      router.refresh();
      return result;
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : "Operacja ruchu magazynowego nie powiodła się.");
      return null;
    } finally {
      setPending(false);
    }
  }, [load, router, workspaceId]);

  useEffect(() => {
    let observer: MutationObserver | null = null;
    let attachFrame = 0;
    let syncFrame = 0;
    let disposed = false;

    const teardown = (updateState = true) => {
      if (legacyRef.current?.isConnected) {
        legacyRef.current.style.display = "";
        delete legacyRef.current.dataset.octopusMovementLegacy;
      }
      legacyRef.current = null;
      hostRef.current?.remove();
      hostRef.current = null;
      if (updateState) setHost(null);
    };

    const sync = () => {
      if (disposed) return;
      const scope = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
      if (!scope) return;
      const legacy = Array.from(scope.querySelectorAll<HTMLElement>("section")).find((section) => {
        if (section.dataset.warehouseMovementTruth === "5.3.1") return false;
        const header = Array.from(section.children).find((node) => node.tagName === "HEADER") as HTMLElement | undefined;
        return header?.querySelector("h2")?.textContent?.trim() === "Ruchy magazynowe";
      });

      if (!legacy) {
        if (hostRef.current || legacyRef.current) teardown();
        return;
      }
      if (hostRef.current?.isConnected && hostRef.current.previousElementSibling === legacy) return;

      teardown();
      legacy.dataset.octopusMovementLegacy = "5.3.1";
      legacy.style.display = "none";
      const nextHost = document.createElement("div");
      nextHost.dataset.octopusMovementTruthHost = "5.3.1";
      legacy.after(nextHost);
      legacyRef.current = legacy;
      hostRef.current = nextHost;
      setHost(nextHost);
      void load();
    };

    const schedule = () => {
      if (disposed || syncFrame) return;
      syncFrame = window.requestAnimationFrame(() => { syncFrame = 0; sync(); });
    };

    const attach = () => {
      if (disposed) return;
      const scope = document.querySelector<HTMLElement>('section[data-warehouse-experience="3.1"]');
      if (!scope) {
        attachFrame = window.requestAnimationFrame(attach);
        return;
      }
      observer = new MutationObserver(schedule);
      observer.observe(scope, { childList: true, subtree: true });
      sync();
    };

    attach();
    return () => {
      disposed = true;
      observer?.disconnect();
      if (attachFrame) window.cancelAnimationFrame(attachFrame);
      if (syncFrame) window.cancelAnimationFrame(syncFrame);
      teardown(false);
    };
  }, [load]);

  const changeRoute = async (row: Movement, choice: string) => {
    const route = routePayload(choice);
    await post("route", { movementId: row.id, ...route }, "Przeznaczenie ruchu zapisano.");
  };

  const approve = async (row: Movement) => {
    const type = String(row.movement_type ?? "").toUpperCase();
    const effect = type === "PZ" ? `Przyjąć ${row.line_count ?? 0} pozycji do wskazanego przeznaczenia?` : type === "WZ" ? `Wydać ${row.line_count ?? 0} pozycji do wskazanego odbiorcy?` : "Zatwierdzić ruch i zmienić rzeczywisty stan magazynu?";
    if (!window.confirm(effect)) return;
    await post("approve", { movementId: row.id }, type === "PZ" ? "PZ zatwierdzono — stan magazynowy został przyjęty." : type === "WZ" ? "WZ zatwierdzono — towar został wydany wskazanemu odbiorcy." : "Ruch zatwierdzono i stan magazynowy został zaktualizowany.");
  };

  const submitMovement = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    let projectId = form.get("projectId");
    let counterpartyId = form.get("counterpartyId");
    let destinationMode: string | null = null;
    if (movementType === "PZ" || movementType === "WZ") {
      if (!formRoute) {
        setError(movementType === "WZ" ? "Wybierz inwestycję albo klienta zewnętrznego." : "Wybierz przeznaczenie PZ.");
        return;
      }
      const route = routePayload(formRoute);
      destinationMode = route.destinationMode;
      projectId = route.projectId;
      if (movementType === "WZ") counterpartyId = route.counterpartyId;
    }
    const result = await post("create", {
      movementType,
      warehouseId: form.get("warehouseId"),
      targetWarehouseId: form.get("targetWarehouseId"),
      destinationMode,
      projectId,
      counterpartyId,
      documentNumber: form.get("documentNumber"),
      movementDate: form.get("movementDate"),
      lines
    }, "Utworzono bezpieczny szkic ruchu — stan nie zmieni się przed zatwierdzeniem.");
    if (result) {
      setFormOpen(false);
      setLines([{ stockItemId: "", quantity: "", unitCost: "" }]);
    }
  };

  const createCustomer = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await post("customer_create", { name: form.get("name"), taxId: form.get("taxId") }, "Klient został dodany do kartoteki kontrahentów.");
    const id = result?.counterparty?.id ? String(result.counterparty.id) : "";
    if (id) {
      setFormRoute(`customer:${id}`);
      setCustomerForm(false);
    }
  };

  if (!host || !host.isConnected) return null;

  const aiDrafts = movements.filter((row) => String(row.status) === "draft" && String(row.source_label ?? "").includes("AI")).length;

  return createPortal(
    <section className={styles.section} data-warehouse-movement-truth="5.3.1">
      <header className={styles.header}>
        <div><small>OPERACJE · ŹRÓDŁO I PRZEZNACZENIE</small><h2>Ruchy magazynowe</h2><p>PZ przyjmuje zapas, WZ go wydaje. Zanim stan fizyczny się zmieni, zawsze widać dokument źródłowy, kontrahenta i miejsce docelowe.</p></div>
        {canWrite ? <button type="button" className={styles.primary} onClick={() => setFormOpen((value) => !value)}>{formOpen ? <X size={14} /> : <Plus size={14} />}{formOpen ? "Zamknij" : "Nowy ruch"}</button> : null}
      </header>

      {aiDrafts > 0 ? <div className={styles.info}><AlertTriangle size={16} /><div><strong>{aiDrafts} {aiDrafts === 1 ? "szkic powstał" : "szkiców powstało"} automatycznie z dokumentów we Wrzutni.</strong><span>To nie są sztuczne ruchy. AI odczytało faktury/WZ i przygotowało propozycje. Dopóki nie zatwierdzisz ruchu, rzeczywisty stan magazynu się nie zmienia.</span></div></div> : null}
      {message ? <div className={styles.success}><Check size={15} />{message}</div> : null}
      {error ? <div className={styles.error}><AlertTriangle size={15} />{error}</div> : null}

      {formOpen ? <form className={styles.form} onSubmit={submitMovement}>
        <div className={styles.formTitle}><strong>Nowy szkic ruchu</strong><span>Zapis tworzy szkic. Dopiero osobne zatwierdzenie zmienia stan.</span></div>
        <div className={styles.grid}>
          <label>Typ<select value={movementType} onChange={(event) => { const next = event.target.value; setMovementType(next); setFormRoute(next === "PZ" ? "central_stock" : ""); }}><option>PZ</option><option>WZ</option><option>RW</option><option>ZW</option><option>MM</option></select></label>
          <label>Magazyn<select name="warehouseId" required><option value="">Wybierz</option>{warehouses.map((row) => <option key={String(row.id)} value={String(row.id)}>{label(row.name)}</option>)}</select></label>
          {movementType === "MM" ? <label>Magazyn docelowy<select name="targetWarehouseId" required><option value="">Wybierz</option>{warehouses.map((row) => <option key={String(row.id)} value={String(row.id)}>{label(row.name)}</option>)}</select></label> : null}
          {movementType === "PZ" || movementType === "WZ" ? <label>{movementType === "PZ" ? "Przeznaczenie" : "Odbiorca"}<select value={formRoute} onChange={(event) => setFormRoute(event.target.value)} required><option value="">Wybierz</option>{movementType === "PZ" ? <option value="central_stock">Zapas centralny</option> : null}<optgroup label="Inwestycje">{projects.map((row) => <option key={String(row.id)} value={`project:${String(row.id)}`}>{label(row.name)}</option>)}</optgroup>{movementType === "WZ" ? <><optgroup label="Klienci zewnętrzni">{customerRows.map((row) => <option key={String(row.id)} value={`customer:${String(row.id)}`}>{label(row.name)}</option>)}</optgroup>{otherCounterparties.length ? <optgroup label="Pozostali kontrahenci">{otherCounterparties.map((row) => <option key={String(row.id)} value={`customer:${String(row.id)}`}>{label(row.name)}</option>)}</optgroup> : null}</> : null}</select></label> : <label>Inwestycja (opcjonalnie)<select name="projectId"><option value="">Ruch ogólnofirmowy</option>{projects.map((row) => <option key={String(row.id)} value={String(row.id)}>{label(row.name)}</option>)}</select></label>}
          {movementType === "PZ" ? <label>Dostawca (opcjonalnie)<select name="counterpartyId"><option value="">—</option>{counterparties.map((row) => <option key={String(row.id)} value={String(row.id)}>{label(row.name)}</option>)}</select></label> : null}
          <label>Data<input type="date" name="movementDate" defaultValue={today()} /></label>
          <label>Numer dokumentu<input name="documentNumber" placeholder="automatyczny / opcjonalny" /></label>
        </div>
        {movementType === "WZ" ? <div className={styles.customerHelper}><span>Nie ma klienta na liście?</span><button type="button" onClick={() => setCustomerForm((value) => !value)}>+ Dodaj klienta</button></div> : null}
        {customerForm && movementType === "WZ" ? <div className={styles.customerForm} onKeyDown={(event) => { if (event.key === "Enter") event.stopPropagation(); }}><label>Nazwa klienta<input name="newCustomerName" form="warehouse-customer-531" /></label><label>NIP (opcjonalnie)<input name="newCustomerTaxId" form="warehouse-customer-531" /></label></div> : null}
        <div className={styles.lines}>{lines.map((line, index) => <div key={index} className={styles.line}><select value={line.stockItemId} onChange={(event) => setLines((current) => current.map((value, i) => i === index ? { ...value, stockItemId: event.target.value } : value))} required><option value="">Materiał / sprzęt</option>{items.map((row) => <option key={String(row.id)} value={String(row.id)}>{label(row.name)}</option>)}</select><input value={line.quantity} onChange={(event) => setLines((current) => current.map((value, i) => i === index ? { ...value, quantity: event.target.value } : value))} inputMode="decimal" placeholder="Ilość" required /><input value={line.unitCost} onChange={(event) => setLines((current) => current.map((value, i) => i === index ? { ...value, unitCost: event.target.value } : value))} inputMode="decimal" placeholder="Koszt j. (opc.)" />{lines.length > 1 ? <button type="button" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}><X size={13} /></button> : null}</div>)}</div>
        <div className={styles.formActions}><button type="button" className={styles.secondary} onClick={() => setLines((current) => [...current, { stockItemId: "", quantity: "", unitCost: "" }])}><Plus size={13} /> Pozycja</button><button type="submit" className={styles.primary} disabled={pending}><Save size={13} /> Zapisz szkic</button></div>
      </form> : null}

      {customerForm && movementType === "WZ" ? <form id="warehouse-customer-531" className={styles.customerSave} onSubmit={(event) => {
        event.preventDefault();
        const external = new FormData();
        const parent = event.currentTarget.parentElement?.querySelector<HTMLElement>(`.${styles.customerForm}`);
        const name = parent?.querySelector<HTMLInputElement>('input[name="newCustomerName"]')?.value ?? "";
        const taxId = parent?.querySelector<HTMLInputElement>('input[name="newCustomerTaxId"]')?.value ?? "";
        external.set("name", name);
        external.set("taxId", taxId);
        void post("customer_create", { name, taxId }, "Klient został dodany do kartoteki kontrahentów.").then((result) => {
          const id = result?.counterparty?.id ? String(result.counterparty.id) : "";
          if (id) { setFormRoute(`customer:${id}`); setCustomerForm(false); }
        });
      }}><button type="submit" className={styles.secondary} disabled={pending}>Zapisz nowego klienta</button></form> : null}

      <div className={styles.tableWrap}><table className={styles.table}><thead><tr><th>Typ</th><th>Dokument / źródło</th><th>Data</th><th>Magazyn</th><th>Kontrahent</th><th>Przeznaczenie / odbiorca</th><th>Pozycje</th><th>Status</th><th>Akcja</th></tr></thead><tbody>{movements.map((row) => {
        const type = String(row.movement_type ?? "").toUpperCase();
        const draft = String(row.status) === "draft";
        const selectable = draft && canWrite && (type === "PZ" || type === "WZ");
        const canFinalize = type !== "WZ" || ["direct_project", "external_customer"].includes(String(row.destination_mode));
        return <tr key={String(row.id)}><td><b>{type}</b></td><td><strong>{label(row.document_number, "bez numeru")}</strong><small>{label(row.source_label, "System")}{row.source_document_name ? ` · ${row.source_document_name}` : ""}</small></td><td>{dateLabel(row.movement_date)}</td><td>{label(row.warehouse_name)}</td><td><strong>{label(row.counterparty_name)}</strong><small>{type === "PZ" && row.counterparty_name ? "dostawca" : type === "WZ" && row.counterparty_name ? "klient / kontrahent" : ""}</small></td><td>{selectable ? <select className={styles.routeSelect} value={routeChoice(row)} onChange={(event) => void changeRoute(row, event.target.value)} disabled={pending}><option value="">Wybierz</option>{type === "PZ" ? <option value="central_stock">Zapas centralny</option> : null}<optgroup label="Inwestycje">{projects.map((project) => <option key={String(project.id)} value={`project:${String(project.id)}`}>{label(project.name)}</option>)}</optgroup>{type === "WZ" ? <><optgroup label="Klienci zewnętrzni">{customerRows.map((party) => <option key={String(party.id)} value={`customer:${String(party.id)}`}>{label(party.name)}</option>)}</optgroup>{otherCounterparties.length ? <optgroup label="Pozostali kontrahenci">{otherCounterparties.map((party) => <option key={String(party.id)} value={`customer:${String(party.id)}`}>{label(party.name)}</option>)}</optgroup> : null}</> : null}</select> : <span className={String(row.destination_mode) === "unassigned" ? styles.unassigned : styles.destination}>{routeText(row)}</span>}</td><td>{Number(row.line_count ?? 0)}</td><td><span className={`${styles.status} ${draft ? styles.draft : styles.approved}`}>{statusLabel(row.status)}</span></td><td>{draft && canApprove ? <button type="button" className={styles.approve} disabled={pending || !canFinalize} title={!canFinalize ? "Najpierw wskaż inwestycję albo klienta zewnętrznego." : undefined} onClick={() => void approve(row)}>{type === "PZ" ? "Przyjmij" : type === "WZ" ? "Wydaj" : "Zatwierdź"}</button> : "—"}</td></tr>;
      })}</tbody></table>{loading ? <div className={styles.empty}>Pobieram aktualne ruchy…</div> : !movements.length ? <div className={styles.empty}>Brak ruchów magazynowych.</div> : null}</div>
    </section>,
    host
  );
}
