import { OperationalModule } from "@/components/dashboard/operational-module";
import { DomainLivePanel } from "@/components/dashboard/domain-live-panel";
import { WORKSPACE_MODULES } from "@/lib/product/modules";

export default function WarehousePage() {
  return <OperationalModule module={WORKSPACE_MODULES.warehouse}><DomainLivePanel kind="warehouse" /></OperationalModule>;
}
