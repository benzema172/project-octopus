"use client";

import Link from "next/link";
import { useEffect } from "react";

const shell = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: "24px",
  background: "#f4f6f9",
  color: "#182230",
  fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
} as const;

const panel = {
  width: "min(100%, 620px)",
  padding: "28px",
  border: "1px solid #dde3ea",
  borderRadius: "18px",
  background: "#ffffff",
  boxShadow: "0 18px 48px rgba(35, 50, 75, 0.10)"
} as const;

export default function RootError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Project Octopus: root route runtime error", error);
  }, [error]);

  return (
    <main style={shell} data-error-boundary="root">
      <section style={panel} role="alert">
        <p style={{ margin: "0 0 8px", color: "#647184", fontWeight: 700, fontSize: "12px", letterSpacing: ".08em", textTransform: "uppercase" }}>Project Octopus</p>
        <h1 style={{ margin: "0 0 10px", fontSize: "24px" }}>Nie udało się załadować aplikacji</h1>
        <p style={{ margin: "0 0 18px", color: "#647184", lineHeight: 1.6 }}>Dane nie zostały usunięte. Spróbuj ponownie; jeżeli problem dotyczy sesji lub nawigacji, wróć do ekranu startowego.</p>
        {error.digest ? <p style={{ margin: "0 0 18px", color: "#8793a3", fontSize: "12px" }}>Identyfikator błędu: {error.digest}</p> : null}
        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
          <button type="button" onClick={reset} style={{ border: 0, borderRadius: "10px", padding: "11px 16px", background: "#182230", color: "#ffffff", fontWeight: 700, cursor: "pointer" }}>Spróbuj ponownie</button>
          <Link href="/" style={{ border: "1px solid #c5ced9", borderRadius: "10px", padding: "10px 16px", color: "#182230", fontWeight: 700, textDecoration: "none" }}>Wróć do startu</Link>
        </div>
      </section>
    </main>
  );
}
