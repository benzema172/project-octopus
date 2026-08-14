import { OperationalModule } from "@/components/dashboard/operational-module";
import { DomainLivePanel } from "@/components/dashboard/domain-live-panel";
import { WORKSPACE_MODULES } from "@/lib/product/modules";

export default function HrPage() {
  return <OperationalModule module={WORKSPACE_MODULES.hr}><DomainLivePanel kind="hr" /></OperationalModule>;
}
