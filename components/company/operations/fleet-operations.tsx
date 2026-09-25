"use client";

import { useState } from "react";
import { FleetWorkspace300, type FleetCoreTab } from "@/components/company/fleet-workspace-300";
import { FleetEquipmentRegistry } from "@/components/company/fleet-equipment-registry";
import { FleetCostsSimple } from "@/components/company/fleet-costs-simple";
import type { Data } from "@/components/company/operations/module-shell";

export default function FleetOperations({ workspaceId, data, canWrite, canApprove, query, tab }: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  pathname: string;
  query: string;
  tab?: string;
}) {
  const initialTab = (["dashboard","vehicles","waiting","operations","service","documents","equipment","damages","costs"].includes(tab ?? "") ? tab : (query ? "vehicles" : "dashboard")) as FleetCoreTab;
  const [activeTab, setActiveTab] = useState<FleetCoreTab>(initialTab);

  return <div className={`fleet-vehicles-polish fleet-tab-${activeTab}`}>
    <FleetWorkspace300
      workspaceId={workspaceId}
      data={data}
      canWrite={canWrite}
      canApprove={canApprove}
      query={query}
      initialTab={initialTab}
      onTabChange={setActiveTab}
    />
    {activeTab === "equipment" ? (
      <div className="fleet-equipment-registry-host">
        <FleetEquipmentRegistry workspaceId={workspaceId} data={data} canWrite={canWrite} />
      </div>
    ) : null}
    {activeTab === "costs" ? (
      <div className="fleet-costs-simple-host">
        <FleetCostsSimple data={data} />
      </div>
    ) : null}
    <style jsx global>{`
      /* Pojazdy: kompaktowe dodawanie + rejestr na pełną szerokość. */
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] {
        grid-template-columns: minmax(0, 1fr) !important;
        gap: 8px !important;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article {
        grid-column: 1 / -1 !important;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article:has(> div + details[class*="formCard"]) {
        border: 0 !important;
        background: transparent !important;
        padding: 0 !important;
        box-shadow: none !important;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article:has(> div + details[class*="formCard"]) > div[class*="heading"] {
        display: none !important;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article:has(> div + details[class*="formCard"]) > details[class*="formCard"] {
        width: max-content;
        max-width: 100%;
        border: 0 !important;
        background: transparent !important;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article:has(> div + details[class*="formCard"]) > details[class*="formCard"] > summary {
        width: max-content;
        min-height: 34px;
        padding: 7px 11px !important;
        border: 1px solid #222047;
        border-radius: 9px !important;
        background: #222047 !important;
        color: #fff !important;
        gap: 6px;
        box-shadow: none;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article:has(> div + details[class*="formCard"]) > details[class*="formCard"][open] {
        width: 100%;
        border: 1px solid #e0e4eb !important;
        border-radius: 12px !important;
        background: #fff !important;
        padding: 10px !important;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article:has(> div + details[class*="formCard"]) > details[class*="formCard"][open] > summary {
        margin-bottom: 10px;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article:has([class*="tableHead"]) {
        padding: 10px 12px !important;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article:has([class*="tableHead"]) [class*="tableHead"] {
        position: sticky;
        top: 0;
        z-index: 2;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article:has([class*="tableHead"]) [class*="row"] {
        min-height: 42px;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article:has([class*="tableHead"]) [class*="row"]:hover {
        background: #fafaff;
      }

      /* Wyposażenie i koszty są montowane dopiero po wejściu do odpowiedniej zakładki. */
      .fleet-tab-equipment section[data-fleet-experience="3.0"] > div[class*="grid"],
      .fleet-tab-costs section[data-fleet-experience="3.0"] > div[class*="grid"] {
        display: none !important;
      }

      @media (max-width: 760px) {
        .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(2)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] > article:has(> div + details[class*="formCard"]) > details[class*="formCard"][open] {
          padding: 8px !important;
        }
      }
    `}</style>
  </div>;
}
