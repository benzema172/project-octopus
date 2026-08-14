import { OperationalModule } from "@/components/dashboard/operational-module";
import { DomainLivePanel } from "@/components/dashboard/domain-live-panel";
import { WORKSPACE_MODULES } from "@/lib/product/modules";

export default function FinancePage() {
  return <OperationalModule module={WORKSPACE_MODULES.finance}><DomainLivePanel kind="finance" /></OperationalModule>;
}
