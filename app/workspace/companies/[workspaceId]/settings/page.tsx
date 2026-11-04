import { AlertTriangle, CheckCircle2, Database, PlugZap, ShieldCheck, UsersRound } from "lucide-react";
import { notFound } from "next/navigation";
import { updateCompanyAction } from "@/app/actions";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { MultiAiProviderSettings } from "@/components/settings/multi-ai-provider-settings";
import { RoleGrantForm } from "@/components/settings/role-grant-form";
import { SettingsAutomationConsole } from "@/components/settings/settings-automation-console";
import { getMultiAiProviderStatus } from "@/lib/ai/provider-vault";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { isExecutionLayerSchemaReady } from "@/lib/data/operations";
import { getWorkspaceForUser, isCompanyProfileSchemaReady } from "@/lib/data/workspace";
import { getAiRuntimeStatus, getOptionalEnv, getPublicSupabaseConfig } from "@/lib/env";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ workspaceId: string }>;
  searchParams: Promise<{ saved?: string }>;
};

type MemberRow = { user_id: string; role: string };
type ProjectRow = { id: string; name: string };
type GrantRow = { id: string; user_id: string; domain: string; access_level: string; project_id: string | null; valid_from: string; valid_until: string | null };
type IntegrationRow = { id: string; integration_type: string; display_name: string; status: string; configuration: unknown; last_sync_at: string | null };
type RuleRow = { id: string; project_id: string | null; event_type: string; lead_time_days: number; active: boolean };
type NotificationRow = { id: string; event_type: string; title: string; body: string | null; severity: string; read_at: string | null; created_at: string };
type KsefRow = { status: string; environment: string; inbound_enabled: boolean; sales_enabled: boolean; last_successful_sync_at: string | null };

function configurationScope(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "company";
  const scope = (value as Record<string, unknown>).scope;
  return typeof scope === "string" ? scope : "company";
}

