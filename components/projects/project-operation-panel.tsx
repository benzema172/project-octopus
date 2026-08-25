import { notFound } from "next/navigation";
import { ProjectOperationForm, type ProjectOperationMode, type ProjectOperationOption } from "@/components/projects/project-operation-form";
import { ExecutionLayerNotice } from "@/components/system/execution-layer-notice";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess, type Domain } from "@/lib/authorization";
import { isExecutionLayerSchemaReady } from "@/lib/data/operations";
import { getProjectForUser } from "@/lib/data/projects";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

const content: Record<ProjectOperationMode, { title: string; description: string; domain: Domain }> = {
  requirement: { title: "Dodaj wymaganie materiałowe", description: "Utwórz konkretny rekord, który będzie śledzony w matrycy wniosków.", domain: "investments" },
  protocol: { title: "Dodaj wymagany protokół", description: "Zapisz rodzaj próby lub odbioru wymagany dla inwestycji.", domain: "investments" },
  schedule: { title: "Dodaj zadanie harmonogramu", description: "Wprowadź zadanie, planowane daty i oznaczenie ścieżki krytycznej.", domain: "investments" },
  progress_period: { title: "Otwórz okres przerobowy", description: "Utwórz rozliczany okres, do którego trafią wykonane i odebrane ilości.", domain: "investments" },
  progress_entry: { title: "Zarejestruj wykonanie pozycji BOQ", description: "Wartość wykonana i odebrana zostanie wyliczona z ceny jednostkowej kosztorysu.", domain: "investments" },
  assignment: { title: "Przypisz osobę do inwestycji", description: "Zbuduj rzeczywisty zespół z rolą, terminem i procentem zaangażowania.", domain: "hr" },
  budget: { title: "Utwórz wersję budżetu", description: "Zapisz planowany przychód i koszt, które zasilą forecast inwestycji.", domain: "finance" },
  reservation: { title: "Zarezerwuj materiał", description: "Powiąż kartotekę i magazyn z terminem zapotrzebowania inwestycji.", domain: "warehouse" },
  change_order: { title: "Zarejestruj zmianę kontraktową", description: "Śledź wpływ zmiany na wartość i termin realizacji.", domain: "finance" }
};

export async function ProjectOperationPanel({ projectId, mode }: { projectId: string; mode: ProjectOperationMode }) {
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await isExecutionLayerSchemaReady()) return <ExecutionLayerNotice />;
  const canWrite = await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: content[mode].domain, level: "write", projectId });
  const supabase = createServiceSupabaseClient();
  let primaryOptions: ProjectOperationOption[] = [];
  let secondaryOptions: ProjectOperationOption[] = [];

  if (mode === "assignment") {
    const { data } = await supabase.from("employees").select("id,first_name,last_name,employee_number").eq("workspace_id", project.workspace_id).eq("status", "active").order("last_name");
    primaryOptions = (data ?? []).map((row) => ({ value: String(row.id), label: `${row.first_name} ${row.last_name}${row.employee_number ? ` · ${row.employee_number}` : ""}` }));
  }
  if (mode === "progress_entry") {
    const [{ data: periods }, { data: items }] = await Promise.all([
      supabase.from("progress_periods").select("id,period_start,period_end,status").eq("project_id", projectId).in("status", ["open", "submitted"]).order("period_start", { ascending: false }),
      supabase.from("boq_items").select("id,item_number,description,unit,quantity,quantity_executed").eq("project_id", projectId).eq("is_active", true).order("item_number").limit(500)
    ]);
    primaryOptions = (periods ?? []).map((row) => ({ value: String(row.id), label: `${row.period_start}–${row.period_end} · ${row.status}` }));
    secondaryOptions = (items ?? []).map((row) => ({ value: String(row.id), label: `${row.item_number ?? "BOQ"} · ${row.description} · ${Number(row.quantity_executed ?? 0)}/${Number(row.quantity ?? 0)} ${row.unit ?? ""}` }));
  }
  if (mode === "reservation") {
    const [{ data: warehouses }, { data: items }] = await Promise.all([
      supabase.from("warehouses").select("id,name,location").eq("workspace_id", project.workspace_id).eq("active", true).order("name"),
      supabase.from("stock_items").select("id,name,sku,unit").eq("workspace_id", project.workspace_id).eq("active", true).order("name").limit(500)
    ]);
    primaryOptions = (warehouses ?? []).map((row) => ({ value: String(row.id), label: `${row.name}${row.location ? ` · ${row.location}` : ""}` }));
    secondaryOptions = (items ?? []).map((row) => ({ value: String(row.id), label: `${row.sku ?? "—"} · ${row.name} · ${row.unit}` }));
  }

  return <ProjectOperationForm projectId={projectId} mode={mode} title={content[mode].title} description={content[mode].description} canWrite={canWrite} primaryOptions={primaryOptions} secondaryOptions={secondaryOptions} />;
}
