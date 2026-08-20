import { FileSpreadsheet, FileText, History, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { ProjectLiveRecords } from "@/components/projects/project-live-records";
import { ProjectOperationPanel } from "@/components/projects/project-operation-panel";
import { requireCurrentUser } from "@/lib/auth";
import { listDocumentsForCategories } from "@/lib/data/documents";
import { getBoqKnowledge } from "@/lib/data/module-knowledge";
import { getProjectForUser } from "@/lib/data/projects";
import { DomainAccessDenied } from "@/components/access/domain-access-denied";
import { hasDomainAccess } from "@/lib/authorization";
import "../../../../boq-compact.css";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ projectId: string }> };

function formatMoney(value: number) {
  return new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 }).format(value) + " zł";
}

function formatNumber(value: number | null) {
  return value == null ? "—" : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 3 }).format(value);
}

export default async function CostEstimatePage({ params }: Props) {
  const { projectId } = await params;
  const user = await requireCurrentUser();
  const project = await getProjectForUser(user, projectId);
  if (!project) notFound();
  if (!await hasDomainAccess({ workspaceId: project.workspace_id, userId: user.id, domain: "investments", level: "read", projectId: project.id })) {
    return <DomainAccessDenied workspaceId={project.workspace_id} area="Kosztorys" />;
  }

  const [documents, boqItems] = await Promise.all([
    listDocumentsForCategories(projectId, ["kosztorys"]),
    getBoqKnowledge(projectId)
  ]);

  const recognizedValue = boqItems.reduce((sum, item) => sum + Number(item.total_price ?? 0), 0);

  return (
    <div className="project-tab-content pw-boq-compact">
      <section className="pw-boq-compact__hero">
        <div className="pw-boq-compact__title">
          <span className="pw-boq-compact__icon"><FileSpreadsheet size={19} aria-hidden="true" /></span>
          <div>
            <p className="co-kicker">Kosztorys / BOQ</p>
            <h2>Kosztorys inwestycji</h2>
            <p>Pozycje, ilości i wartości rozpoznane z kosztorysu.</p>
          </div>
        </div>
        <div className="pw-boq-compact__summary" aria-label="Podsumowanie kosztorysu">
          <span><b>{boqItems.length}</b> pozycji</span>
          <i aria-hidden="true" />
          <span><b>{documents.length}</b> {documents.length === 1 ? "plik" : "plików"}</span>
          <i aria-hidden="true" />
          <span><b>{recognizedValue ? formatMoney(recognizedValue) : "—"}</b> wartość</span>
        </div>
      </section>

      <section className="pw-boq-table-card" aria-label="Pozycje BOQ">
        <div className="pw-boq-table-card__heading">
          <div><p className="co-kicker">Pozycje BOQ</p><h3>Zakres kosztorysowy</h3></div>
          <span>{boqItems.length} pozycji</span>
        </div>

        {boqItems.length ? (
          <div className="pw-boq-table-wrap">
            <table className="pw-boq-table">
              <thead>
                <tr>
                  <th>Pozycja</th>
                  <th>Opis</th>
                  <th>Ilość</th>
                  <th>Cena jedn.</th>
                  <th>Wartość</th>
                </tr>
              </thead>
              <tbody>
                {boqItems.map((item) => (
                  <tr key={item.id}>
                    <td data-label="Pozycja"><strong>{item.item_number ?? "—"}</strong></td>
                    <td data-label="Opis">{item.description}</td>
                    <td data-label="Ilość">{formatNumber(item.quantity)}{item.unit ? ` ${item.unit}` : ""}</td>
                    <td data-label="Cena jedn.">{item.unit_price == null ? "—" : formatMoney(Number(item.unit_price))}</td>
                    <td data-label="Wartość"><strong>{item.total_price == null ? "—" : formatMoney(Number(item.total_price))}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="pw-boq-empty">
            <FileSpreadsheet size={23} aria-hidden="true" />
            <div><strong>Brak pozycji BOQ</strong><p>Wrzuć kosztorys XLSX, CSV lub PDF przez Wrzutnię. Rozpoznane pozycje pojawią się tutaj.</p></div>
          </div>
        )}
      </section>

      <details className="pw-boq-tool">
        <summary><History size={16} aria-hidden="true" />Importy i analiza kosztorysu</summary>
        <ProjectLiveRecords projectId={projectId} kind="estimate" />
      </details>

      <details className="pw-boq-tool">
        <summary><FileText size={16} aria-hidden="true" />Źródła kosztorysu <span>{documents.length}</span></summary>
        {documents.length ? (
          <div className="pw-boq-sources">
            {documents.map((document) => (
              <div key={document.id}>
                <FileText size={15} aria-hidden="true" />
                <span><strong>{document.name}</strong><small>{document.category ?? "kosztorys"}</small></span>
              </div>
            ))}
          </div>
        ) : <p className="pw-boq-tool__empty">Brak przypisanych plików kosztorysowych.</p>}
      </details>

      <details id="boq-change-order" className="pw-boq-tool">
        <summary><Plus size={16} aria-hidden="true" />Zmiana zakresu / kontraktu</summary>
        <ProjectOperationPanel projectId={projectId} mode="change_order" />
      </details>
    </div>
  );
}
