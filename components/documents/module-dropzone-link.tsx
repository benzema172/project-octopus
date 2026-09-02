import Link from "next/link";
import { ScanLine } from "lucide-react";
import { sourceModuleLabel, type DocumentSourceModule } from "@/lib/documents/source-module";
import styles from "./module-dropzone-link.module.css";

type Props = {
  workspaceId: string;
  sourceModule: DocumentSourceModule;
};

export function ModuleDropzoneLink({ workspaceId, sourceModule }: Props) {
  const label = sourceModuleLabel(sourceModule);
  const href = `/workspace/companies/${workspaceId}/documents?upload=1&sourceModule=${sourceModule}#wrzutnia`;

  return (
    <Link
      className={styles.link}
      href={href}
      title={`Otwórz Wrzutnię z kontekstem modułu: ${label}`}
      data-module-dropzone={sourceModule}
    >
      <ScanLine size={16} aria-hidden="true" />
      <span>Wrzutnia</span>
      <small className={styles.context}>{label}</small>
    </Link>
  );
}
