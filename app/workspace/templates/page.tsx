import { OperationalModule } from "@/components/dashboard/operational-module";
import { TemplateStudio } from "@/components/templates/template-studio";
import { WORKSPACE_MODULES } from "@/lib/product/modules";

export default function TemplatesPage() {
  return <OperationalModule module={WORKSPACE_MODULES.templates}><TemplateStudio /></OperationalModule>;
}
