import { CompanyOperationalPage } from "@/components/company/company-operational-page";
import { getWarehouseWorkspaceData } from "@/lib/data/company-operations";

export const dynamic="force-dynamic";
export default async function WarehousePage({params,searchParams}:{params:Promise<{workspaceId:string}>;searchParams:Promise<{page?:string;q?:string}>}){const[{workspaceId},query]=await Promise.all([params,searchParams]);return <CompanyOperationalPage workspaceId={workspaceId} page={query.page} query={query.q} domain="warehouse" kind="warehouse" kicker="Magazyn" title="Magazyn, materiały i sprzęt" description="Dokumenty z AI, kartoteki, rzeczywiste stany, ceny, inwentaryzacje oraz ruchy PZ, WZ, RW, ZW i MM powiązane z inwestycjami." loader={getWarehouseWorkspaceData}/>;}
