import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacyTemplatesPage() {
  return redirectToCurrentCompany("templates");
}
