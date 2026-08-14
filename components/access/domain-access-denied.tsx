import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";

export function DomainAccessDenied({ workspaceId, area }: { workspaceId: string; area: string }) {
  return (
    <main className="co-page">
      <section className="co-access-denied" role="alert">
        <span className="co-access-denied__icon"><LockKeyhole size={24} aria-hidden="true" /></span>
        <p className="co-kicker">Kontrola dostępu</p>
        <h1>Brak dostępu do modułu {area}</h1>
        <p>Ten obszar zawiera dane chronione rolą domenową. Administrator firmy może nadać dostęp tylko do odczytu, edycji albo zatwierdzania.</p>
        <Link href={`/workspace/companies/${workspaceId}`} className="co-primary-action">
          <ArrowLeft size={16} aria-hidden="true" /> Wróć do dashboardu
        </Link>
      </section>
    </main>
  );
}
