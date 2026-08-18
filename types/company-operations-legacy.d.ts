import "@/lib/data/company-operations";

type LegacyCompanyRow = Record<string, unknown>;
type LegacyCompanyData = Record<string, LegacyCompanyRow[]>;

declare module "@/lib/data/company-operations" {
  export function getFinanceWorkspaceData(workspaceId: string): Promise<LegacyCompanyData>;
  export function getHrWorkspaceData(workspaceId: string): Promise<LegacyCompanyData>;
  export function getWarehouseWorkspaceData(workspaceId: string): Promise<LegacyCompanyData>;
  export function getFleetWorkspaceData(workspaceId: string): Promise<LegacyCompanyData>;
}
