import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Database, PlugZap, ShieldCheck } from "lucide-react";
import { requireCurrentUser } from "@/lib/auth";
import { RoleGrantForm } from "@/components/settings/role-grant-form";
import { ensureWorkspaceForUser, getWorkspaceForUser } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";
import { isExecutionLayerSchemaReady } from "@/lib/data/operations";
import { ExecutionLayerNotice } from "@/components/system/execution-layer-notice";

type Kind = "finance" | "hr" | "warehouse" | "fleet" | "reports" | "settings";

async function countWorkspace(table: string, workspaceId: string, status?: string) {
  const supabase = createServiceSupabaseClient();
  let query = supabase.from(table).select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if (status) query = query.eq("status", status);
  const result = await query;
  return result.count ?? 0;
}

export async function DomainLivePanel({ kind, workspaceId }: { kind: Kind; workspaceId?: string }) {
  const user = await requireCurrentUser();
  const workspace = workspaceId ? await getWorkspaceForUser(user, workspaceId) : await ensureWorkspaceForUser(user);
  if (!workspace) return null;
  if (!await isExecutionLayerSchemaReady()) return <ExecutionLayerNotice />;
  const supabase = createServiceSupabaseClient();
  const today = new Date();
  const in30Days = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const todayIso = today.toISOString().slice(0, 10);

  if (kind === "finance") {
    const [invoices, newKsef, openCommitments, connectionResult] = await Promise.all([
      countWorkspace("invoices", workspace.id), countWorkspace("ksef_inbox_items", workspace.id, "new"),
      countWorkspace("commitments", workspace.id, "open"), supabase.from("ksef_connections").select("status,environment,last_successful_sync_at,inbound_enabled,sales_enabled").eq("workspace_id", workspace.id).maybeSingle()
    ]);
    const connection = connectionResult.data;
    return <section className="section-band"><div className="section-heading"><div><p className="eyebrow">Centrum finansowe na żywo</p><h2>KSeF, dekretacja i płynność</h2></div><span className={`status-chip ${connection?.status === "active" ? "status-chip--positive" : "status-chip--warning"}`}>{connection?.status ?? "Nie skonfigurowano"}</span></div><div className="live-domain-grid"><article><Database size={18} /><span>Faktury w rejestrze</span><strong>{invoices}</strong><small>Zakupowe i sprzedażowe</small></article><article><PlugZap size={18} /><span>Nowe z KSeF</span><strong>{newKsef}</strong><small>Najpierw bezpieczny inbound zakupów</small></article><article><AlertTriangle size={18} /><span>Otwarte zobowiązania</span><strong>{openCommitments}</strong><small>Zasilają forecast cash flow</small></article><article><CheckCircle2 size={18} /><span>Ostatnia synchronizacja</span><strong>{connection?.last_successful_sync_at ? new Date(connection.last_successful_sync_at).toLocaleDateString("pl-PL") : "—"}</strong><small>{connection?.environment ?? "test"} · sprzedaż {connection?.sales_enabled ? "włączona" : "wyłączona"}</small></article></div><p className="section-lead">Token lub certyfikat KSeF nie jest przechowywany w tabelach biznesowych. Po konfiguracji serwerowej faktury trafiają najpierw do kwarantanny, kontroli duplikatów i dekretacji na inwestycję/WBS.</p></section>;
  }

  if (kind === "hr") {
    const [employees, leave, examsResult, qualificationsResult] = await Promise.all([
      countWorkspace("employees", workspace.id, "active"), countWorkspace("leave_requests", workspace.id, "pending"),
      supabase.from("medical_exams").select("id,exam_type,valid_until,employees(first_name,last_name)").eq("workspace_id", workspace.id).gte("valid_until", todayIso).lte("valid_until", in30Days).order("valid_until").limit(10),
      supabase.from("qualifications").select("id,qualification_type,valid_until,employees(first_name,last_name)").eq("workspace_id", workspace.id).gte("valid_until", todayIso).lte("valid_until", in30Days).order("valid_until").limit(10)
    ]);
    return <section className="section-band"><div className="section-heading"><div><p className="eyebrow">Kontrola HR</p><h2>Terminy, urlopy i gotowość zespołu</h2></div><span>{employees} pracowników</span></div><div className="control-dashboard-grid"><article className="module-panel"><h3>Decyzje urlopowe</h3><strong className="large-value">{leave}</strong><p>Wnioski oczekujące na akceptację i aktualizację limitu.</p></article><article className="module-panel"><h3>Badania do 30 dni</h3><strong className="large-value">{examsResult.data?.length ?? 0}</strong><p>Lista terminów medycznych bez ujawniania danych płacowych.</p></article><article className="module-panel"><h3>Uprawnienia do 30 dni</h3><strong className="large-value">{qualificationsResult.data?.length ?? 0}</strong><p>SEP, UDT, F-gazy, BHP i inne kwalifikacje.</p></article><article className="module-panel"><h3>Separacja dostępu</h3><ShieldCheck size={24} /><p>Role HR i Finanse są niezależne od technicznego dostępu do inwestycji.</p></article></div></section>;
  }

  if (kind === "warehouse") {
    const [items, movements, reservations, tools] = await Promise.all([
      countWorkspace("stock_items", workspace.id), countWorkspace("stock_movements", workspace.id, "draft"),
      countWorkspace("reservations", workspace.id, "open"), countWorkspace("tool_service_events", workspace.id)
    ]);
    return <section className="section-band"><div className="section-heading"><div><p className="eyebrow">Łańcuch materiału</p><h2>Od faktury i PZ do zużycia na WBS</h2></div></div><div className="live-domain-grid"><article><Database size={18} /><span>Kartoteki</span><strong>{items}</strong><small>Materiały, urządzenia i narzędzia</small></article><article><AlertTriangle size={18} /><span>Ruchy robocze</span><strong>{movements}</strong><small>Nie zmieniają stanu przed zatwierdzeniem</small></article><article><CheckCircle2 size={18} /><span>Rezerwacje</span><strong>{reservations}</strong><small>Powiązane z inwestycją i BOQ</small></article><article><PlugZap size={18} /><span>Zdarzenia serwisowe</span><strong>{tools}</strong><small>Przeglądy, legalizacje i kalibracje</small></article></div></section>;
  }

  if (kind === "fleet") {
    const [vehicles, service, damages, documentsResult] = await Promise.all([
      countWorkspace("vehicles", workspace.id, "active"), countWorkspace("service_orders", workspace.id, "open"),
      countWorkspace("damage_cases", workspace.id, "reported"),
      supabase.from("vehicle_documents").select("id,document_type,valid_until,vehicles(registration_number)").eq("workspace_id", workspace.id).gte("valid_until", todayIso).lte("valid_until", in30Days).order("valid_until").limit(20)
    ]);
    return <section className="section-band"><div className="section-heading"><div><p className="eyebrow">Kontrola floty</p><h2>Terminy, serwis, szkody i koszt inwestycji</h2></div></div><div className="live-domain-grid"><article><Database size={18} /><span>Pojazdy aktywne</span><strong>{vehicles}</strong><small>Samochody, ciężarówki i maszyny</small></article><article><AlertTriangle size={18} /><span>Otwarte serwisy</span><strong>{service}</strong><small>Koszt i przestój</small></article><article><AlertTriangle size={18} /><span>Szkody otwarte</span><strong>{damages}</strong><small>Dokumenty i odpowiedzialność</small></article><article><ShieldCheck size={18} /><span>Terminy do 30 dni</span><strong>{documentsResult.data?.length ?? 0}</strong><small>OC, badania, leasing i legalizacje</small></article></div></section>;
  }

  if (kind === "reports") {
    const [definitions, queued, snapshots, unread] = await Promise.all([
      countWorkspace("report_definitions", workspace.id), countWorkspace("report_runs", workspace.id, "queued"),
      countWorkspace("report_snapshots", workspace.id),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("workspace_id", workspace.id).is("read_at", null)
    ]);
    return <section className="section-band"><div className="section-heading"><div><p className="eyebrow">Raportowanie kontrolowane</p><h2>Definicja → snapshot → komentarz → dystrybucja</h2></div></div><div className="live-domain-grid"><article><Database size={18} /><span>Definicje</span><strong>{definitions}</strong><small>Stałe KPI i filtry</small></article><article><PlugZap size={18} /><span>W kolejce</span><strong>{queued}</strong><small>Raporty cykliczne</small></article><article><CheckCircle2 size={18} /><span>Zamknięte snapshoty</span><strong>{snapshots}</strong><small>Historia odporna na późniejsze korekty</small></article><article><AlertTriangle size={18} /><span>Nieprzeczytane alerty</span><strong>{unread.count ?? 0}</strong><small>Wyjątki z całej firmy</small></article></div></section>;
  }

  const [roles, integrations, rules, notifications, membersResult, projectsResult] = await Promise.all([
    countWorkspace("domain_role_grants", workspace.id), countWorkspace("integration_connections", workspace.id),
    countWorkspace("notification_rules", workspace.id), countWorkspace("notifications", workspace.id),
    supabase.from("workspace_members").select("user_id,role").eq("workspace_id", workspace.id),
    supabase.from("projects").select("id,name").eq("workspace_id", workspace.id).order("name")
  ]);
  return <section className="section-band"><div className="section-heading"><div><p className="eyebrow">Bezpieczeństwo i automatyzacja</p><h2>Role domenowe, integracje i powiadomienia</h2></div></div><div className="live-domain-grid"><article><ShieldCheck size={18} /><span>Nadane role</span><strong>{roles}</strong><small>HR, Finanse, Inwestycje, Magazyn, Flota</small></article><article><PlugZap size={18} /><span>Integracje</span><strong>{integrations}</strong><small>Tylko stan i konfiguracja bez sekretów</small></article><article><Database size={18} /><span>Reguły alertów</span><strong>{rules}</strong><small>Terminy, ryzyka i wyjątki</small></article><article><AlertTriangle size={18} /><span>Historia alertów</span><strong>{notifications}</strong><small>Ślad decyzji i odczytu</small></article></div><article className="module-panel role-grant-panel"><div className="module-panel__heading"><ShieldCheck size={19} /><div><p className="eyebrow">Zasada najmniejszych uprawnień</p><h2>Nadaj rolę domenową</h2></div></div><RoleGrantForm workspaceId={workspace.id} members={(membersResult.data ?? []).map((member) => ({ userId: String(member.user_id), role: String(member.role) }))} projects={(projectsResult.data ?? []).map((project) => ({ id: String(project.id), name: String(project.name) }))} /></article><Link href={`/workspace/companies/${workspace.id}/ai-inbox`} className="text-link">Przejdź do decyzji systemowych <ArrowRight size={15} /></Link></section>;
}
