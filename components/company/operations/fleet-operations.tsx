"use client";

import { FleetWorkspace300 } from "@/components/company/fleet-workspace-300";
import type { Data } from "@/components/company/operations/module-shell";

export default function FleetOperations({ workspaceId, data, canWrite, canApprove, query }: {
  workspaceId: string;
  data: Data;
  canWrite: boolean;
  canApprove: boolean;
  pathname: string;
  query: string;
}) {
  return <>
    <FleetWorkspace300 workspaceId={workspaceId} data={data} canWrite={canWrite} canApprove={canApprove} query={query} />
    <style>{`
      section[data-fleet-experience="3.0"] {
        display: grid !important;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 10px !important;
        align-items: stretch;
      }

      section[data-fleet-experience="3.0"] > * {
        grid-column: 1 / -1;
      }

      section[data-fleet-experience="3.0"] > form:first-of-type {
        display: contents !important;
      }

      section[data-fleet-experience="3.0"] > form:first-of-type > label {
        grid-column: 1 / -1;
        grid-row: 2;
        min-width: 0;
      }

      section[data-fleet-experience="3.0"] > form:first-of-type > [data-module-dropzone="fleet"] {
        grid-column: 2;
        grid-row: 1;
        align-self: stretch;
        min-height: 44px;
        white-space: nowrap;
      }

      section[data-fleet-experience="3.0"] > div:nth-of-type(1) {
        grid-column: 1 / -1;
        grid-row: 3;
      }

      /* Pasek sekcji Floty ma ten sam kontrakt wizualny co Magazyn 3.1. */
      section[data-fleet-experience="3.0"] > div:nth-of-type(2) {
        grid-column: 1;
        grid-row: 1;
        min-width: 0;
        overflow: hidden;
        padding: 7px !important;
        border: 1px solid #dde2ea !important;
        border-radius: 12px !important;
        background: rgb(255 255 255 / 96%) !important;
        backdrop-filter: blur(10px);
      }

      section[data-fleet-experience="3.0"] > div:nth-of-type(2) nav {
        display: flex !important;
        flex-wrap: nowrap !important;
        gap: 3px !important;
        min-width: 0 !important;
        overflow-x: auto;
        overflow-y: hidden;
        scrollbar-width: thin;
        align-items: center;
      }

      section[data-fleet-experience="3.0"] > div:nth-of-type(2) nav button {
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        flex: 0 0 auto;
        border: 0 !important;
        border-radius: 9px !important;
        padding: 9px 10px !important;
        background: transparent !important;
        color: #202531 !important;
        font-size: 11.5px !important;
        font-weight: 780 !important;
        line-height: normal;
        cursor: pointer;
        white-space: nowrap;
        box-shadow: none !important;
      }

      section[data-fleet-experience="3.0"] > div:nth-of-type(2) nav button:hover {
        background: #f4f6fa !important;
      }

      section[data-fleet-experience="3.0"] > div:nth-of-type(2) nav button[class*="tabActive"] {
        background: #edf9f4 !important;
        box-shadow: inset 0 0 0 1px #bfe7d7 !important;
        color: #125f49 !important;
      }

      section[data-fleet-experience="3.0"] > div:nth-of-type(2) nav button b {
        display: grid !important;
        place-items: center;
        min-width: 19px !important;
        height: 19px !important;
        padding: 0 5px !important;
        border-radius: 999px !important;
        background: #e45151 !important;
        color: #fff !important;
        font-size: 9px !important;
      }

      @media (max-width: 980px) {
        section[data-fleet-experience="3.0"] {
          grid-template-columns: minmax(0, 1fr) auto;
        }

        section[data-fleet-experience="3.0"] > div:nth-of-type(2) {
          grid-column: 1;
        }
      }

      @media (max-width: 720px) {
        section[data-fleet-experience="3.0"] {
          grid-template-columns: 1fr;
        }

        section[data-fleet-experience="3.0"] > div:nth-of-type(2) {
          grid-column: 1;
          grid-row: 1;
        }

        section[data-fleet-experience="3.0"] > form:first-of-type > [data-module-dropzone="fleet"] {
          grid-column: 1;
          grid-row: 2;
          justify-self: stretch;
        }

        section[data-fleet-experience="3.0"] > form:first-of-type > label {
          grid-column: 1;
          grid-row: 3;
        }

        section[data-fleet-experience="3.0"] > div:nth-of-type(1) {
          grid-row: 4;
        }
      }
    `}</style>
  </>;
}
