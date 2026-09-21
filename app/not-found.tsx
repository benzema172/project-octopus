export default function NotFound() {
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: "24px", background: "#f4f6f9", color: "#182230", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif" }}>
      <section style={{ width: "min(100%, 620px)", padding: "28px", border: "1px solid #dde3ea", borderRadius: "18px", background: "#ffffff", boxShadow: "0 18px 48px rgba(35, 50, 75, 0.10)" }}>
        <p style={{ margin: "0 0 8px", color: "#647184", fontWeight: 700, fontSize: "12px", letterSpacing: ".08em", textTransform: "uppercase" }}>404 · Project Octopus</p>
        <h1 style={{ margin: "0 0 10px", fontSize: "24px" }}>Nie znaleziono tego widoku</h1>
        <p style={{ margin: "0 0 18px", color: "#647184", lineHeight: 1.6 }}>Adres może być nieaktualny albo element został przeniesiony. Wróć do aplikacji i wybierz właściwą firmę lub inwestycję.</p>
        <a href="/" style={{ display: "inline-block", borderRadius: "10px", padding: "11px 16px", background: "#182230", color: "#ffffff", fontWeight: 700, textDecoration: "none" }}>Wróć do Project Octopus</a>
      </section>
    </main>
  );
}
