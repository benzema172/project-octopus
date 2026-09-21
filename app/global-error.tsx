"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Project Octopus: root layout runtime error", error);
  }, [error]);

  return (
    <html lang="pl">
      <body style={{ margin: 0, minHeight: "100vh", background: "#f4f6f9", color: "#182230", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
        <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px" }} data-error-boundary="global">
          <section role="alert" style={{ width: "min(100%, 620px)", padding: "28px", border: "1px solid #dde3ea", borderRadius: "18px", background: "#ffffff", boxShadow: "0 18px 48px rgba(35, 50, 75, 0.10)" }}>
            <p style={{ margin: "0 0 8px", color: "#647184", fontWeight: 700, fontSize: "12px", letterSpacing: ".08em", textTransform: "uppercase" }}>Project Octopus · tryb bezpieczny</p>
            <h1 style={{ margin: "0 0 10px", fontSize: "24px" }}>Aplikacja napotkała błąd krytyczny</h1>
            <p style={{ margin: "0 0 18px", color: "#647184", lineHeight: 1.6 }}>Project Octopus przechwycił błąd warstwy głównej. Możesz ponowić uruchomienie albo wrócić do ekranu logowania.</p>
            {error.digest ? <p style={{ margin: "0 0 18px", color: "#8793a3", fontSize: "12px" }}>Identyfikator błędu: {error.digest}</p> : null}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              <button type="button" onClick={reset} style={{ border: 0, borderRadius: "10px", padding: "11px 16px", background: "#182230", color: "#ffffff", fontWeight: 700, cursor: "pointer" }}>Uruchom ponownie</button>
              <Link href="/" style={{ border: "1px solid #c5ced9", borderRadius: "10px", padding: "10px 16px", color: "#182230", fontWeight: 700, textDecoration: "none" }}>Ekran startowy</Link>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
