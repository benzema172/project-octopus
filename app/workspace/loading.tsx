import { LoaderCircle } from "lucide-react";

export default function WorkspaceLoading() {
  return (
    <main className="workspace-loading" aria-live="polite" aria-label="Otwieranie workspace">
      <LoaderCircle aria-hidden="true" />
      <p>Otwieram workspace</p>
    </main>
  );
}
