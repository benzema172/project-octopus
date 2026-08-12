import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, FileText, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { updateCompanyAction } from "@/app/actions";
import { requireCurrentUser } from "@/lib/auth";
import { listProjectsForWorkspace } from "@/lib/data/projects";
import { getWorkspaceForUser, isCompanyProfileSchemaReady } from "@/lib/data/workspace";
import { createServiceSupabaseClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

type CompanySectionPageProps = {
  params: Promise<{ workspaceId: string; section: string }>;
  searchParams: Promise<{ saved?: string }>;
};

type DocumentRow = {
  id: string;
  name: string;
  category: string | null;
  project_id: string;
  updated_at: string;
  projects: { name: string } | { name: string }[] | null;
};

const MODULES: Record<string, { title: string; kicker: string; description: string; features: string[] }> = {
  finances: {
    kicker: "Finanse",
    title: "Finanse przedsiębiorstwa",
    description: "Warstwa przygotowana pod pełne rozliczenie firmy i poszczególnych inwestycji.",
    features: ["Budżety inwestycji", "Koszty i przychody", "Cash flow", "Należności i zobowiązania", "Kosztorys vs koszty rzeczywiste", "Rentowność realizacji"]
  },
  hr: {
    kicker: "Kadry",
    title: "Kadry i zasoby ludzkie",
    description: "Jedno miejsce do obsługi zespołu i przypisywania ludzi do realizacji.",
    features: ["Lista pracowników", "Role i uprawnienia", "Badania, szkolenia i uprawnienia", "Czas pracy", "Przypisanie do inwestycji", "Sprzęt powierzony"]
  },
  warehouse: {
    kicker: "Magazyn",
    title: "Magazyn i sprzęt",
    description: "Struktura pod materiały, urządzenia, narzędzia oraz ich ruch pomiędzy firmą i inwestycjami.",
    features: ["Stany magazynowe", "Przyjęcia i wydania", "Rezerwacje pod inwestycje", "Sprzęt i narzędzia", "Stany minimalne", "Inwentaryzacja"]
  }
};

function projectName(document: DocumentRow) {
  if (Array.isArray(document.projects)) {
    return document.projects[0]?.name ?? "Inwestycja";
  }
  return document.projects?.name ?? "Inwestycja";
}

export default async function CompanySectionPage({ params, searchParams }: CompanySectionPageProps) {
  const { workspaceId, section } = await params;
  const query = await searchParams;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);

  if (!workspace) {
    notFound();
  }

  if (MODULES[section]) {
    const module = MODULES[section];
    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div>
            <p className="co-kicker">{module.kicker}</p>
            <h1>{module.title}</h1>
            <p>{module.description}</p>
          </div>
        </header>
        <section className="co-section">
          <div className="co-feature-grid">
            {module.features.map((feature, index) => (
              <article className="co-feature-card" key={feature}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h2>{feature}</h2>
                <p>Obszar przygotowany jako część modułu {module.kicker.toLowerCase()} i gotowy do dalszego rozwijania.</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (section === "documents") {
    const supabase = createServiceSupabaseClient();
    const { data, error } = await supabase
      .from("documents")
      .select("id, name, category, project_id, updated_at, projects(name)")
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(100)
      .returns<DocumentRow[]>();

    if (error) {
      throw new Error(`Nie udało się pobrać dokumentów firmy: ${error.message}`);
    }

    const documents = data ?? [];
    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div>
            <p className="co-kicker">Dokumenty</p>
            <h1>Centralne dokumenty firmy</h1>
            <p>Jeden widok na pliki ze wszystkich inwestycji: umowy, faktury, dokumentację techniczną, protokoły i załączniki.</p>
          </div>
          <strong className="co-count-badge">{documents.length} plików</strong>
        </header>

        <section className="co-category-strip">
          {["Umowy", "Faktury", "Dokumentacja techniczna", "Protokoły", "Załączniki", "OCR / AI"].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </section>

        <section className="co-section">
          <div className="co-section-heading">
            <div>
              <p className="co-kicker">Biblioteka</p>
              <h2>Ostatnio aktualizowane</h2>
            </div>
          </div>
          {documents.length ? (
            <div className="co-document-table">
              {documents.map((document) => (
                <article key={document.id}>
                  <span className="co-document-icon"><FileText size={18} aria-hidden="true" /></span>
                  <div>
                    <strong>{document.name}</strong>
                    <small>{document.category || "Dokument"} · {projectName(document)}</small>
                  </div>
                  <time>{document.updated_at ? new Date(document.updated_at).toLocaleDateString("pl-PL") : ""}</time>
                  <Link href={`/workspace/projects/${document.project_id}/documentation`}>Otwórz →</Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="co-empty-state">
              <strong>Brak dokumentów w firmie.</strong>
              <p>Pliki dodane w inwestycjach będą automatycznie widoczne również tutaj.</p>
            </div>
          )}
        </section>
      </main>
    );
  }

  if (section === "reports") {
    const projects = await listProjectsForWorkspace(user, workspace.id);
    const supabase = createServiceSupabaseClient();
    const { count: documentCount } = await supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id)
      .is("deleted_at", null);
    const statuses = projects.reduce<Record<string, number>>((result, project) => {
      result[project.status] = (result[project.status] ?? 0) + 1;
      return result;
    }, {});

    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div>
            <p className="co-kicker">Raporty</p>
            <h1>Raporty i analityka</h1>
            <p>Przekrojowy obraz firmy z danych zgromadzonych w Project Octopus.</p>
          </div>
        </header>
        <section className="co-metric-grid">
          <article className="co-metric-card"><span>Inwestycje</span><strong>{projects.length}</strong><small>łącznie</small></article>
          <article className="co-metric-card"><span>Aktywne</span><strong>{statuses.active ?? 0}</strong><small>w realizacji</small></article>
          <article className="co-metric-card"><span>Zakończone</span><strong>{statuses.completed ?? 0}</strong><small>zamknięte</small></article>
          <article className="co-metric-card"><span>Dokumenty</span><strong>{documentCount ?? 0}</strong><small>w bibliotece firmy</small></article>
        </section>
        <section className="co-section">
          <div className="co-section-heading"><div><p className="co-kicker">Analityka</p><h2>Przekroje przygotowane do rozwoju</h2></div></div>
          <div className="co-feature-grid co-feature-grid--reports">
            {[
              ["Raport zarządczy", "Firma, inwestycje i kluczowe odchylenia w jednym podsumowaniu."],
              ["Raport inwestycji", "Postęp, dokumentacja, budżet i ryzyka konkretnej realizacji."],
              ["Raport finansowy", "Przychody, koszty, rentowność i cash flow po uruchomieniu danych finansowych."],
              ["Raport kadrowy", "Obsada, uprawnienia i obciążenie zespołu po uruchomieniu modułu Kadry."],
              ["Raport magazynowy", "Stany, ruchy i zapotrzebowanie materiałowe po uruchomieniu modułu Magazyn."],
              ["Analiza OctopusAI", "Interpretacja danych firmy i wskazanie tematów wymagających uwagi."]
            ].map(([title, description]) => (
              <article className="co-feature-card" key={title}>
                <CheckCircle2 size={19} aria-hidden="true" />
                <h2>{title}</h2>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    );
  }

  if (section === "settings") {
    const schemaReady = await isCompanyProfileSchemaReady();
    const updateAction = updateCompanyAction.bind(null, workspace.id);

    return (
      <main className="co-page">
        <header className="co-page-heading">
          <div>
            <p className="co-kicker">Ustawienia</p>
            <h1>Ustawienia firmy</h1>
            <p>Dane organizacji i fundament pod użytkowników, integracje oraz konfigurację OctopusAI.</p>
          </div>
          {query.saved === "1" ? <span className="co-saved-badge"><CheckCircle2 size={16} /> Zapisano</span> : null}
        </header>

        {!schemaReady ? <div className="co-schema-warning">Profil firmy wymaga zastosowania najnowszej migracji Supabase.</div> : null}

        <section className="co-section">
          <div className="co-section-heading"><div><p className="co-kicker">Dane podstawowe</p><h2>Profil przedsiębiorstwa</h2></div></div>
          <form action={updateAction} className="co-settings-form">
            <label className="co-field co-field--wide"><span>Nazwa firmy *</span><input name="name" defaultValue={workspace.name} required minLength={2} /></label>
            <label className="co-field"><span>NIP</span><input name="tax_id" defaultValue={workspace.tax_id ?? ""} /></label>
            <label className="co-field"><span>REGON</span><input name="regon" defaultValue={workspace.regon ?? ""} /></label>
            <label className="co-field co-field--wide"><span>Branża</span><input name="industry" defaultValue={workspace.industry ?? ""} /></label>
            <label className="co-field co-field--wide"><span>Ulica i numer</span><input name="street" defaultValue={workspace.street ?? ""} /></label>
            <label className="co-field"><span>Kod pocztowy</span><input name="postal_code" defaultValue={workspace.postal_code ?? ""} /></label>
            <label className="co-field"><span>Miasto</span><input name="city" defaultValue={workspace.city ?? ""} /></label>
            <label className="co-field"><span>E-mail</span><input name="email" type="email" defaultValue={workspace.email ?? ""} /></label>
            <label className="co-field"><span>Telefon</span><input name="phone" type="tel" defaultValue={workspace.phone ?? ""} /></label>
            <label className="co-field co-field--wide"><span>Osoba kontaktowa</span><input name="contact_person" defaultValue={workspace.contact_person ?? ""} /></label>
            <label className="co-field co-field--wide"><span>Notatka</span><textarea name="notes" rows={4} defaultValue={workspace.notes ?? ""} /></label>
            <div className="co-settings-form__actions"><button className="co-primary-button" type="submit" disabled={!schemaReady}>Zapisz dane firmy</button></div>
          </form>
        </section>

        <section className="co-settings-cards">
          <article><ShieldCheck size={21} /><div><strong>Użytkownicy i uprawnienia</strong><p>Role właściciela, administratora, członka i obserwatora pozostają przypisane do konkretnej firmy.</p></div></article>
          <article><SlidersHorizontal size={21} /><div><strong>Integracje</strong><p>Miejsce pod integracje firmowe, konfigurację OctopusAI i dalsze źródła danych.</p></div></article>
          <article><CheckCircle2 size={21} /><div><strong>Plan i konfiguracja systemu</strong><p>Obszar przygotowany pod ustawienia organizacji i przyszły model SaaS.</p></div></article>
        </section>
      </main>
    );
  }

  notFound();
}
