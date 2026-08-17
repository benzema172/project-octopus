"use client";

import type { FormEvent } from "react";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BellRing, CheckCircle2, LoaderCircle, Pause, Play, PlugZap, RefreshCw, Trash2 } from "lucide-react";

type Integration = {
  id: string;
  integrationType: string;
  displayName: string;
  status: string;
  scope: string;
  lastSyncAt: string | null;
};

type Rule = {
  id: string;
  projectId: string | null;
  eventType: string;
  leadTimeDays: number;
  active: boolean;
};

type Notification = {
  id: string;
  eventType: string;
  title: string;
  body: string | null;
  severity: string;
  readAt: string | null;
  createdAt: string;
};

type Project = { id: string; name: string };

type Props = {
  workspaceId: string;
  integrations: Integration[];
  rules: Rule[];
  notifications: Notification[];
  projects: Project[];
  canWrite: boolean;
};

const EVENT_LABELS: Record<string, string> = {
  qualification_expiry: "Kończące się uprawnienia pracowników",
  medical_exam_expiry: "Kończące się badania medyczne",
  vehicle_document_expiry: "Kończące się dokumenty floty",
  commitment_due: "Zbliżające się zobowiązania finansowe",
  ai_review_required: "Decyzje i błędy w Skrzynce AI"
};

const STATUS_LABELS: Record<string, string> = {
  not_configured: "Nie skonfigurowano",
  configured: "Skonfigurowano",
  active: "Aktywna",
  paused: "Wstrzymana",
  error: "Błąd"
};

