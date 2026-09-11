"use client";

import { FleetWorkspace300 } from "@/components/company/fleet-workspace-300";
import { FleetEquipmentRegistry } from "@/components/company/fleet-equipment-registry";
import { FleetCostsSimple } from "@/components/company/fleet-costs-simple";
import type { Data } from "@/components/company/operations/module-shell";

export default function FleetOperations({ workspaceId, data, canWrite, canApprove, query }: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  pathname: string;
  query: string;
}) {
  return <div className="fleet-vehicles-polish">
    <FleetWorkspace300
      workspaceId={workspaceId}
      data={data}
      canWrite={canWrite}
      canApprove={canApprove}
      query={query}
    />
    <div className="fleet-equipment-registry-host">
      <FleetEquipmentRegistry workspaceId={workspaceId} data={data} canWrite={canWrite} />
    </div>
    <div className="fleet-costs-simple-host">
      <FleetCostsSimple data={data} />
    </div>
    <style jsx global>{`
      /* Flota ma jeden uproszczony poziom nawigacji: bez Poczekalni AI, Serwisu i Szkód. */
      .fleet-vehicles-polish nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(3),
      .fleet-vehicles-polish nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(5),
      .fleet-vehicles-polish nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(8) {
        display: none !important;
      }

      /* KPI są pulpitem zarządczym i nie powtarzają się w zakładkach roboczych. */
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:not(:first-child)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="kpis"] {
        display: none !important;
      }

      /* Na Pulpicie nie pokazujemy wskaźników usuniętych funkcji AI/Serwis/Szkody. */
      .fleet-vehicles-polish section[data-fleet-experience="3.0"] > div[class*="kpis"] > :nth-child(3),
      .fleet-vehicles-polish section[data-fleet-experience="3.0"] > div[class*="kpis"] > :nth-child(4),
      .fleet-vehicles-polish section[data-fleet-experience="3.0"] > div[class*="kpis"] > :nth-child(5) {
        display: none !important;
      }

      /* Usuń odwołania do Poczekalni AI, Serwisu i Szkód z panelu „Do decyzji” na Pulpicie. */
      .fleet-vehicles-polish section[data-fleet-experience="3.0"] > div[class*="grid"]:first-of-type > article:first-child div[class*="list"] > :first-child,
      .fleet-vehicles-polish section[data-fleet-experience="3.0"] > div[class*="grid"]:first-of-type > article:first-child div[class*="list"] > :nth-child(2),
      .fleet-vehicles-polish section[data-fleet-experience="3.0"] > div[class*="grid"]:first-of-type > article:first-child div[class*="list"] > :nth-child(4),
      .fleet-vehicles-polish section[data-fleet-experience="3.0"] > div[class*="grid"]:first-of-type > article:first-child div[class*="actionRow"] > :first-child,
      .fleet-vehicles-polish section[data-fleet-experience="3.0"] > div[class*="grid"]:first-of-type > article:first-child div[class*="actionRow"] > :nth-child(2) {
        display: none !important;
      }

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

      /* Wyposażenie i opony: zastępujemy stare kafle jednym rejestrem pojazdów. */
      .fleet-equipment-registry-host {
        display: none;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(7)[class*="tabActive"]) .fleet-equipment-registry-host {
        display: block;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(7)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] {
        display: none !important;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(7)[class*="tabActive"]) section[data-fleet-experience="3.0"] > form[class*="searchbar"] {
        display: none !important;
      }

      /* Koszty i wykorzystanie: prosty widok finansowy zamiast TCO, stawek i przypisań. */
      .fleet-costs-simple-host {
        display: none;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(9)[class*="tabActive"]) .fleet-costs-simple-host {
        display: block;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(9)[class*="tabActive"]) section[data-fleet-experience="3.0"] > div[class*="grid"] {
        display: none !important;
      }
      .fleet-vehicles-polish:has(nav[aria-label="Sekcje Fleet Core 3.0"] button:nth-child(9)[class*="tabActive"]) section[data-fleet-experience="3.0"] > form[class*="searchbar"] {
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
