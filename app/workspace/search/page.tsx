import { KnowledgeSearch } from "@/components/brain/knowledge-search";
import { requireCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SearchPage() {
  await requireCurrentUser();
  return (
    <main className="workspace-page">
      <section className="page-heading">
        <div><p className="eyebrow">Wyszukiwarka hybrydowa</p><h1>Wiedza firmy ze wskazaniem źródła</h1></div>
        <p className="page-heading__meta">Dokumenty + fakty + pamięć organizacji</p>
      </section>
      <section className="section-band">
        <p className="section-lead">Wyniki łączą nazwę i pełny tekst dokumentu, zatwierdzone fakty Project DNA oraz wiedzę z zamkniętych inwestycji. Każdy rezultat zachowuje identyfikator źródła.</p>
        <KnowledgeSearch />
      </section>
    </main>
  );
}
