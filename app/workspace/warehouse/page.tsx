import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacyWarehousePage() {
  return redirectToCurrentCompany("warehouse");
}