export default async function CompanySettingsPage({ params, searchParams }: Props) {
  const { workspaceId } = await params;
  const query = await searchParams;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();

  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "settings", level: "read" })) {
    return <DomainAccessDenied workspaceId={workspace.id} area="Ustawienia" />;
  }

  const db = createServiceSupabaseClient();
  const [schemaReady, executionReady, canWrite, canAdminAi, membersResult, projectsResult, grantsResult, integrationsResult, rulesResult, notificationsResult, ksefResult, multiAiStatus] = await Promise.all([
    isCompanyProfileSchemaReady().catch(() => false),
    isExecutionLayerSchemaReady().catch(() => false),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "settings", level: "write" }),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "settings", level: "admin" }),
    db.from("workspace_members").select("user_id,role").eq("workspace_id", workspace.id),
    db.from("projects").select("id,name").eq("workspace_id", workspace.id).order("name"),
    db.from("domain_role_grants").select("id,user_id,domain,access_level,project_id,valid_from,valid_until").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(200),
    db.from("integration_connections").select("id,integration_type,display_name,status,configuration,last_sync_at").eq("workspace_id", workspace.id).order("updated_at", { ascending: false }).limit(100),
    db.from("notification_rules").select("id,project_id,event_type,lead_time_days,active").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(100),
    db.from("notifications").select("id,event_type,title,body,severity,read_at,created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(100),
    db.from("ksef_connections").select("status,environment,inbound_enabled,sales_enabled,last_successful_sync_at").eq("workspace_id", workspace.id).maybeSingle<KsefRow>(),
    getMultiAiProviderStatus(workspace.id)
  ]);

  const members = (membersResult.data ?? []) as MemberRow[];
  const projects = (projectsResult.data ?? []) as ProjectRow[];
  const grants = (grantsResult.data ?? []) as GrantRow[];
  const integrations = (integrationsResult.data ?? []) as IntegrationRow[];
  const rules = (rulesResult.data ?? []) as RuleRow[];
  const notifications = (notificationsResult.data ?? []) as NotificationRow[];
  const ksef = ksefResult.data;
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const ai = getAiRuntimeStatus();
  const supabaseReady = Boolean(getPublicSupabaseConfig());
  const r2Ready = ["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].every((name) => Boolean(getOptionalEnv(name))) && Boolean(getOptionalEnv("R2_ENDPOINT") || getOptionalEnv("R2_ACCOUNT_ID"));
  const activeRules = rules.filter((rule) => rule.active).length;
  const unreadNotifications = notifications.filter((item) => !item.read_at).length;
  const activeIntegrations = integrations.filter((item) => item.status === "active").length;
  const updateAction = updateCompanyAction.bind(null, workspace.id);

  return (
    <main className="co-page co-settings-compact">
      <header className="co-page-heading co-page-heading--compact">
        <div>
          <p className="co-kicker">Ustawienia</p>
          <h1>Ustawienia firmy</h1>
        </div>
        {query.saved === "1" ? <span className="co-saved-badge"><CheckCircle2 size={16} /> Zapisano</span> : null}
      </header>

      {!schemaReady ? <div className="co-schema-warning"><AlertTriangle size={16} /> Profil firmy wymaga zastosowania najnowszej migracji Supabase. Strona pozostaje dostępna, ale zapis danych profilu jest zablokowany.</div> : null}
      {!executionReady ? <div className="co-schema-warning"><AlertTriangle size={16} /> Warstwa bezpieczeństwa i automatyzacji nie jest jeszcze kompletna w bazie. Role podstawowe są widoczne, ale integracje i alerty pozostają tylko do odczytu.</div> : null}

      <div className="co-settings-compact__overview" aria-label="Podsumowanie ustawień">
        <span><UsersRound size={14}/>{members.length} użytkowników</span>
        <span><ShieldCheck size={14}/>{grants.length} ról</span>
        <span><PlugZap size={14}/>{activeIntegrations} integracji</span>
        <span><AlertTriangle size={14}/>{unreadNotifications} alertów</span>
        {!executionReady || !schemaReady ? <strong>Wymagana konfiguracja</strong> : null}
      </div>
      <div className="co-settings-compact__sections">
      <details className="co-settings-compact__group" id="company-profile">
        <summary><span><strong>Profil firmy</strong><small>{workspace.name}{workspace.city ? " · " + workspace.city : ""}</small></span><span className="co-settings-compact__indicator">Edytuj</span></summary>
        <div className="co-settings-compact__content">
        <form action={updateAction} className="co-settings-form">
          <label className="co-field co-field--wide"><span>Nazwa firmy *</span><input name="name" defaultValue={workspace.name} required minLength={2} /></label>
          <label className="co-field"><span>NIP</span><input name="tax_id" defaultValue={workspace.tax_id ?? ""} /></label>
          <label className="co-field"><span>REGON</span><input name="regon" defaultValue={workspace.regon ?? ""} /></label>
          <label className="co-field co-field--wide"><span>Branża</span><input name="industry" defaultValue={workspace.industry ?? ""} /></label>
          <label className="co-field co-field--wide"><span>Ulica i numer</span><input name="street" defaultValue={workspace.street ?? ""} /></label>
          <label className="co-field"><span>Kod pocztowy</span><input name="postal_code" defaultValue={workspace.postal_code ?? ""} /></label>
          <label className="co-field"><span>Miasto</span><input name="city" defaultValue={workspace.city ?? ""} /></label>
          <label className="co-field"><span>E-mail</span><input name="email" type="email" defaultValue={workspace.email ?? ""} /></label>
          <label className="co-field"><span>Telefon</span><input name="phone" type="tel" defaultValue={workspace.phone ?? ""} /></label>
          <label className="co-field co-field--wide"><span>Osoba kontaktowa</span><input name="contact_person" defaultValue={workspace.contact_person ?? ""} /></label>
          <label className="co-field co-field--wide"><span>Notatka</span><textarea name="notes" rows={2} defaultValue={workspace.notes ?? ""} /></label>
          <div className="co-settings-form__actions"><button className="co-primary-button" type="submit" disabled={!schemaReady || !canWrite}>Zapisz dane firmy</button></div>
        </form>
        </div>
      </details>

      <details className="co-settings-compact__group" id="settings-ai">
        <summary><span><strong>Dostawcy AI</strong><small>Gemini · Groq {multiAiStatus.groq.configured ? "aktywny" : "niepodłączony"} · Cloudflare {multiAiStatus.cloudflare.configured ? "aktywny" : "niepodłączony"}</small></span><span className="co-settings-compact__indicator">Konfiguruj</span></summary>
        <div className="co-settings-compact__content">
          <MultiAiProviderSettings workspaceId={workspace.id} canWrite={canAdminAi} initialStatus={multiAiStatus} />
        </div>
      </details>

      <details id="security-automation" className="co-settings-compact__group">
        <summary><span><strong>Użytkownicy i uprawnienia</strong><small>{members.length} użytkowników · {grants.length} dodatkowych ról</small></span><span className="co-settings-compact__indicator">Zarządzaj</span></summary>
        <div className="co-settings-compact__content">
        <div className="control-dashboard-grid">
          <article className="module-panel role-grant-panel">
            <div className="module-panel__heading"><ShieldCheck size={19} /><div><p className="eyebrow">Zasada najmniejszych uprawnień</p><h2>Nadaj rolę domenową</h2></div></div>
            <RoleGrantForm workspaceId={workspace.id} members={members.map((member) => ({ userId: member.user_id, role: member.role }))} projects={projects} />
          </article>

          <article className="module-panel">
            <div className="module-panel__heading"><ShieldCheck size={19} /><div><p className="eyebrow">Aktualne uprawnienia</p><h2>Rejestr nadanych ról</h2></div></div>
            <div className="ops-simple-list">
              {grants.slice(0, 30).map((grant) => (
                <div key={grant.id}>
                  <span>{grant.user_id.slice(0, 8)}…</span>
                  <strong>{grant.domain} · {grant.access_level}</strong>
                  <div className="ops-list-row__detail"><span>{grant.project_id ? projectNames.get(grant.project_id) ?? "Wybrana inwestycja" : "Cała firma"}</span><span>{grant.valid_until ? `do ${new Date(grant.valid_until).toLocaleDateString("pl-PL")}` : "bez terminu końcowego"}</span></div>
                </div>
              ))}
              {!grants.length ? <p className="ops-simple-list__empty">Brak dodatkowych ról domenowych. Właściciel i administrator mają uprawnienia nadrzędne.</p> : null}
            </div>
          </article>
        </div>

        </div>
      </details>

      <details className="co-settings-compact__group" id="settings-infrastructure">
        <summary><span><strong>Infrastruktura</strong><small>Supabase · R2 · Gemini · KSeF</small></span><span className="co-settings-compact__indicator">Stan usług</span></summary>
        <div className="co-settings-compact__content">
        <section className="co-section">
          <div className="live-domain-grid">
            <article><Database size={18} /><span>Supabase</span><strong>{supabaseReady ? "Gotowy" : "Brak"}</strong><small>publiczny URL i klucz aplikacji</small></article>
            <article><Database size={18} /><span>Cloudflare R2</span><strong>{r2Ready ? "Gotowy" : "Brak"}</strong><small>bucket, endpoint i poświadczenia serwerowe</small></article>
            <article><PlugZap size={18} /><span>OctopusAI / Gemini</span><strong>{ai.ready ? "Gotowy" : "Brak"}</strong><small>{ai.provider} · {ai.model}</small></article>
            <article><PlugZap size={18} /><span>KSeF</span><strong>{ksef?.status ?? "Nie skonfigurowano"}</strong><small>{ksef ? `${ksef.environment} · zakup ${ksef.inbound_enabled ? "on" : "off"} · sprzedaż ${ksef.sales_enabled ? "on" : "off"}` : "brak połączenia firmy"}</small></article>
          </div>
        </section>
        </div>
      </details>

      <details className="co-settings-compact__group" id="settings-automation">
        <summary><span><strong>Automatyzacja i alerty</strong><small>{activeRules} aktywnych reguł · {unreadNotifications} nieodczytanych</small></span><span className="co-settings-compact__indicator">Zarządzaj</span></summary>
        <div className="co-settings-compact__content">
        <SettingsAutomationConsole
          workspaceId={workspace.id}
          integrations={integrations.map((item) => ({ id: item.id, integrationType: item.integration_type, displayName: item.display_name, status: item.status, scope: configurationScope(item.configuration), lastSyncAt: item.last_sync_at }))}
          rules={rules.map((item) => ({ id: item.id, projectId: item.project_id, eventType: item.event_type, leadTimeDays: Number(item.lead_time_days ?? 0), active: Boolean(item.active) }))}
          notifications={notifications.map((item) => ({ id: item.id, eventType: item.event_type, title: item.title, body: item.body, severity: item.severity, readAt: item.read_at, createdAt: item.created_at }))}
          projects={projects}
          canWrite={canWrite && executionReady}
        />
        </div>
      </details>
      </div>
    </main>
  );
}
