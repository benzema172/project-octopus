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

      section[data-fleet-experience="3.0"] > div:nth-of-type(2) {
        grid-column: 1;
        grid-row: 1;
        min-width: 0;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 5px !important;
        border: 1px solid var(--co-border, #dfe3e8);
        border-radius: 12px;
        background: #fff;
        scrollbar-width: thin;
      }

      section[data-fleet-experience="3.0"] > div:nth-of-type(2) nav {
        min-width: max-content;
        min-height: 34px;
        align-items: center;
      }

      section[data-fleet-experience="3.0"] > div:nth-of-type(2) button {
        border-radius: 9px;
        padding: 7px 9px;
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
