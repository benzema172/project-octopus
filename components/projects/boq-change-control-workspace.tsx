"use client";

import { useMemo, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, CircleDollarSign, GitCompareArrows, GitPullRequestCreate, History, Layers3, LoaderCircle, Network, Pencil, Plus, Search, Send, ShieldCheck, Trash2, TriangleAlert, Undo2, X } from "lucide-react";
import type { BoqControlItem, BoqControlVersion, BoqVersionDiff, ChangeOrderControlItem, WbsControlNode } from "@/lib/data/project-boq-control";

type Permissions = { write: boolean; approve: boolean; financeWrite: boolean; financeApprove: boolean };
type Props = {
  projectId: string;
  versions: BoqControlVersion[];
  versionItems: BoqControlItem[];
  currentItems: BoqControlItem[];
  wbsNodes: WbsControlNode[];
  changeOrders: ChangeOrderControlItem[];
  versionDiffs: Record<string, BoqVersionDiff>;
  permissions: Permissions;
};

type MutationPayload = Record<string, string | number | null | undefined>;
type RunMutation = (payload: MutationPayload, success: string) => void;

const money = (value: number) => new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN", maximumFractionDigits: 2 }).format(value);
const decimal = (value: number | null) => value == null ? "—" : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 4 }).format(value);
const date = (value: string | null) => value ? new Intl.DateTimeFormat("pl-PL").format(new Date(value)) : "—";

const statusLabel: Record<string, string> = {
  draft: "Szkic", review: "Do akceptacji", approved: "Obowiązująca", superseded: "Zastąpiona",
  identified: "Rozpoznana", submitted: "Zgłoszona", rejected: "Odrzucona"
};

const changeLabel: Record<string, string> = { unchanged: "Bez zmiany", added: "Dodano", modified: "Zmieniono", removed: "Usunięto" };

function Message({ message, error }: { message: string | null; error: string | null }) {
  if (!message && !error) return null;
  return <p className={error ? "boq-control-message boq-control-message--error" : "boq-control-message"}>{error ? <TriangleAlert size={15} /> : <Check size={15} />}{error ?? message}</p>;
}

function RevisionForm({ versions, changeOrders, pending, run }: { versions: BoqControlVersion[]; changeOrders: ChangeOrderControlItem[]; pending: boolean; run: RunMutation }) {
  const source = versions.find((version) => version.status === "approved") ?? versions[0];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    run({ action: "create_revision", ...values }, "Utworzono kontrolowaną wersję roboczą BOQ.");
  }
  return <form className="boq-control-form" onSubmit={submit}>
    <label><span>Nazwa wersji</span><input name="name" required placeholder="np. Rewizja R02 — instalacje sanitarne" /></label>
    <label><span>Wersja bazowa</span><select name="basedOnVersionId" defaultValue={source?.id ?? ""}><option value="">Pusty baseline</option>{versions.map((version) => <option value={version.id} key={version.id}>v{version.versionNumber} · {version.name} · {statusLabel[version.status] ?? version.status}</option>)}</select></label>
    <label><span>Rodzaj</span><select name="revisionKind" defaultValue="revision"><option value="revision">Rewizja</option><option value="change_order">Zmiana kontraktowa</option><option value="corrective">Korekta</option><option value="as_built">Powykonawcza</option><option value="baseline">Nowy baseline</option></select></label>
    <label><span>Powiązany Change Order</span><select name="changeOrderId" defaultValue=""><option value="">Bez powiązania</option>{changeOrders.filter((order) => order.status !== "rejected").map((order) => <option value={order.id} key={order.id}>{order.number ?? "Zmiana"} · {order.title}</option>)}</select></label>
    <button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : <GitPullRequestCreate size={15} />}Utwórz rewizję</button>
  </form>;
}

