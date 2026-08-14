import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacyKnowledgePage() {
  return redirectToCurrentCompany("knowledge");
}
