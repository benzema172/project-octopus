"use client";

import { useMemo, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Archive,
  BadgeCheck,
  Check,
  ChevronDown,
  Clock3,
  FileCheck2,
  FolderLock,
  GitCompareArrows,
  LoaderCircle,
  PackageOpen,
  ShieldCheck,
  X
} from "lucide-react";
import type { ProjectDocumentOperations } from "@/lib/data/document-operations";
import { DOCUMENT_DESTINATIONS, documentCategoryLabel } from "@/lib/documents/classification";

type Row = Record<string, unknown>;

type Props = {
  workspaceId: string;
  projectId: string;
  operations: ProjectDocumentOperations;
  canWrite: boolean;
  canApprove: boolean;
  canGovern: boolean;
};

const PHASE_LABELS: Record<string, string> = {
  preparation: "Przygotowanie",
  execution: "Realizacja",
  acceptance: "Odbiory",
  closeout: "Zamknięcie"
};

const STATUS_LABELS: Record<string, string> = {
  approved: "zatwierdzony",
  accepted: "zaakceptowany",
  completed: "zakończony",
  expanded: "rozpakowana",
  failed: "błąd",
  fulfilled: "kompletny",
  in_progress: "w toku",
  missing: "brak",
  pending: "oczekuje",
  proposed: "do decyzji",
  published: "opublikowany",
  rejected: "odrzucony",
  revoked: "wycofany",
  waived: "nie dotyczy"
};