function BoqItemEditor({ version, item, wbsNodes, changeOrders, pending, run, close }: {
  version: BoqControlVersion; item: BoqControlItem | null; wbsNodes: WbsControlNode[]; changeOrders: ChangeOrderControlItem[]; pending: boolean; run: RunMutation; close: () => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    run({ action: "save_item", versionId: version.id, itemId: item?.id, ...values }, item ? "Zapisano zmianę pozycji BOQ." : "Dodano pozycję do wersji roboczej BOQ.");
  }
  return <form className="boq-item-editor" onSubmit={submit}>
    <div className="boq-item-editor__heading"><div><span>{item ? "Edycja pozycji" : "Nowa pozycja"}</span><strong>Wersja v{version.versionNumber} · {version.name}</strong></div><button type="button" onClick={close} aria-label="Zamknij edytor"><X size={16} /></button></div>
    <div className="boq-control-form boq-control-form--items">
      <label><span>Numer pozycji</span><input name="itemNumber" defaultValue={item?.itemNumber ?? ""} /></label>
      <label className="boq-field-wide"><span>Opis</span><input name="description" required defaultValue={item?.description ?? ""} /></label>
      <label><span>Ilość</span><input name="quantity" inputMode="decimal" defaultValue={item?.quantity ?? ""} /></label>
      <label><span>Jednostka</span><input name="unit" defaultValue={item?.unit ?? ""} /></label>
      <label><span>Cena jednostkowa</span><input name="unitPrice" inputMode="decimal" defaultValue={item?.unitPrice ?? ""} /></label>
      <label><span>WBS</span><select name="wbsNodeId" defaultValue={item?.wbsNodeId ?? ""}><option value="">Nieprzypisane</option>{wbsNodes.map((node) => <option value={node.id} key={node.id}>{node.code} · {node.name}</option>)}</select></label>
      <label><span>Kod kosztowy</span><input name="costCode" defaultValue={item?.costCode ?? ""} /></label>
      <label><span>Change Order</span><select name="changeOrderId" defaultValue={item?.changeOrderId ?? version.changeOrderId ?? ""}><option value="">Bez zmiany kontraktowej</option>{changeOrders.filter((order) => order.status !== "rejected").map((order) => <option value={order.id} key={order.id}>{order.number ?? "Zmiana"} · {order.title}</option>)}</select></label>
      <label className="boq-field-wide"><span>Uzasadnienie rewizji</span><input name="revisionNote" defaultValue={item?.revisionNote ?? ""} placeholder="Co i dlaczego zmieniono?" /></label>
    </div>
    <button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Zapisz pozycję</button>
  </form>;
}

function WbsEditor({ node, nodes, pending, run, close }: { node: WbsControlNode | null; nodes: WbsControlNode[]; pending: boolean; run: RunMutation; close: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    run({ action: "upsert_wbs", wbsNodeId: node?.id, ...values }, node ? "Zaktualizowano element WBS." : "Dodano element WBS.");
  }
  return <form className="boq-control-form" onSubmit={submit}>
    <label><span>Kod WBS</span><input name="code" required defaultValue={node?.code ?? ""} placeholder="np. SAN.WOD.01" /></label>
    <label><span>Nazwa</span><input name="name" required defaultValue={node?.name ?? ""} /></label>
    <label><span>Element nadrzędny</span><select name="parentId" defaultValue={node?.parentId ?? ""}><option value="">Poziom główny</option>{nodes.filter((option) => option.id !== node?.id).map((option) => <option value={option.id} key={option.id}>{option.code} · {option.name}</option>)}</select></label>
    <label><span>Branża</span><input name="branch" defaultValue={node?.branch ?? ""} /></label>
    <label><span>Instalacja</span><input name="installation" defaultValue={node?.installation ?? ""} /></label>
    <label><span>Strefa</span><input name="zone" defaultValue={node?.zone ?? ""} /></label>
    <label><span>Kolejność</span><input name="sortOrder" inputMode="numeric" defaultValue={node?.sortOrder ?? 0} /></label>
    <div className="boq-form-actions"><button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}Zapisz WBS</button>{node ? <button type="button" className="secondary-button" onClick={close}>Anuluj</button> : null}</div>
  </form>;
}

function ChangeOrderForm({ pending, run }: { pending: boolean; run: RunMutation }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
    run({ action: "create_change_order", ...values }, "Zarejestrowano zmianę kontraktową.");
    form.reset();
  }
  return <form className="boq-control-form" onSubmit={submit}>
    <label><span>Numer zmiany</span><input name="number" placeholder="np. CO-007" /></label>
    <label><span>Tytuł</span><input name="title" required /></label>
    <label className="boq-field-wide"><span>Opis i podstawa</span><input name="description" /></label>
    <label><span>Wpływ wartościowy</span><input name="valueChange" inputMode="decimal" placeholder="0,00" /></label>
    <label><span>Wpływ na termin (dni)</span><input name="daysChange" inputMode="numeric" placeholder="0" /></label>
    <button className="primary-button" disabled={pending}>{pending ? <LoaderCircle className="spin" size={15} /> : <Plus size={15} />}Dodaj Change Order</button>
  </form>;
}

