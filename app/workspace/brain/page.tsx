import { BrainPanel } from "@/components/brain/brain-panel";
import { requireCurrentUser } from "@/lib/auth";
import { getAiRuntimeStatus } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function BrainPage() {
  await requireCurrentUser();
  const status = getAiRuntimeStatus();

  return (
    <main className="workspace-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">Octopus Brain</p>
          <h1>Centrum analizy</h1>
        </div>
        <p className="page-heading__meta">{status.ready ? "Gemini gotowy" : "Konfiguracja AI oczekuje"}</p>
      </section>

      <BrainPanel status={status} />
    </main>
  );
}
