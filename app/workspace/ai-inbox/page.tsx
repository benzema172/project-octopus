import { AiInbox } from "@/components/brain/ai-inbox";
import { requireCurrentUser } from "@/lib/auth";
import { listAiInbox } from "@/lib/data/operations";
import { ensureWorkspaceForUser } from "@/lib/data/workspace";

export const dynamic = "force-dynamic";

export default async function AiInboxPage() {
  const user = await requireCurrentUser();
  const workspace = await ensureWorkspaceForUser(user);
  const items = await listAiInbox(workspace.id);
  const reviewCount = items.filter((item) => item.status === "review").length;
  const errorCount = items.filter((item) => item.status === "error").length;
  return (
    <main className="workspace-page">
      <section className="page-heading">
        <div><p className="eyebrow">Wspólna kontrola AI</p><h1>Skrzynka AI</h1></div>
        <p className="page-heading__meta">{reviewCount} decyzji · {errorCount} błędów</p>
      </section>
      <section className="section-band">
        <p className="section-lead">Jedno miejsce dla klasyfikacji dokumentów, importów kosztorysów, skutków nowych rewizji i zdarzeń z budowy. AI proponuje, a człowiek podejmuje decyzję i pozostawia ślad audytowy.</p>
        <AiInbox items={items} workspaceId={workspace.id} />
      </section>
    </main>
  );
}
