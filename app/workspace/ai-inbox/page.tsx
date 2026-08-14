import { redirectToCurrentCompany } from "@/lib/navigation/company-redirect";

export default async function LegacyAiInboxPage() {
  return redirectToCurrentCompany("ai-inbox");
}
