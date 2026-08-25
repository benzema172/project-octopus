"use client";

import Link from "next/link";
import { AlertTriangle, LogOut, RefreshCw } from "lucide-react";
import { useEffect } from "react";

export default function WorkspaceError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Project Octopus: workspace runtime error", error);
  }, [error]);

  return (
    <main className="co-page" id="main-content">
      <section className="co-section">
        <div className="empty-state" role="alert">
          <AlertTriangle size={30} aria-hidden="true" />
          <strong>Panel firm nie załadował się poprawnie</strong>
          <p>Dane nie zostały zmienione. Ponów próbę, a jeśli sesja wygasła — wyloguj się i zaloguj ponownie.</p>
          {error.digest ? <small>Identyfikator błędu: {error.digest}</small> : null}
          <div className="ops-inline-actions">
            <button type="button" className="primary-button" onClick={reset}>
              <RefreshCw size={16} aria-hidden="true" /> Spróbuj ponownie
            </button>
            <Link href="/auth/sign-out" className="secondary-button">
              <LogOut size={16} aria-hidden="true" /> Odśwież logowanie
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

