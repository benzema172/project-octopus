"use client";

import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function CompanyWorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Project Octopus: company workspace runtime error", error);
  }, [error]);

  return (
    <main className="co-page">
      <section className="co-section">
        <div className="empty-state">
          <AlertTriangle size={30} aria-hidden="true" />
          <strong>Ten obszar nie załadował się poprawnie</strong>
          <p>Project Octopus przechwycił błąd modułu zamiast wyświetlać pustą stronę serwera. Możesz ponowić próbę albo wrócić do panelu firmy.</p>
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
