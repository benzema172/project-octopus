"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function ProjectWorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Project Octopus: project workspace runtime error", error);
  }, [error]);

  return (
    <main className="workspace-page project-workspace co-project-workspace project-workspace-v2">
      <section className="co-section">
        <div className="empty-state">
          <AlertTriangle size={30} aria-hidden="true" />
          <strong>Ten obszar inwestycji nie załadował się poprawnie</strong>
          <p>Project Octopus przechwycił błąd modułu inwestycji. Dane nie zostały usunięte — spróbuj ponownie albo wróć do panelu firm.</p>
          {error.digest ? <small>Identyfikator błędu: {error.digest}</small> : null}
          <div className="ops-inline-actions">
            <button type="button" className="primary-button" onClick={reset}><RefreshCw size={16} /> Spróbuj ponownie</button>
            <Link href="/workspace" className="secondary-button">Wróć do panelu</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