function text(row: Row, key: string, fallback = "") {
  const value = row[key];
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function number(row: Row, key: string, fallback = 0) {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : fallback;
}

function bool(row: Row, key: string) {
  return row[key] === true;
}

function nestedRows(row: Row, key: string) {
  return Array.isArray(row[key]) ? row[key] as Row[] : [];
}

function formatDate(value: unknown, withTime = false) {
  if (typeof value !== "string" || !value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("pl-PL", withTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(parsed);
}

function dateInputValue(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function formatBytes(value: unknown) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function statusLabel(value: unknown) {
  const status = typeof value === "string" ? value : "pending";
  return STATUS_LABELS[status] ?? status;
}

function statusClass(value: unknown) {
  const status = typeof value === "string" ? value : "";
  if (["approved", "accepted", "completed", "expanded", "fulfilled", "published"].includes(status)) return "status-chip status-chip--positive";
  if (["failed", "rejected", "revoked"].includes(status)) return "status-chip status-chip--danger";
  if (["missing", "pending", "proposed", "in_progress"].includes(status)) return "status-chip status-chip--warning";
  return "status-chip";
}

export function ProjectDocumentControl({ workspaceId, projectId, operations, canWrite, canApprove, canGovern }: Props) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [approvalDocumentId, setApprovalDocumentId] = useState("");
  const [workflowId, setWorkflowId] = useState(operations.workflows[0] ? text(operations.workflows[0], "id") : "");
  const [governanceDocumentId, setGovernanceDocumentId] = useState("");
  const [selectedRoomDocuments, setSelectedRoomDocuments] = useState<string[]>([]);

  const documentsById = useMemo(() => new Map(operations.documents.map((document) => [text(document, "id"), document])), [operations.documents]);
  const workflowsById = useMemo(() => new Map(operations.workflows.map((workflow) => [text(workflow, "id"), workflow])), [operations.workflows]);
  const activeApprovals = operations.approvalInstances.filter((instance) => ["pending", "in_progress"].includes(text(instance, "status")));
  const approvedDocuments = operations.documents.filter((document) => text(document, "review_status") === "approved" && text(document, "current_version_id"));

  async function post(url: string, body: Record<string, unknown>, success: string, actionKey: string) {
    setBusyAction(actionKey);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Operacja nie powiodła się.");
      setMessage(success);
      router.refresh();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Operacja nie powiodła się.");
    } finally {
      setBusyAction(null);
    }
  }

  function startApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!approvalDocumentId || !workflowId) return;
    void post("/api/approvals", {
      workspaceId,
      action: "start",
      documentId: approvalDocumentId,
      workflowId
    }, "Uruchomiono wieloetapową akceptację dokumentu.", "approval:start");
  }

  function decideApproval(instanceId: string, action: "approve" | "reject") {
    void post("/api/approvals", {
      workspaceId,
      action,
      instanceId,
      signatureMethod: "internal",
      signatureEvidence: { source: "project_document_control" }
    }, action === "approve" ? "Etap zatwierdzono i podpisano śladem wewnętrznym." : "Proces został odrzucony.", `approval:${instanceId}:${action}`);
  }

  function reviewImpact(impactId: string, action: "approve" | "reject") {
    void post("/api/brain/review", {
      workspaceId,
      entityType: "change_impact",
      entityId: impactId,
      action
    }, action === "approve" ? "Wpływ rewizji zaakceptowano." : "Wpływ rewizji odrzucono.", `impact:${impactId}:${action}`);
  }

  function updateRequirement(event: FormEvent<HTMLFormElement>, requirementId: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void post("/api/projects/document-requirements", {
      workspaceId,
      projectId,
      requirementId,
      action: "update",
      dueAt: form.get("dueAt") || null
    }, "Zaktualizowano termin wymagania.", `requirement:${requirementId}:update`);
  }

  function changeRequirementState(requirementId: string, action: "waive" | "restore") {
    void post("/api/projects/document-requirements", { workspaceId, projectId, requirementId, action },
      action === "waive" ? "Wymaganie oznaczono jako nieobowiązujące." : "Przywrócono wymaganie do matrycy.",
      `requirement:${requirementId}:${action}`);
  }

  function createRequirement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    void post("/api/projects/document-requirements", {
      workspaceId,
      projectId,
      action: "create",
      title: values.get("title"),
      category: values.get("category"),
      phase: values.get("phase"),
      dueAt: values.get("dueAt") || null,
      description: values.get("description") || null
    }, "Dodano wymaganie do matrycy dokumentacji.", "requirement:create");
  }

  function saveGovernance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!governanceDocumentId) return;
    void post("/api/documents/governance", {
      workspaceId,
      action: "set_policy",
      documentId: governanceDocumentId,
      legalHold: form.get("legalHold") === "on",
      retentionUntil: form.get("retentionUntil") || null,
      retentionPolicyId: form.get("retentionPolicyId") || null,
      note: form.get("note") || null
    }, "Zapisano retencję i blokadę prawną dokumentu.", "governance:save");
  }

  function createDataRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void post("/api/documents/governance", {
      workspaceId,
      action: "create_data_room",
      projectId,
      name: form.get("name"),
      purpose: form.get("purpose"),
      expiresAt: form.get("expiresAt") || null,
      documentIds: selectedRoomDocuments
    }, "Utworzono kontrolowaną paczkę dokumentacji.", "data-room:create");
  }

  function changeDataRoomStatus(roomId: string, action: "publish_data_room" | "revoke_data_room") {
    void post("/api/documents/governance", { workspaceId, action, dataRoomId: roomId },
      action === "publish_data_room" ? "Data room opublikowano." : "Dostęp do data roomu wycofano.",
      `data-room:${roomId}:${action}`);
  }

  function toggleRoomDocument(documentId: string) {
    setSelectedRoomDocuments((current) => current.includes(documentId)
      ? current.filter((id) => id !== documentId)
      : [...current, documentId]);
  }

  return (
    <section className="document-control" aria-label="Kontrola obiegu dokumentacji">
      <div className="document-control__summary">
        <article className="document-control__score">
          <div className="document-control__ring" style={{ "--completion": `${Math.max(0, Math.min(100, operations.completeness.percent)) * 3.6}deg` } as CSSProperties}>
            <strong>{Math.round(operations.completeness.percent)}%</strong>
          </div>
          <div>
            <span>Kompletność dokumentacji</span>
            <strong>{operations.completeness.fulfilled} z {operations.completeness.required} wymaganych</strong>
            <small>{operations.completeness.missing} braków · {operations.completeness.overdue} po terminie</small>
          </div>
        </article>
        <article><GitCompareArrows size={20} /><span>Radar rewizji</span><strong>{operations.revisionImpacts.filter((impact) => text(impact, "status") === "proposed").length}</strong><small>zmian wymaga decyzji</small></article>
        <article><FileCheck2 size={20} /><span>Akceptacje</span><strong>{activeApprovals.length}</strong><small>aktywnych obiegów</small></article>
        <article><FolderLock size={20} /><span>Paczki przekazania</span><strong>{operations.dataRooms.length}</strong><small>wersjonowane i audytowane</small></article>
      </div>

      {message ? <p className="document-control__message document-control__message--success"><Check size={15} />{message}</p> : null}
      {error ? <p className="document-control__message document-control__message--error"><X size={15} />{error}</p> : null}

      <div className="document-control__panels">
        <details className="document-control__panel" open>
          <summary><span><BadgeCheck size={18} /><strong>Matryca kompletności</strong><small>Automatycznie łączy zatwierdzone dokumenty z wymaganiami etapów.</small></span><ChevronDown size={17} /></summary>
          <div className="document-control__panel-body">
            <div className="document-control__phases">
              {operations.completeness.phases.map((phase) => {
                const required = number(phase, "required");
                const fulfilled = number(phase, "fulfilled");
                const percent = required ? Math.round(100 * fulfilled / required) : 100;
                return <article key={text(phase, "phase")}><div><strong>{PHASE_LABELS[text(phase, "phase")] ?? text(phase, "phase")}</strong><span>{fulfilled}/{required}</span></div><progress value={percent} max={100}>{percent}%</progress></article>;
              })}
            </div>
            <div className="document-control__table" role="table" aria-label="Wymagane dokumenty">
              {operations.requirements.map((requirement) => {
                const status = text(requirement, "status");
                return <div className="document-control__table-row" role="row" key={text(requirement, "id")}>
                  <span><strong>{text(requirement, "title")}</strong><small>{PHASE_LABELS[text(requirement, "phase")] ?? text(requirement, "phase")} · {documentCategoryLabel(text(requirement, "category"))}</small></span>
                  <span className={statusClass(status)}>{statusLabel(status)}</span>
                  {canWrite ? <form className="document-control__requirement-actions" onSubmit={(event) => updateRequirement(event, text(requirement, "id"))}><input aria-label={`Termin: ${text(requirement, "title")}`} name="dueAt" type="date" defaultValue={dateInputValue(requirement.due_at)} /><button className="secondary-button" type="submit" disabled={Boolean(busyAction)}>Zapisz termin</button>{canApprove ? <button className={status === "waived" ? "approve-button" : "reject-button"} type="button" disabled={Boolean(busyAction)} onClick={() => changeRequirementState(text(requirement, "id"), status === "waived" ? "restore" : "waive")}>{status === "waived" ? "Przywróć" : "Nie dotyczy"}</button> : null}</form> : <span>{formatDate(requirement.due_at)}</span>}
                </div>;
              })}
            </div>
            {canWrite ? <form className="document-control__requirement-create" onSubmit={createRequirement}><label><span>Nowe wymaganie</span><input required name="title" placeholder="np. Instrukcja eksploatacji" /></label><label><span>Etap</span><select name="phase" defaultValue="execution">{Object.entries(PHASE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><label><span>Kategoria</span><select required name="category" defaultValue="technical">{DOCUMENT_DESTINATIONS.map((destination) => <option key={destination.value} value={destination.value}>{destination.label}</option>)}</select></label><label><span>Termin</span><input name="dueAt" type="date" /></label><label className="document-control__requirement-description"><span>Opis / podstawa</span><input name="description" placeholder="Kontrakt, standard firmy lub wymóg inwestora" /></label><button className="primary-button" type="submit" disabled={Boolean(busyAction)}>{busyAction === "requirement:create" ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}Dodaj wymaganie</button></form> : null}
          </div>
        </details>

        <details className="document-control__panel" open={operations.revisionImpacts.some((impact) => text(impact, "status") === "proposed")}>
          <summary><span><GitCompareArrows size={18} /><strong>Radar rewizji</strong><small>Porównanie pól, kwot, terminów i pozycji kosztorysowych między wersjami.</small></span><ChevronDown size={17} /></summary>
          <div className="document-control__panel-body">
            <div className="document-control__list">
              {operations.revisionImpacts.slice(0, 12).map((impact) => {
                const impactId = text(impact, "id");
                const proposed = text(impact, "status") === "proposed";
                return <article className="document-control__impact" key={impactId}>
                  <span className={`document-control__risk document-control__risk--${text(impact, "risk_level", "medium")}`}>{text(impact, "risk_level", "medium")}</span>
                  <div><strong>{text(impact, "summary")}</strong><small>{text(impact, "field_path", text(impact, "target_type"))} · pewność {Math.round(number(impact, "confidence") * 100)}%{impact.financial_impact != null ? ` · wpływ ${Number(impact.financial_impact).toLocaleString("pl-PL")} zł` : ""}{number(impact, "schedule_impact_days") ? ` · ${number(impact, "schedule_impact_days")} dni` : ""}</small></div>
                  {proposed && canApprove ? <div className="review-buttons"><button type="button" className="approve-button" disabled={Boolean(busyAction)} onClick={() => reviewImpact(impactId, "approve")}><Check size={14} />Akceptuj</button><button type="button" className="reject-button" disabled={Boolean(busyAction)} onClick={() => reviewImpact(impactId, "reject")}><X size={14} />Odrzuć</button></div> : <span className={statusClass(impact.status)}>{statusLabel(impact.status)}</span>}
                </article>;
              })}
              {!operations.revisionImpacts.length ? <p className="document-control__empty">Dodanie nowej wersji uruchomi automatyczne porównanie zmian.</p> : null}
            </div>
          </div>
        </details>

        <details className="document-control__panel">
          <summary><span><PackageOpen size={18} /><strong>Bezpieczne paczki ZIP</strong><small>Każdy plik ma osobny rekord, sumę SHA-256, walidację i zadanie AI.</small></span><ChevronDown size={17} /></summary>
          <div className="document-control__panel-body">
            <div className="document-control__list">
              {operations.packages.map((item) => <article className="document-control__package" key={text(item, "id")}><PackageOpen size={18} /><div><strong>Paczka z {number(item, "entry_count")} pozycjami</strong><small>{number(item, "accepted_count")} przyjętych · {number(item, "rejected_count")} odrzuconych · {formatBytes(item.total_uncompressed_bytes)} · {formatDate(item.created_at, true)}</small>{text(item, "error_message") ? <em>{text(item, "error_message")}</em> : null}</div><span className={statusClass(item.status)}>{statusLabel(item.status)}</span></article>)}
              {!operations.packages.length ? <p className="document-control__empty">Wgraj ZIP we Wrzutni poniżej. Archiwum zostanie sprawdzone przed rozpakowaniem.</p> : null}
            </div>
          </div>
        </details>

        <details className="document-control__panel" open={activeApprovals.length > 0}>
          <summary><span><ShieldCheck size={18} /><strong>Akceptacje i podpis wewnętrzny</strong><small>Konfigurowalne etapy, uprawnienia, termin, SHA-256 i pełny ślad audytowy.</small></span><ChevronDown size={17} /></summary>
          <div className="document-control__panel-body document-control__approval-grid">
            {canApprove ? <form className="document-control__form" onSubmit={startApproval}>
              <label><span>Dokument</span><select required value={approvalDocumentId} onChange={(event) => setApprovalDocumentId(event.target.value)}><option value="">Wybierz dokument</option>{operations.documents.filter((document) => text(document, "current_version_id")).map((document) => <option key={text(document, "id")} value={text(document, "id")}>{text(document, "name")}</option>)}</select></label>
              <label><span>Ścieżka</span><select required value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}>{operations.workflows.map((workflow) => <option key={text(workflow, "id")} value={text(workflow, "id")}>{text(workflow, "name")}</option>)}</select></label>
              <button className="primary-button" type="submit" disabled={Boolean(busyAction) || !approvalDocumentId || !workflowId}>{busyAction === "approval:start" ? <LoaderCircle className="spin" size={15} /> : <FileCheck2 size={15} />}Uruchom obieg</button>
            </form> : <p className="document-control__empty">Masz podgląd procesów. Decyzja wymaga uprawnienia zatwierdzania inwestycji.</p>}
            <div className="document-control__list">
              {operations.approvalInstances.slice(0, 12).map((instance) => {
                const instanceId = text(instance, "id");
                const workflow = workflowsById.get(text(instance, "workflow_id"));
                const document = documentsById.get(text(instance, "entity_id"));
                const currentStep = operations.workflowSteps.find((step) => text(step, "workflow_id") === text(instance, "workflow_id") && number(step, "step_order") === number(instance, "current_step_order"));
                const active = ["pending", "in_progress"].includes(text(instance, "status"));
                return <article className="document-control__approval" key={instanceId}>
                  <Clock3 size={18} />
                  <div><strong>{document ? text(document, "name") : `Dokument ${text(instance, "entity_id").slice(0, 8)}`}</strong><small>{workflow ? text(workflow, "name") : "Ścieżka akceptacji"} · etap {number(instance, "current_step_order")}: {currentStep ? text(currentStep, "name") : "—"} · termin {formatDate(instance.due_at, true)}</small></div>
                  {active && canApprove ? <div className="review-buttons"><button type="button" className="approve-button" disabled={Boolean(busyAction)} onClick={() => decideApproval(instanceId, "approve")}><Check size={14} />Zatwierdź etap</button><button type="button" className="reject-button" disabled={Boolean(busyAction)} onClick={() => decideApproval(instanceId, "reject")}><X size={14} />Odrzuć</button></div> : <span className={statusClass(instance.status)}>{statusLabel(instance.status)}</span>}
                </article>;
              })}
              {!operations.approvalInstances.length ? <p className="document-control__empty">Nie uruchomiono jeszcze formalnego obiegu akceptacji.</p> : null}
            </div>
          </div>
        </details>

        <details className="document-control__panel">
          <summary><span><Archive size={18} /><strong>Retencja, legal hold i data room</strong><small>Kontrolowane przechowywanie oraz niezmienny zestaw dokumentów do odbioru lub audytu.</small></span><ChevronDown size={17} /></summary>
          <div className="document-control__panel-body document-control__governance-grid">
            {canGovern ? <form className="document-control__form" onSubmit={saveGovernance}>
              <h3>Ochrona dokumentu</h3>
              <label><span>Dokument</span><select required value={governanceDocumentId} onChange={(event) => setGovernanceDocumentId(event.target.value)}><option value="">Wybierz dokument</option>{operations.documents.map((document) => <option key={text(document, "id")} value={text(document, "id")}>{bool(document, "legal_hold") ? "🔒 " : ""}{text(document, "name")}</option>)}</select></label>
              <label><span>Polityka retencji</span><select name="retentionPolicyId" defaultValue=""><option value="">Bez polityki automatycznej</option>{operations.retentionPolicies.map((policy) => <option key={text(policy, "id")} value={text(policy, "id")}>{text(policy, "name")} ({number(policy, "retention_months")} mies.)</option>)}</select></label>
              <label><span>Przechowuj co najmniej do</span><input name="retentionUntil" type="date" /></label>
              <label className="document-control__checkbox"><input name="legalHold" type="checkbox" /><span>Legal hold — zablokuj usunięcie</span></label>
              <label><span>Uzasadnienie</span><input name="note" type="text" placeholder="np. spór, audyt, obowiązek kontraktowy" /></label>
              <small>Domyślne polityki są szkicami organizacyjnymi i wymagają zatwierdzenia podstawy prawnej przez firmę.</small>
              <button className="secondary-button" type="submit" disabled={Boolean(busyAction) || !governanceDocumentId}>{busyAction === "governance:save" ? <LoaderCircle className="spin" size={15} /> : <Archive size={15} />}Zapisz ochronę</button>
            </form> : null}

            {canApprove ? <form className="document-control__form document-control__room-form" onSubmit={createDataRoom}>
              <h3>Nowa paczka przekazania</h3>
              <label><span>Nazwa</span><input required name="name" type="text" placeholder="Dokumentacja odbiorowa · etap 1" /></label>
              <label><span>Cel</span><input name="purpose" type="text" placeholder="Odbiór, audyt, przekazanie inwestorowi" /></label>
              <label><span>Wygaśnięcie dostępu</span><input name="expiresAt" type="datetime-local" /></label>
              <fieldset><legend>Dokumenty zatwierdzone</legend>{approvedDocuments.map((document) => <label className="document-control__checkbox" key={text(document, "id")}><input type="checkbox" checked={selectedRoomDocuments.includes(text(document, "id"))} onChange={() => toggleRoomDocument(text(document, "id"))} /><span>{text(document, "name")}</span></label>)}{!approvedDocuments.length ? <small>Najpierw zatwierdź co najmniej jeden dokument.</small> : null}</fieldset>
              <small>Brak zaznaczenia oznacza wszystkie zatwierdzone dokumenty inwestycji.</small>
              <button className="primary-button" type="submit" disabled={Boolean(busyAction) || !approvedDocuments.length}>{busyAction === "data-room:create" ? <LoaderCircle className="spin" size={15} /> : <FolderLock size={15} />}Utwórz data room</button>
            </form> : null}

            <div className="document-control__list document-control__room-list">
              {operations.dataRooms.map((room) => {
                const roomId = text(room, "id");
                const status = text(room, "status");
                return <article className="document-control__room" key={roomId}><FolderLock size={18} /><div><strong>{text(room, "name")}</strong><small>{nestedRows(room, "data_room_documents").length} dokumentów · utworzono {formatDate(room.created_at)}{room.expires_at ? ` · ważny do ${formatDate(room.expires_at, true)}` : ""}</small></div><span className={statusClass(status)}>{statusLabel(status)}</span><div className="document-control__room-actions">{status === "published" || canApprove ? <a className="secondary-button" href={`/api/data-rooms/${roomId}/manifest`}>Pobierz indeks</a> : null}{canApprove && status !== "published" && status !== "revoked" ? <button className="approve-button" type="button" disabled={Boolean(busyAction)} onClick={() => changeDataRoomStatus(roomId, "publish_data_room")}>Publikuj</button> : null}{canApprove && status !== "revoked" ? <button className="reject-button" type="button" disabled={Boolean(busyAction)} onClick={() => changeDataRoomStatus(roomId, "revoke_data_room")}>Wycofaj</button> : null}</div></article>;
              })}
              {!operations.dataRooms.length ? <p className="document-control__empty">Nie utworzono jeszcze paczki przekazania.</p> : null}
            </div>
          </div>
        </details>
      </div>
    </section>
  );
}