export function BoqChangeControlWorkspace({ projectId, versions, versionItems, currentItems, wbsNodes, changeOrders, versionDiffs, permissions }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const defaultVersion = versions.find((version) => version.status === "draft") ?? versions.find((version) => version.status === "review") ?? versions.find((version) => version.status === "approved") ?? versions[0] ?? null;
  const [selectedVersionId, setSelectedVersionId] = useState(defaultVersion?.id ?? "");
  const [query, setQuery] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | "new" | null>(null);
  const [editingWbsId, setEditingWbsId] = useState<string | "new" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedVersion = versions.find((version) => version.id === selectedVersionId) ?? defaultVersion;
  const items = useMemo(() => {
    if (!selectedVersion) return currentItems;
    const snapshot = versionItems.filter((item) => item.versionId === selectedVersion.id);
    return snapshot.length ? snapshot : selectedVersion.status === "approved" ? currentItems : snapshot;
  }, [currentItems, selectedVersion, versionItems]);
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pl-PL");
    if (!normalized) return items;
    return items.filter((item) => [item.itemNumber, item.description, item.unit, item.costCode, wbsNodes.find((node) => node.id === item.wbsNodeId)?.code].some((value) => value?.toLocaleLowerCase("pl-PL").includes(normalized)));
  }, [items, query, wbsNodes]);
  const wbsMap = useMemo(() => new Map(wbsNodes.map((node) => [node.id, node])), [wbsNodes]);
  const selectedDiff = selectedVersion ? versionDiffs[selectedVersion.id] : undefined;
  const editingItem = editingItemId && editingItemId !== "new" ? items.find((item) => item.id === editingItemId) ?? null : null;
  const editingWbs = editingWbsId && editingWbsId !== "new" ? wbsNodes.find((node) => node.id === editingWbsId) ?? null : null;
  const activeItems = items.filter((item) => item.changeType !== "removed");
  const mapped = activeItems.filter((item) => item.wbsNodeId).length;
  const openChanges = changeOrders.filter((order) => !["approved", "rejected"].includes(order.status)).length;

  function run(payload: MutationPayload, success: string) {
    setMessage(null); setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/projects/boq-control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, ...payload }) });
        const result = await response.json().catch(() => ({})) as { error?: string; versionId?: string };
        if (!response.ok) { setError(result.error ?? "Nie udało się wykonać operacji."); return; }
        if (payload.action === "create_revision" && result.versionId) setSelectedVersionId(result.versionId);
        setEditingItemId(null); setEditingWbsId(null); setMessage(success); router.refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Utracono połączenie podczas zapisywania zmian.");
      }
    });
  }

  function remove(item: BoqControlItem) {
    if (!selectedVersion || !window.confirm(`Usunąć pozycję „${item.description}” z tej rewizji?`)) return;
    run({ action: "remove_item", versionId: selectedVersion.id, itemId: item.id }, "Pozycję oznaczono jako usuniętą w rewizji.");
  }

  return <div className="boq-control-workspace">
    <section className="boq-control-hero">
      <div><p className="co-kicker">BOQ / WBS Change Control</p><h2>Kosztorys bez nadpisywania historii</h2><p>Edytuj wersję roboczą, porównaj skutki i dopiero potem zatwierdź nowy baseline.</p></div>
      <div className="boq-control-kpis">
        <span><b>{activeItems.length}</b> pozycji</span><span><b>{money(activeItems.reduce((sum, item) => sum + item.totalPrice, 0))}</b> wartość</span>
        <span><b>{activeItems.length ? Math.round(mapped / activeItems.length * 100) : 0}%</b> WBS</span><span><b>{openChanges}</b> otwartych zmian</span>
      </div>
    </section>

    <Message message={message} error={error} />

    <section className="boq-version-bar">
      <div className="boq-version-picker"><History size={16} /><label><span>Widoczna wersja</span><select value={selectedVersion?.id ?? ""} onChange={(event) => { setSelectedVersionId(event.target.value); setEditingItemId(null); }} disabled={!versions.length}>{versions.length ? versions.map((version) => <option value={version.id} key={version.id}>v{version.versionNumber} · {version.name} · {statusLabel[version.status] ?? version.status}</option>) : <option value="">Brak wersji</option>}</select></label></div>
      {selectedVersion ? <div className="boq-version-meta"><span data-status={selectedVersion.status}>{statusLabel[selectedVersion.status] ?? selectedVersion.status}</span><small>{selectedVersion.revisionKind} · utworzono {date(selectedVersion.createdAt)} · {money(selectedVersion.netValue)}</small></div> : null}
      <div className="boq-version-actions">
        {selectedVersion?.status === "draft" && permissions.write ? <button className="secondary-button" disabled={pending} onClick={() => run({ action: "submit_version", versionId: selectedVersion.id }, "Wersja BOQ oczekuje na zatwierdzenie.")}><Send size={14} />Przekaż do akceptacji</button> : null}
        {selectedVersion?.status === "review" && permissions.approve ? <button className="primary-button" disabled={pending} onClick={() => run({ action: "approve_version", versionId: selectedVersion.id }, "Nowa wersja BOQ została zatwierdzona i obowiązuje w modułach.")}><ShieldCheck size={14} />Zatwierdź baseline</button> : null}
      </div>
    </section>

    {permissions.write ? <details className="boq-control-tool"><summary><GitPullRequestCreate size={16} />Nowa wersja kontrolowana <ChevronRight size={14} /></summary><RevisionForm versions={versions} changeOrders={changeOrders} pending={pending} run={run} /></details> : null}

    <section className="boq-control-table-card">
      <div className="boq-control-table-heading"><div><p className="co-kicker">Pozycje wersji</p><h3>{selectedVersion ? `v${selectedVersion.versionNumber} · ${selectedVersion.name}` : "Aktywny kosztorys"}</h3></div><label className="boq-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj pozycji, WBS, kodu…" /></label>{selectedVersion?.status === "draft" && permissions.write ? <button className="primary-button" onClick={() => setEditingItemId("new")}><Plus size={14} />Dodaj pozycję</button> : null}</div>
      {selectedVersion?.status === "draft" && editingItemId ? <BoqItemEditor key={editingItemId} version={selectedVersion} item={editingItem} wbsNodes={wbsNodes} changeOrders={changeOrders} pending={pending} run={run} close={() => setEditingItemId(null)} /> : null}
      <div className="boq-control-table-wrap"><table className="boq-control-table"><thead><tr><th>Pozycja</th><th>Opis / kod kosztu</th><th>WBS</th><th>Ilość</th><th>Cena jedn.</th><th>Wartość</th><th>Zmiana</th><th aria-label="Akcje" /></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id} data-change={item.changeType}><td><strong>{item.itemNumber ?? "—"}</strong></td><td><strong>{item.description}</strong><small>{item.costCode ?? "bez kodu kosztowego"}</small></td><td>{item.wbsNodeId ? <span className="boq-wbs-chip">{wbsMap.get(item.wbsNodeId)?.code ?? "WBS"}<small>{wbsMap.get(item.wbsNodeId)?.name}</small></span> : <span className="boq-missing">Nieprzypisane</span>}</td><td>{decimal(item.quantity)} {item.unit ?? ""}</td><td>{item.unitPrice == null ? "—" : money(item.unitPrice)}</td><td><strong>{money(item.totalPrice)}</strong></td><td><span className="boq-change-chip" data-change={item.changeType}>{changeLabel[item.changeType]}</span></td><td>{selectedVersion?.status === "draft" && permissions.write ? <div className="boq-row-actions"><button type="button" onClick={() => setEditingItemId(item.id)} aria-label={`Edytuj ${item.description}`}><Pencil size={14} /></button><button type="button" onClick={() => remove(item)} aria-label={`Usuń ${item.description}`}><Trash2 size={14} /></button></div> : null}</td></tr>)}</tbody></table>{visibleItems.length === 0 ? <div className="boq-control-empty"><Layers3 size={22} /><strong>Brak pozycji w tym widoku</strong><span>{query ? "Zmień wyszukiwaną frazę." : "Utwórz wersję lub dodaj pierwszą pozycję BOQ."}</span></div> : null}</div>
    </section>

    <details className="boq-control-tool" open={Boolean(selectedDiff?.rows.length)}><summary><GitCompareArrows size={16} />Porównanie z wersją bazową <span>{selectedDiff?.rows.length ?? 0}</span><ChevronRight size={14} /></summary><div className="boq-diff"><div className="boq-diff-kpis"><span><b>{selectedDiff?.added ?? 0}</b> dodano</span><span><b>{selectedDiff?.modified ?? 0}</b> zmieniono</span><span><b>{selectedDiff?.removed ?? 0}</b> usunięto</span><span data-negative={(selectedDiff?.deltaValue ?? 0) < 0}><b>{money(selectedDiff?.deltaValue ?? 0)}</b> wpływ netto</span></div><div className="boq-diff-list">{selectedDiff?.rows.slice(0, 250).map((row) => <article key={row.lineageId} data-change={row.changeType}><span>{changeLabel[row.changeType]}</span><div><strong>{row.itemNumber ?? "—"} · {row.description}</strong><small>{money(row.beforeValue)} → {money(row.afterValue)}</small></div><b>{row.deltaValue >= 0 ? "+" : ""}{money(row.deltaValue)}</b></article>)}{!selectedDiff?.rows.length ? <p>Brak różnic względem wskazanej wersji bazowej.</p> : null}</div></div></details>

    <details className="boq-control-tool"><summary><Network size={16} />Struktura WBS <span>{wbsNodes.length}</span><ChevronRight size={14} /></summary><div className="boq-wbs-workspace"><div className="boq-wbs-list">{wbsNodes.map((node) => <button type="button" key={node.id} onClick={() => permissions.write && setEditingWbsId(node.id)}><span style={{ paddingLeft: node.parentId ? 18 : 0 }}><b>{node.code}</b><strong>{node.name}</strong><small>{[node.branch, node.installation, node.zone].filter(Boolean).join(" · ") || "Bez dodatkowego podziału"}</small></span>{permissions.write ? <Pencil size={13} /> : null}</button>)}{!wbsNodes.length ? <p>Brak struktury WBS. Dodaj pierwszy pakiet robót.</p> : null}</div>{permissions.write ? <div className="boq-wbs-editor"><div className="boq-subheading"><div><p className="co-kicker">Edytor WBS</p><h3>{editingWbs ? `Edycja ${editingWbs.code}` : "Nowy element struktury"}</h3></div>{editingWbsId ? <button type="button" onClick={() => setEditingWbsId(null)}><X size={14} /></button> : null}</div><WbsEditor key={editingWbs?.id ?? "new"} node={editingWbs} nodes={wbsNodes} pending={pending} run={run} close={() => setEditingWbsId(null)} /></div> : null}</div></details>

    <details className="boq-control-tool"><summary><CircleDollarSign size={16} />Rejestr Change Order <span>{changeOrders.length}</span><ChevronRight size={14} /></summary><div className="boq-change-orders">{permissions.financeWrite ? <ChangeOrderForm pending={pending} run={run} /> : null}<div className="boq-change-order-list">{changeOrders.map((order) => <article key={order.id} data-status={order.status}><div><span>{order.number ?? "Bez numeru"}</span><strong>{order.title}</strong><small>{order.description ?? "Bez opisu"}</small></div><dl><div><dt>Wartość</dt><dd>{order.valueChange >= 0 ? "+" : ""}{money(order.valueChange)}</dd></div><div><dt>Termin</dt><dd>{order.daysChange >= 0 ? "+" : ""}{order.daysChange} dni</dd></div><div><dt>Status</dt><dd>{statusLabel[order.status] ?? order.status}</dd></div></dl><div className="boq-change-order-actions">{order.status === "identified" && permissions.financeWrite ? <button disabled={pending} onClick={() => run({ action: "transition_change_order", changeOrderId: order.id, transition: "submit" }, "Zmiana została zgłoszona do decyzji.")}><Send size={13} />Zgłoś</button> : null}{order.status === "submitted" && permissions.financeApprove ? <><button disabled={pending} onClick={() => run({ action: "transition_change_order", changeOrderId: order.id, transition: "approve" }, "Change Order został zatwierdzony.")}><Check size={13} />Zatwierdź</button><button disabled={pending} onClick={() => run({ action: "transition_change_order", changeOrderId: order.id, transition: "reject" }, "Change Order został odrzucony.")}><X size={13} />Odrzuć</button></> : null}{order.status === "rejected" && permissions.financeWrite ? <button disabled={pending} onClick={() => run({ action: "transition_change_order", changeOrderId: order.id, transition: "reopen" }, "Zmiana wróciła do analizy.")}><Undo2 size={13} />Otwórz ponownie</button> : null}</div></article>)}{!changeOrders.length ? <p>Brak zarejestrowanych zmian zakresu lub kontraktu.</p> : null}</div></div></details>
  </div>;
}
