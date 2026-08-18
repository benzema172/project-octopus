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
  try {
    const data = await getControlCommandCenterData(workspaceId, projectId) as CommandCenterData;
    return <ProjectCommandCenter projectId={projectId} data={data} canManage={canManageInvestments} />;
  } catch (error) {
    return <PanelFailure title="Command Center" error={error} />;
  }
}

export async function AutopilotPanel({ workspaceId, projectId, canManageInvestments, financeAllowed, warehouseAllowed }: AccessProps) {
  try {
    const snapshot = await getControlAutopilotSnapshot(workspaceId, projectId, { includeFinance: financeAllowed, includeWarehouse: warehouseAllowed });
    return <InvestmentAutopilotCenter projectId={projectId} workspaceId={workspaceId} snapshot={snapshot} canRun={canManageInvestments} financeAllowed={financeAllowed} warehouseAllowed={warehouseAllowed} />;
  } catch (error) {
    return <PanelFailure title="Investment Autopilot" error={error} />;
  }
}

export async function ReconciliationPanel({ workspaceId, projectId, canManageInvestments, financeAllowed, canManageFinance, warehouseAllowed, canManageWarehouse }: AccessProps) {
  if (!financeAllowed && !warehouseAllowed) return null;
  try {
    const data = await getControlReconciliationData(workspaceId, projectId) as ReconciliationData;
    return <ProjectReconciliationGraph projectId={projectId} data={data} canManage={canManageInvestments && (canManageFinance || canManageWarehouse)} canOrder={canManageInvestments && canManageWarehouse} />;
  } catch (error) {
    return <PanelFailure title="Reconciliation" error={error} />;
  }
}

export async function ExecutionPanel({ workspaceId, projectId, canManageInvestments, financeAllowed, canManageFinance, warehouseAllowed }: AccessProps) {
  try {
    const snapshot = await getControlExecutionSnapshot(workspaceId, projectId);
    return <ProjectExecutionCenter workspaceId={workspaceId} projectId={projectId} snapshot={snapshot} financeAllowed={financeAllowed} canManageFinance={canManageFinance} warehouseAllowed={warehouseAllowed} canManageInvestments={canManageInvestments} />;
  } catch (error) {
    return <PanelFailure title="Execution Layer" error={error} />;
  }
}
