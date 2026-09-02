import Link from "next/link";
import { ScanLine } from "lucide-react";
import { sourceModuleLabel, type DocumentSourceModule } from "@/lib/documents/source-module";
import styles from "./module-dropzone-link.module.css";

type Props = {
  workspaceId: string;
  sourceModule: DocumentSourceModule;
  variant?: "default" | "primary";
};

export function ModuleDropzoneLink({ workspaceId, sourceModule, variant = "default" }: Props) {
  const label = sourceModuleLabel(sourceModule);
  const href = `/workspace/companies/${workspaceId}/documents?upload=1&sourceModule=${sourceModule}#wrzutnia`;
  const className = variant === "primary" ? `primary-button ${styles.primary}` : styles.link;

  return (
    <Link
      className={className}
      href={href}
      title={`Otwórz Wrzutnię z kontekstem modułu: ${label}`}
      data-module-dropzone={sourceModule}
      data-module-dropzone-variant={variant}
    >
      <ScanLine size={16} aria-hidden="true" />
      <span>Wrzutnia</span>
      <small className={variant === "primary" ? styles.contextPrimary : styles.context}>{label}</small>
    </Link>
  );
}
