"use client";

import dynamic from "next/dynamic";
import type { Data } from "@/components/company/operations/module-shell";

const FinanceOperations=dynamic(()=>import("@/components/company/operations/finance-operations"),{loading:()=> <p className="empty-copy">Ładowanie finansów…</p>});
const WarehouseOperations=dynamic(()=>import("@/components/company/operations/warehouse-operations"),{loading:()=> <p className="empty-copy">Ładowanie magazynu…</p>});
const FleetOperations=dynamic(()=>import("@/components/company/operations/fleet-operations"),{loading:()=> <p className="empty-copy">Ładowanie floty…</p>});

type Kind="finance"|"warehouse"|"fleet";

export function CompanyOperationsLazy({workspaceId,kind,data,canWrite,canApprove,pathname,query}:{workspaceId:string;kind:Kind;data:Data;canWrite:boolean;canApprove:boolean;pathname:string;query:string}){
  const props={workspaceId,data,canWrite,canApprove,pathname,query};
  if(kind==="finance")return <FinanceOperations {...props}/>;
  if(kind==="warehouse")return <WarehouseOperations {...props}/>;
  return <FleetOperations {...props}/>;
}
