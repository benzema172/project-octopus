import type { ComponentProps } from "react";
import { AlertTriangle } from "lucide-react";
import { InvestmentAutopilotCenter } from "@/components/projects/investment-autopilot-center";
import { ProjectCommandCenter } from "@/components/projects/project-command-center";
import { ProjectExecutionCenter } from "@/components/projects/project-execution-center";
import { ProjectReconciliationGraph } from "@/components/projects/project-reconciliation-graph";
import {
  getControlAutopilotSnapshot,
  getControlCommandCenterData,
  getControlExecutionSnapshot,
  getControlReconciliationData
} from "@/lib/data/control-snapshot";

type BaseProps = { workspaceId: string; projectId: string };
type AccessProps = BaseProps & {
  canManageInvestments: boolean;
  financeAllowed: boolean;
  canManageFinance: boolean;
  warehouseAllowed: boolean;
  canManageWarehouse: boolean;
};
type CommandCenterData = ComponentProps<typeof ProjectCommandCenter>["data"];
type ReconciliationData = ComponentProps<typeof ProjectReconciliationGraph>["data"];
type Loaded<T> = { data: T; error: null } | { data: null; error: unknown };

async function safeLoad<T>(loader: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { data: await loader(), error: null };
  } catch (error) {
    return { data: null, error };
  }
}

function PanelFailure({ title, error }: { title: string; error: unknown }) {
  const detail = error instanceof Error ? error.message : "Nieznany błąd modułu.";
  console.error(`Project Octopus: Control 360 panel failed: ${title}`, error);
  return (
    <section className="execution-layer-notice" role="status">
      <AlertTriangle size={22} aria-hidden="true" />
      <div>
        <strong>{title} jest chwilowo niedostępny</strong>
        <p>{detail} Pozostałe części Kontroli 360 działają niezależnie.</p>
      </div>
    </section>
  );
}

export async function CommandCenterPanel({ workspaceId, projectId, canManageInvestments }: BaseProps & { canManageInvestments: boolean }) {
  const result = await safeLoad(() => getControlCommandCenterData(workspaceId, projectId));
  if (result.error) return <PanelFailure title="Command Center" error={result.error} />;
  const data = result.data as CommandCenterData;
  return <ProjectCommandCenter projectId={projectId} data={data} canManage={canManageInvestments} />;
}

export async function AutopilotPanel({ workspaceId, projectId, canManageInvestments, financeAllowed, warehouseAllowed }: AccessProps) {
  const result = await safeLoad(() => getControlAutopilotSnapshot(workspaceId, projectId, { includeFinance: financeAllowed, includeWarehouse: warehouseAllowed }));
  if (result.error) return <PanelFailure title="Investment Autopilot" error={result.error} />;
  return <InvestmentAutopilotCenter projectId={projectId} workspaceId={workspaceId} snapshot={result.data} canRun={canManageInvestments} financeAllowed={financeAllowed} warehouseAllowed={warehouseAllowed} />;
}

export async function ReconciliationPanel({ workspaceId, projectId, canManageInvestments, financeAllowed, canManageFinance, warehouseAllowed, canManageWarehouse }: AccessProps) {
  if (!financeAllowed && !warehouseAllowed) return null;
  const result = await safeLoad(() => getControlReconciliationData(workspaceId, projectId));
  if (result.error) return <PanelFailure title="Reconciliation" error={result.error} />;
  const data = result.data as ReconciliationData;
  return <ProjectReconciliationGraph projectId={projectId} data={data} canManage={canManageInvestments && (canManageFinance || canManageWarehouse)} canOrder={canManageInvestments && canManageWarehouse} />;
}

export async function ExecutionPanel({ workspaceId, projectId, canManageInvestments, financeAllowed, canManageFinance, warehouseAllowed }: AccessProps) {
  const result = await safeLoad(() => getControlExecutionSnapshot(workspaceId, projectId));
  if (result.error) return <PanelFailure title="Execution Layer" error={result.error} />;
  return <ProjectExecutionCenter workspaceId={workspaceId} projectId={projectId} snapshot={result.data} financeAllowed={financeAllowed} canManageFinance={canManageFinance} warehouseAllowed={warehouseAllowed} canManageInvestments={canManageInvestments} />;
}
