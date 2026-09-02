import Link from "next/link";
import { AlertTriangle, BarChart3, CalendarClock, CheckCircle2, Download, FileBarChart, PieChart, Sparkles } from "lucide-react";
import { notFound } from "next/navigation";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import ReportsOperations from "@/components/company/operations/reports-operations";
import { requireCurrentUser } from "@/lib/auth";
import { hasDomainAccess } from "@/lib/authorization";
import { getReportsWorkspaceData } from "@/lib/data/company-operations";
import { getWorkspaceForUser } from "@/lib/data/workspace";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ workspaceId: string }> };
type ReportsData = Awaited<ReturnType<typeof getReportsWorkspaceData>>;

async function safeReportsData(workspaceId: string): Promise<{ data: ReportsData; degraded: boolean }> {
  try {
    return { data: await getReportsWorkspaceData(workspaceId), degraded: false };
  } catch (error) {
    console.error("Project Octopus: reports fallback", {
      workspaceId,
      message: error instanceof Error ? error.message : String(error)
    });
    return {
      degraded: true,
      data: { definitions: [], runs: [], snapshots: [], projects: [] }
    };
  }
}

export default async function CompanyReportsPage({ params }: Props) {
  const { workspaceId } = await params;
  const user = await requireCurrentUser();
  const workspace = await getWorkspaceForUser(user, workspaceId);
  if (!workspace) notFound();

  if (!await hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "reports", level: "read" })) {
    return <DomainAccessDenied workspaceId={workspace.id} area="Raporty" />;
  }

  const [{ data, degraded }, canWrite] = await Promise.all([
    safeReportsData(workspace.id),
    hasDomainAccess({ workspaceId: workspace.id, userId: user.id, domain: "reports", level: "write" })
  ]);

  const definitions = data.definitions ?? [];
  const runs = data.runs ?? [];
  const snapshots = data.snapshots ?? [];
  const activeDefinitions = definitions.filter((row) => row.active !== false).length;
  const queuedRuns = runs.filter((row) => ["queued", "running"].includes(String(row.status))).length;
  const completedRuns = runs.filter((row) => row.status === "completed").length;
  const latestSnapshot = snapshots[0];
  const latestClosedAt = latestSnapshot?.closed_at ?? latestSnapshot?.created_at;
  const latestSnapshotId = latestSnapshot?.id ? String(latestSnapshot.id) : null;

  return (
    <main className="co-page">
      <header className="co-page-heading">
        <div>
          <p className="co-kicker">Raporty</p>
          <h1>Raporty i analityka firmy</h1>
          <p>Twórz powtarzalne raporty zarządcze i inwestycyjne, zamykaj dane w snapshotach oraz pobieraj wynik w formacie nadającym się do dalszej analizy.</p>
        </div>
        <strong className="co-count-badge">{snapshots.length} snapshotów</strong>
      </header>

      {degraded ? (
        <section className="co-schema-warning" role="status">
          <AlertTriangle size={17} aria-hidden="true" />
          <div><strong>Raporty są dostępne w trybie bezpiecznym.</strong><span>Jedna z tabel raportowych nie jest jeszcze dostępna. Zamiast błędu całej strony pokazujemy pusty panel do czasu uzupełnienia migracji.</span></div>
        </section>
      ) : null}

      <section className="co-metric-grid" aria-label="Stan raportowania">
        <article className="co-metric-card"><span>Definicje raportów</span><strong>{definitions.length}</strong><small>{activeDefinitions} aktywnych schematów</small></article>
        <article className="co-metric-card"><span>W kolejce</span><strong>{queuedRuns}</strong><small>oczekujące lub generowane</small></article>
        <article className="co-metric-card"><span>Wygenerowane</span><strong>{completedRuns}</strong><small>zakończonych uruchomień</small></article>
        <article className="co-metric-card co-metric-card--ai"><span>Ostatni snapshot</span><strong>{latestClosedAt ? new Date(String(latestClosedAt)).toLocaleDateString("pl-PL") : "—"}</strong><small>zamknięty obraz danych</small></article>
      </section>

      <section className="co-category-strip" aria-label="Typy raportów">
        {["Zarządczy firmy", "Inwestycja", "Finansowy", "Kadrowy", "Magazynowy", "Flotowy", "AI / wyjątki"].map((label) => <span key={label}>{label}</span>)}
      </section>

      <section className="document-principles" aria-label="Jak działają raporty">
        <div><FileBarChart size={18} /><strong>1. Definicja</strong><span>Wybierasz typ raportu, zakres firmy lub inwestycji i cykl.</span></div>
        <div><CalendarClock size={18} /><strong>2. Okres</strong><span>Przy generowaniu wskazujesz zakres dat, który ma zostać policzony.</span></div>
        <div><CheckCircle2 size={18} /><strong>3. Snapshot</strong><span>Octopus zamyka KPI w historycznym obrazie odpornym na późniejsze zmiany danych.</span></div>
        <div><Download size={18} /><strong>4. Eksport</strong><span>Gotowy snapshot możesz pobrać do JSON lub CSV i wykorzystać poza systemem.</span></div>
      </section>

      <section className="co-section">
        <div className="co-section-heading">
          <div><p className="co-kicker">Szybki dostęp</p><h2>Co ma dawać ten moduł</h2></div>
          {latestSnapshotId ? (
            <div className="ops-inline-actions">
              <a className="secondary-button" href={`/api/company/reports/${latestSnapshotId}?format=csv`}><Download size={15} /> Ostatni CSV</a>
              <a className="secondary-button" href={`/api/company/reports/${latestSnapshotId}?format=json`}><Download size={15} /> Ostatni JSON</a>
            </div>
          ) : null}
        </div>
        <div className="co-settings-cards">
          <article><BarChart3 size={21} /><div><strong>Kontrola finansowa</strong><p>Sprzedaż, zakupy, zapłacone kwoty, otwarte zobowiązania i wynik brutto w wybranym okresie.</p></div></article>
          <article><PieChart size={21} /><div><strong>Stan operacyjny</strong><p>Liczba inwestycji, dokumentów, aktywnych pracowników, pojazdów i kartotek magazynowych.</p></div></article>
          <article><Sparkles size={21} /><div><strong>Wyjątki AI</strong><p>Liczba decyzji oczekujących na człowieka pomaga wychwycić ryzyko przed zamknięciem raportu.</p></div></article>
        </div>
      </section>

      <section className="co-section">
        <div className="co-section-heading">
          <div><p className="co-kicker">Generator i historia</p><h2>Definicje, uruchomienia i snapshoty</h2></div>
          <Link href={`/workspace/companies/${workspace.id}/ai-inbox`} className="co-text-link">Sprawdź wyjątki AI →</Link>
        </div>
        <p className="section-lead">Najpierw utwórz definicję raportu. Następnie rozwiń ją i uruchom raport dla wybranego okresu. Wynik zostaje zachowany jako snapshot, dzięki czemu raport z poprzedniego miesiąca nie zmieni się po późniejszej korekcie danych.</p>
        <ReportsOperations
          workspaceId={workspace.id}
          data={data}
          canWrite={canWrite}
          pathname={`/workspace/companies/${workspace.id}/reports`}
          query=""
        />
      </section>
    </main>
  );
}