export function SettingsAutomationConsole({ workspaceId, integrations, rules, notifications, projects, canWrite }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function run(action: string, payload: Record<string, unknown>, success: string) {
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/settings/automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, action, payload })
      });
      const result = await response.json().catch(() => ({})) as { error?: string; created?: number };
      if (!response.ok) {
        setMessage(result.error ?? "Nie udało się wykonać operacji.");
        return;
      }
      setMessage(action === "run_alert_scan" ? `Kontrola zakończona. Utworzono ${result.created ?? 0} nowych alertów.` : success);
      router.refresh();
    });
  }

  function submitIntegration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run("integration_upsert", Object.fromEntries(form.entries()), "Integracja została zapisana w rejestrze konfiguracji.");
  }

  function submitRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    run("rule_create", Object.fromEntries(form.entries()), "Reguła alertu została dodana.");
  }

  return (
    <div className="settings-automation-console">
      {message ? <p className="action-message">{message}</p> : null}

      <div className="control-dashboard-grid">
        <article className="module-panel">
          <div className="module-panel__heading"><PlugZap size={20} /><div><p className="eyebrow">Rejestr integracji</p><h2>Dodaj lub zaktualizuj połączenie</h2></div></div>
          <p>To jest bezpieczny rejestr stanu i zakresu integracji. Klucze API i tokeny nie są zapisywane w tabelach biznesowych.</p>
          <form className="template-generator" onSubmit={submitIntegration}>
            <div className="form-row">
              <label>Typ integracji
                <select name="integrationType" defaultValue="ksef" disabled={!canWrite}>
                  <option value="ksef">KSeF</option>
                  <option value="cloudflare_r2">Cloudflare R2</option>
                  <option value="gemini">Gemini / OctopusAI</option>
                  <option value="supabase">Supabase</option>
                  <option value="google_drive">Google Drive</option>
                  <option value="microsoft_365">Microsoft 365</option>
                  <option value="webhook">Webhook / API</option>
                </select>
              </label>
              <label>Nazwa połączenia<input name="displayName" placeholder="np. KSeF produkcja" required disabled={!canWrite} /></label>
            </div>
            <div className="form-row">
              <label>Status
                <select name="status" defaultValue="configured" disabled={!canWrite}>
                  <option value="configured">Skonfigurowano</option>
                  <option value="active">Aktywna</option>
                  <option value="paused">Wstrzymana</option>
                  <option value="not_configured">Nie skonfigurowano</option>
                </select>
              </label>
              <label>Zakres<input name="scope" defaultValue="company" placeholder="company / inbound / reports" disabled={!canWrite} /></label>
            </div>
            <button className="primary-button" type="submit" disabled={pending || !canWrite}>{pending ? <LoaderCircle className="spin" size={16} /> : <PlugZap size={16} />}Zapisz integrację</button>
          </form>
        </article>

        <article className="module-panel">
          <div className="module-panel__heading"><BellRing size={20} /><div><p className="eyebrow">Automatyczne kontrole</p><h2>Dodaj regułę alertu</h2></div></div>
          <p>Reguła określa, czego system ma szukać i z jakim wyprzedzeniem. Przycisk kontroli poniżej uruchamia realny skan danych firmy.</p>
          <form className="template-generator" onSubmit={submitRule}>
            <label>Zdarzenie
              <select name="eventType" defaultValue="qualification_expiry" disabled={!canWrite}>
                {Object.entries(EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <div className="form-row">
              <label>Wyprzedzenie
                <select name="leadTimeDays" defaultValue="14" disabled={!canWrite}>
                  <option value="0">Dzisiaj</option><option value="3">3 dni</option><option value="7">7 dni</option><option value="14">14 dni</option><option value="30">30 dni</option><option value="60">60 dni</option><option value="90">90 dni</option>
                </select>
              </label>
              <label>Zakres inwestycji
                <select name="projectId" defaultValue="" disabled={!canWrite}>
                  <option value="">Cała firma</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
            </div>
            <button className="primary-button" type="submit" disabled={pending || !canWrite}>{pending ? <LoaderCircle className="spin" size={16} /> : <BellRing size={16} />}Dodaj regułę</button>
          </form>
        </article>
      </div>

      <section className="co-section">
        <div className="co-section-heading">
          <div><p className="co-kicker">Aktywne konfiguracje</p><h2>Integracje i reguły</h2></div>
          <button className="secondary-button" type="button" onClick={() => run("run_alert_scan", {}, "Kontrola wykonana.")} disabled={pending || !canWrite}><RefreshCw size={15} /> Uruchom kontrolę alertów teraz</button>
        </div>

        <div className="control-dashboard-grid">
          <article className="module-panel">
            <h3>Integracje</h3>
            <div className="ops-simple-list">
              {integrations.map((integration) => (
                <div key={integration.id}>
                  <span>{integration.integrationType}</span>
                  <strong>{integration.displayName}</strong>
                  <div className="ops-list-row__detail">
                    <span className={`status-chip ${integration.status === "active" ? "status-chip--positive" : integration.status === "error" ? "status-chip--warning" : ""}`}>{STATUS_LABELS[integration.status] ?? integration.status}</span>
                    <span>Zakres: {integration.scope || "company"}</span>
                    {integration.lastSyncAt ? <span>Sync: {new Date(integration.lastSyncAt).toLocaleString("pl-PL")}</span> : null}
                    {canWrite ? <span className="ops-inline-actions">
                      <button type="button" className="secondary-button" onClick={() => run("integration_status", { id: integration.id, status: integration.status === "active" ? "paused" : "active" }, "Status integracji został zmieniony.")} disabled={pending}>{integration.status === "active" ? <Pause size={14} /> : <Play size={14} />}{integration.status === "active" ? "Wstrzymaj" : "Aktywuj"}</button>
                      <button type="button" className="secondary-button secondary-button--danger" onClick={() => run("integration_delete", { id: integration.id }, "Integracja została usunięta z rejestru.")} disabled={pending}><Trash2 size={14} />Usuń</button>
                    </span> : null}
                  </div>
                </div>
              ))}
              {!integrations.length ? <p className="ops-simple-list__empty">Brak zapisanych integracji firmowych.</p> : null}
            </div>
          </article>

          <article className="module-panel">
            <h3>Reguły alertów</h3>
            <div className="ops-simple-list">
              {rules.map((rule) => (
                <div key={rule.id}>
                  <span>{rule.active ? "Aktywna" : "Wstrzymana"}</span>
                  <strong>{EVENT_LABELS[rule.eventType] ?? rule.eventType}</strong>
                  <div className="ops-list-row__detail">
                    <span>Wyprzedzenie: {rule.leadTimeDays} dni</span>
                    <span>{rule.projectId ? projects.find((project) => project.id === rule.projectId)?.name ?? "Wybrana inwestycja" : "Cała firma"}</span>
                    {canWrite ? <span className="ops-inline-actions">
                      <button type="button" className="secondary-button" onClick={() => run("rule_toggle", { id: rule.id, active: !rule.active }, rule.active ? "Reguła została wstrzymana." : "Reguła została aktywowana.")} disabled={pending}>{rule.active ? <Pause size={14} /> : <Play size={14} />}{rule.active ? "Wstrzymaj" : "Włącz"}</button>
                      <button type="button" className="secondary-button secondary-button--danger" onClick={() => run("rule_delete", { id: rule.id }, "Reguła została usunięta.")} disabled={pending}><Trash2 size={14} />Usuń</button>
                    </span> : null}
                  </div>
                </div>
              ))}
              {!rules.length ? <p className="ops-simple-list__empty">Brak reguł. Dodaj pierwszą kontrolę terminu lub wyjątku.</p> : null}
            </div>
          </article>
        </div>
      </section>

      <section className="co-section">
        <div className="co-section-heading"><div><p className="co-kicker">Historia alertów</p><h2>Ostatnie wykryte wyjątki</h2></div><strong>{notifications.filter((item) => !item.readAt).length} nieprzeczytanych</strong></div>
        <div className="ops-simple-list">
          {notifications.map((notification) => (
            <div key={notification.id}>
              <span>{new Date(notification.createdAt).toLocaleString("pl-PL")}</span>
              <strong>{notification.title}</strong>
              <div className="ops-list-row__detail">
                {notification.severity === "error" ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                <span>{notification.body ?? EVENT_LABELS[notification.eventType] ?? notification.eventType}</span>
                <span className={`status-chip ${notification.readAt ? "" : "status-chip--warning"}`}>{notification.readAt ? "Odczytany" : "Nowy"}</span>
                {!notification.readAt && canWrite ? <button type="button" className="secondary-button" onClick={() => run("notification_read", { id: notification.id }, "Alert oznaczono jako odczytany.")} disabled={pending}>Oznacz jako odczytany</button> : null}
              </div>
            </div>
          ))}
          {!notifications.length ? <p className="ops-simple-list__empty">Nie ma jeszcze alertów. Dodaj regułę i uruchom kontrolę.</p> : null}
        </div>
      </section>
    </div>
  );
}
